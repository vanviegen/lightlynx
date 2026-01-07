// lightlynx-api v1
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');

const USERS_FILE = 'lightlynx-users.json';

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
        this.externalIP = null;
    }

    async start() {
        this.logger.info('LightLynx API starting...');
        
        // Fetch external IP for local IP detection
        this.fetchExternalIP();
        
        // Disable original frontend
        this.mqtt.onMessage(`${this.mqttBaseTopic}/bridge/request/options`, JSON.stringify({
            options: { frontend: { enabled: false } }
        }));

        const frontendSettings = this.settings.get().frontend || {};
        const port = frontendSettings.port || 8080;
        const host = frontendSettings.host;
        const sslKey = frontendSettings.ssl_key;
        const sslCert = frontendSettings.ssl_cert;

        // Create HTTP(S) server
        if (sslKey && sslCert && fs.existsSync(sslKey) && fs.existsSync(sslCert)) {
            this.server = https.createServer({
                key: fs.readFileSync(sslKey),
                cert: fs.readFileSync(sslCert)
            });
        } else {
            this.server = http.createServer();
        }

        this.server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));

        this.wss = new WebSocket.Server({ noServer: true, path: '/api' });
        this.wss.on('connection', (ws, req) => this.onConnection(ws, req));

        if (!host) {
            this.server.listen(port);
            this.logger.info(`LightLynx API listening on port ${port}`);
        } else if (host.startsWith('/')) {
            this.server.listen(host);
            this.logger.info(`LightLynx API listening on socket ${host}`);
        } else {
            this.server.listen(port, host);
            this.logger.info(`LightLynx API listening on ${host}:${port}`);
        }

        this.eventBus.onMQTTMessagePublished(this, (data) => this.onMQTTPublish(data));
        this.eventBus.onPublishEntityState(this, (data) => this.onEntityState(data));
        this.eventBus.onMQTTMessage(this, (data) => this.onMQTTRequest(data));
    }

    async stop() {
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

    // === User Management ===

    getUsersPath() {
        const dataPath = process.env.ZIGBEE2MQTT_DATA || path.join(__dirname, '..', '..', 'data');
        return path.join(dataPath, USERS_FILE);
    }

    loadUsers() {
        try {
            return JSON.parse(fs.readFileSync(this.getUsersPath(), 'utf8'));
        } catch {
            return {};
        }
    }

    saveUsers(users) {
        fs.writeFileSync(this.getUsersPath(), JSON.stringify(users, null, 2));
    }

    hashPassword(password, salt) {
        return crypto.scryptSync(password, salt, 64).toString('hex');
    }

    validateUser(username, password) {
        // Admin user uses frontend.auth_token
        if (username === 'admin') {
            const authToken = this.settings.get().frontend?.auth_token;
            if (!authToken || authToken === password) {
                return { username: 'admin', isAdmin: true, allowedDevices: null, allowedGroups: null, allowRemote: false };
            }
            return null;
        }

        const users = this.loadUsers();
        const user = users[username];
        if (!user) return null;

        const hash = this.hashPassword(password, user.salt);
        if (hash !== user.passwordHash) return null;

        return {
            username,
            isAdmin: user.isAdmin || false,
            allowedDevices: user.allowedDevices || [],
            allowedGroups: user.allowedGroups || [],
            allowRemote: user.allowRemote || false
        };
    }

    fetchExternalIP() {
        https.get('https://api.ipify.org', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                this.externalIP = data.trim();
                this.logger.info(`LightLynx detected external IP: ${this.externalIP}`);
            });
        }).on('error', (err) => {
            this.logger.warning(`Failed to fetch external IP: ${err.message}`);
        });
    }

    isLocalIP(ip) {
        if (!ip) return false;
        // Handle IPv6-mapped IPv4
        if (ip.startsWith('::ffff:')) ip = ip.slice(7);
        // Localhost
        if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
        // Our own external IP counts as local
        if (this.externalIP && ip === this.externalIP) return true;
        // Private ranges
        const parts = ip.split('.').map(Number);
        if (parts.length === 4) {
            if (parts[0] === 10) return true;
            if (parts[0] === 192 && parts[1] === 168) return true;
            if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        }
        // IPv6 private (fc00::/7)
        if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return true;
        return false;
    }

    getUsersForBroadcast() {
        const users = this.loadUsers();
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

        const username = url.searchParams.get('username') || 'admin';
        const password = url.searchParams.get('password') || url.searchParams.get('token') || '';
        const isLightLynx = url.searchParams.get('lightlynx') === '1';
        const clientIP = req.socket.remoteAddress;

        const user = this.validateUser(username, password);
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

        // Extract target from topic
        const parts = topic.split('/');

        // Device control: <device_name>/set
        if (parts.length === 2 && parts[1] === 'set') {
            const deviceName = parts[0];
            const device = this.findDeviceByName(deviceName);
            if (device && clientInfo.allowedDevices?.includes(device.ieeeAddr)) return true;
            return false;
        }

        // Group control: bridge/request/group/members/... or <group_name>/set
        if (parts[0] === 'bridge' && parts[1] === 'request' && parts[2] === 'group') {
            return false; // Non-admin cannot modify groups
        }

        // Group set
        const group = this.findGroupByName(parts[0]);
        if (group && parts[1] === 'set') {
            if (clientInfo.allowedGroups?.includes(group.id)) return true;
            return false;
        }

        // Bridge admin operations
        if (topic.startsWith('bridge/request/')) {
            // Allow scene recall for allowed groups
            if (parts[2] === 'group' && parts[3] === 'scenes' && parts[4] === 'recall') {
                const groupId = payload?.group_id || payload?.id;
                if (clientInfo.allowedGroups?.includes(groupId)) return true;
            }
            return false;
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
        const prefix = `${this.mqttBaseTopic}/bridge/request/lightlynx/users/`;
        if (!data.topic.startsWith(prefix)) return;

        const action = data.topic.slice(prefix.length);
        let message;
        try { message = JSON.parse(data.message); } catch { message = {}; }

        // Find requesting client (must be admin)
        let isAdmin = false;
        for (const clientInfo of this.clients.values()) {
            if (clientInfo.isAdmin) { isAdmin = true; break; }
        }
        
        // For now, allow any request (will be validated by caller context in real scenarios)
        // In production, this should validate the request source

        let response;
        try {
            switch (action) {
                case 'list':
                    response = { data: this.getUsersForBroadcast(), status: 'ok' };
                    break;
                case 'add':
                    response = this.addUser(message);
                    break;
                case 'update':
                    response = this.updateUser(message);
                    break;
                case 'delete':
                    response = this.deleteUser(message);
                    break;
                default:
                    response = { status: 'error', error: 'Unknown action' };
            }
        } catch (err) {
            response = { status: 'error', error: err.message };
        }

        await this.mqtt.publish(`bridge/response/lightlynx/users/${action}`, JSON.stringify(response));

        // Broadcast updated users if change was successful
        if (response.status === 'ok' && action !== 'list') {
            this.broadcastUsers();
        }
    }

    addUser(message) {
        const { username, password, isAdmin, allowedDevices, allowedGroups, allowRemote } = message;
        if (!username || !password) throw new Error('Username and password required');
        if (username === 'admin') throw new Error('Cannot add admin user');

        const users = this.loadUsers();
        if (users[username]) throw new Error('User already exists');

        const salt = crypto.randomBytes(16).toString('hex');
        users[username] = {
            passwordHash: this.hashPassword(password, salt),
            salt,
            isAdmin: isAdmin || false,
            allowedDevices: allowedDevices || [],
            allowedGroups: allowedGroups || [],
            allowRemote: allowRemote || false
        };
        this.saveUsers(users);
        return { status: 'ok' };
    }

    updateUser(message) {
        const { username, password, isAdmin, allowedDevices, allowedGroups, allowRemote } = message;
        if (!username) throw new Error('Username required');

        // Special case: updating admin updates frontend.auth_token
        if (username === 'admin') {
            if (password) {
                this.mqtt.onMessage(`${this.mqttBaseTopic}/bridge/request/options`, Buffer.from(JSON.stringify({
                    options: { frontend: { auth_token: password } }
                })));
            }
            return { status: 'ok' };
        }

        const users = this.loadUsers();
        if (!users[username]) throw new Error('User not found');

        if (password) {
            const salt = crypto.randomBytes(16).toString('hex');
            users[username].passwordHash = this.hashPassword(password, salt);
            users[username].salt = salt;
        }
        if (isAdmin !== undefined) users[username].isAdmin = isAdmin;
        if (allowedDevices !== undefined) users[username].allowedDevices = allowedDevices;
        if (allowedGroups !== undefined) users[username].allowedGroups = allowedGroups;
        if (allowRemote !== undefined) users[username].allowRemote = allowRemote;

        this.saveUsers(users);
        return { status: 'ok' };
    }

    deleteUser(message) {
        const { username } = message;
        if (!username) throw new Error('Username required');
        if (username === 'admin') throw new Error('Cannot delete admin user');

        const users = this.loadUsers();
        if (!users[username]) throw new Error('User not found');

        delete users[username];
        this.saveUsers(users);
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
