
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Types ---

interface MockDevice {
    ieeeAddr: string;
    friendly_name: string;
    model: string;
    description: string;
    vendor: string;
    exposes: any[];
    type: 'EndDevice' | 'Router' | 'Coordinator';
}

interface MockGroup {
    id: number;
    friendly_name: string;
    description: string;
    members: string[]; // ieee addresses
    scenes: { id: number; name: string }[];
}

// --- Mock Z2M Environment ---

class MockLogger {
    info(msg: string) { console.log(`[INFO] ${msg}`); }
    warn(msg: string) { console.warn(`[WARN] ${msg}`); }
    error(msg: string) { console.error(`[ERROR] ${msg}`); }
    debug(_msg: string) { /* console.log(`[DEBUG] ${msg}`); */ }
}

class MockEventBus extends EventEmitter {
    onMQTTMessagePublished(_key: any, cb: any) { this.on('mqttMessagePublished', cb); }
    onPublishEntityState(_key: any, cb: any) { this.on('publishEntityState', cb); }
    onMQTTMessage(_key: any, cb: any) { this.on('mqttMessage', cb); }
    onStateChange(_key: any, cb: any) { this.on('stateChange', cb); }
    onScenesChanged(_key: any, cb: any) { this.on('scenesChanged', cb); }
    onGroupMembersChanged(_key: any, cb: any) { this.on('groupMembersChanged', cb); }
    
    emitMQTTMessage(topic: string, message: string) {
        this.emit('mqttMessage', { topic, message });
    }
    emitMQTTMessagePublished(topic: string, payload: string, options: any = {}) {
        if (typeof mqtt !== 'undefined') mqtt.retainedMessages[topic] = { payload } as any;
        this.emit('mqttMessagePublished', { topic: topic, payload, options });
    }
    emitPublishEntityState(entity: any, state: any) {
        this.emit('publishEntityState', { entity, state });
    }
    emitStateChange(data: any) {
        this.emit('stateChange', data);
    }

    removeListeners(_key: any) {
        this.removeAllListeners();
    }
}

class MockEntity {
    public id: string | number;
    public options: any;
    public zh: any;
    public definition: any;
    private _members: string[] = [];
    constructor(id: string | number, options: any, data?: any) {
        this.id = id;
        this.options = options;
        this.zh = {
            ieeeAddr: typeof id === 'string' ? id : undefined,
            groupID: typeof id === 'number' ? id : undefined,
            type: data?.type || (typeof id === 'string' ? 'Router' : undefined),
            modelID: data?.model,
            manufacturerName: data?.vendor,
            members: []
        };
        if (data?.exposes) {
            this.definition = {
                model: data.model,
                vendor: data.vendor,
                description: data.description,
                exposes: data.exposes
            };
        }
        if (data?.members) {
            this._members = data.members;
            this.zh.members = data.members;
        }
        if (data?.scenes) {
            this.zh.scenes = data.scenes;
        }
    }
    toJSON() {
        if (this.isDevice()) {
            return {
                ieee_address: this.id,
                friendly_name: this.name,
                model_id: this.zh.modelID,
                manufacturer: this.zh.manufacturerName,
                type: this.zh.type,
                definition: this.definition
            };
        } else {
            return {
                id: this.id,
                friendly_name: this.name,
                members: this.members.map(m => ({ ieee_address: m.id, friendly_name: m.name })),
                scenes: this.zh.scenes || []
            };
        }
    }
    get members(): MockEntity[] {
        return this._members.map(addr => zigbee.deviceByIeeeAddr(addr)).filter(d => !!d) as MockEntity[];
    }
    get ieeeAddr() { return this.zh.ieeeAddr; }
    get ID() { return this.id; }
    get name(): string { return this.options.friendly_name; }
    isDevice(): this is MockEntity & { id: string } { return typeof this.id === 'string'; }
    isGroup(): this is MockEntity & { id: number } { return typeof this.id === 'number'; }
}

class MockZigbee {
    devices = new Map<string, MockEntity>();
    groups = new Map<number, MockEntity>();

    constructor() {}

    groupByID(id: number) { return this.groups.get(id); }
    groupByName(name: string) { return [...this.groups.values()].find(g => g.name === name); }
    deviceByFriendlyName(name: string) { return [...this.devices.values()].find(d => d.name === name); }
    deviceByIeeeAddr(ieeeAddr: string) { return this.devices.get(ieeeAddr); }

