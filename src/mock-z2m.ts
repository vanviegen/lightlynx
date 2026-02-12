
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Environment Setup ---
const dataPath = `.mock-z2m-data-${process.pid}`;
if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
process.env.ZIGBEE2MQTT_DATA = dataPath;

// Cleanup on exit (including Ctrl-C)
function cleanup() {
    try {
        if (fs.existsSync(dataPath)) {
            fs.rmSync(dataPath, { recursive: true, force: true });
            console.log(`Cleaned up ${dataPath}`);
        }
    } catch (err) {
        console.error(`Failed to cleanup ${dataPath}:`, err);
    }
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

// --- Types ---

interface MockDevice {
    ieeeAddr: string;
    friendlyName: string;
    model: string;
    description: string;
    vendor: string;
    exposes: any[];
    type: 'EndDevice' | 'Router' | 'Coordinator';
}

interface MockGroup {
    id: number;
    friendlyName: string;
    description: string;
    members: string[]; // ieee addresses
    scenes: { id: number; name: string }[];
}

// --- Mock Z2M Environment ---

class MockLogger {
    info(msg: string) { process.stderr.write(`[INFO] ${msg}\n`); }
    warn(msg: string) { process.stderr.write(`[WARN] ${msg}\n`); }
    warning(msg: string) { process.stderr.write(`[WARN] ${msg}\n`); }
    error(msg: string) { process.stderr.write(`[ERROR] ${msg}\n`); }
    debug(_msg: string) { /* console.log(`[DEBUG] ${msg}`); */ }
}

class MockEventBus extends EventEmitter {
    onMQTTMessagePublished(_key: any, cb: any) { this.on('mqttMessagePublished', cb); }
    onPublishEntityState(_key: any, cb: any) { this.on('publishEntityState', cb); }
    onMQTTMessage(_key: any, cb: any) { this.on('mqttMessage', cb); }
    onStateChange(_key: any, cb: any) { this.on('stateChange', cb); }
    onScenesChanged(_key: any, cb: any) { this.on('scenesChanged', cb); }
    onGroupMembersChanged(_key: any, cb: any) { this.on('groupMembersChanged', cb); }
    onEntityOptionsChanged(_key: any, cb: any) { this.on('entityOptionsChanged', cb); }
    onEntityRenamed(_key: any, cb: any) { this.on('entityRenamed', cb); }
    onDevicesChanged(_key: any, cb: any) { this.on('devicesChanged', cb); }
    
    emitMQTTMessage(topic: string, message: string) {
        this.emit('mqttMessage', { topic, message, _fromMock: true });
    }
    emitMQTTMessagePublished(topic: string, payload: string, options: any = {}) {
        if (typeof mqtt !== 'undefined') mqtt.retainedMessages[topic] = { topic, payload, options };
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
            // zh.members should be endpoint-like objects with deviceIeeeAddress, matching real Z2M
            this.zh.members = data.members.map((ieee: string) => ({ deviceIeeeAddress: ieee, ID: 1 }));
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
    get name(): string { return this.options.friendlyName; }
    isDevice(): this is MockEntity & { id: string } { return typeof this.id === 'string'; }
    isGroup(): this is MockEntity & { id: number } { return typeof this.id === 'number'; }
}

class MockZigbee {
    devices = new Map<string, MockEntity>();
    groups = new Map<number, MockEntity>();
    private permitJoinTimer?: NodeJS.Timeout;

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
        
        if (this.permitJoinTimer) {
            clearTimeout(this.permitJoinTimer);
            this.permitJoinTimer = undefined;
        }
        
        const base = settings.get().mqtt.base_topic;
        
        if (time > 0) {
            mqtt.publish(`${base}/bridge/info`, { permit_join: true }, { clientOptions: { retain: true } });
            
            startPairingProcedure();
            
            this.permitJoinTimer = setTimeout(() => {
                mqtt.publish(`${base}/bridge/info`, { permit_join: false }, { clientOptions: { retain: true } });
                console.log('Permit join auto-disabled after 30s');
            }, 30000);
        } else {
            mqtt.publish(`${base}/bridge/info`, { permit_join: false }, { clientOptions: { retain: true } });
        }
    }
}

class MockSettings {
    data = {
        mqtt: { base_topic: 'zigbee2mqtt' },
        frontend: { port: 8080, host: '0.0.0.0', enabled: true },
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
        
        // Filter state updates based on device capabilities
        const filteredUpdate = filterStateByCapabilities(entity, update);
        
        const next = { ...current, ...filteredUpdate };
        this.states.set(entity.id, next);

        this._eventBus.emitPublishEntityState(entity, next);
        this._eventBus.emitStateChange({ entity, from: current, to: next, update: filteredUpdate });

        if (JSON.stringify(current) !== JSON.stringify(next)) {
            const base = settings.get().mqtt.base_topic;
            mqtt.publish(`${base}/${entity.name}`, next, { clientOptions: { retain: true } });
        }
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

const WebSocket = require('ws');

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
            // In real Z2M, extensions are NOT necessarily stopped manually if they don't have a stop() or if the process exits,
            // but here we want to keep the process alive, so we must stop them.
            for (const name of Array.from(extensionManager.getRunningNames())) {
                await extensionManager.stop(name);
            }
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

    addSilently(name: string, code: string) {
        const existing = this.extensionsList.find(e => e.name === name);
        if (existing) {
            existing.code = code;
        } else {
            this.extensionsList.push({ name, code });
        }
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
        await mqtt.publish('zigbee2mqtt/bridge/extensions', this.list(), { clientOptions: { retain: true } });
    }

    async start(name: string, code: string) {
        console.log(`ExtensionManager: Starting ${name}`);
        const module: any = { exports: {} };
        const req = (modName: string) => {
            if (modName === 'ws') return WebSocket;
            return require(modName);
        };

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
            throw err;
        }
    }
}

const extensionManager = new ExtensionManager();

const devicesData: Record<string, MockDevice> = {
    // Living Room - mixed capabilities
    '0x001': { ieeeAddr: '0x001', friendlyName: 'Living Room Ceiling 1', model: 'MOCK_COLOR', description: 'Color light bulb', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 },
            { name: 'color_hs', type: 'composite', features: [{name:'hue', property:'hue'}, {name:'saturation', property:'saturation'}] }
        ]}
    ]},
    '0x002': { ieeeAddr: '0x002', friendlyName: 'Living Room Ceiling 2', model: 'MOCK_COLOR', description: 'Color light bulb', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 },
            { name: 'color_hs', type: 'composite', features: [{name:'hue', property:'hue'}, {name:'saturation', property:'saturation'}] }
        ]}
    ]},
    '0x003': { ieeeAddr: '0x003', friendlyName: 'Living Room Floor Lamp', model: 'MOCK_AMBIANCE', description: 'Ambiance light (white with temp)', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 },
            { name: 'color_temp', property: 'color_temp', type: 'numeric', value_min: 153, value_max: 500 }
        ]}
    ]},
    
    // Kitchen - ambiance lights
    '0x004': { ieeeAddr: '0x004', friendlyName: 'Kitchen Counter 1', model: 'MOCK_AMBIANCE', description: 'Ambiance light', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 },
            { name: 'color_temp', property: 'color_temp', type: 'numeric', value_min: 153, value_max: 500 }
        ]}
    ]},
    '0x005': { ieeeAddr: '0x005', friendlyName: 'Kitchen Counter 2', model: 'MOCK_AMBIANCE', description: 'Ambiance light', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 },
            { name: 'color_temp', property: 'color_temp', type: 'numeric', value_min: 153, value_max: 500 }
        ]}
    ]},
    '0x006': { ieeeAddr: '0x006', friendlyName: 'Kitchen Ceiling', model: 'MOCK_WHITE', description: 'White light bulb', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 }
        ]}
    ]},
    
    // Bedroom - color lights
    '0x007': { ieeeAddr: '0x007', friendlyName: 'Bedroom Ceiling', model: 'MOCK_COLOR', description: 'Color light bulb', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 },
            { name: 'color_hs', type: 'composite', features: [{name:'hue', property:'hue'}, {name:'saturation', property:'saturation'}] }
        ]}
    ]},
    '0x008': { ieeeAddr: '0x008', friendlyName: 'Bedroom Nightstand 1', model: 'MOCK_AMBIANCE', description: 'Ambiance light', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 },
            { name: 'color_temp', property: 'color_temp', type: 'numeric', value_min: 153, value_max: 500 }
        ]}
    ]},
    '0x009': { ieeeAddr: '0x009', friendlyName: 'Bedroom Nightstand 2', model: 'MOCK_AMBIANCE', description: 'Ambiance light', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 },
            { name: 'color_temp', property: 'color_temp', type: 'numeric', value_min: 153, value_max: 500 }
        ]}
    ]},
    
    // Office - white lights
    '0x00A': { ieeeAddr: '0x00A', friendlyName: 'Office Desk Lamp', model: 'MOCK_WHITE', description: 'White light bulb', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 }
        ]}
    ]},
    '0x00B': { ieeeAddr: '0x00B', friendlyName: 'Office Ceiling', model: 'MOCK_AMBIANCE', description: 'Ambiance light', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 },
            { name: 'color_temp', property: 'color_temp', type: 'numeric', value_min: 153, value_max: 500 }
        ]}
    ]},
    
    // Bathroom - ambiance light
    '0x00C': { ieeeAddr: '0x00C', friendlyName: 'Bathroom Ceiling', model: 'MOCK_AMBIANCE', description: 'Ambiance light', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 },
            { name: 'color_temp', property: 'color_temp', type: 'numeric', value_min: 153, value_max: 500 }
        ]}
    ]},
    
    // Buttons and sensors
    '0x050': { ieeeAddr: '0x050', friendlyName: 'Living Room Button', model: 'MOCK_BUTTON', description: 'Wireless button', vendor: 'Mock', type: 'EndDevice', exposes: [
        { type: 'enum', name: 'action', property: 'action', values: ['single', 'double', 'triple', 'hold'] },
        { type: 'numeric', name: 'battery', property: 'battery', unit: '%', value_min: 0, value_max: 100 }
    ]},
    '0x051': { ieeeAddr: '0x051', friendlyName: 'Kitchen Button', model: 'MOCK_BUTTON', description: 'Wireless button', vendor: 'Mock', type: 'EndDevice', exposes: [
        { type: 'enum', name: 'action', property: 'action', values: ['single', 'double', 'triple', 'hold'] },
        { type: 'numeric', name: 'battery', property: 'battery', unit: '%', value_min: 0, value_max: 100 }
    ]},
    '0x052': { ieeeAddr: '0x052', friendlyName: 'Hallway Motion Sensor', model: 'MOCK_SENSOR', description: 'Motion sensor', vendor: 'Mock', type: 'EndDevice', exposes: [
        { type: 'binary', name: 'occupancy', property: 'occupancy', value_on: true, value_off: false },
        { type: 'numeric', name: 'battery', property: 'battery', unit: '%', value_min: 0, value_max: 100 }
    ]},
    '0x053': { ieeeAddr: '0x053', friendlyName: 'Bathroom Motion Sensor', model: 'MOCK_SENSOR', description: 'Motion sensor', vendor: 'Mock', type: 'EndDevice', exposes: [
        { type: 'binary', name: 'occupancy', property: 'occupancy', value_on: true, value_off: false },
        { type: 'numeric', name: 'battery', property: 'battery', unit: '%', value_min: 0, value_max: 100 }
    ]}
};

