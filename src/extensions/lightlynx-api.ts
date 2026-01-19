import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import dgram from 'dgram';
import WebSocket, { WebSocketServer } from 'ws';

const CONFIG_FILE = 'lightlynx.json';
const PORT = 43597;
const SSL_RENEW_THRESHOLD = 10 * 24 * 60 * 60 * 1000; // 10 days

interface UserConfig {
    secret: string;
    isAdmin: boolean;
    allowedDevices: string[];
    allowedGroups: number[];
    allowRemote: boolean;
}

interface SslConfig {
    expiresAt: number;
    nodeHttpsOptions: {
        cert: string;
        key: string;
    };
    localIp?: string;
    externalIp?: string;
}

interface LightLynxConfig {
    users: Record<string, UserConfig>;
    ssl?: SslConfig;
    externalPort?: number; // for UPnP
    remoteAccess: boolean;
}

class LightLynxAPI {
    private zigbee: any;
    private mqtt: any;
    private state: any;
    private eventBus: any;
    private logger: any;
    private mqttBaseTopic: string;
    private clients: Map<any, any> = new Map();
    private config: LightLynxConfig;
    private server?: http.Server | https.Server;
    private wss?: WebSocketServer;
    private refreshTimer?: NodeJS.Timeout;
    private activeScenes: Record<string, number | undefined> = {};
    private lastSceneTime: Record<string, number> = {};

    constructor(zigbee: any, mqtt: any, state: any, _publishEntityState: any, eventBus: any, _enableDisableExtension: any, _restartCallback: any, _addExtension: any, _settings: any, logger: any) {
        this.zigbee = zigbee;
        this.mqtt = mqtt;
        this.state = state;
        this.eventBus = eventBus;
        this.logger = logger;
        this.mqttBaseTopic = _settings.get().mqtt.base_topic;
        this.config = this.loadConfig();
    }

