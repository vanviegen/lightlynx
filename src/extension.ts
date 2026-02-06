import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import dgram from 'dgram';
import WebSocket, { WebSocketServer } from 'ws';
import { Config, Group, Light, Scene, Toggle, State, Trigger, User, StripUnderscoreKeys, UserWithName } from './types';
import { applyDelta, createDelta, createDeltaRecurse, deepClone } from './json-merge-patch';
import { createZ2MLightDelta, tailorLightState, DEFAULT_TRIGGERS } from './colors';

const EXTENSION_VERSION = 1;
const CONFIG_PATH = path.join(process.env.ZIGBEE2MQTT_DATA || path.join(__dirname, '..', '..', 'data'), 'lightlynx.json');
const SSL_RENEW_THRESHOLD = 10 * 24 * 60 * 60 * 1000; // 10 days

// Read configuration from environment
const PORT = parseInt(process.env.LIGHTLYNX_PORT || '43597');
const INSECURE = !['', '0', 'false'].includes(process.env.LIGHTLYNX_INSECURE || '');
const CERT_FILE = process.env.LIGHTLYNX_CERT_FILE;

// Sun calculation constants
const DEFAULT_ZENITH = 90.8333;
const DEGREES_PER_HOUR = 360 / 24;

const CLICK_COUNTS: Record<string, number> = {
    single: 1,
    double: 2,
    triple: 3,
    quadruple: 4,
    many: 5
};


class LightLynx {
    // MQTT and Zigbee references
    // private zigbee: any;
    private mqtt: any;
    private state: any;
    private eventBus: any;
    private logger: any;
    private mqttBaseTopic: string;

    private webSocketUsers: Map<WebSocket, UserWithName> = new Map();
    private pendingBridgeRequests: Map<number, { resolve: (value: any) => void, reject: (reason: any) => void }> = new Map();
    private nextTransactionId = 1;

    private store: State;
    private storeCopy: StripUnderscoreKeys<State>; // To determine delta for emitting to WebSockets
    private emitChangesTimeout: NodeJS.Timeout | undefined = undefined; // Batch emitting deltas

    private groupIdsByNames: Record<string, number> = {}; // name -> groupId
    private deviceIdsByName: Record<string, string> = {}; // name -> ieee

    private server?: http.Server | https.Server;
    private wss?: WebSocketServer;
    private sslRefreshTimer?: NodeJS.Timeout;

    // For automation
    private clickCounts: Map<string, number> = new Map();
    private clickTimers: Map<string, NodeJS.Timeout> = new Map();
    private timeTriggerInterval?: NodeJS.Timeout;

    private configJson: string = '';

    constructor(_zigbee: any, mqtt: any, state: any, _publishEntityState: any, eventBus: any, _enableDisableExtension: any, _restartCallback: any, _addExtension: any, _settings: any, logger: any) {
        // this.zigbee = zigbee;
        this.mqtt = mqtt;
        this.state = state;
        this.eventBus = eventBus;
        this.logger = logger;
        this.mqttBaseTopic = _settings.get().mqtt.base_topic;

        let config: Config = {
            allowRemote: false,
            automationEnabled: false,
            latitude: 52.24, // Enschede NL (center of the known universe)
            longitude: 6.88,
            users: {
                admin: {
                    secret: '',
                    isAdmin: true,
                    allowedGroupIds: [],
                    allowRemote: false
                },
            },
            _sceneStates: {},
            _groupTimeouts: {},
            _sceneTriggers: {},
            _toggleGroupLinks: {},
        };
        try {
            if (fs.existsSync(CONFIG_PATH)) {
                this.configJson = fs.readFileSync(CONFIG_PATH, 'utf8');
                Object.assign(config, JSON.parse(this.configJson));
            }
        } catch (e: any) {
            this.log('error', `Error loading configuration ${CONFIG_PATH}: ${e.message}`);
        }

        this.store = {
            lights: {},
            toggles: {},
            groups: {},
            permitJoin: false,
            config,
        }
        this.storeCopy = deepClone(this.store);
    }

    private log(level: 'info' | 'error' | 'warning', message: string) {
        this.logger[level](`Light Lynx: ${message}`);
    }