const groupsData: Record<number, MockGroup> = {
    1: { id: 1, friendlyName: 'Living Room', description: 'Main living space', members: ['0x001', '0x002', '0x003'], scenes: [
        {id:1, name:'Bright'}, 
        {id:2, name:'Cozy'}, 
        {id:3, name:'Movie'},
        {id:4, name:'Normal'}
    ] },
    2: { id: 2, friendlyName: 'Kitchen', description: 'Kitchen and dining', members: ['0x004', '0x005', '0x006'], scenes: [
        {id:5, name:'Bright'}, 
        {id:6, name:'Dinner'},
        {id:7, name:'Night'}
    ] },
    3: { id: 3, friendlyName: 'Bedroom', description: 'Master bedroom', members: ['0x007', '0x008', '0x009'], scenes: [
        {id:8, name:'Normal'},
        {id:9, name:'Reading'},
        {id:10, name:'Night'},
        {id:11, name:'Cozy'}
    ] },
    4: { id: 4, friendlyName: 'Office', description: 'Home office', members: ['0x00A', '0x00B'], scenes: [
        {id:12, name:'Bright'},
        {id:13, name:'Normal'},
        {id:14, name:'Cozy'}
    ] },
    5: { id: 5, friendlyName: 'Bathroom', description: 'Bathroom', members: ['0x00C'], scenes: [
        {id:15, name:'Normal'},
        {id:16, name:'Night'}
    ] }
};

