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
    allowedGroups: number[];
    allowRemote: boolean;
}

interface User extends UserConfig {
    username: string;
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
    automation: boolean; // Enable/disable automation features
    latitude?: number; // For sunrise/sunset calculations (default: Enschede)
    longitude?: number;
}

// === Automation Module ===

const defaultZenith = 90.8333;
const degreesPerHour = 360 / 24;
const msecInDay = 8.64e7;

function getDayOfYear(date: Date) {
    return Math.ceil((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / msecInDay);
}

function sinDeg(deg: number) { return Math.sin(deg * 2.0 * Math.PI / 360.0); }
function acosDeg(x: number) { return Math.acos(x) * 360.0 / (2 * Math.PI); }
function asinDeg(x: number) { return Math.asin(x) * 360.0 / (2 * Math.PI); }
function cosDeg(deg: number) { return Math.cos(deg * 2.0 * Math.PI / 360.0); }
function mod(a: number, b: number) { const r = a % b; return r < 0 ? r + b : r; }

function getSunTime(latitude: number, longitude: number, isSunrise: boolean, zenith: number, date: Date) {
    const dayOfYear = getDayOfYear(date);
    const hoursFromMeridian = longitude / degreesPerHour;
    const approxTimeOfEventInDays = isSunrise
        ? dayOfYear + ((6.0 - hoursFromMeridian) / 24.0)
        : dayOfYear + ((18.0 - hoursFromMeridian) / 24.0);

    const sunMeanAnomaly = (0.9856 * approxTimeOfEventInDays) - 3.289;
    let sunTrueLong = sunMeanAnomaly + (1.916 * sinDeg(sunMeanAnomaly)) + (0.020 * sinDeg(2 * sunMeanAnomaly)) + 282.634;
    sunTrueLong = mod(sunTrueLong, 360);

    let sunRightAscension = acosDeg(cosDeg(sunTrueLong) / cosDeg(asinDeg(0.39782 * sinDeg(sunTrueLong))));
    sunRightAscension = mod(sunRightAscension, 360);
    sunRightAscension = sunRightAscension + (((Math.floor(sunTrueLong / 90.0) * 90.0) - (Math.floor(sunRightAscension / 90.0) * 90.0)) / degreesPerHour);

    const sunDeclinationSin = 0.39782 * sinDeg(sunTrueLong);
    const sunDeclinationCos = cosDeg(asinDeg(sunDeclinationSin));

    const localHourAngleCos = (cosDeg(zenith) - (sunDeclinationSin * sinDeg(latitude))) / (sunDeclinationCos * cosDeg(latitude));

    if (localHourAngleCos > 1 || localHourAngleCos < -1) return null;

    const localHourAngle = isSunrise ? 360 - acosDeg(localHourAngleCos) : acosDeg(localHourAngleCos);
    const localMeanTime = (localHourAngle / degreesPerHour) + (sunRightAscension / degreesPerHour) - (0.06571 * approxTimeOfEventInDays) - 6.622;
    const utcTimeInHours = mod(localMeanTime - hoursFromMeridian, 24);
    const utcDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    utcDate.setUTCHours(Math.floor(utcTimeInHours));
    utcDate.setUTCMinutes(Math.floor((utcTimeInHours - Math.floor(utcTimeInHours)) * 60));
    return utcDate;
}

function getSunrise(lat: number, lon: number, zenith?: number, date?: Date) { 
    return getSunTime(lat, lon, true, zenith || defaultZenith, date || new Date()); 
}

function getSunset(lat: number, lon: number, zenith?: number, date?: Date) { 
    return getSunTime(lat, lon, false, zenith || defaultZenith, date || new Date()); 
}

const CLICK_COUNTS: Record<string, number> = {single: 1, double: 2, triple: 3, quadruple: 4, many: 5};


interface Scene {
    id: number;
    start?: string;
    end?: string;
}

interface Group {
    id: number;
    name: string;
    scenes: Record<string, Scene[]>;
    timeout: number | undefined;
    timer: NodeJS.Timeout | undefined;
    touch: () => void;
}

class Automation {
    private mqtt: any;
    private zigbee: any;
    private state: any;
    private mqttBaseTopic: string;
    private config: LightLynxConfig;
    private clickCounts: Map<string, number> = new Map();
    private clickTimers: Map<string, NodeJS.Timeout> = new Map();
    private groups: Record<string, Group> = {};
    private lastTimedSceneIds: Record<string, number | undefined> = {};
    private timeInterval?: NodeJS.Timeout;

    constructor(mqtt: any, zigbee: any, state: any, mqttBaseTopic: string, config: LightLynxConfig) {
        this.mqtt = mqtt;
        this.zigbee = zigbee;
        this.state = state;
        this.mqttBaseTopic = mqttBaseTopic;
        this.config = config;
    }

    start(eventBus: any) {
        eventBus['onStateChange'](this, this.onStateChange.bind(this));
        for(const event of ['ScenesChanged', 'GroupMembersChanged', 'EntityOptionsChanged', 'EntityRenamed', 'DevicesChanged']) {
            eventBus['on' + event](this, this.loadScenes.bind(this));
        }
        this.timeInterval = setInterval(this.handleTimeTriggers.bind(this), 10000);
        this.loadScenes();
    }

    stop(eventBus: any) {
        eventBus.removeListeners(this);
        if (this.timeInterval) clearInterval(this.timeInterval);
        for (let group of Object.values(this.groups)) {
            clearTimeout(group.timer);
        }
        this.groups = {};
    }

    private parseTimeRange(str: string) {
        let m = str.trim().match(/^([0-9]{1,2})(:([0-9]{2}))?((b|a)(s|r))?$/);
        if (!m) return 0;
        let hour = 0 | parseInt(m[1]!);
        let minute = 0 | parseInt(m[3] || '0');
        let beforeAfter = m[5];
        let riseSet = m[6];

        if (riseSet) {
            const lat = this.config.latitude!;
            const lon = this.config.longitude!;
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

    private checkTimeRange(startStr: string, endStr: string) {
        let start = this.parseTimeRange(startStr);
        let end = this.parseTimeRange(endStr);
        if (end < start) end += 24 * 60;
        let now = new Date();
        let nowMins = now.getHours() * 60 + now.getMinutes();
        if (nowMins < start) nowMins += 24 * 60;
        if (nowMins >= start && nowMins <= end) return end - start;
        return null;
    }

    private findScene(group: Group, trigger: string | number): Scene | undefined {
        let sceneOptions = group.scenes[trigger];
        if (sceneOptions) {
            let foundRange = 25*60, foundScene;
            for(let scene of sceneOptions) {
                let range = scene.start && scene.end ? this.checkTimeRange(scene.start, scene.end) : 24*60;
                if (range!=null && range < foundRange) {
                    foundScene = scene;
                }
            }
            return foundScene;
        }
        return undefined;
    }

    
    loadScenes() {
        console.log('automation.js loading scenes');
        let groups: Record<string, Group> = {};
        for (let zigbeeGroup of this.zigbee.groupsIterator()) {
            let resultScenes: Record<string, Scene[]> = {};
            let discoveredScenes: Set<string> = new Set();
            for (let endpoint of zigbeeGroup.zh.members) {
                let scenes = endpoint.meta?.scenes;
                for (const sceneKey in scenes) {
                    const keyParts = sceneKey.split('_');
                    let groupId = parseInt(keyParts[1]!);
                    if (groupId !== zigbeeGroup.ID) continue;
                    let sceneId = parseInt(keyParts[0]!);

                    let name = scenes[sceneKey].name || '';

                    let suffix = name.match(/ \((.*?)\)$/);
                    if (!suffix) continue;

                    for(let condition of suffix[1].split(',')) {
                        let m = condition.match(/^\s*([0-9a-z]+)(?: ([^)-]*?)-([^)-]*))?\s*$/);
                        if (!m) continue;
                        let [_all, trigger, start, end] = m;
                        let key = `${trigger}/${sceneId}/${start}/${end}`;
                        if (discoveredScenes.has(key)) continue;
                        discoveredScenes.add(key);
                        (resultScenes[trigger] = resultScenes[trigger] || []).push({
                            id: sceneId,
                            start,
                            end,
                        });
                    }
                }
            }

            let onTimeout = () => {
                this.mqtt.onMessage(`${this.mqttBaseTopic}/${group.name}/set`, JSON.stringify({ state: 'OFF', transition: 30 }));
            };

            let name = zigbeeGroup.name;
            
            // Parse timeout from description (lightlynx- metadata)
            let timeout : number | undefined;
            const description = zigbeeGroup.options?.description || '';
            const timeoutMatch = description.match(/^lightlynx-timeout (\d+(?:\.\d+)?)([smhd])$/m);
            if (timeoutMatch) {
                // New format: lightlynx-timeout 30m in description
                const value = parseFloat(timeoutMatch[1]);
                const unit = {s: 1, m: 60, h: 60*60, d: 24*60*60}[timeoutMatch[2] as 's' | 'm' | 'h' | 'd'];
                if (unit && !isNaN(value)) {
                    timeout = value * unit * 1000;
                }
            }
            console.log(`lightlynx group name=${name} triggers=${Object.keys(resultScenes)} timeout=${timeout ? timeout/1000 + 's' : 'none'}`);

            let group = groups[name] = {
                id: zigbeeGroup.ID,
                name,
                scenes: resultScenes,
                timeout,
                timer: undefined,
                touch: function() {
                    if (this.timeout) {
                        clearTimeout(this.timer);
                        this.timer = setTimeout(onTimeout, this.timeout)
                    }
                }
            };
            group.touch();
        }

        for(let group of Object.values(this.groups)) {
            clearTimeout(group.timer);
        }
        this.groups = groups;
    }

    async onStateChange(data: any) {
        if (!data.update) return;
        
        // Get device and check which groups it belongs to (description-based only)
        if (!data.entity || !data.entity.isDevice()) return;
        let device = data.entity;
        let groups = [];
        
        // Parse group associations from device description
        const description = device.options?.description || '';
        const groupsMatch = description.match(/^lightlynx-groups (\d+(,\d+)*)$/m);
        if (groupsMatch) {
            // Map group IDs to group short names
            for (let groupIdStr of groupsMatch[1].split(',')) {
                for (let group of Object.values(this.groups)) {
                    if (group.id == groupIdStr) {
                        groups.push(group);
                    }
                }
            }
        }
        
        // Handle triggers for all associated groups
        for (let group of groups) {
            group.touch();

            let newState: any;
            
            let action = data.update.action;
            let clicks;
            if (action==='press') {
                clearTimeout(this.clickTimers.get(data.entity));
                this.clickTimers.set(data.entity, setTimeout(()=> {
                    this.clickTimers.delete(data.entity);
                    this.clickCounts.delete(data.entity);
                }, 1000))
                
                clicks = (this.clickCounts.get(data.entity) || 0) + 1
                this.clickCounts.set(data.entity, clicks);
            }
            else if (CLICK_COUNTS[action]) {
                clicks = CLICK_COUNTS[action];
            }
            
            if (clicks) {
                if (clicks==1 && this.state.get({ID: group.id})?.state === 'ON') {
                    newState = {state: 'OFF'}
                    if (action==='press') {
                        // The next subsequent click should start the count at 1
                        this.clickCounts.set(data.entity, 0);
                    }
                }
                else {
                    let scene = this.findScene(group, clicks);
                    if (scene) {
                        newState = { scene_recall: scene.id };
                    }
                    else {
                        if (clicks==1) newState = {brightness: 150, color_temp: 365, state: 'ON'};
                        else if (clicks==2) newState = {brightness: 40, color_temp: 450, state: 'ON'};
                        else if (clicks==3) newState = {brightness: 254, color_temp: 225, state: 'ON'};
                    }
                }
            }
            else if (data.update.occupancy) {
                let scene = this.findScene(group, 'sensor');
                if (scene) {
                    newState = { scene_recall: scene.id };
                }
                else {
                    newState = {brightness: 150, color_temp: 365, state: 'ON'};
                }
            }

            if (newState) {
                newState.transition = 0.4
                this.mqtt.onMessage(`${this.mqttBaseTopic}/${group.name}/set`, JSON.stringify(newState));
            }
        }
    }

    handleTimeTriggers() {
        for(let group of Object.values(this.groups)) {
            let newState: any;
            let scene = this.findScene(group, 'time');
            if (scene) {
                group.touch();
                if (this.lastTimedSceneIds[group.name] !== scene.id) {
                    console.log('automation.js time-based recall', group.name, scene);
                    newState = { scene_recall: scene.id };
                    this.lastTimedSceneIds[group.name] = scene.id;
                }
            }
            else {
                if (this.lastTimedSceneIds[group.name]!=undefined) {
                    console.log('automation.js time-based off', group.name);
                    newState = {state: 'OFF'};
                    this.lastTimedSceneIds[group.name] = undefined;
                }
            }
            if (newState) {
                newState.transition = 10;
                this.mqtt.onMessage(`${this.mqttBaseTopic}/${group.name}/set`, JSON.stringify(newState));
            }
        }
    }
}

// === Main Extension Class ===

class LightLynx {
    private zigbee: any;
    private mqtt: any;
    private state: any;
    private eventBus: any;
    private logger: any;
    private mqttBaseTopic: string;
    private clients: Map<WebSocket, User> = new Map();
    private config: LightLynxConfig;
    private server?: http.Server | https.Server;
    private wss?: WebSocketServer;
    private refreshTimer?: NodeJS.Timeout;
    private activeScenes: Record<string, number | undefined> = {};
    private lastSceneTime: Record<string, number> = {};
    private automation?: Automation;

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

        if (mock?.insecure) {
            // Start without TLS
            this.log('info', 'Starting insecure WebSocket server (no TLS)');
            this.server = http.createServer((req, res) => {
                if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('LightLynx API ready');
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });
        } else if (mock?.certFile) {
            this.log('info', 'Starting using mock SSL certificate');
            const { cert, key } = JSON.parse(fs.readFileSync(mock.certFile, 'utf8'));
            
            this.config.ssl = {
                expiresAt: Date.now() + 1000000000,
                nodeHttpsOptions: { cert, key }
            };
            
            this.server = https.createServer(this.config.ssl.nodeHttpsOptions);
        } else {
            await this.setupSSL();
            this.log('info', 'Starting HTTPS server on port ' + PORT);
            
            const ssl = this.config.ssl;
            if (!ssl?.nodeHttpsOptions?.cert) {
                this.log('error', 'Failed to setup SSL. Cannot start server.');
                return;
            }
            
            this.server = https.createServer(ssl.nodeHttpsOptions);
        }

        this.server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));
        if (!mock?.insecure) {
            this.server.on('request', (req, res) => {
                if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('LightLynx API ready');
                } else {
                    res.writeHead(404);
                    res.end();
                }
            });
        }

        this.wss = new WebSocketServer({ 
            noServer: true, 
            path: '/api'
        });
        this.wss.on('connection', (ws: any, req: any) => this.onConnection(ws, req));

        this.server.listen(mock?.httpsPort || PORT);

        this.eventBus.onMQTTMessagePublished(this, (data: any) => this.onMQTTPublish(data));
        this.eventBus.onPublishEntityState(this, (data: any) => this.onEntityState(data));
        this.eventBus.onMQTTMessage(this, (data: any) => this.onMQTTRequest(data));

        // Start automation if enabled
        if (this.config.automation) {
            this.automation = new Automation(this.mqtt, this.zigbee, this.state, this.mqttBaseTopic, this.config);
            this.automation.start(this.eventBus);
            this.log('info', 'Automation enabled');
        }

        // Refresh check every 59 minutes
        if (!mock) {
            this.refreshTimer = setInterval(() => this.setupSSL(), 59 * 60 * 1000);
        }
    }

    async stop() {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        if (this.automation) {
            this.automation.stop(this.eventBus);
            this.automation = undefined;
        }
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
        const defaultConfig: LightLynxConfig = { users: {}, remoteAccess: false, automation: false };
        try {
            if (!fs.existsSync(configPath)) {
                return defaultConfig;
            }
            const loaded = JSON.parse(fs.readFileSync(configPath, 'utf8')) || defaultConfig;
            // Ensure automation field exists (default to false for backward compatibility)
            if (loaded.automation === undefined) loaded.automation = false;
            // Set default location (Enschede, NL) if not configured
            if (loaded.latitude === undefined) loaded.latitude = 52.24;
            if (loaded.longitude === undefined) loaded.longitude = 6.88;
            return loaded;
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
        this.logger[level](`LightLynx: ${message}`);
    }

    private async setupSSL() {
        const cfg = this.config;

        const externalIp = (cfg.remoteAccess ? await this.getExternalHost() : undefined) || cfg.ssl?.externalIp;
        const localIp = await this.getLocalIp() || cfg.ssl?.localIp;
        let changes = false;

        if ((externalIp || localIp) && (!cfg.ssl || localIp !== cfg.ssl.localIp || externalIp !== cfg.ssl.externalIp || cfg.ssl.expiresAt - Date.now() < SSL_RENEW_THRESHOLD)) {
            this.log('info', `Requesting SSL certificate localIp=${localIp} useExternalHost=${cfg.remoteAccess}`);
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
                const externalPort = (i < 2 && storedPort) ? storedPort : Math.floor(Math.random() * (65535 - 10000) + 10000);

                try {
                    await this.addPortMapping(gatewayUrl, localIp, PORT, externalPort, 'TCP', 'LightLynx');
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
        if (user.secret === '' && password === '') return user;
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
                allowedGroups: user.allowedGroups,
                allowRemote: user.allowRemote,
                secret: user.secret
            };
        }
        return result;
    }

    private sendConnectError(req: http.IncomingMessage, socket: any, head: Buffer, message: string) {
        this.wss!.handleUpgrade(req, socket, head, (ws) => {
            ws.send(JSON.stringify({ topic: 'bridge/lightlynx/connectError', payload: { message } }));
            ws.close();
        });
    }

    private onUpgrade(req: http.IncomingMessage, socket: any, head: Buffer) {
        const url = new URL(req.url!, 'http://localhost');
        if (url.pathname !== '/api') {
            socket.destroy();
            return;
        }

        const username = url.searchParams.get('user');
        if (!username) return this.sendConnectError(req, socket, head, 'No username provided.');
        const password = url.searchParams.get('secret') || '';
        const clientIp = this.getClientIp(req);

        const user = this.validateUser(username, password);
        if (!user) return this.sendConnectError(req, socket, head, 'Invalid user name or password.');

        const externalIp = this.config.ssl?.externalIp;
        const isRemote = !this.isLocalIp(clientIp) && clientIp !== externalIp;
        if (isRemote && !this.config.remoteAccess) {
            return this.sendConnectError(req, socket, head, 'Remote access is disabled on this server.');
        }
        if (isRemote && !user.allowRemote) {
            return this.sendConnectError(req, socket, head, 'Remote access not permitted for user.');
        }

        this.wss!.handleUpgrade(req, socket, head, (ws) => {
            this.clients.set(ws, { username, ...user });
            this.wss!.emit('connection', ws, req);
        });
    }

    private async onConnection(ws: WebSocket, _req: http.IncomingMessage) {
        const clientInfo = this.clients.get(ws);
        this.log('info', `Client connected: ${clientInfo?.username}`);

        ws.on('error', (err) => this.log('error', `WebSocket error: ${err.message}`));
        ws.on('close', () => this.clients.delete(ws));
        ws.on('message', (data) => this.onClientMessage(ws, data));

        await this.sendInitialState(ws, clientInfo);
    }

    private async sendInitialState(ws: WebSocket, clientInfo: any) {
        const state = await this.buildState(clientInfo);
        ws.send(JSON.stringify({ 
            type: 'state', 
            data: { full: state } 
        }));
    }

    private async buildState(clientInfo: any) {
        const state: any = {
            lights: {},
            groups: {},
            scenes: {},
            devices: {},
            activeScenes: {},
            config: {
                permitJoin: false,
                remoteAccess: this.config.remoteAccess,
                automation: this.config.automation,
                location: this.config.latitude && this.config.longitude ? {
                    latitude: this.config.latitude,
                    longitude: this.config.longitude
                } : undefined,
                addresses: {
                    local: this.config.ssl?.localIp ? `${this.config.ssl.localIp}:${PORT}` : undefined,
                    external: this.config.remoteAccess && this.config.ssl?.externalIp && this.config.externalPort 
                        ? `${this.config.ssl.externalIp}:${this.config.externalPort}` 
                        : undefined
                }
            }
        };

        // Read permitJoin from retained messages
        const bridgeInfoTopic = `${this.mqttBaseTopic}/bridge/info`;
        const bridgeInfo = this.mqtt.retainedMessages[bridgeInfoTopic];
        if (bridgeInfo) {
            try {
                const info = JSON.parse(bridgeInfo.payload);
                state.config.permitJoin = !!info.permit_join;
            } catch {}
        }

        // Build lights from devices with light capabilities
        for (const device of this.zigbee.devicesIterator((d: any) => d.type !== 'Coordinator')) {
            const ieee = device.zh?.ieeeAddr;
            if (!ieee) continue;

            const deviceState = this.state.get(device) || {};
            const definition = device.definition;
            
            // Check if this is a light device
            const lightExpose = definition?.exposes?.find((e: any) => e.type === 'light' || e.type === 'switch');
            
            if (lightExpose) {
                // Extract light capabilities
                const features = lightExpose.features || [];
                const brightnessFeat = features.find((f: any) => f.name === 'brightness');
                const colorHsFeat = features.find((f: any) => f.name === 'color_hs');
                const colorXyFeat = features.find((f: any) => f.name === 'color_xy');
                const colorTempFeat = features.find((f: any) => f.name === 'color_temp');

                state.lights[ieee] = {
                    ieee,
                    name: device.name,
                    model: (definition?.description || device.modelID) + " (" + (definition?.vendor || device.manufacturerName) + ")",
                    description: device.options?.description,
                    state: {
                        on: deviceState.state === 'ON',
                        brightness: deviceState.brightness,
                        color: deviceState.color_temp ? deviceState.color_temp :
                               deviceState.color ? deviceState.color : undefined
                    },
                    caps: {
                        brightness: brightnessFeat ? {
                            valueMin: brightnessFeat.value_min || 0,
                            valueMax: brightnessFeat.value_max || 255
                        } : undefined,
                        colorTemp: colorTempFeat ? {
                            valueMin: colorTempFeat.value_min || 150,
                            valueMax: colorTempFeat.value_max || 500
                        } : undefined,
                        colorHs: !!colorHsFeat,
                        colorXy: !!colorXyFeat,
                        supportsBrightness: !!brightnessFeat,
                        supportsColor: !!(colorHsFeat || colorXyFeat),
                        supportsColorTemp: !!colorTempFeat
                    },
                    meta: {
                        online: deviceState.linkquality !== undefined,
                        battery: deviceState.battery,
                        linkquality: deviceState.linkquality,
                        updateAvailable: deviceState.update?.state === 'available'
                    }
                };
            } else {
                // Non-light device
                const actionExpose = definition?.exposes?.find((e: any) => e.name === 'action');
                state.devices[ieee] = {
                    ieee,
                    name: device.name,
                    model: (definition?.description || device.modelID) + " (" + (definition?.vendor || device.manufacturerName) + ")",
                    description: device.options?.description,
                    actions: actionExpose?.values,
                    state: deviceState,
                    meta: {
                        online: deviceState.linkquality !== undefined,
                        battery: deviceState.battery,
                        linkquality: deviceState.linkquality
                    }
                };
            }
        }

        // Build groups
        for (const group of this.zigbee.groupsIterator()) {
            const groupId = group.ID;
            const members = (group.zh?.members || []).map((m: any) => m.deviceIeeeAddress);
            const scenes: any = {};
            
            // Extract scenes from group members
            for (const endpoint of group.zh?.members || []) {
                const scenesData = endpoint.meta?.scenes || {};
                for (const sceneKey in scenesData) {
                    const [sceneIdStr, groupIdStr] = sceneKey.split('_');
                    if (parseInt(groupIdStr!) !== groupId) continue;
                    const sceneId = parseInt(sceneIdStr!);
                    if (!scenes[sceneId]) {
                        const sceneName = scenesData[sceneKey].name || `Scene ${sceneId}`;
                        const suffix = sceneName.match(/ \((.*?)\)$/);
                        scenes[sceneId] = {
                            id: sceneId,
                            name: sceneName,
                            triggers: suffix ? this.parseSceneTriggers(suffix[1]) : undefined
                        };
                    }
                }
            }

            // Compute aggregate state from members
            const groupState = this.computeGroupState(members, state.lights);
            
            // Parse group metadata
            const description = group.options?.description || '';
            const timeoutMatch = description.match(/^lightlynx-timeout (\d+(?:\.\d+)?)([smhd])$/m);
            let timeout: number | undefined;
            if (timeoutMatch) {
                const value = parseFloat(timeoutMatch[1]);
                const unit = {s: 1, m: 60, h: 60*60, d: 24*60*60}[timeoutMatch[2] as 's' | 'm' | 'h' | 'd'];
                if (unit && !isNaN(value)) timeout = value * unit * 1000;
            }

            // Extract linked devices (non-lights associated via description)
            const linkedDevices: string[] = [];
            for (const ieee in state.devices) {
                const dev = state.devices[ieee];
                const groupsMatch = dev.description?.match(/^lightlynx-groups (\d+(,\d+)*)$/m);
                if (groupsMatch) {
                    const groupIds = groupsMatch[1].split(',').map((s: string) => parseInt(s));
                    if (groupIds.includes(groupId)) {
                        linkedDevices.push(ieee);
                    }
                }
            }

            state.groups[groupId] = {
                id: groupId,
                name: group.name,
                description,
                members,
                state: groupState.state,
                caps: groupState.caps,
                timeout,
                linkedDevices
            };

            if (Object.keys(scenes).length > 0) {
                state.scenes[groupId] = scenes;
            }
        }

        // Add active scenes
        for (const [groupName, sceneId] of Object.entries(this.activeScenes)) {
            const group = Object.values(state.groups).find((g: any) => g.name === groupName);
            if (group && sceneId !== undefined) {
                state.activeScenes[group.id] = sceneId;
            }
        }

        // Add users (admin only)
        if (clientInfo.isAdmin) {
            state.users = {};
            for (const [username, user] of Object.entries(this.config.users)) {
                state.users[username] = {
                    isAdmin: user.isAdmin,
                    allowedGroups: user.allowedGroups,
                    allowRemote: user.allowRemote
                };
            }
        }

        return state;
    }

    private parseSceneTriggers(suffix: string): any[] {
        const triggers: any[] = [];
        for (const condition of suffix.split(',')) {
            const m = condition.match(/^\s*([0-9a-z]+)(?: ([^)-]*?)-([^)-]*))?\s*$/);
            if (!m) continue;
            const [_fullMatch, trigger, start, end] = m;
            
            if (trigger === 'sensor') {
                triggers.push({ type: 'sensor' });
            } else if (trigger === 'time' && start && end) {
                triggers.push({ type: 'time', timeRange: { start, end } });
            } else {
                const clicks = parseInt(trigger!);
                if (!isNaN(clicks)) {
                    triggers.push({ type: 'click', clicks });
                }
            }
        }
        return triggers;
    }

    private computeGroupState(members: string[], lights: any): { state: any, caps: any } {
        let groupState: any = { on: false };
        let groupCaps: any = {
            supportsBrightness: false,
            supportsColor: false,
            supportsColorTemp: false
        };
        let onCount = 0;

        for (const ieee of members) {
            const light = lights[ieee];
            if (!light) continue;

            // Merge capabilities
            if (light.caps.supportsBrightness) groupCaps.supportsBrightness = true;
            if (light.caps.supportsColor) groupCaps.supportsColor = true;
            if (light.caps.supportsColorTemp) groupCaps.supportsColorTemp = true;
            if (light.caps.brightness) {
                if (!groupCaps.brightness) {
                    groupCaps.brightness = { ...light.caps.brightness };
                } else {
                    groupCaps.brightness.valueMin = Math.min(groupCaps.brightness.valueMin, light.caps.brightness.valueMin);
                    groupCaps.brightness.valueMax = Math.max(groupCaps.brightness.valueMax, light.caps.brightness.valueMax);
                }
            }
            if (light.caps.colorTemp) {
                if (!groupCaps.colorTemp) {
                    groupCaps.colorTemp = { ...light.caps.colorTemp };
                } else {
                    groupCaps.colorTemp.valueMin = Math.min(groupCaps.colorTemp.valueMin, light.caps.colorTemp.valueMin);
                    groupCaps.colorTemp.valueMax = Math.max(groupCaps.colorTemp.valueMax, light.caps.colorTemp.valueMax);
                }
            }
            if (light.caps.colorHs) groupCaps.colorHs = true;
            if (light.caps.colorXy) groupCaps.colorXy = true;

            // Compute aggregate state
            if (light.state.on) {
                onCount++;
                groupState.on = true;
            }
        }

        // Average properties only from ON lights
        if (onCount > 0) {
            let totalBrightness = 0, brightCount = 0;
            let totalColorTemp = 0, colorTempCount = 0;
            for (const ieee of members) {
                const light = lights[ieee];
                if (!light || !light.state.on) continue;
                if (light.state.brightness !== undefined) {
                    totalBrightness += light.state.brightness;
                    brightCount++;
                }
                if (typeof light.state.color === 'number') {
                    totalColorTemp += light.state.color;
                    colorTempCount++;
                }
            }
            if (brightCount > 0) groupState.brightness = Math.round(totalBrightness / brightCount);
            if (colorTempCount > 0) groupState.color = Math.round(totalColorTemp / colorTempCount);
        }

        return { state: groupState, caps: groupCaps };
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
        
        if (msg.type !== 'command') {
            this.log('warning', `Invalid message type from ${clientInfo.username}: ${msg.type}`);
            return;
        }

        const { id, cmd, args } = msg;
        this.handleCommand(ws, clientInfo, id, cmd, args);
    }

    private async handleCommand(ws: WebSocket, clientInfo: any, id: string, cmd: string, args: any) {
        try {
            const [category, action] = cmd.split('.');
            let result: any;

            switch (category) {
                case 'light':
                    result = await this.handleLightCommand(clientInfo, action, args);
                    break;
                case 'group':
                    result = await this.handleGroupCommand(clientInfo, action, args);
                    break;
                case 'scene':
                    result = await this.handleSceneCommand(clientInfo, action, args);
                    break;
                case 'config':
                    result = await this.handleConfigCommand(clientInfo, action, args);
                    break;
                case 'user':
                    result = await this.handleUserCommand(clientInfo, action, args);
                    break;
                case 'device':
                    result = await this.handleDeviceCommand(clientInfo, action, args);
                    break;
                default:
                    throw new Error(`Unknown command category: ${category}`);
            }

            ws.send(JSON.stringify({ type: 'response', id, ok: true, data: result }));
        } catch (error: any) {
            this.log('error', `Command error for ${clientInfo.username}: ${error.message}`);
            ws.send(JSON.stringify({ 
                type: 'response', 
                id, 
                ok: false, 
                error: error.message 
            }));
        }
    }

    private async handleLightCommand(clientInfo: any, action: string, args: any) {
        if (action === 'set') {
            const { ieee, state, transition } = args;
            const device = this.findDeviceByIeee(ieee);
            if (!device) throw new Error('Device not found');
            
            // Check permission
            if (!clientInfo.isAdmin) {
                const hasAccess = this.checkDeviceAccess(clientInfo, ieee);
                if (!hasAccess) throw new Error('Permission denied');
            }

            const payload: any = {};
            if (state.on !== undefined) payload.state = state.on ? 'ON' : 'OFF';
            if (state.brightness !== undefined) payload.brightness = state.brightness;
            if (state.color !== undefined) {
                if (typeof state.color === 'number') {
                    payload.color_temp = state.color;
                } else if (state.color.hue !== undefined) {
                    payload.color = { hue: state.color.hue, saturation: state.color.saturation * 100 };
                } else if (state.color.x !== undefined) {
                    payload.color = { x: state.color.x, y: state.color.y };
                }
            }
            if (transition !== undefined) payload.transition = transition;

            this.mqtt.onMessage(`${this.mqttBaseTopic}/${device.name}/set`, Buffer.from(JSON.stringify(payload)));
            return undefined;
        }
        throw new Error(`Unknown light action: ${action}`);
    }

    private async handleGroupCommand(clientInfo: any, action: string, args: any) {
        if (action === 'set') {
            const { id, state, transition } = args;
            const group = this.zigbee.resolveEntity(id);
            if (!group) throw new Error('Group not found');
            
            // Check permission
            if (!clientInfo.isAdmin && !clientInfo.allowedGroups?.includes(id)) {
                throw new Error('Permission denied');
            }

            const payload: any = {};
            if (state.on !== undefined) payload.state = state.on ? 'ON' : 'OFF';
            if (state.brightness !== undefined) payload.brightness = state.brightness;
            if (state.color !== undefined) {
                if (typeof state.color === 'number') {
                    payload.color_temp = state.color;
                } else if (state.color.hue !== undefined) {
                    payload.color = { hue: state.color.hue, saturation: state.color.saturation * 100 };
                } else if (state.color.x !== undefined) {
                    payload.color = { x: state.color.x, y: state.color.y };
                }
            }
            if (transition !== undefined) payload.transition = transition;

            this.mqtt.onMessage(`${this.mqttBaseTopic}/${group.name}/set`, Buffer.from(JSON.stringify(payload)));
            return undefined;
        }
        throw new Error(`Unknown group action: ${action}`);
    }

    private async handleSceneCommand(clientInfo: any, action: string, args: any) {
        if (action === 'recall') {
            const { groupId, sceneId, transition } = args;
            const group = this.zigbee.resolveEntity(groupId);
            if (!group) throw new Error('Group not found');
            
            // Check permission
            if (!clientInfo.isAdmin && !clientInfo.allowedGroups?.includes(groupId)) {
                throw new Error('Permission denied');
            }

            const payload: any = { scene_recall: sceneId };
            if (transition !== undefined) payload.transition = transition;

            this.mqtt.onMessage(`${this.mqttBaseTopic}/${group.name}/set`, Buffer.from(JSON.stringify(payload)));
            return undefined;
        }
        // TODO: Implement scene state storage and management
        // - scene.store: Store current bulb states for a scene (requires reading back states from devices)
        // - scene.create: Create a new scene in Z2M
        // - scene.update: Update scene name or states
        // - scene.delete: Remove a scene from Z2M
        // These will require integration with Z2M's scene management API
        throw new Error(`Scene action not implemented: ${action}`);
    }

    private async handleConfigCommand(clientInfo: any, action: string, args: any) {
        if (!clientInfo.isAdmin) throw new Error('Admin permission required');

        switch (action) {
            case 'setRemoteAccess':
                this.config.remoteAccess = !!args.enabled;
                this.saveConfig();
                await this.setupSSL();
                this.broadcastConfig();
                return undefined;
            
            case 'setAutomation':
                const wasEnabled = this.config.automation;
                this.config.automation = !!args.enabled;
                this.saveConfig();
                if (this.config.automation && !wasEnabled) {
                    this.automation = new Automation(this.mqtt, this.zigbee, this.state, this.mqttBaseTopic, this.config);
                    this.automation.start(this.eventBus);
                } else if (!this.config.automation && wasEnabled && this.automation) {
                    this.automation.stop(this.eventBus);
                    this.automation = undefined;
                }
                this.broadcastConfig();
                return undefined;
            
            case 'setLocation':
                if (args.latitude !== undefined) this.config.latitude = args.latitude;
                if (args.longitude !== undefined) this.config.longitude = args.longitude;
                this.saveConfig();
                this.broadcastConfig();
                return undefined;
            
            case 'setPermitJoin':
                // TODO: Implement permit join control
                // Requires integration with Z2M's permit_join API to control pairing mode
                // Should support duration parameter and broadcast config updates to all clients
                throw new Error('setPermitJoin not yet implemented');
            
            default:
                throw new Error(`Unknown config action: ${action}`);
        }
    }

    private async handleUserCommand(clientInfo: any, action: string, args: any) {
        if (!clientInfo.isAdmin) throw new Error('Admin permission required');

        switch (action) {
            case 'add':
                const { username, secret, isAdmin, allowedGroups, allowRemote } = args;
                if (!username) throw new Error('Username required');
                if (username === 'admin') throw new Error('Cannot add admin user');
                if (this.config.users[username]) throw new Error('User already exists');
                if (allowRemote && !secret) throw new Error('Cannot enable remote access without a password');
                this.config.users[username] = { 
                    secret: secret || '', 
                    isAdmin: !!isAdmin, 
                    allowedGroups: allowedGroups || [], 
                    allowRemote: !!allowRemote 
                };
                this.saveConfig();
                this.broadcastUsers();
                return undefined;
            
            case 'update':
                const updateUsername = args.username;
                if (!updateUsername) throw new Error('Username required');
                const user = this.config.users[updateUsername];
                if (!user) throw new Error('User not found');
                if (args.secret !== undefined) user.secret = args.secret;
                if (args.isAdmin !== undefined) user.isAdmin = args.isAdmin;
                if (args.allowedGroups !== undefined) user.allowedGroups = args.allowedGroups;
                if (args.allowRemote !== undefined) {
                    if (args.allowRemote && !user.secret) throw new Error('Cannot enable remote access without a password');
                    user.allowRemote = args.allowRemote;
                }
                this.saveConfig();
                this.broadcastUsers();
                return undefined;
            
            case 'delete':
                const deleteUsername = args.username;
                if (!deleteUsername) throw new Error('Username required');
                if (deleteUsername === 'admin') throw new Error('Cannot delete admin user');
                if (!this.config.users[deleteUsername]) throw new Error('User not found');
                delete this.config.users[deleteUsername];
                this.saveConfig();
                this.broadcastUsers();
                return undefined;
            
            default:
                throw new Error(`Unknown user action: ${action}`);
        }
    }

    private async handleDeviceCommand(clientInfo: any, action: string, args: any) {
        // TODO: Implement device management operations
        // - device.rename: Rename a device in Z2M (requires Z2M rename API)
        // - device.linkGroups: Associate non-light devices with groups via description metadata
        //   (update device description with 'lightlynx-groups X,Y,Z' format)
        throw new Error(`Device action not implemented: ${action}`);
    }

    private findDeviceByIeee(ieee: string): any {
        for (const device of this.zigbee.devicesIterator()) {
            if (device.zh?.ieeeAddr === ieee) return device;
        }
        return null;
    }

    private checkDeviceAccess(clientInfo: any, ieee: string): boolean {
        if (clientInfo.isAdmin) return true;
        for (const gid of clientInfo.allowedGroups || []) {
            const g = this.zigbee.resolveEntity(gid) as any;
            const members = g?.zh?.members;
            if (members?.some((m: any) => m.deviceIeeeAddress === ieee)) {
                return true;
            }
        }
        return false;
    }

    private broadcastConfig() {
        const payload = {
            config: {
                remoteAccess: this.config.remoteAccess,
                automation: this.config.automation,
                location: this.config.latitude && this.config.longitude ? {
                    latitude: this.config.latitude,
                    longitude: this.config.longitude
                } : undefined,
                addresses: {
                    local: this.config.ssl?.localIp ? `${this.config.ssl.localIp}:${PORT}` : undefined,
                    external: this.config.remoteAccess && this.config.ssl?.externalIp && this.config.externalPort 
                        ? `${this.config.ssl.externalIp}:${this.config.externalPort}` 
                        : undefined
                }
            }
        };
        this.broadcast({ type: 'state', data: payload });
    }

    private broadcastUsers() {
        const users: any = {};
        for (const [username, user] of Object.entries(this.config.users)) {
            users[username] = {
                isAdmin: user.isAdmin,
                allowedGroups: user.allowedGroups,
                allowRemote: user.allowRemote
            };
        }
        this.broadcast({ type: 'state', data: { users } });
    }

    private broadcast(message: any) {
        for (const [ws, _clientInfo] of this.clients) {
            if (ws.readyState !== WebSocket.OPEN) continue;
            ws.send(JSON.stringify(message));
        }
    }

    private findDeviceIeeeByName(name: string): string | null {
        for (const device of this.zigbee.devicesIterator()) {
            const ieeeAddr = device.zh?.ieeeAddr;
            if (device.name === name || ieeeAddr === name) return ieeeAddr;
        }
        return null;
    }

    private findGroupIdByName(name: string): number | null {
        for (const group of this.zigbee.groupsIterator()) {
            const groupId = group.zh?.groupID;
            if (group.name === name || String(groupId) === name) return groupId;
        }
        return null;
    }

    private handleSceneTracking(data: any) {
        if (!data.topic.startsWith(`${this.mqttBaseTopic}/`)) return;
        const parts = data.topic.slice(this.mqttBaseTopic.length + 1).split('/');
        if (parts[0] === 'bridge') return;

        const groupName = parts[0];
        if (!groupName || this.findGroupIdByName(groupName) == null) return;
        
        if (parts.length === 2 && parts[1] === 'set') {
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

    private onMQTTPublish(data: any) {
        if (data.options.meta?.isEntityState || !data.topic.startsWith(`${this.mqttBaseTopic}/`)) return;
        // For v2, we don't need to broadcast individual MQTT messages
        // State updates are handled through buildState and specific broadcast methods
    }

    private onEntityState(data: any) {
        // For v2, we don't need to broadcast individual entity state changes
        // State updates are handled through buildState and specific broadcast methods
    }

    private async onMQTTRequest(data: any) {
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
                    case 'setAutomation':
                        const wasEnabled = this.config.automation;
                        this.config.automation = !!message.enabled;
                        this.saveConfig();
                        if (this.config.automation && !wasEnabled) {
                            this.automation = new Automation(this.mqtt, this.zigbee, this.state, this.mqttBaseTopic, this.config);
                            this.automation.start(this.eventBus);
                            this.log('info', 'Automation enabled');
                        } else if (!this.config.automation && wasEnabled && this.automation) {
                            this.automation.stop(this.eventBus);
                            this.automation = undefined;
                            this.log('info', 'Automation disabled');
                        }
                        response = { data: { automation: this.config.automation }, status: 'ok' };
                        this.broadcastConfig();
                        break;
                    case 'setLocation':
                        if (message.latitude !== undefined) this.config.latitude = message.latitude;
                        if (message.longitude !== undefined) this.config.longitude = message.longitude;
                        this.saveConfig();
                        // No need to restart automation - it reads from config
                        response = { data: { latitude: this.config.latitude, longitude: this.config.longitude }, status: 'ok' };
                        this.broadcastConfig();
                        break;
                    case 'addUser': 
                        response = this.addUser(message); 
                        this.broadcastUsers(); 
                        break;
                    case 'updateUser': 
                        response = this.updateUser(message); 
                        this.broadcastUsers(); 
                        break;
                    case 'deleteUser': 
                        response = this.deleteUser(message); 
                        this.broadcastUsers(); 
                        break;
                    default: 
                        response = { status: 'error', error: 'Unknown action' };
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

    private async getPayloadForConfig() {
        return { 
            remoteAccess: this.config.remoteAccess,
            automation: this.config.automation,
            latitude: this.config.latitude,
            longitude: this.config.longitude,
            localAddress: this.config.ssl?.localIp 
                ? `${this.config.ssl.localIp}:${PORT}` 
                : undefined,
            externalAddress: this.config.remoteAccess && this.config.ssl?.externalIp && this.config.externalPort 
                ? `${this.config.ssl.externalIp}:${this.config.externalPort}` 
                : undefined,
        };
    }

    private addUser(message: any) {
        const { username, secret, isAdmin, allowedGroups, allowRemote } = message;
        if (!username) throw new Error('Username required');
        if (username === 'admin') throw new Error('Cannot add admin user');
        if (this.config.users[username]) throw new Error('User already exists');
        if (allowRemote && !secret) throw new Error('Cannot enable remote access without a password');
        this.config.users[username] = { 
            secret: secret || '', 
            isAdmin: !!isAdmin, 
            allowedGroups: allowedGroups || [], 
            allowRemote: !!allowRemote 
        };
        this.saveConfig();
        return { status: 'ok' };
    }

    private updateUser(message: any) {
        const { username, secret, isAdmin, allowedGroups, allowRemote } = message;
        if (!username) throw new Error('Username required');
        const user = this.config.users[username];
        if (!user) throw new Error('User not found');
        if (secret !== undefined) user.secret = secret;
        if (isAdmin !== undefined) user.isAdmin = isAdmin;
        if (allowedGroups !== undefined) user.allowedGroups = allowedGroups;
        if (allowRemote !== undefined) {
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
}

module.exports = LightLynx;