    /** Called by Zigbee2MQTT. */
    async start() {
        // Setups IP addresses, SSL certificates and UPnP port mapping. Update every 59 minutes.
        await this.setupNetworking();
        this.sslRefreshTimer = setInterval(() => this.setupNetworking(), 59 * 60 * 1000);

        // Create either a http or an https server
        if (INSECURE) {
            this.log('info', 'Starting INSECURE (no TLS) WebSocket server on port ' + PORT);
            this.server = http.createServer();
        } else {
            this.log('info', 'Starting secure WebSocket server on port ' + PORT);
            const ssl = this.store.config._ssl;
            if (!ssl?.nodeHttpsOptions?.cert) {
                const err = 'Failed to setup SSL. Cannot start server.';
                this.log('error', err);
                throw new Error(err);
            }
            this.server = https.createServer(ssl.nodeHttpsOptions);
        }

        // Setup and start the HTTP(S) and WebSocket servers
        this.server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));
        this.server.on('request', (req, res) => {
            if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Light Lynx API ready. See https://lightlynx.eu/ for info.');
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        this.wss = new WebSocketServer({ 
            noServer: true, 
            path: '/api'
        });

        this.server.listen(PORT);

        // We gather and maintain state based on the outgoing MQTT messages send by Zigbee2MQTT.
        // This feels more robust than trying to hook into Zigbee2MQTT internals.
        this.eventBus.onMQTTMessagePublished(this, (data: any) => this.onOutgoingMQTT(data));
        for(const data of Object.values(this.mqtt.retainedMessages) as {topic: string, payload: string}[]) {
            this.onOutgoingMQTT({topic: this.mqttBaseTopic + '/' + data.topic, payload: data.payload});
        }

        // We hook into incoming MQTT messages (including the simulated ones we send ourselves),
        // in order to capture which scenes are being set.
        this.eventBus.onMQTTMessage(this, (data: any) => this.onIncomingMQTT(data));

        // TODO: no longer needed?
        // this.eventBus.onPublishEntityState(this, (data: any) => this.onEntityState(data));
        
        // Check time based triggers every 10s
        this.timeTriggerInterval = setInterval(this.handleTimeTriggers.bind(this), 10000);
    }

    /** Called by Zigbee2MQTT, in particular before we upgrade. */
    async stop() {
        if (this.sslRefreshTimer) clearInterval(this.sslRefreshTimer);
        if (this.timeTriggerInterval) clearInterval(this.timeTriggerInterval);
        this.eventBus.removeListeners(this);

        if (this.wss) {
            for (const client of this.wss.clients) {
                client.terminate();
            }
            this.wss.close();
        }
        if (this.server) await new Promise(r => this.server?.close(r as any));
    }

    /** Sync store data to config and write to file if changed. Called automatically from emitChangesNow. */
    private saveConfig() {
        const cfg = this.store.config;
        
        // Copy group timeouts to config
        cfg._groupTimeouts = {};
        for (const [id, group] of Object.entries(this.store.groups)) {
            if (group.timeout) cfg._groupTimeouts[Number(id)] = group.timeout;
        }
        
        // Copy scene triggers to config
        cfg._sceneTriggers = {};
        for (const [groupId, group] of Object.entries(this.store.groups)) {
            for (const [sceneId, scene] of Object.entries(group.scenes)) {
                if (scene.triggers?.length) {
                    (cfg._sceneTriggers[Number(groupId)] ||= {})[Number(sceneId)] = scene.triggers;
                }
            }
        }
        
        // Copy toggle group links to config
        cfg._toggleGroupLinks = {};
        for (const [ieee, toggle] of Object.entries(this.store.toggles)) {
            if (toggle.linkedGroupIds?.length) {
                cfg._toggleGroupLinks[ieee] = toggle.linkedGroupIds;
            }
        }
        
        // Copy scene states to config
        cfg._sceneStates = {};
        for (const [groupId, group] of Object.entries(this.store.groups)) {
            for (const [sceneId, scene] of Object.entries(group.scenes)) {
                if (scene.lightStates) {
                    (cfg._sceneStates[Number(groupId)] ||= {})[Number(sceneId)] = scene.lightStates;
                }
            }
        }
        
        // Only write if changed
        const json = JSON.stringify(cfg, null, 2);
        if (this.configJson !== json) {
            fs.writeFileSync(CONFIG_PATH, json);
            this.configJson = json;
        }
    }

    /** Returns whatever IP the system uses for internet requests. */
    private getLocalIp(): Promise<string | undefined> {
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

    /** Returns the IP that the outside world sees of us (which differs from getLocalIp when
     * we're behind a NAT). */
    private async getExternalHost(): Promise<string | null> {
        try {
            return (await this.httpRequest('https://cert.lightlynx.eu/ip')).body.trim();
        } catch (err) {
            return null;
        }
    }

    /** Obtains initial certificate valid for DNS-ified local and external IPs, or sees if
     * a renewal is needed. Always renews when any of the IPs have changed.
     * Stores results in this.store.config._ssl.
     * Also updates this.store.localAddress and this.store.externalAddress.
    */
    private async setupNetworking() {
        const cfg = this.store.config;
        let ssl = cfg._ssl;

        const localIp = await this.getLocalIp();
        const externalIp = cfg.allowRemote ? await this.getExternalHost() : undefined;

        this.store.localAddress = localIp ? `${localIp}:${PORT}` : undefined;

        // If an IP is unset, while the other remains the same, we don't need to trigger a renewal.
        const sslExternalIp = (externalIp || ssl?.localIp !== localIp) ? externalIp : ssl?.externalIp;
        const sslInternalIp = (localIp || ssl?.externalIp !== externalIp) ? localIp : ssl?.localIp;

        if (cfg.allowRemote && localIp) {
            // Run UPnP port mapping setup in background. We don't need to wait for this on
            // startup (especially since we may not be behind a UPnP-capable gateway at all).
            (async () => {
                const port = await this.setupUPnP(localIp, PORT, cfg._externalPort);
                if (port !== cfg._externalPort) {
                    cfg._externalPort = port;
                    this.saveConfig();
                    if (port) {
                        this.log('info', `UPnP external port mapped to ${port}`);
                        this.store.externalAddress = externalIp && cfg._externalPort ? `${externalIp}:${cfg._externalPort}` : undefined;
                        this.scheduleEmitChanges();
                    }
                }
            })();
        }

        if (!INSECURE && (externalIp || localIp) && (!ssl || sslInternalIp !== ssl.localIp || sslExternalIp !== ssl.externalIp || ssl.expiresAt - Date.now() < SSL_RENEW_THRESHOLD)) {
            try {
                let res: any;
                if (CERT_FILE) {
                    this.log('info', 'Loading SSL certificate from file ' + CERT_FILE);
                    const { cert, key } = JSON.parse(fs.readFileSync(CERT_FILE, 'utf8'));            
                    res = {
                        expiresAt: Date.now() + 24 * 3600 * 1000,
                        nodeHttpsOptions: { cert, key }
                    };
                } else {
                    this.log('info', `Requesting SSL certificate localIp=${localIp} useExternalHost=${cfg.allowRemote}`);
                    const response = await this.httpRequest('https://cert.lightlynx.eu/create', {
                        method: 'POST',
                        body: JSON.stringify({ localIp, useExternalHost: cfg.allowRemote }),
                        headers: { 'Content-Type': 'application/json' }
                    });
                    res = JSON.parse(response.body);
                }

                if (res && res.nodeHttpsOptions && res.expiresAt) {
                    cfg._ssl = res;
                    this.saveConfig();
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
        
        this.store.externalAddress = externalIp && cfg._externalPort ? `${externalIp}:${cfg._externalPort}` : undefined;
        this.scheduleEmitChanges();
    }

    /** Tries to map localIp:localPort to preferredExternalPort on the NAT router.
     * If the port is not available, a random other port is attempted. The mapped port
     * is returned, or undefined on failure.
     */
    private async setupUPnP(localIp: string, localPort: number, preferredExternalPort?: number): Promise<number | undefined> {
        try {
            const gatewayUrl = await this.discoverGateway();
            if (!gatewayUrl) {
                this.log('warning', 'Could not find UPnP gateway');
                return undefined;
            }
            for (let i = 0; i < 4; i++) {
                const externalPort = (i < 2 && preferredExternalPort) ? preferredExternalPort : Math.floor(Math.random() * (65535 - 10000) + 10000);
                try {
                    await this.portMapUPnP(gatewayUrl, localIp, localPort, externalPort, 'TCP', 'LightLynx');
                    this.log('info', `UPnP port mapped: <router>:${externalPort} -> ${localIp}:${localPort}`);
                    return externalPort;
                } catch (err: any) {
                    this.log('warning', `UPnP mapping attempt ${i + 1} failed on ${externalPort}: ${err.message}`);
                    if (i < 3) await new Promise(r => setTimeout(r, 1000));
                }
            }
            this.log('warning', 'Could not establish UPnP port mapping after 4 attempts');
            return undefined;
        } catch (err: any) {
            this.log('warning', `UPnP setup failed: ${err.message}`);
            return undefined;
        }
    }

    /** Tries for 3s to discover the UPnP gateway. Returns gateway URL or undefined. */
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

    /** Returns nothings. Throws on failure (which is not at all unlikely). */
    private async portMapUPnP(gatewayUrl: string, internalIp: string, internalPort: number, externalPort: number, protocol: string, description: string) {
        const descResponse = (await this.httpRequest(gatewayUrl)).body;

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

        const res = await this.httpRequest(controlUrl, {
            method: 'POST',
            body,
            headers: {
                'Content-Type': 'text/xml; charset="utf-8"',
                'SOAPACTION': `"${soapAction}"`
            }
        });
        if (res.status !== 200) throw new Error(`UPnP SOAP request failed with status ${res.status}`);
    }

    /** Generic HTTP request helper method. */
    private httpRequest(url: string, options?: { method?: string, body?: string, headers?: Record<string, string> }): Promise<{ status: number, body: string }> {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const httpModule = parsedUrl.protocol === 'https:' ? https : http;
            const headers: Record<string, string> = { ...options?.headers };
            if (options?.body) headers['Content-Length'] = String(Buffer.byteLength(options.body));

            const req = httpModule.request(parsedUrl, { method: options?.method || 'GET', headers }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => resolve({ status: res.statusCode || 0, body }));
            });
            req.on('error', reject);
            if (options?.body) req.write(options.body);
            req.end();
        });
    }

    /** Returns client IP address for HTTP connection, taking proxy headers into account */
    private getClientIp(req: http.IncomingMessage) {
        let ip = req.socket.remoteAddress;
        const forwarded = req.headers['x-forwarded-for'];
        if (this.isLocalIp(ip) && forwarded) {
            const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded;
            if (forwardedStr) ip = forwardedStr.split(',')[0]!.trim();
        }
        return ip && ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    }

    /** Given an ipv4/ipv6 address, return if it's a local/private/internal address */
    private isLocalIp(ip: string | undefined) {
        if (!ip) return false;
        if (ip.startsWith('::ffff:')) ip = ip.slice(7);
        if (ip === '::1' || ip === 'localhost') return true;
        const parts = ip.split('.');
        if (parts.length !== 4) return ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd');
        const a = Number(parts[0]), b = Number(parts[1]);
        return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
    }

    /** Called by http server on 'upgrade' event. Check permissions, and attach
     * socket to WebSocket server if valid.
     */
    private onUpgrade(req: http.IncomingMessage, socket: any, head: Buffer) {
        try {
            const url = new URL(req.url!, 'http://localhost');
            if (url.pathname !== '/api') throw new Error('Invalid WebSocket path.');

            const userName = url.searchParams.get('user');
            if (!userName) throw new Error('No userName provided.');
            const secret = url.searchParams.get('secret') || '';
            
            const user = this.store.config.users[userName];
            if (!user || secret !== user.secret) throw new Error('Invalid user name or password.');
            const userWithName = { name: userName, ...user };
            
            const clientIp = this.getClientIp(req);
            const isRemote = !this.isLocalIp(clientIp) && clientIp !== this.store.config._ssl?.externalIp;
            if (isRemote && !this.store.config.allowRemote) {
                throw new Error('Remote access is disabled on this server.');
            }
            if (isRemote && !user.allowRemote) {
                throw new Error('Remote access not permitted for user.');
            }
            this.wss!.handleUpgrade(req, socket, head, (ws) => {
                this.onWebSocketAuthenticated(ws, userWithName);
            });
            
        } catch (err: any) {
            this.wss!.handleUpgrade(req, socket, head, (ws) => {
                ws.send(JSON.stringify(['error', err.message]));
                ws.close();
            });
        }
    }

    /** Called for new WebSocket connections after successful authentication.
     * Attach event handlers and send initial state.
     */
    private async onWebSocketAuthenticated(ws: WebSocket, user: UserWithName) {
        this.webSocketUsers.set(ws, user);
        this.log('info', `Client connected: ${user.name}`);

        ws.on('error', (err) => this.log('error', `WebSocket error: ${err.message}`));
        ws.on('close', () => this.webSocketUsers.delete(ws));
        ws.on('message', (data) => this.onUserMessage(ws, data));

        const delta = createDeltaRecurse(this.store, {});
        delta.me = user;
        ws.send(JSON.stringify(['init', EXTENSION_VERSION, delta]));
    }

    /** Handle patch-config command from user. */
    private userPatchConfig(clientInfo: any, delta: any) {
        if (!clientInfo.isAdmin) throw new Error('Permission denied: not an admin user');
        applyDelta(this.store.config, delta);
        if (delta.remoteAccess !== undefined) this.setupNetworking(); // in the background
    }

    /** Handle set-state command from user for a zigbee group. */
    private async userSetGroupState(user: User, groupId: number, state: any) {
        const group = this.store.groups[groupId];
        if (!group) throw new Error(`Group ${groupId} not found`);
        if (!user.isAdmin && !user.allowedGroupIds?.includes(groupId)) throw new Error("Permission denied for group");

        // First send a command to the zigbee group.
        const delta = createZ2MLightDelta({}, state);
        this.sendMqttCommand(`${groupId}/set`, delta);

        // Then send more tailored commands to each light in the group, if needed.
        // This may be the case when sending a color command to a light that only
        // supports color temperature.
        for (const ieee of group.lightIds) {
            const light = this.store.lights[ieee];
            if (!light) continue;
            const tailoredDelta = createZ2MLightDelta(light.lightState, tailorLightState(state, light.lightCaps));
            for(const [k,v] of Object.entries(delta) as [keyof typeof delta, any][]) {
                if (tailoredDelta[k] === v) delete tailoredDelta[k];
            }
            if (Object.keys(tailoredDelta).length) {
                this.sendMqttCommand(`${ieee}/set`, tailoredDelta);
            }
        }
    }

    /** Handle set-state command from user for a zigbee light. */
    private async userSetLightState(clientInfo: any, ieee: string, state: any) {
        const light = this.store.lights[ieee];
        if (!light) throw new Error(`Light ${ieee} not found`);
        if (!clientInfo.isAdmin) {
            let allow = false;
            for (const groupId of clientInfo.allowedGroupIds) {
                const group = this.store.groups[groupId];
                if (!group) continue;
                if (group.lightIds.includes(ieee)) {
                    allow = true;
                    break;
                }
            }
            if (!allow) throw new Error("Permission denied for device");
        }

        const delta = createZ2MLightDelta(light.lightState, tailorLightState(state, light.lightCaps))
        this.sendMqttCommand(`${ieee}/set`, delta);
    }

    /** Relay admin commands send to the Zigbee2MQTT 'bridge' virtual device. */
    private async userBridgeCommand(user: User, ...args: any[]) {
        if (!user.isAdmin) throw new Error('Permission denied: not an admin user');
        const payload = args.pop();
        const topic = `bridge/${args.join('/')}`;
        
        if (args[0] === 'request') {
            if (args[1].toLowerCase().trim() === 'extension') throw new Error('Accessing extensions is not allowed');
            // Generate unique transaction ID
            const transaction = this.nextTransactionId++;
            const payloadWithTransaction = { ...payload, transaction };
            
            // Create promise for response
            const responsePromise = new Promise<any>((resolve, reject) => {
                this.pendingBridgeRequests.set(transaction, { resolve, reject });
                
                // Set timeout
                setTimeout(() => {
                    if (this.pendingBridgeRequests.has(transaction)) {
                        this.pendingBridgeRequests.delete(transaction);
                        reject(new Error('Bridge request timeout'));
                    }
                }, 10000); // 10 second timeout
            });
            
            this.sendMqttCommand(topic, payloadWithTransaction);
            return await responsePromise;
        } else {
            this.sendMqttCommand(topic, payload);
        }
    }

    private async userSceneCommand(user: User, groupId: number, sceneId: number, subCommand: string, value?: any) {
        const group = this.store.groups[groupId];
        if (!group) throw new Error(`Group ${groupId} not found`);

        if (!user.isAdmin && (subCommand !== 'recall' || !user.allowedGroupIds.includes(groupId))) {
            throw new Error('Permission denied');
        }

        if (subCommand === 'setTriggers') {
            // value: Trigger[] - our custom Light Lynx feature
            const scene = group.scenes[sceneId];
            if (!scene) throw new Error(`Scene ${sceneId} not found`);
            scene.triggers = value;
        } else {
            // Standard Z2M scene commands (recall, store, add, remove, rename)
            // Convert value to proper format: string -> {name: value}, object -> {...value, ID: sceneId}, else -> sceneId
            const z2mValue = typeof value === 'string' ? { ID: sceneId, name: value } : (value && typeof value === 'object') ? { ...value, ID: sceneId } : sceneId;
            
            const payload = {[`scene_${subCommand}`]: z2mValue};
            await this.sendMqttCommand(`${groupId}/set`, payload);

            if (subCommand === 'store' || subCommand === 'add') {
                // Also store any off-states into the scene (for some reason that doesn't happen by default)
                const sceneName = z2mValue?.name;
                for(let ieee of group.lightIds) {
                    if (!this.store.lights[ieee]?.lightState?.on) {
                        this.sendMqttCommand(`${ieee}/set`, {scene_add: {ID: sceneId, group_id: groupId, name: sceneName, state: "OFF"}});
                    }
                }
            }
        }
    }

    /** Link or unlink a toggle device to/from a group. */
    private userLinkToggleToGroup(user: User, groupId: number, ieee: string, linked: boolean) {
        if (!user.isAdmin) throw new Error('Permission denied: not an admin user');
        const toggle = this.store.toggles[ieee];
        if (!toggle) throw new Error(`Toggle device ${ieee} not found`);
        
        if (linked && !toggle.linkedGroupIds.includes(groupId)) {
            toggle.linkedGroupIds.push(groupId);
        } else if (!linked) {
            toggle.linkedGroupIds = toggle.linkedGroupIds.filter(id => id !== groupId);
        }
    }

    /** Set or clear the auto-off timeout for a group. */
    private userSetGroupTimeout(user: User, groupId: number, timeoutSecs: number | null) {
        if (!user.isAdmin) throw new Error('Permission denied: not an admin user');
        const group = this.store.groups[groupId];
        if (!group) throw new Error(`Group ${groupId} not found`);
        
        const oldTimeout = group.timeout;
        group.timeout = timeoutSecs || undefined;
        if (oldTimeout && timeoutSecs) this.nudgeGroupAutoOff(group);
    }

    /** Called for each incoming WebSocket message. Delegates to appropriate
     * user* function and replies with result or error.
     */
    private async onUserMessage(ws: WebSocket, data: any) {
        const user = this.webSocketUsers.get(ws);
        if (!user) return;

        const args = JSON.parse(data.toString());
        const id = args.shift();
        const command = args.shift();
        try {
            let response;
            if (command === 'patch-config') {
                this.userPatchConfig(user, args[0]);
            } else if (command === 'set-state') {
                if (typeof args[0] === 'number') await this.userSetGroupState(user, args[0], args[1]);
                else await this.userSetLightState(user, args[0], args[1]);
            } else if (command === 'bridge') {
                response = await this.userBridgeCommand(user, ...args);
            } else if (command === 'scene') {
                await this.userSceneCommand(user, args[0], args[1], args[2], args[3]);
            } else if (command === 'link-toggle-to-group') {
                this.userLinkToggleToGroup(user, args[0], args[1], args[2]);
            } else if (command === 'set-group-timeout') {
                this.userSetGroupTimeout(user, args[0], args[1]);
            } else if (command === 'convert') {
                response = await this.userConvert(user, args[0]);
            } else {
                throw new Error(`Unknown command: ${command}`);
            }
            this.emitChangesNow();
            ws.send(JSON.stringify(['reply', id, response]));
        } catch (err: any) {
            ws.send(JSON.stringify(['reply', id, undefined, err.message]));
        }
    }

    /** Temporary command to convert old metadata format to new config format. */
    private async userConvert(user: User, stripOld: boolean) {
        if (!user.isAdmin) throw new Error('Permission denied: not an admin user');
        
        const bridgeCommands: any[][] = [];
        
        // Parse old format metadata helper
        const parseMeta = (desc: string | undefined): Record<string, string> => {
            const result: Record<string, string> = {};
            const rest: string[] = [];
            for (const line of (desc || '').split('\n')) {
                const m = line.match(/^lightlynx-(\w+)\s+(.*)$/);
                if (m) result[m[1]!] = m[2]!;
                else if (line.trim()) rest.push(line);
            }
            if (rest.length) result._ = rest.join('\n');
            return result;
        };
        
        const parseTimeoutSecs = (str: string | undefined): number | undefined => {
            if (!str) return undefined;
            const m = str.match(/^(\d+(?:\.\d+)?)([smhd])?$/);
            if (!m) return undefined;
            const units: Record<string, number> = {s: 1, m: 60, h: 3600, d: 86400};
            return parseFloat(m[1]!) * (units[m[2]!] || 1);
        };
        
        // Convert toggle device links
        for (const [ieee, toggle] of Object.entries(this.store.toggles)) {
            const meta = parseMeta(toggle.description);
            if (meta.groups) {
                const groups = meta.groups.split(',').map(Number).filter(n => !isNaN(n));
                if (groups.length) {
                    toggle.linkedGroupIds = groups;
                    bridgeCommands.push(['request', 'device', 'options', {id: ieee, options: {description: meta._ || ''}}]);
                }
            }
        }
        
        // Convert group timeouts
        for (const [groupId, group] of Object.entries(this.store.groups)) {
            const meta = parseMeta(group.description);
            if (meta.timeout) {
                const timeout = parseTimeoutSecs(meta.timeout);
                if (timeout) {
                    group.timeout = timeout;
                    bridgeCommands.push(['request', 'group', 'options', {id: Number(groupId), options: {description: meta._ || ''}}]);
                }
            }
        }
        
        // Convert scene triggers from names
        for (const [groupId, group] of Object.entries(this.store.groups)) {
            for (const [sceneId, scene] of Object.entries(group.scenes)) {
                const m = scene.name.match(/^(.*?)\s*\((.*)\)\s*$/);
                if (m) {
                    const name = m[1]!.trim();
                    const triggers: Trigger[] = [];
                    
                    for(let condition of m[2]!.split(',')) {
                        const match = condition.match(/^\s*([0-9a-z]+)(?: ([^)-]*?)-([^)-]*))?\s*$/);
                        if (match) {
                            triggers.push({
                                event: match[1]!,
                                startTime: match[2],
                                endTime: match[3],
                            });
                        }
                    }
                    
                    if (triggers.length || name !== scene.name) {
                        scene.triggers = triggers;
                        bridgeCommands.push(['request', 'group', 'options', {
                            id: Number(groupId),
                            options: { scenes: { [sceneId]: { name } } }
                        }]);
                    }
                }
            }
        }
        
        // Execute bridge commands if stripOld is true
        if (stripOld) {
            for (const args of bridgeCommands) {
                await this.userBridgeCommand(user, ...args);
            }
        }
        
        return bridgeCommands;
    }

    /** Called for each MQTT sent by Zigbee2MQTT. We use this to keep this.store up-to-date.*/
    private onOutgoingMQTT(data: {topic: string, payload: string}) {
        console.log('Outgoing MQTT:', data?.topic);
        if (!data.topic.startsWith(`${this.mqttBaseTopic}/`)) return;
        const topic = data.topic.slice(this.mqttBaseTopic.length + 1).split('/');
        let payload: any;
        try { payload = JSON.parse(data.payload); } catch { payload = data.payload; }

        if (topic[0] === 'bridge') {
            if (topic[1] === 'response' && payload.transaction != null) {
                const pending = this.pendingBridgeRequests.get(payload.transaction);
                if (pending) {
                    this.pendingBridgeRequests.delete(payload.transaction);
                    if (payload.status === 'ok') {
                        pending.resolve(payload.data);
                    } else {
                        pending.reject(new Error(payload.error || 'Bridge request failed'));
                    }
                }
            }
            else if (topic.length !== 2) {}
            else if (topic[1] === 'groups') this.handleBridgeGroups(payload);
            else if (topic[1] === 'devices') this.handleBridgeDevices(payload);
            else if (topic[1] === 'info') this.store.permitJoin = payload.permit_join;
        }
        else if (topic.length === 2 && topic[1] === 'availability') this.handleDeviceAvailability(topic[0], payload);
        else if (topic.length === 1) this.handleDeviceState(topic[0], payload);
        this.scheduleEmitChanges();
    }

    /** Translate outgoing bridge/devices MQTT into this.lights and this.toggles. */
    private handleBridgeDevices(payload: any) {
        this.deviceIdsByName = {};

        const lights: Record<string, Light> = {};
        const toggles: Record<string, Toggle> = {};
        for (let z2mDev of payload) {
            if (!z2mDev.definition) continue;

            const ieee = z2mDev.ieee_address;
            const dev = {
                name: z2mDev.friendly_name,
                description: z2mDev.description,
                model: (z2mDev.definition.description || z2mDev.model_id) + " (" + (z2mDev.definition.vendor || z2mDev.manufacturer) + ")",
            };
            this.deviceIdsByName[dev.name] = ieee;

            for (const expose of z2mDev.definition.exposes) {
                if (expose.type === "light" || expose.type === "switch") {
                    const features: any = {};
                    for (const feature of (expose.features || [])) {
                        features[feature.name] = {};
                        if (feature.value_max !== undefined) {
                            features[feature.name].valueMin = feature.value_min;
                            features[feature.name].valueMax = feature.value_max;
                        }
                    }
                    const lightCaps = {
                        supportsBrightness: !!features.brightness,
                        supportsColor: !!(features.color_hs || features.color_xy),
                        supportsColorTemp: !!features.color_temp,
                        brightness: features.brightness,
                        colorTemp: features.color_temp,
                        colorHs: !!features.color_hs,
                        colorXy: !!features.color_xy
                    };
                    const old = this.store.lights[ieee];
                    lights[ieee] = {
                        ...dev,
                        lightCaps,
                        lightState: old?.lightState || {},
                        meta: old?.meta || {},
                    };
                } else if (expose.name === "action") {
                    const old = this.store.toggles[ieee];
                    toggles[ieee] = {
                        ...dev,
                        actions: expose.actions,
                        meta: old?.meta || {},
                        linkedGroupIds: this.store.config._toggleGroupLinks?.[ieee] || [],
                    };
                }
            }
        }
        this.store.lights = lights;
        this.store.toggles = toggles;
    }

    /** Translate outgoing bridge/groups MQTT into this.groups. */
    private handleBridgeGroups(payload: any) {
        this.groupIdsByNames = {};

        let groups: Record<number, Group> = {};
        for (let z2mGroup of payload) {
            const id = z2mGroup.id;
            const group = this.store.groups[id] || {} as Group;
            groups[id] = group;

            group.name = z2mGroup.friendly_name;
            group.description = z2mGroup.description;
            group.scenes = this.convertZ2mScenes(id, z2mGroup.scenes);
            group.lightIds = z2mGroup.members.map((obj: any) => obj.ieee_address);

            // Read timeout from config, but only if not already set
            // (to avoid overwriting recently-set timeouts before saveConfig() runs)
            if (group.timeout === undefined) {
                const timeout = this.store.config._groupTimeouts?.[id];
                group.timeout = timeout;
                if (timeout) this.nudgeGroupAutoOff(group);
            }
            
            this.groupIdsByNames[group.name] = id;
        }
        this.store.groups = groups;
    }

    /** Call this when there's activity for a group, in order to (re)set its auto-off timer. */
    private nudgeGroupAutoOff(group: Group) {
        if (group._autoOffTimer) clearTimeout(group._autoOffTimer);
        delete group._autoOffTimer
        if (group.timeout && this.store.config.automationEnabled) {
            group._autoOffTimer = setTimeout(() => {
                if (!this.store.config.automationEnabled) return;
                this.sendMqttCommand(`${group.name}/set`, { state: 'OFF', transition: 30 });
            }, group.timeout * 1000);
        }
    }

    /** Send a MQTT-style message to Zigbee2MQTT (of course bypassing MQTT). These also get 
     * delivered to our own incoming MQTT handler. The topic will be auto-prefixed by the 
     * MQTT base topic. */
    sendMqttCommand(topic: string, payload: any) {
        this.eventBus.emitMQTTMessage(`${this.mqttBaseTopic}/${topic}`, JSON.stringify(payload));
    }

    /** Translate a Z2M scenes list to a this.store.groups[x].scenes object. */
    private convertZ2mScenes(groupId: number, z2mScenes: any): Record<number, Scene> {
        const result: Record<number, Scene> = {};
        for(const z2mScene of z2mScenes) {
            const sceneId = z2mScene.id;
            result[sceneId] = {
                name: z2mScene.name,
                triggers: this.store.config._sceneTriggers?.[groupId]?.[sceneId] || [],
                lightStates: this.store.config._sceneStates?.[groupId]?.[sceneId],
            };
        }
        return result;
    }

    /** Translate outgoing Z2M device online/offline messsages to this.state. */
    private handleDeviceAvailability(deviceName: string, payload: any) {
        let ieee = this.deviceIdsByName[deviceName];
        if (ieee) {
            const dev = this.store.lights[ieee] || this.store.toggles[ieee];
            if (dev) {
                dev.meta.online = payload.state==="online";
            }
        }
    }

    /** Translate outgoing Z2M device state messages to this.state. */
    private handleDeviceState(deviceName: string, payload: any) {
        let ieee = this.deviceIdsByName[deviceName];
        if (!payload || !ieee) return;

        const light = this.store.lights[ieee];
        if (light) this.handleLightState(light, payload);

        const toggle = this.store.toggles[ieee];
        if (toggle) this.handleToggleState(ieee, toggle, payload);

        for (const dev of [light, toggle]) {
            if (!dev) continue;
            if (payload.update != null) dev.meta.update = payload.update.state;
            if (payload.battery != null) dev.meta.battery = payload.battery;
            if (payload.linkquality != null) dev.meta.linkquality = payload.linkquality;
        }
    }

    /** Translate outgoing Z2M light state messages to this.store.lights[x]. */
    private handleLightState(dev: Light, payload: any) {
        if (payload.state == null) return;
        dev.lightState = {
            on: payload.state === 'ON',
            brightness: payload.brightness,
            color: undefined,
        };
        if (payload.color_mode === 'color_temp') {
            dev.lightState.color = payload.color_temp;
        } else if (payload.color?.hue) {
            dev.lightState.color = { hue: payload.color.hue, saturation: payload.color.saturation / 100 };
        } else if (payload.color?.x) {
            dev.lightState.color = payload.color;
        }
    }

    /** Handle outgoing Z2M state messages for buttons and sensors, by taking
     * automation actions on linked groups.
     */
    async handleToggleState(ieee: string, device: Toggle, payload: any) {
        if (!this.store.config.automationEnabled) return;

        let action = payload.action;
        if (action === 'press') {
            clearTimeout(this.clickTimers.get(ieee));
            this.clickTimers.set(ieee, setTimeout(()=> {
                this.clickTimers.delete(ieee);
                this.clickCounts.delete(ieee);
            }, 1000))
            
            action = (this.clickCounts.get(ieee) || 0) + 1
            this.clickCounts.set(ieee, action);
        }
        else if (CLICK_COUNTS[action]) {
            action = CLICK_COUNTS[action];
        } else if (payload.occupancy) {
            action = 'sensor';
        } else {
            return;
        }

        // Handle triggers for all associated groups
        for (const groupId of device.linkedGroupIds) {
            const group = this.store.groups[groupId];
            if (!group) continue;

            let newState: Record<string, any> | undefined;
            if (action === 1 && this.state.get({ID: groupId})?.state === 'ON') {
                // Special case: single press turns off if already on
                newState = {state: 'OFF'};
                // The next click should start the count at 1
                if (this.clickCounts.has(ieee)) this.clickCounts.set(ieee, 0);
            } else {
                let sceneId = this.findSceneId(group, action);
                newState = sceneId == null ? DEFAULT_TRIGGERS[action] : { scene_recall: sceneId };
            }

            if (newState) {
                newState.transition = 0.4;
                this.sendMqttCommand(`${groupId}/set`, newState);
            }
        }
    }

    /** Debounced sync of this.store to websockets. */
    private scheduleEmitChanges() {
        if (this.emitChangesTimeout === undefined) {
            this.emitChangesTimeout = setTimeout(() => {
                this.emitChangesTimeout = undefined;
                this.emitChangesNow();
            }, 0);
        }
    }

    /** Sync this.store to websockets. */
    private emitChangesNow() {
        const delta = createDelta(this.store, this.storeCopy) || {};
        this.storeCopy = deepClone(this.store);

        const users = delta.config?.users;
        
        for (const [ws, clientInfo] of this.webSocketUsers) {
            if (ws.readyState !== WebSocket.OPEN) continue;
            if (users) {
                // Two special cases: only admins get `config.users`, and `me` should contain
                // `config.users[clientInfo.name]`.
                if (clientInfo.isAdmin) delta.config!.users = users;
                else delete delta.config!.users;
                const me = users[clientInfo.name];
                if (me) {
                    // Update info for currently logged in users
                    Object.assign(clientInfo, me);
                    delta.me = clientInfo;
                }
                else if (me==null) {
                    // If the user was deleted, disconnect
                    this.webSocketUsers.delete(ws)
                    ws.close();
                }
                else {
                    // This user was not modified, no need to update 'me'
                    delete delta.me;
                }
            }
            if (Object.keys(delta).length > 0) {
                ws.send(JSON.stringify(['store-delta', delta]));
            }
        }
        // This doesn't need to happen sync:
        setTimeout(() => this.saveConfig(), 20);
    }

    /** Called for incoming MQTT messages, including the fake messages we send to
     * Zigbee2MQTT ourselves. We use this to track which scene is set for each group,
     * and to capture and save scene light states.
     */
    private async onIncomingMQTT(data: any) {
        /// Handle scene tracking
        if (!data.topic.startsWith(`${this.mqttBaseTopic}/`)) return;
        const parts = data.topic.slice(this.mqttBaseTopic.length + 1).split('/');
        
        const groupName = parts[0];
        if (groupName === 'bridge') return;
        if (parts.length !== 2 || parts[1] !== 'set') return;

        const groupId = this.groupIdsByNames[groupName] ?? parseInt(groupName);
        if (isNaN(groupId)) return;
        const group = this.store.groups[groupId];
        if (!group) return;
        
        group.activeSceneId = undefined;
        this.nudgeGroupAutoOff(group);

        let message: any;
        try { message = JSON.parse(data.message); } catch { return; }

        const sceneStore = message.scene_store || message.scene_add;
        if (sceneStore != null) {
            // We'll keep our own copy of the light states for this scene, to be used by the 
            // client to predictively show scene states.
            // Actually, scene_add should only store selected attributes - oh well!
            const sceneId = typeof sceneStore === 'object' ? sceneStore.ID : sceneStore;
            group.activeSceneId = sceneId;
            const states: Record<string, any> = {};
            for (const id of group.lightIds) {
                const s = this.store.lights[id]?.lightState;
                if (s) states[id] = s;
            }
            // Store in both places - the scene may not exist yet in group.scenes
            const scene = group.scenes[sceneId];
            if (scene) scene.lightStates = states;
            (this.store.config._sceneStates ||= {})[groupId] ||= {};
            this.store.config._sceneStates[groupId][sceneId] = states;
        }
        else if (message.scene_recall != null) {
            group.activeSceneId = message.scene_recall;
        }
        else if (message.scene_remove != null) {
            const scene = group.scenes[message.scene_remove];
            if (scene) scene.lightStates = undefined;
            if (this.store.config._sceneStates?.[groupId]) {
                delete this.store.config._sceneStates[groupId][message.scene_remove];
            }
        }

        this.scheduleEmitChanges();
    }

    /**
     * Parses time strings like "7:30", "19:00", "30bs" (30 min before sunset),
     * "1:00ar" (1 hour after sunrise) from 00:00. Returns 0 if parsing fails.
     */
    private parseTime(str: string): number {
        let m = str.trim().match(/^([0-9]{1,2})(:([0-9]{2}))?((b|a)(s|r))?$/);
        if (!m) return 0;
        let hour = 0 | parseInt(m[1]!);
        let minute = 0 | parseInt(m[3] || '0');
        let beforeAfter = m[5];
        let riseSet = m[6];

        if (riseSet) {
            const lat = this.store.config.latitude!;
            const lon = this.store.config.longitude!;
            let sunTime = (riseSet === 'r' ? getSunrise : getSunset)(lat, lon);
            if (sunTime) {
                if (beforeAfter === 'a') {
                    hour += sunTime.getHours();
                    minute += sunTime.getMinutes();
                } else {
                    hour = sunTime.getHours() - hour;
                    minute = sunTime.getMinutes() - minute;
                }
            }
        }
        hour += Math.floor(minute / 60);
        hour = ((hour % 24) + 24) % 24;
        minute = ((minute % 60) + 60) % 60;
        return hour * 60 + minute;
    }

    /**
     * Checks if current time is within the specified range. Handles ranges that span over midnight.
     * If within range, returns the total range in minutes (for prioritization), otherwise returns undefined.
     * Accepts time strings according to parseTimeRange.
     */
    private checkTimeRange(startStr: string, endStr: string): number | undefined {
        let start = this.parseTime(startStr);
        let end = this.parseTime(endStr);
        if (end < start) end += 24 * 60;
        let now = new Date();
        let nowMins = now.getHours() * 60 + now.getMinutes();
        if (nowMins < start) nowMins += 24 * 60;
        if (nowMins >= start && nowMins <= end) return end - start;
        return undefined;
    }

    /** Find a scene for the given group that matches the event (1 .. 5, 'sensor', 'time')
     * and is currently within its time range (if any). If there are multiple, pick the
     * one with the narrowest time range. Returns scene id or undefined if none is found.
    */
    private findSceneId(group: Group, event: string | number): number | undefined {
        let foundRange = 25*60, foundSceneId;
        for(const sceneId in group.scenes) {
            const scene = group.scenes[sceneId]!;
            for(const trig of scene.triggers) {
                if (trig.event == event) {
                    let range = trig.startTime && trig.endTime ? this.checkTimeRange(trig.startTime, trig.endTime) : 24*60;
                    if (range!=null && range < foundRange) {
                        foundSceneId = parseInt(sceneId);
                    }
                }
            }
        }
        return foundSceneId;
    }

    /** Called every 10s. Checks if any new "time" event scene triggers are applicable. */
    private handleTimeTriggers() {
        if (!this.store.config.automationEnabled) return;
        for(const [groupId, group] of Object.entries(this.store.groups)) {
            let newState: Record<string, any> | undefined;
            let sceneId = this.findSceneId(group, 'time');
            if (sceneId != null) {
                // Only recall if different from previous scene, to avoid setting the
                // scene again when the user has manually changed it.
                if (group._lastTimedSceneId !== sceneId) {
                    this.log('info', `Time-based recall group=${group.name} scene=${sceneId}`);
                    newState = { scene_recall: sceneId };
                    group.activeSceneId = group._lastTimedSceneId = sceneId;
                }
                // Keep auto-off at bay as long as the time-based scene is active
                if (sceneId === group.activeSceneId) this.nudgeGroupAutoOff(group);
            } else {
                if (group._lastTimedSceneId != undefined) {
                    this.log('info', `Time-based off group=${group.name}`);
                    newState = {state: 'OFF'};
                    group.activeSceneId = group._lastTimedSceneId = undefined;
                }
            }
            if (newState) {
                newState.transition = 20;
                this.sendMqttCommand(`${groupId}/set`, newState);
            }
        }
    }
}