// Scene state storage: sceneStates[groupId][sceneId][deviceIeee] = { state, brightness, ... }
const sceneStates: Record<number, Record<number, Record<string, any>>> = {
    1: {
        1: { // Living Room - Bright
            '0x001': { state: 'ON', brightness: 255, color: { hue: 40, saturation: 20 } },
            '0x002': { state: 'ON', brightness: 255, color: { hue: 40, saturation: 20 } },
            '0x003': { state: 'ON', brightness: 255, color_temp: 250 }
        },
        2: { // Living Room - Cozy
            '0x001': { state: 'ON', brightness: 120, color: { hue: 30, saturation: 70 } },
            '0x002': { state: 'ON', brightness: 120, color: { hue: 30, saturation: 70 } },
            '0x003': { state: 'ON', brightness: 100, color_temp: 400 }
        },
        3: { // Living Room - Movie
            '0x001': { state: 'ON', brightness: 30, color: { hue: 240, saturation: 90 } },
            '0x002': { state: 'ON', brightness: 30, color: { hue: 240, saturation: 90 } },
            '0x003': { state: 'OFF' }
        },
        4: { // Living Room - Normal
            '0x001': { state: 'ON', brightness: 200, color: { hue: 40, saturation: 30 } },
            '0x002': { state: 'ON', brightness: 200, color: { hue: 40, saturation: 30 } },
            '0x003': { state: 'ON', brightness: 200, color_temp: 300 }
        }
    },
    2: {
        5: { // Kitchen - Bright
            '0x004': { state: 'ON', brightness: 255, color_temp: 250 },
            '0x005': { state: 'ON', brightness: 255, color_temp: 250 },
            '0x006': { state: 'ON', brightness: 255 }
        },
        6: { // Kitchen - Dinner
            '0x004': { state: 'ON', brightness: 180, color_temp: 350 },
            '0x005': { state: 'ON', brightness: 180, color_temp: 350 },
            '0x006': { state: 'ON', brightness: 150 }
        },
        7: { // Kitchen - Night
            '0x004': { state: 'ON', brightness: 40, color_temp: 450 },
            '0x005': { state: 'OFF' },
            '0x006': { state: 'OFF' }
        }
    },
    3: {
        8: { // Bedroom - Normal
            '0x007': { state: 'ON', brightness: 200, color: { hue: 40, saturation: 20 } },
            '0x008': { state: 'ON', brightness: 200, color_temp: 300 },
            '0x009': { state: 'ON', brightness: 200, color_temp: 300 }
        },
        9: { // Bedroom - Reading
            '0x007': { state: 'ON', brightness: 180, color: { hue: 40, saturation: 15 } },
            '0x008': { state: 'ON', brightness: 200, color_temp: 300 },
            '0x009': { state: 'ON', brightness: 200, color_temp: 300 }
        },
        10: { // Bedroom - Night
            '0x007': { state: 'OFF' },
            '0x008': { state: 'ON', brightness: 20, color_temp: 500 },
            '0x009': { state: 'ON', brightness: 20, color_temp: 500 }
        },
        11: { // Bedroom - Cozy
            '0x007': { state: 'ON', brightness: 120, color: { hue: 30, saturation: 70 } },
            '0x008': { state: 'ON', brightness: 100, color_temp: 400 },
            '0x009': { state: 'ON', brightness: 100, color_temp: 400 }
        }
    },
    4: {
        12: { // Office - Bright
            '0x00A': { state: 'ON', brightness: 255 },
            '0x00B': { state: 'ON', brightness: 255, color_temp: 250 }
        },
        13: { // Office - Normal
            '0x00A': { state: 'ON', brightness: 200 },
            '0x00B': { state: 'ON', brightness: 200, color_temp: 300 }
        },
        14: { // Office - Cozy
            '0x00A': { state: 'ON', brightness: 120 },
            '0x00B': { state: 'ON', brightness: 140, color_temp: 380 }
        }
    },
    5: {
        15: { // Bathroom - Normal
            '0x00C': { state: 'ON', brightness: 200, color_temp: 300 }
        },
        16: { // Bathroom - Night
            '0x00C': { state: 'ON', brightness: 30, color_temp: 500 }
        }
    }
};