    *devicesIterator(predicate?: (d: any) => boolean) {
        for (const d of this.devices.values()) if (!predicate || predicate(d.zh)) yield d;
    }
    *groupsIterator(predicate?: (g: any) => boolean) {
        for (const g of this.groups.values()) if (!predicate || predicate(g.zh)) yield g;
    }

    *groupsAndDevicesIterator() {
        yield* this.devicesIterator();
        yield* this.groupsIterator();
    }

    resolveEntity(id: string | number) {
        return this.devices.get(id as string) || this.groups.get(id as number);
    }

    permitJoin(time: number) {
        console.log(`Permit join: ${time}`);
        if (time > 0) {
            startPairingProcedure();
        }
    }
}

class MockSettings {
    data = {
        mqtt: { base_topic: 'zigbee2mqtt' },
        frontend: { port: parseInt(process.env.MOCK_Z2M_PORT || '8080'), host: '0.0.0.0', enabled: true },
        advanced: {
            cache_state_persistent: false,
            timestamp_format: 'YYYY-MM-DD HH:mm:ss'
        },
        location: {
            latitude: 52.3676,
            longitude: 4.9041
        },
        device_options: {},
        devices: {},
        groups: {}
    };
    get() { return this.data; }
    set(path: string, value: any) {
        // Simple path setter for common settings
        if (path === 'frontend.enabled') this.data.frontend.enabled = value;
        console.log(`Settings updated: ${path} = ${value}`);
    }
}

class MockState {
    states = new Map<string | number, any>();
    private _eventBus: MockEventBus;
    constructor(eventBus: MockEventBus) {
        this._eventBus = eventBus;
    }
    get(entity: MockEntity) { return this.states.get(entity.id) || {}; }
    set(entity: MockEntity, update: any) {
        const current = this.get(entity);
        const next = { ...current, ...update };
        this.states.set(entity.id, next);
        this._eventBus.emitPublishEntityState(entity, next);
        this._eventBus.emitStateChange({ entity, from: current, to: next, update });
        return next;
    }
}

// --- Global State ---

const logger = new MockLogger();
const eventBus = new MockEventBus();
const zigbee = new MockZigbee();
const settings = new MockSettings();
const state = new MockState(eventBus);

// --- Global Main Server ---

const http = require('http');
const WebSocket = require('ws');

let mainServer: any = null;
let mainWss: any = null;

async function startBaseServer() {
    const frontend = settings.get().frontend;
    if (!frontend.enabled) {
        console.log('Base server disabled in settings.');
        return;
    }

    mainServer = http.createServer((req: any, res: any) => {
        res.writeHead(200);
        res.end('Mock Z2M Server (Base)');
    });

    mainWss = new WebSocket.Server({ noServer: true });
    mainWss.on('connection', (ws: any, request: any) => {
        setupWebSocketClient(ws);
    });

    mainServer.on('upgrade', (request: any, socket: any, head: any) => {
        const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
        if (pathname === '/api') {
            mainWss.handleUpgrade(request, socket, head, (ws: any) => {
                mainWss.emit('connection', ws, request);
            });
        } else {
            socket.destroy();
        }
    });

    const port = frontend.port;
    await new Promise<void>(resolve => {
        mainServer.listen(port, '0.0.0.0', () => {
            console.log(`Mock Z2M Base Server running on port ${port}`);
            resolve();
        });
    });
}

function stopBaseServer() {
    return new Promise<void>(resolve => {
        if (mainWss) {
            for (const client of mainWss.clients) client.terminate();
            mainWss.close();
        }
        if (mainServer) {
            mainServer.close(() => {
                mainServer = null;
                mainWss = null;
                resolve();
            });
        } else {
            resolve();
        }
    });
}

let restartInProgress = false;
let restartPending = false;
async function restart() {
    if (restartInProgress) {
        restartPending = true;
        return;
    }
    restartInProgress = true;
    try {
        do {
            restartPending = false;
            process.stderr.write('--- RESTARTING MOCK Z2M ---\n');
            await stopBaseServer();
            // In real Z2M, extensions are NOT necessarily stopped manually if they don't have a stop() or if the process exits,
            // but here we want to keep the process alive, so we must stop them.
            for (const name of Array.from(extensionManager.getRunningNames())) {
                await extensionManager.stop(name);
            }
            await startBaseServer();
            await extensionManager.startAll();
        } while (restartPending);
    } finally {
        restartInProgress = false;
    }
}

// --- Extension Manager ---