// Functions for sunset/sunrise calculations

function getDayOfYear(date: Date) {
    return Math.ceil((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / (24*3600*1000));
}

function sinDeg(deg: number) { return Math.sin(deg * 2.0 * Math.PI / 360.0); }
function acosDeg(x: number) { return Math.acos(x) * 360.0 / (2 * Math.PI); }
function asinDeg(x: number) { return Math.asin(x) * 360.0 / (2 * Math.PI); }
function cosDeg(deg: number) { return Math.cos(deg * 2.0 * Math.PI / 360.0); }
function mod(a: number, b: number) { const r = a % b; return r < 0 ? r + b : r; }

function getSunTime(latitude: number, longitude: number, isSunrise: boolean, zenith: number, date: Date) {
    const dayOfYear = getDayOfYear(date);
    const hoursFromMeridian = longitude / DEGREES_PER_HOUR;
    const approxTimeOfEventInDays = isSunrise
        ? dayOfYear + ((6.0 - hoursFromMeridian) / 24.0)
        : dayOfYear + ((18.0 - hoursFromMeridian) / 24.0);

    const sunMeanAnomaly = (0.9856 * approxTimeOfEventInDays) - 3.289;
    let sunTrueLong = sunMeanAnomaly + (1.916 * sinDeg(sunMeanAnomaly)) + (0.020 * sinDeg(2 * sunMeanAnomaly)) + 282.634;
    sunTrueLong = mod(sunTrueLong, 360);

    let sunRightAscension = acosDeg(cosDeg(sunTrueLong) / cosDeg(asinDeg(0.39782 * sinDeg(sunTrueLong))));
    sunRightAscension = mod(sunRightAscension, 360);
    sunRightAscension = sunRightAscension + (((Math.floor(sunTrueLong / 90.0) * 90.0) - (Math.floor(sunRightAscension / 90.0) * 90.0)) / DEGREES_PER_HOUR);

    const sunDeclinationSin = 0.39782 * sinDeg(sunTrueLong);
    const sunDeclinationCos = cosDeg(asinDeg(sunDeclinationSin));

    const localHourAngleCos = (cosDeg(zenith) - (sunDeclinationSin * sinDeg(latitude))) / (sunDeclinationCos * cosDeg(latitude));

    if (localHourAngleCos > 1 || localHourAngleCos < -1) return null;

    const localHourAngle = isSunrise ? 360 - acosDeg(localHourAngleCos) : acosDeg(localHourAngleCos);
    const localMeanTime = (localHourAngle / DEGREES_PER_HOUR) + (sunRightAscension / DEGREES_PER_HOUR) - (0.06571 * approxTimeOfEventInDays) - 6.622;
    const utcTimeInHours = mod(localMeanTime - hoursFromMeridian, 24);
    const utcDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    utcDate.setUTCHours(Math.floor(utcTimeInHours));
    utcDate.setUTCMinutes(Math.floor((utcTimeInHours - Math.floor(utcTimeInHours)) * 60));
    return utcDate;
}

function getSunrise(lat: number, lon: number, zenith?: number, date?: Date) { 
    return getSunTime(lat, lon, true, zenith || DEFAULT_ZENITH, date || new Date()); 
}

function getSunset(lat: number, lon: number, zenith?: number, date?: Date) { 
    return getSunTime(lat, lon, false, zenith || DEFAULT_ZENITH, date || new Date()); 
}

module.exports = LightLynx;