// Helper to determine device capabilities from exposes
function getDeviceCapabilities(entity: MockEntity): { supportsColor: boolean, supportsColorTemp: boolean } {
    if (!entity.definition?.exposes) return { supportsColor: false, supportsColorTemp: false };
    
    let supportsColor = false;
    let supportsColorTemp = false;
    
    for (const expose of entity.definition.exposes) {
        if (expose.type === 'light' && expose.features) {
            for (const feature of expose.features) {
                if (feature.name === 'color_hs' || feature.name === 'color_xy') {
                    supportsColor = true;
                }
                if (feature.name === 'color_temp' || feature.property === 'color_temp') {
                    supportsColorTemp = true;
                }
            }
        }
    }
    
    return { supportsColor, supportsColorTemp };
}

// Helper to filter state updates based on device capabilities
function filterStateByCapabilities(entity: MockEntity, stateUpdate: any): any {
    if (!entity.isDevice()) return stateUpdate; // Groups can accept any state
    
    const caps = getDeviceCapabilities(entity);
    const filtered = { ...stateUpdate };
    
    // Color lights: ignore color_temp
    if (!caps.supportsColorTemp && 'color_temp' in filtered) {
        process.stderr.write(`MockZ2M:        Ignoring color_temp for ${entity.name}\n`);
        delete filtered.color_temp;
    }
    
    // White lights (no color, no temp): ignore color and color_temp
    if (!caps.supportsColor && 'color' in filtered) {
        process.stderr.write(`MockZ2M:        Ignoring color for ${entity.name}\n`);
        delete filtered.color;
    }
    
    return filtered;
}