    async start() {
        this.seedAdminUser();

        const mock = (globalThis as any).MOCK_Z2M;

        if (mock && mock.certFile) {
            // Fallback for mock environment
            this.log('info', 'Starting using mock SSL certificate');
            const { cert, key } = JSON.parse(fs.readFileSync(mock.certFile, 'utf8'));
            
            this.config.ssl = {
                expiresAt: Date.now() + 1000000000,
                nodeHttpsOptions: { cert, key }
            };
        } else {
            this.log('info', 'Requesting SSL certificate');
            await this.setupSSL();
            this.log('info', 'Starting HTTPS server on port ' + PORT);
        }

        const ssl = this.config.ssl;
        if (!ssl?.nodeHttpsOptions?.cert) {
            this.log('error', 'Failed to setup SSL. Cannot start server.');
            return;
        }

        this.server = https.createServer(ssl.nodeHttpsOptions);

        this.server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));
        this.server.on('request', (req, res) => {
            if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('LightLynx API ready');
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        this.wss = new WebSocketServer({ 
            noServer: true, 
            path: '/api'
        });
        this.wss.on('connection', (ws: any, req: any) => this.onConnection(ws, req));

        this.server.listen(mock?.httpsPort || PORT);

        this.eventBus.onMQTTMessagePublished(this, (data: any) => this.onMQTTPublish(data));
        this.eventBus.onPublishEntityState(this, (data: any) => this.onEntityState(data));
        this.eventBus.onMQTTMessage(this, (data: any) => this.onMQTTRequest(data));

        // Refresh check every 59 minutes
        if (!mock) {
            this.refreshTimer = setInterval(() => this.setupSSL(), 59 * 60 * 1000);
        }
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
        if (this.server) await new Promise(r => this.server?.close(r as any));
    }

    // === Config Management ===

    private getDataPath() {
        return process.env.ZIGBEE2MQTT_DATA || path.join(__dirname, '..', '..', 'data');
    }

    private loadConfig(): LightLynxConfig {
        const configPath = path.join(this.getDataPath(), CONFIG_FILE);
        const defaultConfig: LightLynxConfig = { users: {}, remoteAccess: false };
        try {
            if (!fs.existsSync(configPath)) {
                return defaultConfig;
            }
            return JSON.parse(fs.readFileSync(configPath, 'utf8')) || defaultConfig;
        } catch (e: any) {
            this.log('error', 'Error loading configuration: ' + e.message);
            return defaultConfig;
        }
    }

    private saveConfig(config?: LightLynxConfig) {
        if (config) this.config = config;
        const configPath = path.join(this.getDataPath(), CONFIG_FILE);
        fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
    }

    // === SSL Management ===

    private getLocalIp(): Promise<string | undefined> {
        // This doesn't actually send anything, but figures out which interface would be used to reach the internet
        return new Promise((resolve) => {
            const socket = dgram.createSocket('udp4');
            socket.on('error', () => {
                socket.close();
                resolve(undefined);
            });
            socket.connect(80, '8.8.8.8', () => {
                const address = socket.address().address;
                socket.close();
                resolve(address);
            });
        });
   }

    private async getExternalHost(): Promise<string | null> {
        try {
            return await this.fetchText('https://cert.lightlynx.eu/ip');
        } catch (err) {
            return null;
        }
    }

    private log(level: 'info' | 'error' | 'warning', message: string) {
        this.logger[level](`LightLynx API: ${message}`);
    }

    private async setupSSL() {
        const cfg = this.config;

        const externalIp = (cfg.remoteAccess ? await this.getExternalHost() : undefined) || cfg.ssl?.externalIp;
        const localIp = await this.getLocalIp() || cfg.ssl?.localIp;
        let changes = false;

        if ((externalIp || localIp) && (!cfg.ssl || localIp !== cfg.ssl.localIp  || externalIp !== cfg.ssl.externalIp || cfg.ssl.expiresAt - Date.now() < SSL_RENEW_THRESHOLD)) {
            this.log('info', 'Requesting SSL certificate');
            try {
                const res: any = await this.postJSON('https://cert.lightlynx.eu/create', { 
                    localIp,
                    useExternalHost: cfg.remoteAccess
                });
                if (res.nodeHttpsOptions && res.expiresAt) {
                    cfg.ssl = res;
                    changes = true;
                    this.log('info', `New SSL certificate obtained (expires at ${new Date(res.expiresAt).toISOString()}), restarting...`);
                    await this.stop();
                    await this.start();
                } else {
                    this.log('error', 'SSL certificate request failed: ' + (res.error || JSON.stringify(res)));
                }
            } catch (err: any) {
                this.log('error', `SSL setup failed: ${err.message}`);
            }
        }

        if (cfg.remoteAccess) {
            const port = await this.setupUPnP(cfg.externalPort);
            if (port && port !== cfg.externalPort) {
                this.log('info', `UPnP external port mapped to ${port}`);
                cfg.externalPort = port;
                changes = true;
            }
        }

        if (changes) {
            this.saveConfig();
            this.broadcastConfig();
        }
    }

    private async setupUPnP(storedPort?: number): Promise<number | undefined> {
        try {
            const localIp = await this.getLocalIp();
            if (!localIp) throw new Error('Could not determine local IP');
            const gatewayUrl = await this.discoverGateway();
            if (!gatewayUrl) throw new Error('Could not find UPnP gateway');

            for (let i = 0; i < 4; i++) {
                // Try stored port for first 2 attempts, then switch to random
                const externalPort = (i < 2 && storedPort) ? storedPort : Math.floor(Math.random() * (65535 - 10000) + 10000);

                try {
                    await this.addPortMapping(gatewayUrl, localIp, PORT, externalPort, 'TCP', 'Light Lynx');
                    this.log('info', `UPnP port mapped: <router>:${externalPort} -> ${localIp}:${PORT}`);
                    return externalPort;
                } catch (err: any) {
                    this.log('warning', `UPnP mapping attempt ${i + 1} failed on ${externalPort}: ${err.message}`);
                    if (i < 3) await new Promise(r => setTimeout(r, 1000));
                }
            }
            throw new Error('Could not establish UPnP port mapping after 4 attempts');
        } catch (err: any) {
            this.log('warning', `UPnP setup failed: ${err.message}`);
            return undefined;
        }
    }

    private discoverGateway(): Promise<string | null> {
        return new Promise((resolve) => {
            const socket = dgram.createSocket('udp4');
            const query = [
                'M-SEARCH * HTTP/1.1',
                'HOST: 239.255.255.250:1900',
                'MAN: "ssdp:discover"',
                'MX: 3',
                'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1',
                '',
                ''
            ].join('\r\n');

            let resolved = false;
            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    socket.close();
                    resolve(null);
                }
            }, 3000);

            socket.on('message', (msg) => {
                const locationMatch = msg.toString().match(/LOCATION: (http:\/\/[^\r\n]+)/i);
                if (locationMatch && !resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    socket.close();
                    resolve(locationMatch[1]!);
                }
            });

            socket.send(query, 0, query.length, 1900, '239.255.255.250');
        });
    }

    private async addPortMapping(gatewayUrl: string, internalIp: string, internalPort: number, externalPort: number, protocol: string, description: string) {
        const descResponse = await new Promise<string>((resolve, reject) => {
            http.get(gatewayUrl, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', reject);
        });

        const serviceMatch = descResponse.match(/<serviceType>urn:schemas-upnp-org:service:WAN(IP|PPP)Connection:1<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/);
        if (!serviceMatch) throw new Error('Could not find WAN connection service in gateway description');

        const controlPath = serviceMatch[2]!;
        const url = new URL(gatewayUrl);
        const controlUrl = `${url.protocol}//${url.host}${controlPath.startsWith('/') ? '' : '/'}${controlPath}`;
        const soapAction = `urn:schemas-upnp-org:service:WAN${serviceMatch[1]}Connection:1#AddPortMapping`;
        const body = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:AddPortMapping xmlns:u="urn:schemas-upnp-org:service:WAN${serviceMatch[1]}Connection:1">
      <NewRemoteHost></NewRemoteHost>
      <NewExternalPort>${externalPort}</NewExternalPort>
      <NewProtocol>${protocol}</NewProtocol>
      <NewInternalPort>${internalPort}</NewInternalPort>
      <NewInternalClient>${internalIp}</NewInternalClient>
      <NewEnabled>1</NewEnabled>
      <NewPortMappingDescription>${description}</NewPortMappingDescription>
      <NewLeaseDuration>0</NewLeaseDuration>
    </u:AddPortMapping>
  </s:Body>
</s:Envelope>`;

        return new Promise<void>((resolve, reject) => {
            const req = http.request(controlUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/xml; charset="utf-8"',
                    'SOAPACTION': `"${soapAction}"`,
                    'Content-Length': Buffer.byteLength(body)
                }
            }, (res) => {
                if (res.statusCode === 200) resolve();
                else reject(new Error(`UPnP SOAP request failed with status ${res.statusCode}`));
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    private async postJSON(url: string, body: any) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(body);
            const req = https.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
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

    private async fetchText(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                let bytes = '';
                res.on('data', chunk => bytes += chunk);
                res.on('end', () => resolve(bytes.trim()));
            }).on('error', reject);
        });
    }

    private seedAdminUser() {
        if (!this.config.users.admin) {
            this.config.users.admin = {
                secret: '',
                isAdmin: true,
                allowedDevices: [],
                allowedGroups: [],
                allowRemote: false
            };
            this.saveConfig();
            this.log('info', `Created default 'admin' user with no password`);
        }
    }

    private validateUser(username: string, password: string): UserConfig | null {
        const user = this.config.users[username];
        if (!user) return null;
        // Empty secret means no password set - allow login with empty password
        if (user.secret === '' && password === '') return user;
        // Non-empty secret requires matching password
        if (password !== user.secret) return null;
        return user;
    }

    private getClientIp(req: http.IncomingMessage) {
        let ip = req.socket.remoteAddress;
        const forwarded = req.headers['x-forwarded-for'];
        if (this.isLocalIp(ip) && forwarded) {
            const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded;
            if (forwardedStr) ip = forwardedStr.split(',')[0]!.trim();
        }
        return ip && ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    }

    private isLocalIp(ip: string | undefined) {
        if (!ip) return false;
        if (ip.startsWith('::ffff:')) ip = ip.slice(7);
        if (ip === '::1' || ip === 'localhost') return true;
        const parts = ip.split('.');
        if (parts.length !== 4) return ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd');
        const a = Number(parts[0]), b = Number(parts[1]);
        return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
    }

    private getUsersForBroadcast() {
        const users = this.config.users;
        const result: Record<string, any> = {};
        for (const [name, user] of Object.entries(users)) {
            result[name] = {
                isAdmin: user.isAdmin,
                allowedDevices: user.allowedDevices,
                allowedGroups: user.allowedGroups,
                allowRemote: user.allowRemote,
                hasPassword: !!user.secret
            };
        }
        return result;
    }

    private onUpgrade(req: http.IncomingMessage, socket: any, head: Buffer) {
        const url = new URL(req.url!, 'http://localhost');
        if (url.pathname !== '/api') {
            socket.destroy();
            return;
        }

        const username = url.searchParams.get('user');
        const password = url.searchParams.get('secret') || '';
        const clientIp = this.getClientIp(req);

        const user = username ? this.validateUser(username, password) : null;
        if (!user) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        const externalIp = this.config.ssl?.externalIp;
        if (!user.allowRemote && !this.isLocalIp(clientIp) && clientIp !== externalIp) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
        }

        this.wss!.handleUpgrade(req, socket, head, (ws) => {
            this.clients.set(ws, { username, ...user });
            this.wss!.emit('connection', ws, req);
        });
    }

    private async onConnection(ws: WebSocket, _req: http.IncomingMessage) {
        const clientInfo = this.clients.get(ws);
        this.log('info', `Client connected: ${clientInfo.username}`);

        ws.on('error', (err) => this.log('error', `WebSocket error: ${err.message}`));
        ws.on('close', () => this.clients.delete(ws));
        ws.on('message', (data) => this.onClientMessage(ws, data));

        await this.sendInitialState(ws, clientInfo);
    }

    private async sendInitialState(ws: WebSocket, clientInfo: any) {
        for (const [topic, msg] of Object.entries(this.mqtt.retainedMessages as Record<string, any>)) {
            if (!topic.startsWith(`${this.mqttBaseTopic}/`)) continue;
            const shortTopic = topic.slice(this.mqttBaseTopic.length + 1);
            let payload: any;
            try { payload = JSON.parse(msg.payload); } catch { payload = msg.payload; }

            if (payload !== null) {
                payload = this.filterPayload(shortTopic, payload);
                ws.send(JSON.stringify({ topic: shortTopic, payload }));
            }
        }

        for (const device of this.zigbee.devicesIterator((d: any) => d.type !== 'Coordinator')) {
            const payload = this.state.get(device);
            ws.send(JSON.stringify({ topic: device.name, payload }));
        }

        if (clientInfo.isAdmin) {
            ws.send(JSON.stringify({ topic: 'bridge/lightlynx/users', payload: this.getUsersForBroadcast() }));
        }
        ws.send(JSON.stringify({ topic: 'bridge/lightlynx/config', payload: await this.getPayloadForConfig() }));
        ws.send(JSON.stringify({ topic: 'bridge/lightlynx/sceneSet', payload: this.activeScenes }));
    }

    private filterPayload(topic: string, payload: any) {
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
                scenes: (g.scenes || []).map((s: any) => ({ id: s.id, name: s.name })),
                members: (g.members || []).map((m: any) => ({ ieee_address: m.ieee_address }))
            }));
        }

        return payload;
    }

    private filterExposes(exposes: any[]): any[] {
        if (!Array.isArray(exposes)) return [];
        return exposes.map(e => {
            const filtered: any = { type: e.type, name: e.name };
            if (e.values) filtered.values = e.values;
            if (e.features) filtered.features = this.filterExposes(e.features);
            if (e.value_min !== undefined) filtered.value_min = e.value_min;
            if (e.value_max !== undefined) filtered.value_max = e.value_max;
            return filtered;
        });
    }

    private onClientMessage(ws: WebSocket, data: any) {
        const clientInfo = this.clients.get(ws);
        if (!clientInfo) return;

        let msg: any;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        const { topic, payload } = msg;

        if (!this.checkPermission(clientInfo, topic, payload)) {
            this.log('warning', `Permission denied for ${clientInfo.username} on ${topic}`);
            return;
        }

        this.mqtt.onMessage(`${this.mqttBaseTopic}/${topic}`, Buffer.from(JSON.stringify(payload)));
    }

    private checkPermission(clientInfo: any, topic: string, _payload: any) {
        if (clientInfo.isAdmin) return true;

        const parts = topic.split('/');
        const name = parts[0];
        if (name && parts[1] === 'set') {
            const device = this.findDeviceByName(name);
            if (device) {
                if (clientInfo.allowedDevices?.includes(device.ieeeAddr)) return true;
            } else {
                const group = this.findGroupByName(name);
                if (group) {
                    if (clientInfo.allowedGroups?.includes(group.id)) return true;
                }
            }
        }
        return false;
    }

    private findDeviceByName(name: string) {
        for (const device of this.zigbee.devicesIterator()) {
            if (device.name === name || device.ieeeAddr === name) return device;
        }
        return null;
    }

    private findGroupByName(name: string) {
        for (const group of this.zigbee.groupsIterator()) {
            if (group.name === name || String(group.id) === name) return group;
        }
        return null;
    }

    private onMQTTPublish(data: any) {
        if (data.options.meta?.isEntityState || !data.topic.startsWith(`${this.mqttBaseTopic}/`)) return;
        const topic = data.topic.slice(this.mqttBaseTopic.length + 1);
        let payload: any;
        try { payload = JSON.parse(data.payload); } catch { payload = data.payload; }
        this.broadcast(topic, payload);
    }

    private onEntityState(data: any) {
        this.broadcast(data.entity.name, data.message);
    }

    private broadcast(topic: string, payload: any) {
        payload = this.filterPayload(topic, payload);
        for (const [ws, _clientInfo] of this.clients) {
            if (ws.readyState !== WebSocket.OPEN) continue;
            if (payload !== null) {
                ws.send(JSON.stringify({ topic, payload }));
            }
        }
    }

    private handleSceneTracking(data: any) {
       
        if (!data.topic.startsWith(`${this.mqttBaseTopic}/`)) return;
        const parts = data.topic.slice(this.mqttBaseTopic.length + 1).split('/');
        if (parts[0] === 'bridge') return; // Ignore bridge topics
            
        
        const groupName = parts[0];
        if (!groupName || !this.findGroupByName(groupName)) return;
        
        if (parts.length === 2 && parts[1] === 'set') {
            // <base>/<groupName>/set - check for scene commands
            let message: any;
            try { message = JSON.parse(data.message); } catch { return; }
            
            if (message.scene_recall !== undefined) {
                const sceneId = message.scene_recall;
                this.lastSceneTime[groupName] = Date.now();
                if (this.activeScenes[groupName] !== sceneId) {
                    this.activeScenes[groupName] = sceneId;
                    this.broadcastSceneChange(groupName, sceneId);
                }
            }
        } else if (parts.length === 1) {
            // <base>/<groupName> - state update, clear scene if not recent
            const timeSinceScene = Date.now() - (this.lastSceneTime[groupName] || 0);
            if (timeSinceScene > 500 && this.activeScenes[groupName] !== undefined) {
                this.activeScenes[groupName] = undefined;
                this.broadcastSceneChange(groupName, undefined);
            }
        }
    }

    private broadcastSceneChange(groupName: string, sceneId: number | undefined) {
        const payload: Record<string, number | undefined> = { [groupName]: sceneId };
        for (const [ws, _clientInfo] of this.clients) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ topic: 'bridge/lightlynx/sceneSet', payload }));
            }
        }
    }

    private async onMQTTRequest(data: any) {
        // Handle scene tracking for group /set commands
        this.handleSceneTracking(data);

        const prefix = `${this.mqttBaseTopic}/bridge/request/lightlynx/`;
        if (!data.topic.startsWith(prefix)) return;

        const path = data.topic.slice(prefix.length);
        const parts = path.split('/');
        const category = parts[0];
        const action = parts[1];
        
        let message: any;
        try { message = JSON.parse(data.message); } catch { message = {}; }
        
        let response: any;
        try {
            if (category === 'config') {
                switch (action) {
                    case 'setRemoteAccess':
                        this.config.remoteAccess = !!message.enabled;
                        this.saveConfig();
                        await this.setupSSL();
                        response = { data: { remoteAccess: this.config.remoteAccess }, status: 'ok' };
                        this.broadcastConfig();
                        break;
                    case 'listUsers': response = { data: this.getUsersForBroadcast(), status: 'ok' }; break;
                    case 'addUser': response = this.addUser(message); this.broadcastUsers(); break;
                    case 'updateUser': response = this.updateUser(message); this.broadcastUsers(); break;
                    case 'deleteUser': response = this.deleteUser(message); this.broadcastUsers(); break;
                    default: response = { status: 'error', error: 'Unknown action' };
                }
            } else {
                response = { status: 'error', error: 'Unknown category' };
            }
        } catch (err: any) {
            response = { status: 'error', error: err.message };
        }
        if (message.transaction) response.transaction = message.transaction;
        await this.mqtt.publish(`bridge/response/lightlynx/${path}`, JSON.stringify(response));
    }

    private async broadcastConfig() {
        const payload = await this.getPayloadForConfig();
        for (const [ws, _clientInfo] of this.clients) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ topic: 'bridge/lightlynx/config', payload }));
            }
        }
    }

    private async getPayloadForConfig() {
        return { 
            remoteAccess: this.config.remoteAccess,
            externalAddress: this.config.remoteAccess && this.config.ssl?.externalIp && this.config.externalPort ? `${this.config.ssl.externalIp}:${this.config.externalPort}` : undefined,
        };
    }

    private addUser(message: any) {
        const { username, secret, isAdmin, allowedDevices, allowedGroups, allowRemote } = message;
        if (!username) throw new Error('Username required');
        if (username === 'admin') throw new Error('Cannot add admin user');
        if (this.config.users[username]) throw new Error('User already exists');
        // Block remote access if no password is set
        if (allowRemote && !secret) throw new Error('Cannot enable remote access without a password');
        this.config.users[username] = { secret: secret || '', isAdmin: !!isAdmin, allowedDevices: allowedDevices || [], allowedGroups: allowedGroups || [], allowRemote: !!allowRemote };
        this.saveConfig();
        return { status: 'ok' };
    }

    private updateUser(message: any) {
        const { username, secret, isAdmin, allowedDevices, allowedGroups, allowRemote } = message;
        if (!username) throw new Error('Username required');
        const user = this.config.users[username];
        if (!user) throw new Error('User not found');
        if (secret !== undefined) user.secret = secret;
        if (isAdmin !== undefined) user.isAdmin = isAdmin;
        if (allowedDevices !== undefined) user.allowedDevices = allowedDevices;
        if (allowedGroups !== undefined) user.allowedGroups = allowedGroups;
        if (allowRemote !== undefined) {
            // Block remote access if no password is set
            if (allowRemote && !user.secret) throw new Error('Cannot enable remote access without a password');
            user.allowRemote = allowRemote;
        }
        this.saveConfig();
        return { status: 'ok' };
    }

    private deleteUser(message: any) {
        const { username } = message;
        if (!username) throw new Error('Username required');
        if (username === 'admin') throw new Error('Cannot delete admin user');
        if (!this.config.users[username]) throw new Error('User not found');
        delete this.config.users[username];
        this.saveConfig();
        return { status: 'ok' };
    }

    private broadcastUsers() {
        const payload = this.getUsersForBroadcast();
        for (const [ws, clientInfo] of this.clients) {
            if (ws.readyState === WebSocket.OPEN && clientInfo.isAdmin) {
                ws.send(JSON.stringify({ topic: 'lightlynx/users', payload }));
            }
        }
    }
}


module.exports = LightLynxAPI;