class ExtensionManager {
    private extensionsList: { name: string, code: string }[] = [];
    private runningExtensions = new Map<string, any>();

    constructor() {}

    getRunningNames() { return this.runningExtensions.keys(); }

    async save(name: string, code: string) {
        console.log(`ExtensionManager: Saving ${name}`);
        const existing = this.extensionsList.find(e => e.name === name);
        if (existing) {
            existing.code = code;
        } else {
            this.extensionsList.push({ name, code });
        }
        await restart();
    }

    async remove(name: string) {
        console.log(`ExtensionManager: Removing ${name}`);
        this.extensionsList = this.extensionsList.filter(e => e.name !== name);
        await restart();
    }

    async stop(name: string) {
        const ext = this.runningExtensions.get(name);
        if (ext) {
            console.log(`ExtensionManager: Stopping ${name}`);
            if (typeof ext.stop === 'function') {
                await ext.stop();
            }
            this.runningExtensions.delete(name);
        }
    }

    list() {
        return this.extensionsList.map(e => ({ name: e.name, code: e.code.split('\n')[0] }));
    }

    async startAll() {
        for (const ext of this.extensionsList) {
            await this.start(ext.name, ext.code);
        }
        eventBus.emitMQTTMessagePublished('zigbee2mqtt/bridge/extensions', JSON.stringify(this.list()));
    }

    async start(name: string, code: string) {
        console.log(`ExtensionManager: Starting ${name}`);
        const module: any = { exports: {} };
        const req = (modName: string) => require(modName);

        try {
            const wrapper = new Function('module', 'require', '__dirname', code);
            wrapper(module, req, __dirname);

            const ExtensionClass = module.exports;
            const ext = new ExtensionClass(
                zigbee,
                mqtt,
                state,
                (entity: any, update: any) => state.set(entity, update),
                eventBus,
                () => {}, // enableDisableExtension
                async () => {
                    console.log(`Extension ${name} requested restart`);
                    setTimeout(restart, 100);
                },
                () => {}, // addExtension
                settings,
                logger
            );

            await ext.start();
            this.runningExtensions.set(name, ext);
            console.log(`ExtensionManager: Started ${name}`);
        } catch (err: any) {
            console.error(`ExtensionManager: Failed to start ${name}:`, err);
        }
    }
}

const extensionManager = new ExtensionManager();

const devicesData: Record<string, MockDevice> = {
    '0x001': { ieeeAddr: '0x001', friendly_name: 'Color Light', model: 'MOCK_COLOR', description: 'Color light bulb', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 },
            { name: 'color_hs', type: 'composite', features: [{name:'hue', property:'hue'}, {name:'saturation', property:'saturation'}] }
        ]}
    ]},
    '0x002': { ieeeAddr: '0x002', friendly_name: 'White Light', model: 'MOCK_WHITE', description: 'White light bulb', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 }
        ]}
    ]}
};

const groupsData: Record<number, MockGroup> = {
    1: { id: 1, friendly_name: 'Living Room', description: 'Main group', members: ['0x001', '0x002'], scenes: [{id:1, name:'Bright'}, {id:2, name:'Dim'}] },
    2: { id: 2, friendly_name: 'Kitchen', description: 'Secondary group', members: ['0x002'], scenes: [{id:3, name:'Cooking'}, {id:4, name:'Night'}] }
};

// Initialize
function init() {
    for (const [ieee, d] of Object.entries(devicesData)) {
        const entity = new MockEntity(ieee, { friendly_name: d.friendly_name }, d);
        zigbee.devices.set(ieee, entity);
        state.set(entity, { state: 'OFF', brightness: 255 });
    }
    for (const [id, g] of Object.entries(groupsData)) {
        const idNum = Number(id);
        const entity = new MockEntity(idNum, { friendly_name: g.friendly_name }, g);
        zigbee.groups.set(idNum, entity);
        state.set(entity, { state: 'OFF' });
    }

    const base = 'zigbee2mqtt';
    mqtt.retainedMessages[`${base}/bridge/devices`] = { payload: JSON.stringify([...zigbee.devicesIterator()].map(d => d.toJSON())) } as any;
    mqtt.retainedMessages[`${base}/bridge/groups`] = { payload: JSON.stringify([...zigbee.groupsIterator()].map(g => g.toJSON())) } as any;
    mqtt.retainedMessages[`${base}/bridge/extensions`] = { payload: JSON.stringify([]) } as any;
}