// Initialize
async function init() {
    // Create initial lightlynx.json config with automation enabled and sample triggers
    const lightlynxConfigPath = path.join(dataPath, 'lightlynx.json');
    const initialConfig: any = {
        allowRemote: false,
        automationEnabled: true,
        latitude: 52.24, // Enschede NL
        longitude: 6.88,
        users: {
            admin: {
                secret: '',
                isAdmin: true,
                defaultGroupAccess: false,
                groupAccess: {},
                allowRemote: false
            }
        },
        sceneStates: {},
        groupTimeouts: {
            1: 1800, // Living Room: 30 minutes
            2: 3600, // Kitchen: 1 hour
            5: 300   // Bathroom: 5 minutes
        },
        sceneTriggers: {
            1: { // Living Room
                1: [{ event: '1' }], // Bright - single press button
                2: [{ event: '2' }], // Cozy - double press button
                3: [{ event: '3' }], // Movie - triple press button
                4: [{ event: 'sensor' }] // Normal - hallway sensor
            },
            2: { // Kitchen
                5: [{ event: '1' }], // Bright - single press
                6: [{ event: '2' }], // Dinner - double press
                7: [{ event: '3' }]  // Night - triple press
            },
            3: { // Bedroom
                9: [{ event: 'time', startTime: '20:00', endTime: '22:30' }] // Reading 8pm-10:30pm
            },
            4: { // Office
                12: [{ event: 'time', startTime: '9:00', endTime: '17:00' }] // Bright during work hours
            },
            5: { // Bathroom
                15: [{ event: 'sensor' }], // Normal - sensor during day
                16: [{ event: 'sensor', startTime: '23:00', endTime: '7:00' }] // Night - sensor 11pm-7am
            }
        },
        toggleGroupLinks: {
            '0x050': [1], // Living Room Button -> Living Room group
            '0x051': [2], // Kitchen Button -> Kitchen group
            '0x052': [1], // Hallway Motion Sensor -> Living Room
            '0x053': [5]  // Bathroom Motion Sensor -> Bathroom
        }
    };

    if (!process.env.LIGHTLYNX_DEMO) {
        initialConfig.systemMessage = "**Hi there!**\nYou are connected to an *actual* Light Lynx extension running within a *mock* Zigbee2MQTT server. All state will be reset after 5 idle minutes.\nTap the wrench icon in the top bar to enter management mode.\n*Enjoy!*";
    }

    fs.writeFileSync(lightlynxConfigPath, JSON.stringify(initialConfig, null, 2));

    for (const [ieee, d] of Object.entries(devicesData)) {
        const entity = new MockEntity(ieee, { friendlyName: d.friendlyName }, d);
        zigbee.devices.set(ieee, entity);
        
        // Initialize state
        const initialState: any = { state: 'OFF', brightness: 255 };
        
        // Add battery for EndDevice types (buttons and sensors)
        if (d.type === 'EndDevice') {
            // Devices with 'low' in the name get 4% battery for testing
            const batteryLevel = d.friendlyName.toLowerCase().includes('low') ? 4 : 
                                 ieee === '0x050' ? 87 :
                                 ieee === '0x051' ? 65 :
                                 ieee === '0x052' ? 42 :
                                 ieee === '0x053' ? 91 : 75;
            initialState.battery = batteryLevel;
        }
        
        state.set(entity, initialState);
    }
    for (const [id, g] of Object.entries(groupsData)) {
        const idNum = Number(id);
        const entity = new MockEntity(idNum, { friendlyName: g.friendlyName }, g);
        zigbee.groups.set(idNum, entity);
        state.set(entity, { state: 'OFF' });
    }

    const base = 'zigbee2mqtt';
    await mqtt.publish(`${base}/bridge/devices`, [...zigbee.devicesIterator()].map(d => d.toJSON()), { clientOptions: { retain: true } });
    await mqtt.publish(`${base}/bridge/groups`, [...zigbee.groupsIterator()].map(g => g.toJSON()), { clientOptions: { retain: true } });
    await mqtt.publish(`${base}/bridge/extensions`, [], { clientOptions: { retain: true } });

    // Load extensions from command line arguments, or default to lightlynx extension
    const extensionsToLoad = process.argv.slice(2).length > 0 
        ? process.argv.slice(2) 
        : [path.join(__dirname, '..', 'build.frontend', 'extension.js')];
    
    for (const extensionPath of extensionsToLoad) {
        if (!fs.existsSync(extensionPath)) {
            console.error(`Extension not found: ${extensionPath}`);
            continue;
        }
        const code = fs.readFileSync(extensionPath, 'utf8');
        const extensionName = path.basename(extensionPath);
        
        // Add with the proper name
        extensionManager.addSilently(extensionName, code);
        console.log(`Loaded extension: ${extensionName}`);
    }
    
    await extensionManager.startAll();
}

