
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Environment Setup ---
const dataPath = `/tmp/mock-z2m-${process.pid}`;
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
        this.emit('mqttMessage', { topic, message });
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
    '0x001': { ieeeAddr: '0x001', friendlyName: 'Color Light', model: 'MOCK_COLOR', description: 'Color light bulb', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 },
            { name: 'color_hs', type: 'composite', features: [{name:'hue', property:'hue'}, {name:'saturation', property:'saturation'}] }
        ]}
    ]},
    '0x002': { ieeeAddr: '0x002', friendlyName: 'White Light', model: 'MOCK_WHITE', description: 'White light bulb', vendor: 'Mock', type: 'Router', exposes: [
        { type: 'light', features: [
            { name: 'state', property: 'state', type: 'binary', value_on: 'ON', value_off: 'OFF' },
            { name: 'brightness', property: 'brightness', type: 'numeric', value_min: 0, value_max: 255 }
        ]}
    ]}
};

const groupsData: Record<number, MockGroup> = {
    1: { id: 1, friendlyName: 'Living Room', description: 'Main group', members: ['0x001', '0x002'], scenes: [{id:1, name:'Bright'}, {id:2, name:'Dim'}] },
    2: { id: 2, friendlyName: 'Kitchen', description: 'Secondary group', members: ['0x002'], scenes: [{id:3, name:'Cooking'}, {id:4, name:'Night'}] }
};

// Scene state storage: sceneStates[groupId][sceneId][deviceIeee] = { state, brightness, ... }
const sceneStates: Record<number, Record<number, Record<string, any>>> = {
    1: {
        1: { // Bright scene
            '0x001': { state: 'ON', brightness: 255, color: { hue: 30, saturation: 80 } },
            '0x002': { state: 'ON', brightness: 255 }
        },
        2: { // Dim scene
            '0x001': { state: 'ON', brightness: 50, color: { hue: 30, saturation: 50 } },
            '0x002': { state: 'ON', brightness: 50 }
        }
    },
    2: {
        3: { // Cooking scene
            '0x002': { state: 'ON', brightness: 255 }
        },
        4: { // Night scene
            '0x002': { state: 'ON', brightness: 30 }
        }
    }
};

