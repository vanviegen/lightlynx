// lightlynx-api v1
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const yaml = require('js-yaml');
const WebSocket = require('ws');

const CONFIG_FILE = 'lightlynx.yaml';
const PORT = 43597;

class LightLynxAPI {
    constructor(zigbee, mqtt, state, publishEntityState, eventBus, enableDisableExtension, restartCallback, addExtension, settings, logger) {
        this.zigbee = zigbee;
        this.mqtt = mqtt;
        this.state = state;
        this.publishEntityState = publishEntityState;
        this.eventBus = eventBus;
        this.enableDisableExtension = enableDisableExtension;
        this.restartCallback = restartCallback;
        this.addExtension = addExtension;
        this.settings = settings;
        this.logger = logger;
        this.mqttBaseTopic = settings.get().mqtt.base_topic;
        this.clients = new Map(); // ws -> {username, isAdmin, allowedDevices, allowedGroups, isLightLynx, allowRemote}
        this.config = this.loadConfig();
    }

    async start() {
        this.logger.info('LightLynx API starting...');
        
        // Seed admin user if it doesn't exist
        this.seedAdminUser();

        // Setup SSL certificate
        await this.setupSSL();

        if (!this.config.ssl?.certificate) {
            this.logger.error('LightLynx API: Failed to setup SSL. Cannot start server.');
            return;
        }

        // Create HTTPS server
        this.server = https.createServer({
            cert: this.config.ssl.certificate,
            key: this.config.ssl.private_key
        });

        this.server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));

        this.wss = new WebSocket.Server({ 
            noServer: true, 
            path: '/api'
        });
        this.wss.on('connection', (ws, req) => this.onConnection(ws, req));

        this.server.listen(PORT);
        this.logger.info(`LightLynx API listening on HTTPS port ${PORT}`);

        this.eventBus.onMQTTMessagePublished(this, (data) => this.onMQTTPublish(data));
        this.eventBus.onPublishEntityState(this, (data) => this.onEntityState(data));
        this.eventBus.onMQTTMessage(this, (data) => this.onMQTTRequest(data));

        // Daily refresh
        this.refreshTimer = setInterval(() => this.setupSSL(), 24 * 60 * 60 * 1000);
    }

    async stop() {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.eventBus.removeListeners(this);
        if (this.wss) {
            for (const client of this.wss.clients) {
                client.send(JSON.stringify({ topic: 'bridge/state', payload: { state: 'offline' } }));
                client.terminate();
            }
            this.wss.close();
        }
        if (this.server) await new Promise(r => this.server.close(r));
    }

    // === Config Management ===

    getDataPath() {
        return process.env.ZIGBEE2MQTT_DATA || path.join(__dirname, '..', '..', 'data');
    }

    loadConfig() {
        const configPath = path.join(this.getDataPath(), CONFIG_FILE);
        let config = { users: {}, ssl: {}, remote_access: false };
        try {
            if (fs.existsSync(configPath)) {
                config = yaml.load(fs.readFileSync(configPath, 'utf8')) || config;
            }
        } catch (e) {
            this.logger.error('LightLynx API: Error loading config: ' + e.message);
        }
        return config;
    }

    saveConfig(config) {
        if (config) this.config = config;
        const configPath = path.join(this.getDataPath(), CONFIG_FILE);
        fs.writeFileSync(configPath, yaml.dump(this.config));
    }

    // === SSL Management ===

    getLocalIP() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    const parts = iface.address.split('.');
                    if (parts.length === 4) {
                        const a = Number(parts[0]), b = Number(parts[1]);
                        // Private IP ranges
                        if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) {
                            return iface.address;
                        }
                    }
                }
            }
        }
        return null;
    }

    async setupSSL(force = false) {
        const lastRemoteAccess = this.config.last_remote_access_state;
        const remoteAccessChanged = lastRemoteAccess !== undefined && lastRemoteAccess !== this.config.remote_access;
        
        const localIP = this.getLocalIP();
        
        try {
            if (!this.config.ssl?.client_id) {
                this.logger.info('LightLynx API: Requesting new SSL certificate...');
                const response = await this.postJSON('https://cert.lightlynx.eu/create', { 
                    local_ip: localIP,
                    remote_access: this.config.remote_access
                });
                if (response.success) {
                    this.config.ssl = response;
                    this.config.last_remote_access_state = this.config.remote_access;
                    this.saveConfig();
                    this.logger.info(`LightLynx API: Certificate created for instance ID ${response.client_id}`);
                }
            } else {
                this.logger.info('LightLynx API: Refreshing SSL certificate/DNS...');
                const response = await this.postJSON('https://cert.lightlynx.eu/refresh', {
                    client_id: this.config.ssl.client_id,
                    secret_token: this.config.ssl.secret_token,
                    local_ip: localIP,
                    remote_access: this.config.remote_access,
                    force_refresh: force || remoteAccessChanged
                });
                if (response.success) {
                    const updatedSsl = { ...this.config.ssl, ...response };
                    if (response.certificate) {
                        updatedSsl.certificate = response.certificate;
                        updatedSsl.private_key = response.private_key;
                    }
                    this.config.ssl = updatedSsl;
                    this.config.last_remote_access_state = this.config.remote_access;
                    this.saveConfig();
                    this.logger.info(`LightLynx API: SSL check completed for instance ID ${this.config.ssl.client_id}`);
                }
            }
        } catch (err) {
            this.logger.error(`LightLynx API: SSL setup failed: ${err.message}`);
        }
    }

    async postJSON(url, body) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(body);
            const req = https.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': data.length
                }
            }, (res) => {
                let bytes = '';
                res.on('data', chunk => bytes += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(bytes)); }
                    catch (e) { reject(e); }
                });
            });
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    seedAdminUser() {
        if (!this.config.users.admin || !this.config.users.admin.secret) {
            const password = crypto.randomBytes(16).toString('hex');
            const saltString = "LightLynx-Salt-v1-" + "admin";
            const secret = crypto.pbkdf2Sync(password, saltString, 100000, 32, 'sha256').toString('hex');
            
            this.config.users.admin = {
                secret,
                isAdmin: true,
                allowRemote: true
            };
            this.saveConfig();
            this.logger.info(`LightLynx API: Created default 'admin' user with password: ${password}`);
        }
    }

    validateUser(username, password) {
        const user = this.config.users[username];
        if (!user) return null;

        if (password !== user.secret) return null;

        return {
            username,
            isAdmin: user.isAdmin || false,
            allowedDevices: user.allowedDevices || [],
            allowedGroups: user.allowedGroups || [],
            allowRemote: user.allowRemote || false
        };
    }

    getClientIP(req) {
        let ip = req.socket.remoteAddress;
        if (this.isLocalIP(ip) && req.headers['x-forwarded-for'])
            ip = req.headers['x-forwarded-for'].split(',')[0].trim();
        return ip && ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    }

    isLocalIP(ip) {
        if (!ip) return false;
        if (ip.startsWith('::ffff:')) ip = ip.slice(7);
        if (ip === '::1' || ip === 'localhost') return true;
        const parts = ip.split('.');
        if (parts.length !== 4) return ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd');
        const a = Number(parts[0]), b = Number(parts[1]);
        return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
    }

    getUsersForBroadcast() {
        const users = this.config.users;
        const result = {};
        for (const [name, user] of Object.entries(users)) {
            result[name] = {
                isAdmin: user.isAdmin || false,
                allowedDevices: user.allowedDevices || [],
                allowedGroups: user.allowedGroups || [],
                allowRemote: user.allowRemote || false
            };
        }
        return result;
    }

    // === WebSocket Handling ===

    onUpgrade(req, socket, head) {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== '/api') {
            socket.destroy();
            return;
        }

        const username = url.searchParams.get('user');
        const password = url.searchParams.get('secret');
        
        const isLightLynx = url.searchParams.get('lightlynx') === '1';
        const clientIP = this.getClientIP(req);

        const user = username ? this.validateUser(username, password) : null;
        if (!user) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        // Check remote access
        if (!user.allowRemote && !this.isLocalIP(clientIP)) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
        }

        this.wss.handleUpgrade(req, socket, head, (ws) => {
            this.clients.set(ws, { ...user, isLightLynx });
            this.wss.emit('connection', ws, req);
        });
    }

    onConnection(ws, req) {
        const clientInfo = this.clients.get(ws);
        this.logger.info(`LightLynx client connected: ${clientInfo.username} (lightlynx=${clientInfo.isLightLynx})`);

        ws.on('error', (err) => this.logger.error(`WebSocket error: ${err.message}`));
        ws.on('close', () => this.clients.delete(ws));
        ws.on('message', (data) => this.onClientMessage(ws, data));

        // Send initial state
        this.sendInitialState(ws, clientInfo);
    }

    sendInitialState(ws, clientInfo) {
        for (const [topic, msg] of Object.entries(this.mqtt.retainedMessages)) {
            if (!topic.startsWith(`${this.mqttBaseTopic}/`)) continue;
            const shortTopic = topic.slice(this.mqttBaseTopic.length + 1);
            let payload;
            try { payload = JSON.parse(msg.payload); } catch { payload = msg.payload; }

            // Filter for LightLynx clients
            if (clientInfo.isLightLynx) {
                payload = this.filterPayload(shortTopic, payload);
            }

            if (payload !== null) {
                ws.send(JSON.stringify({ topic: shortTopic, payload }));
            }
        }

        // Send device states
        for (const device of this.zigbee.devicesIterator((d) => d.type !== 'Coordinator')) {
            const payload = this.state.get(device);
            ws.send(JSON.stringify({ topic: device.name, payload }));
        }

        // Send users data for LightLynx clients
        if (clientInfo.isLightLynx && clientInfo.isAdmin) {
            ws.send(JSON.stringify({ topic: 'bridge/lightlynx/users', payload: this.getUsersForBroadcast() }));
            ws.send(JSON.stringify({ topic: 'bridge/lightlynx/config', payload: { remote_access: this.config.remote_access, instance_id: this.config.ssl?.client_id } }));
        }
    }

    filterPayload(topic, payload) {
        if (topic === 'bridge/extensions' && Array.isArray(payload)) {
            return payload.map(ext => ({
                name: ext.name,
                code: (ext.code || '').split('\n')[0]
            }));
        }

        if (topic === 'bridge/devices' && Array.isArray(payload)) {
            return payload.map(d => ({
                ieee_address: d.ieee_address,
                friendly_name: d.friendly_name,
                description: d.description,
                model_id: d.model_id,
                manufacturer: d.manufacturer,
                definition: d.definition ? {
                    description: d.definition.description,
                    vendor: d.definition.vendor,
                    exposes: this.filterExposes(d.definition.exposes)
                } : null
            }));
        }

        if (topic === 'bridge/groups' && Array.isArray(payload)) {
            return payload.map(g => ({
                id: g.id,
                friendly_name: g.friendly_name,
                description: g.description,
                scenes: (g.scenes || []).map(s => ({ id: s.id, name: s.name })),
                members: (g.members || []).map(m => ({ ieee_address: m.ieee_address }))
            }));
        }

        return payload;
    }

    filterExposes(exposes) {
        if (!Array.isArray(exposes)) return [];
        return exposes.map(e => {
            const filtered = { type: e.type, name: e.name };
            if (e.values) filtered.values = e.values;
            if (e.features) filtered.features = this.filterExposes(e.features);
            if (e.value_min !== undefined) filtered.value_min = e.value_min;
            if (e.value_max !== undefined) filtered.value_max = e.value_max;
            return filtered;
        });
    }

    onClientMessage(ws, data) {
        const clientInfo = this.clients.get(ws);
        if (!clientInfo) return;

        let msg;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        const { topic, payload } = msg;

        // Check permissions
        if (!this.checkPermission(clientInfo, topic, payload)) {
            this.logger.warning(`Permission denied for ${clientInfo.username} on ${topic}`);
            return;
        }

        this.mqtt.onMessage(`${this.mqttBaseTopic}/${topic}`, Buffer.from(JSON.stringify(payload)));
    }

    checkPermission(clientInfo, topic, payload) {
        if (clientInfo.isAdmin) return true;

        const parts = topic.split('/');
        if (parts[1] === 'set') {
            const device = this.findDeviceByName(parts[0]);
            if (device) {
                if (clientInfo.allowedDevices?.includes(device.ieeeAddr)) return true;
            } else {
                const group = this.findGroupByName(parts[0]);
                if (group) {
                    if (clientInfo.allowedGroups?.includes(group.id)) return true;
                }
            }
        }

        return false;
    }

    findDeviceByName(name) {
        for (const device of this.zigbee.devicesIterator()) {
            if (device.name === name || device.ieeeAddr === name) return device;
        }
        return null;
    }

    findGroupByName(name) {
        for (const group of this.zigbee.groupsIterator()) {
            if (group.name === name || String(group.id) === name) return group;
        }
        return null;
    }

    // === MQTT Event Handlers ===

    onMQTTPublish(data) {
        if (data.options.meta?.isEntityState || !data.topic.startsWith(`${this.mqttBaseTopic}/`)) return;

        const topic = data.topic.slice(this.mqttBaseTopic.length + 1);
        let payload;
        try { payload = JSON.parse(data.payload); } catch { payload = data.payload; }

        this.broadcast(topic, payload);
    }

    onEntityState(data) {
        this.broadcast(data.entity.name, data.message);
    }

    broadcast(topic, payload) {
        for (const [ws, clientInfo] of this.clients) {
            if (ws.readyState !== WebSocket.OPEN) continue;

            let filtered = payload;
            if (clientInfo.isLightLynx) {
                filtered = this.filterPayload(topic, payload);
            }

            if (filtered !== null) {
                ws.send(JSON.stringify({ topic, payload: filtered }));
            }
        }
    }

    // === User Management API ===

    async onMQTTRequest(data) {
        const prefix = `${this.mqttBaseTopic}/bridge/request/lightlynx/`;
        if (!data.topic.startsWith(prefix)) return;

        const path = data.topic.slice(prefix.length);
        const parts = path.split('/');
        const category = parts[0];
        const action = parts[1];
        
        let message;
        try { message = JSON.parse(data.message); } catch { message = {}; }
        
        let response;
        try {
            if (category === 'users') {
                switch (action) {
                    case 'list':
                        response = { data: this.getUsersForBroadcast(), status: 'ok' };
                        break;
                    case 'add':
                        response = this.addUser(message);
                        this.broadcastUsers();
                        break;
                    case 'update':
                        response = this.updateUser(message);
                        this.broadcastUsers();
                        break;
                    case 'delete':
                        response = this.deleteUser(message);
                        this.broadcastUsers();
                        break;
                    default:
                        response = { status: 'error', error: 'Unknown action' };
                }
            } else if (category === 'config') {
                switch (action) {
                    case 'get':
                        response = { data: { remote_access: this.config.remote_access, instance_id: this.config.ssl?.client_id }, status: 'ok' };
                        break;
                    case 'set_remote_access':
                        this.config.remote_access = !!message.enabled;
                        this.saveConfig();
                        await this.setupSSL(true);
                        response = { data: { remote_access: this.config.remote_access }, status: 'ok' };
                        // Broadcast update to all admin clients
                        this.broadcastConfig();
                        break;
                    default:
                        response = { status: 'error', error: 'Unknown action' };
                }
            } else {
                response = { status: 'error', error: 'Unknown category' };
            }
        } catch (err) {
            response = { status: 'error', error: err.message };
        }

        await this.mqtt.publish(`bridge/response/lightlynx/${path}`, JSON.stringify(response));

        // Broadcast updated users if change was successful

    }

    broadcastConfig() {
        const payload = { remote_access: this.config.remote_access, instance_id: this.config.ssl?.client_id };
        for (const [ws, clientInfo] of this.clients) {
            if (ws.readyState === WebSocket.OPEN && clientInfo.isAdmin) {
                ws.send(JSON.stringify({ topic: 'bridge/lightlynx/config', payload }));
            }
        }
    }

    addUser(message) {
        const { username, secret, isAdmin, allowedDevices, allowedGroups, allowRemote } = message;
        if (!username || !secret) throw new Error('Username and secret required');
        if (username === 'admin') throw new Error('Cannot add admin user');

        const users = this.config.users;
        if (users[username]) throw new Error('User already exists');

        users[username] = {
            secret,
            isAdmin: isAdmin || false,
            allowedDevices: allowedDevices || [],
            allowedGroups: allowedGroups || [],
            allowRemote: allowRemote || false
        };
        this.saveConfig();
        return { status: 'ok' };
    }

    updateUser(message) {
        const { username, secret, isAdmin, allowedDevices, allowedGroups, allowRemote } = message;
        if (!username) throw new Error('Username required');

        const users = this.config.users;
        if (!users[username]) throw new Error('User not found');

        if (secret) {
            users[username].secret = secret;
        }
        if (isAdmin !== undefined) users[username].isAdmin = isAdmin;
        if (allowedDevices !== undefined) users[username].allowedDevices = allowedDevices;
        if (allowedGroups !== undefined) users[username].allowedGroups = allowedGroups;
        if (allowRemote !== undefined) users[username].allowRemote = allowRemote;

        this.saveConfig();
        return { status: 'ok' };
    }

    deleteUser(message) {
        const { username } = message;
        if (!username) throw new Error('Username required');
        if (username === 'admin') throw new Error('Cannot delete admin user');

        const users = this.config.users;
        if (!users[username]) throw new Error('User not found');

        delete users[username];
        this.saveConfig();
        return { status: 'ok' };
    }

    broadcastUsers() {
        const payload = this.getUsersForBroadcast();
        for (const [ws, clientInfo] of this.clients) {
            if (ws.readyState === WebSocket.OPEN && clientInfo.isAdmin) {
                ws.send(JSON.stringify({ topic: 'bridge/lightlynx/users', payload }));
            }
        }
    }
}

module.exports = LightLynxAPI;