// --- MQTT Mock ---

class MockMQTT {
    public retainedMessages: Record<string, { payload: string }> = {};

    publish(topic: string, message: string, options?: any) {
        console.log(`MockZ2M: MQTT OUT: ${topic} -> ${message}`);
        eventBus.emitMQTTMessagePublished(topic, message, options);
    }

    onMessage(topic: string, message: any) {
        const messageStr = message.toString();
        process.stderr.write(`MockZ2M: MQTT IN: ${topic} -> ${messageStr}\n`);
        eventBus.emitMQTTMessage(topic, messageStr);
        
        // Internal handling
        const parts = topic.split('/');
        const base = settings.get().mqtt.base_topic;
        if (parts[0] === base) {
            const entityName = parts[1];
            if (entityName && parts[2] === 'set') {
                const payload = JSON.parse(messageStr);
                const entity = zigbee.deviceByFriendlyName(entityName) || zigbee.groupByName(entityName);
                if (entity) {
                    if (payload.scene_store !== undefined) {
                        const sceneId = typeof payload.scene_store === 'object' ? payload.scene_store.ID : payload.scene_store;
                        const sceneName = typeof payload.scene_store === 'object' ? payload.scene_store.name : `Scene ${sceneId}`;
                        
                        entity.zh.scenes = entity.zh.scenes || [];
                        const existing = entity.zh.scenes.find((s: any) => s.id === sceneId);
                        if (existing) {
                            existing.name = sceneName;
                        } else {
                            entity.zh.scenes.push({ id: sceneId, name: sceneName });
                        }
                        process.stderr.write(`MockZ2M: Scene stored: ${sceneId} (${sceneName})\n`);
                        eventBus.emitMQTTMessagePublished(`${base}/bridge/groups`, JSON.stringify([...zigbee.groupsIterator()].map(g => g.toJSON())));
                    }
                    if (payload.scene_name !== undefined) {
                        const { id, name } = payload.scene_name;
                        entity.zh.scenes = entity.zh.scenes || [];
                        const scene = entity.zh.scenes.find((s: any) => s.id === id);
                        if (scene) scene.name = name;
                        else entity.zh.scenes.push({ id, name });
                        process.stderr.write(`MockZ2M: Scene named: ${id} -> ${name}\n`);
                        eventBus.emitMQTTMessagePublished(`${base}/bridge/groups`, JSON.stringify([...zigbee.groupsIterator()].map(g => g.toJSON())));
                    }
                    state.set(entity, payload);
                    // Echo back state
                    eventBus.emitMQTTMessagePublished(`${base}/${entityName}`, JSON.stringify(state.get(entity)));
                } else {
                    process.stderr.write(`MockZ2M: Entity not found: ${entityName}\n`);
                }
            } else if (parts[1] === 'bridge' && parts[2] === 'request') {
                handleBridgeRequest(parts.slice(2).join('/'), messageStr ? JSON.parse(messageStr) : {});
            }
        }
    }
}

const mqtt = new MockMQTT();