// Initialize
async function init() {
    for (const [ieee, d] of Object.entries(devicesData)) {
        const entity = new MockEntity(ieee, { friendlyName: d.friendlyName }, d);
        zigbee.devices.set(ieee, entity);
        state.set(entity, { state: 'OFF', brightness: 255 });
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
        console.log(`MockZ2M: MQTT OUT: ${topic} -> ${messageStr.substr(0,200)}`);
        if (options?.clientOptions?.retain) {
            this.retainedMessages[topic] = { topic, payload: messageStr, options };
        }
        eventBus.emitMQTTMessagePublished(topic, messageStr, options);
        return Promise.resolve();
    }

    onMessage(topic: string, message: any) {
        const messageStr = message.toString();
        process.stderr.write(`MockZ2M: MQTT IN: ${topic} -> ${messageStr.substr(0,100)}\n`);
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
                            process.stderr.write(`MockZ2M: Scene ${sceneId} stored state for ${member.name}: ${JSON.stringify(memberState)}\n`);
                        }
                        
                        process.stderr.write(`MockZ2M: Scene stored: ${sceneId} (${sceneName})\n`);
                        mqtt.publish(`${base}/bridge/groups`, [...zigbee.groupsIterator()].map(g => g.toJSON()), { clientOptions: { retain: true } });
                    }
                    if (payload.scene_rename !== undefined) {
                        const { ID, name } = payload.scene_rename;
                        entity.zh.scenes = entity.zh.scenes || [];
                        const scene = entity.zh.scenes.find((s: any) => s.id === ID);
                        if (scene) scene.name = name;
                        else entity.zh.scenes.push({ id: ID, name });
                        process.stderr.write(`MockZ2M: Scene renamed: ${ID} -> ${name}\n`);
                        mqtt.publish(`${base}/bridge/groups`, [...zigbee.groupsIterator()].map(g => g.toJSON()), { clientOptions: { retain: true } });
                    }
                    if (payload.scene_recall !== undefined && entity.isGroup()) {
                        const sceneId = payload.scene_recall;
                        const groupId = entity.id as number;
                        process.stderr.write(`MockZ2M: Scene recalled: ${sceneId} for group ${groupId}\n`);
                        
                        // Apply stored scene states to all group members
                        const groupScenes = sceneStates[groupId];
                        const sceneData = groupScenes?.[sceneId];
                        
                        for (const member of entity.members) {
                            const storedState = sceneData?.[member.ieeeAddr];
                            if (storedState) {
                                state.set(member, storedState);
                                process.stderr.write(`MockZ2M: Applied scene state to ${member.name}: ${JSON.stringify(storedState)}\n`);
                            } else {
                                // Fallback: turn on with default brightness if no stored state
                                state.set(member, { state: 'ON', brightness: 200 });
                                process.stderr.write(`MockZ2M: No stored state for ${member.name}, using default\n`);
                            }
                            mqtt.publish(`${base}/${member.name}`, state.get(member));
                        }
                    }
                    if (payload.scene_add !== undefined) {
                        // scene_add is sent to individual devices to add them to a group's scene
                        const { ID, group_id, name, state: sceneState } = payload.scene_add;
                        process.stderr.write(`MockZ2M: Scene add for device ${entityName}: scene ${ID} in group ${group_id}, state: ${sceneState}\n`);
                        // In real Z2M, this stores the device's scene state in the device itself
                        // For mock, we just acknowledge it
                    }
                    if (payload.scene_remove !== undefined) {
                        const sceneId = payload.scene_remove;
                        entity.zh.scenes = entity.zh.scenes || [];
                        entity.zh.scenes = entity.zh.scenes.filter((s: any) => s.id !== sceneId);
                        process.stderr.write(`MockZ2M: Scene removed: ${sceneId}\n`);
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
                        state.set(entity, statePayload);
                        
                        // If this is a group, propagate state to all members
                        if (entity.isGroup()) {
                            for (const member of entity.members) {
                                const memberState = state.get(member);
                                state.set(member, { ...memberState, ...statePayload });
                                mqtt.publish(`${base}/${member.name}`, state.get(member));
                            }
                        }
                    }
                    // Echo back state
                    mqtt.publish(`${base}/${entityName}`, state.get(entity));
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
            device.options.friendlyName = payload.to;
            mqtt.publish(`${base}/bridge/devices`, [...zigbee.devicesIterator()].map(d => d.toJSON()), { clientOptions: { retain: true } });
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
    const newDevices = [
        { ieeeAddr: '0x101', friendlyName: 'New Color Bulb', model: 'MOCK_COLOR' },
        { ieeeAddr: '0x102', friendlyName: 'New White Bulb', model: 'MOCK_WHITE' },
        { ieeeAddr: '0x103', friendlyName: 'New Button', model: 'MOCK_BUTTON' },
        { ieeeAddr: '0x104', friendlyName: 'New Sensor', model: 'MOCK_SENSOR' },
    ];

    newDevices.forEach((d, i) => {
        setTimeout(() => {
            console.log(`Device joining: ${d.friendlyName}`);
            const entity = new MockEntity(d.ieeeAddr, { friendlyName: d.friendlyName });
            zigbee.devices.set(d.ieeeAddr, entity);
            state.set(entity, { linkquality: 100 });
            // In real Z2M, devices list is published
            const base = settings.get().mqtt.base_topic;
            eventBus.emitMQTTMessagePublished(`${base}/bridge/devices`, JSON.stringify([...zigbee.devicesIterator()].map(d => d.toJSON())));
        }, (i + 1) * 2000);
    });
}

// --- Start ---

init().catch(err => {
    console.error('Failed to initialize Mock Z2M:', err);
    process.exit(1);
});

// Keep process alive
setInterval(() => {}, 1000);