// --- MQTT Mock ---

class MockMQTT {
    public retainedMessages: Record<string, { topic: string, payload: string, options: any }> = {};

    async publish(topic: string, message: string | object, options?: any) {
        const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
        console.log(`MockZ2M ->MQTT: ${topic} -> ${messageStr.substr(0,200)}`);
        if (options?.clientOptions?.retain) {
            this.retainedMessages[topic] = { topic, payload: messageStr, options };
        }
        eventBus.emitMQTTMessagePublished(topic, messageStr, options);
        return Promise.resolve();
    }

    onMessage(topic: string, message: any) {
        const messageStr = message.toString();
        process.stderr.write(`MockZ2M <-MQTT: ${topic} -> ${messageStr.substr(0,100)}\n`);
        eventBus.emitMQTTMessage(topic, messageStr);
        
        // Internal handling
        const parts = topic.split('/');
        const base = settings.get().mqtt.base_topic;
        if (parts[0] === base) {
            const entityName = parts[1];
            if (entityName && parts[2] === 'set') {
                const payload = JSON.parse(messageStr);
                // Try to find entity by friendly name, IEEE address, or group ID
                const entity = zigbee.deviceByFriendlyName(entityName) 
                    || zigbee.deviceByIeeeAddr(entityName) 
                    || zigbee.groupByName(entityName)
                    || (!isNaN(Number(entityName)) ? zigbee.groupByID(Number(entityName)) : undefined);
                if (entity) {
                    if (payload.scene_store !== undefined && entity.isGroup()) {
                        const sceneId = typeof payload.scene_store === 'object' ? payload.scene_store.ID : payload.scene_store;
                        const sceneName = typeof payload.scene_store === 'object' ? payload.scene_store.name : `Scene ${sceneId}`;
                        
                        entity.zh.scenes = entity.zh.scenes || [];
                        const existing = entity.zh.scenes.find((s: any) => s.id === sceneId);
                        if (existing) {
                            existing.name = sceneName;
                        } else {
                            entity.zh.scenes.push({ id: sceneId, name: sceneName });
                        }
                        
                        // Store current light states for all group members
                        const groupId = entity.id as number;
                        if (!sceneStates[groupId]) sceneStates[groupId] = {};
                        sceneStates[groupId][sceneId] = {};
                        for (const member of entity.members) {
                            const memberState = state.get(member);
                            sceneStates[groupId][sceneId][member.ieeeAddr] = { ...memberState };
                            process.stderr.write(`MockZ2M Zigbee: Scene ${sceneId} stored state for ${member.name}: ${JSON.stringify(memberState)}\n`);
                        }
                        
                        process.stderr.write(`MockZ2M Zigbee: Scene stored: ${sceneId} (${sceneName})\n`);
                        mqtt.publish(`${base}/bridge/groups`, [...zigbee.groupsIterator()].map(g => g.toJSON()), { clientOptions: { retain: true } });
                    }
                    if (payload.scene_rename !== undefined) {
                        const { ID, name } = payload.scene_rename;
                        entity.zh.scenes = entity.zh.scenes || [];
                        const scene = entity.zh.scenes.find((s: any) => s.id === ID);
                        if (scene) scene.name = name;
                        else entity.zh.scenes.push({ id: ID, name });
                        process.stderr.write(`MockZ2M Zigbee: Scene renamed from ${ID} to ${name}\n`);
                        mqtt.publish(`${base}/bridge/groups`, [...zigbee.groupsIterator()].map(g => g.toJSON()), { clientOptions: { retain: true } });
                    }
                    if (payload.scene_recall !== undefined && entity.isGroup()) {
                        const sceneId = payload.scene_recall;
                        const groupId = entity.id as number;
                        process.stderr.write(`MockZ2M Zigbee: Scene recall ${sceneId} for GROUP ${entity.name} (${groupId})\n`);
                        
                        // Apply stored scene states to all group members
                        const groupScenes = sceneStates[groupId];
                        const sceneData = groupScenes?.[sceneId];
                        
                        for (const member of entity.members) {
                            const storedState = sceneData?.[member.ieeeAddr];
                            if (storedState) {
                                process.stderr.write(`MockZ2M Zigbee: - Member ${member.name} (${member.ieeeAddr}): ${JSON.stringify(storedState)}\n`);
                                state.set(member, storedState);
                                // mqtt.publish(`${base}/${member.name}`, state.get(member), { clientOptions: { retain: true } });
                            }
                            // Do nothing if no stored state for this device.
                        }
                    }
                    if (payload.scene_add !== undefined) {
                        // scene_add is sent to individual devices to add them to a group's scene
                        const { ID, group_id, state: sceneState } = payload.scene_add;
                        process.stderr.write(`MockZ2M Zigbee: Scene add for device ${entityName}: scene ${ID} in group ${group_id}, state: ${sceneState}\n`);
                        // In real Z2M, this stores the device's scene state in the device itself
                        // For mock, we just acknowledge it
                    }
                    if (payload.scene_remove !== undefined) {
                        const sceneId = payload.scene_remove;
                        entity.zh.scenes = entity.zh.scenes || [];
                        entity.zh.scenes = entity.zh.scenes.filter((s: any) => s.id !== sceneId);
                        process.stderr.write(`MockZ2M Zigbee: Scene removed: ${sceneId}\n`);
                        mqtt.publish(`${base}/bridge/groups`, [...zigbee.groupsIterator()].map(g => g.toJSON()), { clientOptions: { retain: true } });
                    }
                    // Don't set scene_* payloads as state
                    const statePayload = { ...payload };
                    delete statePayload.scene_store;
                    delete statePayload.scene_rename;
                    delete statePayload.scene_recall;
                    delete statePayload.scene_add;
                    delete statePayload.scene_remove;
                    if (Object.keys(statePayload).length > 0) {
                        // Log zigbee command
                        if (entity.isGroup()) {
                            process.stderr.write(`MockZ2M Zigbee: Sending to GROUP ${entity.name} (${entity.id}): ${JSON.stringify(statePayload)}\n`);
                        } else {
                            process.stderr.write(`MockZ2M Zigbee: Sending to DEVICE ${entity.name} (${entity.ieeeAddr}): ${JSON.stringify(statePayload)}\n`);
                        }
                        
                        // If this is a group, propagate state to all members
                        if (entity.isGroup()) {
                            for (const member of entity.members) {
                                process.stderr.write(`MockZ2M Zigbee: - Member ${member.name} (${member.ieeeAddr}): ${JSON.stringify(statePayload)}\n`);
                                state.set(member, statePayload);
                                // mqtt.publish(`${base}/${member.name}`, state.get(member), { clientOptions: { retain: true } });
                            }
                        }
                        state.set(entity, statePayload);
                    }
                    // Echo back state
                    mqtt.publish(`${base}/${entity.name}`, state.get(entity), { clientOptions: { retain: true } });
                } else {
                    process.stderr.write(`MockZ2M:        Entity not found: ${entityName}\n`);
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
        zigbee.permitJoin(payload.time || 0);
    } else if (cmd === 'request/device/remove') {
        const device = zigbee.deviceByIeeeAddr(payload.id) || zigbee.deviceByFriendlyName(payload.id);
        if (device) {
            zigbee.devices.delete(device.ieeeAddr);
            state.states.delete(device.id);
            mqtt.publish(`${base}/bridge/devices`, [...zigbee.devicesIterator()].map(d => d.toJSON()), { clientOptions: { retain: true } });
        }
    } else if (cmd === 'request/device/rename') {
        const device = typeof payload.from === 'string' ? zigbee.deviceByFriendlyName(payload.from) : undefined;
        if (device) {
            device.options.friendlyName = payload.to;
            mqtt.publish(`${base}/bridge/devices`, [...zigbee.devicesIterator()].map(d => d.toJSON()), { clientOptions: { retain: true } });
            
            // Update battery level if device is an EndDevice and name contains 'low'
            if (device.zh.type === 'EndDevice') {
                const currentState = state.get(device);
                const newBattery = payload.to.toLowerCase().includes('low') ? 4 : currentState.battery;
                if (newBattery !== currentState.battery) {
                    state.set(device, { ...currentState, battery: newBattery });
                    mqtt.publish(`${base}/${device.name}`, state.get(device), { clientOptions: { retain: true } });
                }
            }
        }
    } else if (cmd === 'request/group/add') {
        const id = Math.max(0, ...zigbee.groups.keys()) + 1;
        const entity = new MockEntity(id, { friendlyName: payload.friendly_name }, { description: '' });
        zigbee.groups.set(id, entity);
        state.set(entity, { state: 'OFF' });
        mqtt.publish(`${base}/bridge/groups`, [...zigbee.groupsIterator()].map(g => g.toJSON()), { clientOptions: { retain: true } });
        responseData = { id, friendly_name: payload.friendly_name };
    } else if (cmd === 'request/group/members/add') {
        const group = typeof payload.group === 'number' ? zigbee.groupByID(payload.group) : zigbee.groupByName(payload.group);
        if (group && typeof payload.device === 'string') {
            const device = zigbee.deviceByFriendlyName(payload.device) || zigbee.deviceByIeeeAddr(payload.device);
            const ieee = device ? device.ieeeAddr : payload.device;
            if (!group.zh.members) group.zh.members = [];
            // Check if device already in group (compare deviceIeeeAddress)
            const alreadyMember = group.zh.members.some((m: any) => m.deviceIeeeAddress === ieee);
            if (!alreadyMember) {
                // Add as endpoint-like object with deviceIeeeAddress to match real Z2M
                group.zh.members.push({ deviceIeeeAddress: ieee, ID: 1 });
                 // Actual MockEntity storage
                if (!(group as any)._members) (group as any)._members = [];
                (group as any)._members.push(ieee);
                
                mqtt.publish(`${base}/bridge/groups`, [...zigbee.groupsIterator()].map(g => g.toJSON()), { clientOptions: { retain: true } });
                eventBus.emit('groupMembersChanged', { group, device: { ieeeAddr: ieee }, action: 'add' });
            }
        }
    } else if (cmd === 'request/group/remove') {
        zigbee.groups.delete(payload.id);
        mqtt.publish(`${base}/bridge/groups`, [...zigbee.groupsIterator()].map(g => g.toJSON()), { clientOptions: { retain: true } });
    } else if (cmd === 'request/group/options') {
        // Persist group options (e.g., description) and notify clients
        const group = typeof payload.id === 'number' ? zigbee.groupByID(payload.id) : zigbee.groupByName(payload.id);
        if (group && payload.options && payload.options.description !== undefined) {
            group.options = group.options || {};
            group.options.description = payload.options.description;

            // Publish updated groups list and also emit 'info' so clients update description cache
            mqtt.publish(`${base}/bridge/groups`, [...zigbee.groupsIterator()].map(g => g.toJSON()), { clientOptions: { retain: true } });

            const infoPayload = {
                config: { groups: { [String(group.id)]: { description: group.options.description } } }
            };
            mqtt.publish(`${base}/bridge/info`, infoPayload, { clientOptions: { retain: true } });
        }
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
    mqtt.publish(responseTopic, { status: 'ok', data: responseData, transaction: payload.transaction });
}

// --- Pairing Procedure ---

function startPairingProcedure() {
    const lightTypes = ['COLOR', 'WHITE', 'AMBIANCE'];
    const lightType = lightTypes[Math.floor(Math.random() * lightTypes.length)]!;
    
    let ieeeAddr = '0x100';
    while (zigbee.devices.has(ieeeAddr)) {
        ieeeAddr = '0x' + Math.floor(Math.random() * 0xFFFF).toString(16).padStart(3, '0');
    }

    const exposes: any[] = [{ type: 'light', features: [
        { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
        { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 }
    ]}];

    if (lightType === 'COLOR') {
        exposes[0].features.push({ name: 'color_hs', type: 'composite', features: [{name:'hue', property:'hue'}, {name:'saturation', property:'saturation'}] });
    } else if (lightType === 'AMBIANCE') {
        exposes[0].features.push({ name: 'color_temp', property: 'color_temp', type: 'numeric', value_min: 153, value_max: 500 });
    }

    const deviceToAdd = {
        ieeeAddr,
        friendlyName: `New ${lightType.charAt(0) + lightType.slice(1).toLowerCase()} Bulb`,
        model: `MOCK_${lightType}`,
        description: `${lightType.charAt(0) + lightType.slice(1).toLowerCase()} light bulb`,
        vendor: 'Mock',
        type: 'Router' as const,
        exposes
    };

    setTimeout(() => {
        console.log(`Device joining: ${deviceToAdd.friendlyName}`);
        const entity = new MockEntity(deviceToAdd.ieeeAddr, { friendlyName: deviceToAdd.friendlyName }, deviceToAdd);
        zigbee.devices.set(deviceToAdd.ieeeAddr, entity);
        state.set(entity, { state: 'OFF', brightness: 255 });
        
        const base = settings.get().mqtt.base_topic;
        mqtt.publish(`${base}/bridge/devices`, [...zigbee.devicesIterator()].map(d => d.toJSON()), { clientOptions: { retain: true } });
        mqtt.publish(`${base}/${entity.name}`, state.get(entity), { clientOptions: { retain: true } });
    }, 5000);
}

// --- Start ---

eventBus.on('mqttMessage', (data: { topic: string, message: string, _fromMock?: boolean }) => {
    if (data._fromMock) return;
    mqtt.onMessage(data.topic, data.message);
});

init().catch(err => {
    console.error('Failed to initialize Mock Z2M:', err);
    process.exit(1);
});

// Keep process alive
setInterval(() => {}, 1000);