function handleBridgeRequest(cmd: string, payload: any) {
    console.log(`Bridge Request: ${cmd}`, payload);
    const base = settings.get().mqtt.base_topic;
    let responseData: any = {};

    if (cmd === 'request/permit_join') {
        zigbee.permitJoin(payload.value ? 254 : 0);
    } else if (cmd === 'request/device/rename') {
        const device = typeof payload.from === 'string' ? zigbee.deviceByFriendlyName(payload.from) : undefined;
        if (device) {
            device.options.friendly_name = payload.to;
            eventBus.emitMQTTMessagePublished(`${base}/bridge/devices`, JSON.stringify([...zigbee.devicesIterator()].map(d => d.toJSON())));
        }
    } else if (cmd === 'request/group/add') {
        const id = Math.max(0, ...zigbee.groups.keys()) + 1;
        const entity = new MockEntity(id, { friendly_name: payload.friendly_name }, { description: '' });
        zigbee.groups.set(id, entity);
        state.set(entity, { state: 'OFF' });
        eventBus.emitMQTTMessagePublished(`${base}/bridge/groups`, JSON.stringify([...zigbee.groupsIterator()].map(g => g.toJSON())));
        responseData = { id, friendly_name: payload.friendly_name };
    } else if (cmd === 'request/group/members/add') {
        const group = typeof payload.group === 'number' ? zigbee.groupByID(payload.group) : undefined;
        if (group && typeof payload.device === 'string') {
            group.zh.members = group.zh.members || [];
            if (!group.zh.members.includes(payload.device)) {
                group.zh.members.push(payload.device);
                eventBus.emitMQTTMessagePublished(`${base}/bridge/groups`, JSON.stringify([...zigbee.groupsIterator()].map(g => g.toJSON())));
            }
        }
    } else if (cmd === 'request/group/remove') {
        zigbee.groups.delete(payload.id);
        eventBus.emitMQTTMessagePublished(`${base}/bridge/groups`, JSON.stringify([...zigbee.groupsIterator()].map(g => g.toJSON())));
    } else if (cmd === 'request/options') {
        if (payload.options && payload.options.frontend !== undefined) {
             settings.set('frontend.enabled', payload.options.frontend.enabled);
        }
    } else if (cmd === 'request/restart') {
        setTimeout(restart, 100);
    } else if (cmd === 'request/extension/list') {
         responseData = extensionManager.list();
    } else if (cmd === 'request/extension/save') {
        extensionManager.save(payload.name, payload.code);
        responseData = { name: payload.name };
    } else if (cmd === 'request/extension/remove') {
        extensionManager.remove(payload.name);
        responseData = { name: payload.name };
    }

    // Echo back success
    const responseTopic = `${base}/bridge/response/${cmd.replace('request/', '')}`;
    eventBus.emitMQTTMessagePublished(responseTopic, JSON.stringify({ 
        status: 'ok', 
        data: responseData, 
        transaction: payload.transaction 
    }));
}

// --- Pairing Procedure ---

function startPairingProcedure() {
    const newDevices = [
        { ieeeAddr: '0x101', friendly_name: 'New Color Bulb', model: 'MOCK_COLOR' },
        { ieeeAddr: '0x102', friendly_name: 'New White Bulb', model: 'MOCK_WHITE' },
        { ieeeAddr: '0x103', friendly_name: 'New Button', model: 'MOCK_BUTTON' },
        { ieeeAddr: '0x104', friendly_name: 'New Sensor', model: 'MOCK_SENSOR' },
    ];

    newDevices.forEach((d, i) => {
        setTimeout(() => {
            console.log(`Device joining: ${d.friendly_name}`);
            const entity = new MockEntity(d.ieeeAddr, { friendly_name: d.friendly_name });
            zigbee.devices.set(d.ieeeAddr, entity);
            state.set(entity, { linkquality: 100 });
            // In real Z2M, devices list is published
            const base = settings.get().mqtt.base_topic;
            eventBus.emitMQTTMessagePublished(`${base}/bridge/devices`, JSON.stringify([...zigbee.devicesIterator()].map(d => d.toJSON())));
        }, (i + 1) * 2000);
    });
}

// --- WebSocket Handling ---

function setupWebSocketClient(ws: any) {
    console.log('MockZ2M: WebSocket client connected');
    ws.on('message', (data: any) => {
        try {
            const { topic, payload } = JSON.parse(data.toString());
            mqtt.onMessage(`zigbee2mqtt/${topic}`, JSON.stringify(payload));
        } catch (e) {
            console.error('MockZ2M: Failed to parse WS message', e);
        }
    });

    // Provide a way for the mock to send messages back to the client
    const onMQTTPublish = (data: any) => {
        const base = settings.get().mqtt.base_topic;
        if (data.topic.startsWith(`${base}/`)) {
            const topic = data.topic.slice(base.length + 1);
            let payload;
            try { payload = JSON.parse(data.payload); } catch { payload = data.payload; }
            ws.send(JSON.stringify({ topic, payload }));
        }
    };
    eventBus.on('mqttMessagePublished', onMQTTPublish);
    ws.on('close', () => eventBus.off('mqttMessagePublished', onMQTTPublish));
    
    // Initial state (minimal)
    ws.send(JSON.stringify({ topic: 'bridge/devices', payload: [...zigbee.devicesIterator()].map(d => d.toJSON()) }));
    ws.send(JSON.stringify({ topic: 'bridge/groups', payload: [...zigbee.groupsIterator()].map(g => g.toJSON()) }));
    ws.send(JSON.stringify({ topic: 'bridge/extensions', payload: extensionManager.list() }));
    ws.send(JSON.stringify({ topic: 'bridge/lightlynx/users', payload: {} })); // Mock empty users
}

// --- Start ---

init();
startBaseServer();

// Keep process alive
setInterval(() => {}, 1000);
