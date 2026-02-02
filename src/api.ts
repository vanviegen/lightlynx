import { $, proxy, clone, copy, unproxy, peek } from "aberdeen";
import * as route from "aberdeen/route";
import * as colors from "./colors";
import { LightState, XYColor, HSColor, ColorValue, isHS, isXY, Store, LightCaps, Device, Group } from "./types";

const CREDENTIALS_LOCAL_STORAGE_ITEM_NAME = "lightlynx-servers";

// Inlined by Vite from build.frontend/extensions/versions.json
declare const __EXTENSION_HASH__: string;
let EXTENSION_HASH: string = typeof __EXTENSION_HASH__ !== 'undefined' ? __EXTENSION_HASH__ : '';

// In dev mode, fetch hash dynamically
if (import.meta.env.DEV) {
    fetch('/extension.hash')
        .then(r => r.text())
        .then(hash => {
            EXTENSION_HASH = hash || '';
            console.log('Extension hash loaded:', EXTENSION_HASH);
        })
        .catch(err => console.error('Failed to load extension hash:', err));
}

interface PromiseCallbacks {
    resolve: () => void;
    reject: (err: Error) => void;
}

interface LightStateDelta {
    state?: 'ON' | 'OFF';
    brightness?: number;
    color?: { hue: number; saturation: number } | XYColor;
    color_temp?: number;
    transition?: number;
}

function objectIsEmpty(obj: object): boolean {
    for(let _ in obj) return false;
    return true;
}

function colorsEqual(a?: ColorValue, b?: ColorValue): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (isHS(a) && isHS(b)) {
        return a.hue === b.hue && a.saturation === b.saturation;
    }
    if (isXY(a) && isXY(b)) {
        return a.x === b.x && a.y === b.y;
    }
    return false;
}

function ipToHexDomain(ip: string): string {
    const parts = ip.split('.');
    if (parts.length !== 4) return ip;
    if (parts.some(p => isNaN(parseInt(p)))) return ip;
    const hex = parts.map(p => parseInt(p).toString(16).padStart(2, '0')).join('');
    return `x${hex}.lightlynx.eu`;
}

function createLightStateDelta(o: LightState, n: LightState): LightStateDelta {
    let delta: LightStateDelta = {};
    if (n.on != null && o.on !== n.on) {
        delta.state = n.on ? 'ON' : 'OFF';
    }
    if (n.brightness != null && o.brightness !== n.brightness) {
        delta.brightness = n.brightness;
    }
    if (n.color != null && !colorsEqual(n.color, o.color)) {
        if (isHS(n.color)) {
            delta.color = { hue: Math.round(n.color.hue), saturation: Math.round(n.color.saturation * 100) };
        } else if (isXY(n.color)) {
            delta.color = n.color;
        } else {
            delta.color_temp = n.color as number;
        }
    }
    return delta;
}

function tailorLightState(from: LightState, cap: any): LightState {
    let to: LightState = {};

    if (from.on != null) {
        to.on = from.on;
    }

    if (isHS(from.color)) {
        if (cap.colorHs) {
            to.color = from.color;
        }
        else if (cap.colorXy) {
            to.color = colors.hsToXy(from.color as HSColor);
        }
    }
    else if (typeof from.color === 'number') {
        if (cap.colorTemp) {
            to.color = from.color;
        }
        else if (cap.colorHs) {
            const hsColor = colors.miredsToHs(from.color);
            to.color = hsColor;
        }
        else if (cap.colorXy) {
            const hsColor = colors.miredsToHs(from.color);
            to.color = colors.hsToXy(hsColor);
        }
    }
    else if (isXY(from.color)) {
        to.color = from.color;
    }
    if (typeof to.color === 'number') {
        to.color = Math.min(cap.colorTemp.valueMax, Math.max(cap.colorTemp.valueMin, to.color));
    }

    if (from.brightness != null) {
        if (cap.brightness) {
            to.brightness = Math.min(cap.brightness.valueMax, Math.max(cap.brightness.valueMin, 1, from.brightness));
        }
    }
    console.log('api/tailorLightState', 'from', from, 'to', to, 'cap', cap)

    return to;
}

function setLocalStorage(key: string, value: any) {
    localStorage.setItem(key, JSON.stringify(value));
}

function getLocalStorage(key: string): any {
    const json = localStorage.getItem(key);
    return json ? json && JSON.parse(json) : undefined;
}

class Api {
    private socket?: WebSocket;
    private tryingSockets: WebSocket[] = [];
    private requests: Map<string, PromiseCallbacks> = new Map();
    private transactionNumber = 1;
    private transactionRndPrefix: string;
    private nameToIeeeMap: Map<string, string> = new Map();
    private currentConnectionKey: string | null = null;
    private reconnectTimeout?: ReturnType<typeof setTimeout>;
    private connectTimeout?: ReturnType<typeof setTimeout>;
    private reconnectAttempts = 0;

    store: Store = proxy({
        devices: {},
        groups: {},
        permitJoin: false,
        servers: getLocalStorage(CREDENTIALS_LOCAL_STORAGE_ITEM_NAME) || [],
        connected: false,
        connectionState: 'idle',
        users: {},
        activeScenes: {},
        automationEnabled: false,
        remoteAccessEnabled: false,
        isAdmin: true, // Default to true until user data is loaded
        allowedGroupIds: {},
    });
    groupDescriptionsCache: Record<string, string | undefined> = {};
    notifyHandlers: Array<(type: 'error' | 'info' | 'warning', msg: string) => void> = [];
    
    notify = (type: 'error' | 'info' | 'warning', msg: string): void => {
        for (const handler of this.notifyHandlers) {
            handler(type, msg);
        }
    };
    
    constructor() {
        this.transactionRndPrefix = (Math.random() + 1).toString(36).substring(2,7);

        // Load cached data from localStorage
        for (const topic of ['bridge/devices', 'bridge/groups']) {
            const data = localStorage.getItem(topic);
            if (data) this.onMessage({ data } as MessageEvent);
        }

        // Auto-connect from URL parameters
        // As we're not in any scope, this peek shouldn't do anything, but just for clarity:
        peek(() => {
            const initialHost = route.current.search.host;
            const initialUsername = route.current.search.username;
            if (!initialHost || !initialUsername) return;
            const initialSecret = route.current.search.secret;

            console.log('Auto-connecting from URL parameters:', initialHost, initialUsername);
            let server = this.store.servers.find(s => s.localAddress === initialHost && s.username === initialUsername);
            if (server) {
                if (initialSecret) server.secret = initialSecret;
                const index = this.store.servers.indexOf(server);
                if (index > 0) {
                    this.store.servers.splice(index, 1);
                    this.store.servers.unshift(server);
                }
            } else {
                this.store.servers.unshift({localAddress: initialHost, username: initialUsername, secret: initialSecret || '', status: 'try'});
            }
            // Remove from the route
            delete route.current.search.host;
            delete route.current.search.username;
            delete route.current.search.secret;
        });
        
        // Persist servers list to localStorage on changes
        $(() => {
            setLocalStorage(CREDENTIALS_LOCAL_STORAGE_ITEM_NAME, this.store.servers);
        });
        
        // Reactively update isAdmin and allowedGroupIds based on current user
        $(() => {
            const username = this.store.servers[0]?.username;
            const user = username ? this.store.users[username] : undefined;
            this.store.isAdmin = !user || user.isAdmin;
            const newAllowed: Record<number, true> = {};
            if (user && !user.isAdmin) {
                for (const gid of user.allowedGroups) {
                    newAllowed[gid] = true;
                }
            }
            copy(this.store.allowedGroupIds, newAllowed);
        });
        
        // Reactive connection management
        $(() => {
            const server = this.store.servers[0];
            
            // Compute the wanted connection key (null = no connection wanted)
            // Reading localAddress/username/secret subscribes to credential changes
            // Reading status subscribes to disabled state - but try→enabled change 
            // still computes the same key, so no reconnect happens
            const wantedKey = server && server.status !== 'disabled'
                ? `${server.localAddress}|${server.username}|${server.secret}`
                : null;
            

            
            // Only act if the target changed
            if (wantedKey === this.currentConnectionKey) return;
            
            // Switching connections - flush cache if we had a previous one
            if (this.currentConnectionKey) {
                this.flushCache();
            }
            this.currentConnectionKey = wantedKey;
            this.disconnect();
            
            if (wantedKey && server) {
                // Extract values using peek() to avoid subscribing to externalAddress
                this.connect({
                    localAddress: server.localAddress,
                    externalAddress: peek(server, 'externalAddress'),
                    username: server.username,
                    secret: server.secret,
                });
            }
        });
    }

    private disconnect(): void {
        if (!this.socket && this.tryingSockets.length === 0 && !this.reconnectTimeout) return;
        console.log("api/disconnect");
        
        clearTimeout(this.reconnectTimeout);
        clearTimeout(this.connectTimeout);
        this.reconnectTimeout = undefined;
        this.connectTimeout = undefined;
        
        this.socket?.close();
        this.socket = undefined;
        for (const s of this.tryingSockets) s.close();
        this.tryingSockets = [];
        
        this.store.connectionState = 'idle';
        this.store.connected = false;
    }

    private connect(creds: { localAddress: string; externalAddress?: string; username?: string; secret?: string }): void {
        console.log("api/connect", creds.localAddress);
        
        this.store.connectionState = 'connecting';
        
        // Timeout for connection attempt
        this.connectTimeout = setTimeout(() => {
            this.handleConnectionFailure("Connection timed out. Please check the server address and port.");
        }, 4000);

        // Build connection URLs (try both local and external if available)
        const connections: { hostname: string, port: number }[] = [];
        const [localHost, serverPort] = creds.localAddress.split(':');
        connections.push({ hostname: ipToHexDomain(localHost!), port: parseInt(serverPort || '43597') });
        
        if (creds.externalAddress) {
            const [externalHost, externalPort] = creds.externalAddress.split(':');
            connections.push({ hostname: ipToHexDomain(externalHost!), port: parseInt(externalPort || '43597') });
        }

        for (const { hostname, port } of connections) {
            // Use ws:// if page loaded over http://, otherwise wss://
            const protocol = location.protocol === 'http:' ? 'ws' : 'wss';
            const url = new URL(`${protocol}://${hostname}:${port}/api`);
            url.searchParams.append("lightlynx", "1");
            if (creds.username) {
                url.searchParams.append("user", creds.username);
                url.searchParams.append("secret", creds.secret || '');
            }
            const socket = new WebSocket(url.toString(), ["lightlynx"]);
            this.tryingSockets.push(socket);
            
            socket.addEventListener("error", (e) => {
                console.error("WebSocket error", e);
            });
            
            socket.addEventListener("open", () => {
                if (this.socket) {
                    socket.close();  // Already have a winner
                    return;
                }
                console.log("api/onOpen", socket.url);
                
                this.socket = socket;
                for (const s of this.tryingSockets) {
                    if (s !== socket) s.close();
                }
                this.tryingSockets = [];
                this.store.connectionState = 'authenticating';
                if (this.reconnectTimeout) {
                    clearTimeout(this.reconnectTimeout);
                    this.reconnectTimeout = undefined;
                }
            });
            
            socket.addEventListener("close", (e) => {
                console.log("api/onClose", socket.url, e.code, e.reason);
                
                if (this.socket === socket) {
                    // Our active socket closed
                    this.socket = undefined;
                    this.handleConnectionFailure("Connection lost.");
                } else {
                    // One of the racing sockets failed
                    const index = this.tryingSockets.indexOf(socket);
                    if (index !== -1) {
                        this.tryingSockets.splice(index, 1);
                        if (this.tryingSockets.length === 0 && !this.socket) {
                            this.handleConnectionFailure("Connection failed. Please check the server address.");
                        }
                    }
                }
            });
            
            socket.addEventListener("message", this.onMessage);
        }

    }
    
    private handleConnectionFailure(errorMessage: string): void {
        if (this.socket && this.store.connected) {
            return;
        }
        console.log("api/connectionFailed", errorMessage);
        clearTimeout(this.connectTimeout);
        this.socket?.close();
        this.socket = undefined;
        for (const s of this.tryingSockets) s.close();
        this.tryingSockets = [];
        this.store.connected = false;
        this.store.lastConnectError = errorMessage;
        
        const server = this.store.servers[0];
        if (server?.status === 'try') {
            // Single attempt mode: disable on failure
            server.status = 'disabled';
            this.store.connectionState = 'idle';
        } else if (server?.status === 'enabled') {
            // Persistent mode: schedule retry with exponential backoff
            const delay = Math.min(500 * Math.pow(2, this.reconnectAttempts++), 16000);
            console.log(`api/scheduleReconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
            this.store.connectionState = 'reconnecting';
            // Extract credentials now (not in the timeout callback)
            const creds = {
                localAddress: server.localAddress,
                externalAddress: server.externalAddress,
                username: server.username,
                secret: server.secret,
            };
            this.reconnectTimeout = setTimeout(() => {
                this.reconnectTimeout = undefined;
                if (this.store.servers[0]?.status === 'enabled') {
                    this.connect(creds);
                }
            }, delay);
        } else {
            this.store.connectionState = 'idle';
        }
    }

    private flushCache(): void {
        console.log("api/flushCache");
        localStorage.removeItem('bridge/devices');
        localStorage.removeItem('bridge/groups');
        copy(this.store.devices, {});
        copy(this.store.groups, {});
        copy(this.store.users, {});
        this.nameToIeeeMap.clear();
    }
    
    private extractHashFromExtension(extensionCode: string): string | undefined {
        // Extract hash from first line comment like "// hash=d1474d1c"
        const firstLine = extensionCode.split('\n')[0];
        const match = firstLine?.match(/^\/\/\s+hash=([a-f0-9]{8})/);
        return match ? match[1] : undefined;
    }

    public async checkAndUpgradeExtension(): Promise<void> {
        if (!this.store.extensionHash) return; // No extension installed yet
        if (EXTENSION_HASH && this.store.extensionHash !== EXTENSION_HASH) {
            console.log(`Extension hash mismatch: installed=${this.store.extensionHash}, expected=${EXTENSION_HASH}`);
            await this.upgradeExtension();
        }
    }

    public async upgradeExtension(): Promise<void> {
        try {
            const response = await fetch(`/extension.js`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const code = await response.text();
            
            // Code already has hash comment prepended by build

            await this.send("bridge", "request", "extension", "save", { name: 'lightlynx.js', code });
            console.log(`Extension upgraded successfully (${EXTENSION_HASH})`);
            this.notify('info', 'Extension upgraded successfully');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('Failed to upgrade extension:', message);
            this.notify('error', `Failed to upgrade extension: ${message}`);
        }
    }
    
    private resolvePromises(payload: any): void {
        const { transaction, status, error } = payload || {};
        if (transaction !== undefined && this.requests.has(transaction)) {
            const { resolve, reject } = this.requests.get(transaction)!;
            (status === "ok" || status === undefined) ? resolve() : reject(new Error(error || 'Unknown error'));
            this.requests.delete(transaction);
        }
    }
    
    send = async (...topicAndPayload: any[]): Promise<void> => {
        let payload: any = topicAndPayload.pop();
        let topic = topicAndPayload.join("/");
        console.log("api/send", topic, JSON.stringify(payload).substr(0, 100));

        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.warn("api/send - WebSocket not connected, message dropped");
            throw new Error("WebSocket not connected");
        }

        if (topic.startsWith('bridge/request/')) {
            const transaction = `${this.transactionRndPrefix}-${this.transactionNumber++}`;
            payload = { ...payload, transaction };
        }
        this.socket.send(JSON.stringify({ topic, payload }));
        if (payload.transaction) {
            await new Promise<void>((resolve, reject) => {
                this.requests.set(payload.transaction, { resolve, reject });
            });
        }
    }

    setLightState(target: string | number, lightState: LightState) {
        console.log('api/setLightState', target, lightState);

        if (typeof target === 'number') {
            const group = this.store.groups[target];
            if (!group) return;
            if (lightState.on != null && Object.keys(lightState).length === 1) {
                // Just an on/off toggle, emit it to the group
                this.send(group.name, "set", createLightStateDelta({}, lightState));
            } else {
                // Other params changing. We'll customize this per member, creating a state prediction
                for (let ieee of this.store.groups[target]?.members || []) {
                    this.setLightState(ieee, lightState);
                }
            }
            return;
        }

        const dev = this.store.devices[target];
        if (!dev?.lightCaps) {
            console.log('api/setLightState unknown device', target);
            return;
        }
        
        lightState = tailorLightState(lightState, dev.lightCaps);
        const delta = createLightStateDelta(dev.lightState || {}, lightState);
        
        if (!objectIsEmpty(delta)) {
            console.log('merge', dev.lightState, lightState);
            if (dev.lightState) copy(dev.lightState, lightState);
            else dev.lightState = lightState;
            
            let held = this.heldLightDeltas.get(target);
            if (held != null) {
                copy(held, delta);
            } else {
                this.heldLightDeltas.set(target, delta);
                this.heldLightTimeouts.set(target, setTimeout(() => this.transmitHeldLightDelta(target), 0));
            }
        }
    }

    // Used to send at most 3 updates per second to zigbee2mqtt
    private heldLightDeltas: Map<string, LightStateDelta> = new Map();
    private heldLightTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

    // Used to delay updates from zigbee2mqtt shortly after we've asked it to update state
    private echoTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private echoLightStates: Map<string, LightState> = new Map();

    private handleLightState(ieee: string, payload: any) {
        let lightState : LightState = {
            on: payload.state === 'ON',
            brightness: payload.brightness,
            color: undefined,
        };
        if (payload.color_mode === 'color_temp') {
            lightState.color = payload.color_temp;
        }
        else if (payload.color?.hue) {
            lightState.color = { hue: payload.color.hue, saturation: payload.color.saturation/100 };
        }
        else if (payload.color?.x) {
            lightState.color = payload.color
        }

        // console.log("api/handleLightState", ieee, lightState);
        if (this.echoTimeouts.get(ieee)) {
            this.echoLightStates.set(ieee, lightState);
        }
        else {
            const dev = this.store.devices[ieee];
            if (dev) {
                dev.lightState ||= {};
                copy(dev.lightState, lightState);
            }
        }
    }

    private streamGroupState(groupId: number) {
        $(() => {
            // In case a group disappeared, this will cause the observe to end without
            // observing anything anymore.
            if (!unproxy(this.store).groups[groupId]) return;
            const group = this.store.groups[groupId]!;

            let members = group.members || [];

            let groupState: LightState = {};
            let groupCaps: LightCaps = {};
            if (members.length) {
                let ieee = members[0]!;
                groupState = clone(this.store.devices[ieee]?.lightState || {});
                groupCaps = clone(this.store.devices[ieee]?.lightCaps || {});
            }

            for(let memberIndex=1; memberIndex<members.length; memberIndex++) {
                let ieee = members[memberIndex]!;

                for(const [name,obj] of Object.entries(this.store.devices[ieee]?.lightCaps||{}) as [keyof LightCaps, any][]) {
                    if (obj && typeof obj === 'object') {
                        const cap = (groupCaps[name] ||= clone(obj));
                        if (obj.valueMin != null && cap.valueMin != null) {
                            cap.valueMin = Math.min(cap.valueMin, obj.valueMin);
                            cap.valueMax = Math.max(cap.valueMax, obj.valueMax);
                        }
                    } else {
                        // For booleans (supportsBrightness, etc), use OR (any member supports it)
                        if (groupCaps[name] === undefined) groupCaps[name] = obj;
                        else if (typeof obj === 'boolean') groupCaps[name] = groupCaps[name] || obj as any;
                    }
                }
                
                let lightState: LightState = this.store.devices[ieee]?.lightState || {};
                if (!lightState || !groupState) continue;

                groupState.on = groupState.on || lightState.on;

                if (typeof groupState.color === 'number' && typeof lightState.color === 'number' && Math.abs(groupState.color-lightState.color)<10) {
                    // Color temp similar enough! Take the average.
                    groupState.color = Math.round((groupState.color * memberIndex + lightState.color) / (memberIndex+1));
                }
                else if (isHS(groupState.color) && isHS(lightState.color) && Math.abs(lightState.color.hue-groupState.color.hue)<20 && Math.abs(lightState.color.saturation-groupState.color.saturation)<0.1) {
                    // Hue/saturation are close enough! Take the average.
                    groupState.color.hue = Math.round((groupState.color.hue * memberIndex + lightState.color.hue) / (memberIndex+1));
                    groupState.color.saturation = Math.round((groupState.color.saturation * memberIndex + lightState.color.saturation) / (memberIndex+1));
                } else {
                    groupState.color = undefined;
                }

                if (groupState.brightness!==undefined && lightState.brightness!==undefined && Math.abs(groupState.brightness - lightState.brightness) < 0.2) {
                    groupState.brightness = Math.round((groupState.brightness * memberIndex + lightState.brightness) / (memberIndex+1));
                } else {
                    groupState.brightness = undefined;
                }
            }
            // console.log('api/streamGroupState update', groupId, groupState);
            if (groupState && group) {
                group.lightState ||= {};
                copy(group.lightState, groupState);
                group.lightCaps ||= {};
                copy(group.lightCaps, groupCaps);
            }
        });
    }

    private transmitHeldLightDelta(ieee: string) {
        let delta = this.heldLightDeltas.get(ieee);
        if (delta && !objectIsEmpty(delta)) {
            console.log('api/transmitHeldLightDelta', ieee, 'to', delta);
            delta.transition = 0.333;
            this.send(ieee, "set", delta);

            this.heldLightDeltas.set(ieee, {});
            this.heldLightTimeouts.set(ieee, setTimeout(() => this.transmitHeldLightDelta(ieee), 333));

            console.log('api/pause echos', ieee);
            clearTimeout(this.echoTimeouts.get(ieee));
            this.echoTimeouts.set(ieee, setTimeout(() => {
                console.log('api/unpause echos', ieee);
                this.echoTimeouts.delete(ieee);
                const echoState = this.echoLightStates.get(ieee);
                const dev = this.store.devices[ieee];
                if (dev?.lightState && echoState) {
                    copy(dev.lightState, echoState);
                }
            }, 1500));
        } else {
            this.heldLightDeltas.delete(ieee);
            this.heldLightTimeouts.delete(ieee);
        }
    }

    setRemoteAccess(enabled: boolean): Promise<void> {
        return this.send('bridge/request/lightlynx/config/setRemoteAccess', { enabled });
    }

    setAutomation(enabled: boolean): Promise<void> {
        return this.send('bridge/request/lightlynx/config/setAutomation', { enabled });
    }

    setLocation(latitude: number, longitude: number): Promise<void> {
        return this.send('bridge/request/lightlynx/config/setLocation', { latitude, longitude });
    }

    addUser(payload: any): Promise<void> {
        return this.send('bridge/request/lightlynx/config/addUser', payload);
    }

    updateUser(payload: any): Promise<void> {
        return this.send('bridge/request/lightlynx/config/updateUser', payload);
    }

    deleteUser(username: string): Promise<void> {
        return this.send('bridge/request/lightlynx/config/deleteUser', { username });
    }

    /**
     * Check if the current user can control a group (reactive)
     */
    canControlGroup(groupId: number): boolean {
        return this.store.isAdmin || !!this.store.allowedGroupIds[groupId];
    }

    private onMessage = (event: MessageEvent): void => {
        const socket = event.target as WebSocket;
        if (socket && socket !== this.socket) return;

        const message = JSON.parse(event.data);
        let topic = message.topic;
        let payload = message.payload;        

        if (topic === 'bridge/lightlynx/connectError') {
            this.handleConnectionFailure(payload.message);
        } else if (this.store.connectionState === 'authenticating') {
            // First message confirms authentication succeeded
            console.log("api/onMessage - Authentication confirmed");
            clearTimeout(this.connectTimeout);
            this.connectTimeout = undefined;
            this.store.connected = true;
            this.store.connectionState = 'connected';
            delete this.store.lastConnectError;
            this.reconnectAttempts = 0;
            
            // If status was 'try', upgrade to 'enabled' on success
            const server = this.store.servers[0];
            if (server?.status === 'try') {
                server.status = 'enabled';
            }
        }
        
        if (!topic && message.transaction) {
            this.resolvePromises(message);
            return;
        }

        if (!topic) return;

        if (topic === 'bridge/devices' || topic === 'bridge/groups') {
            localStorage.setItem(topic, event.data);
        }

        if (topic.startsWith("bridge/")) {
            topic = topic.substr(7);
            if (topic.startsWith("response/")) {
                if (payload.status === 'error') {
                    this.notify('error', payload.error);
                }
                this.resolvePromises(payload);
            }
            else if (topic === "info") {
                this.store.permitJoin = payload.permit_join;

                // Unfortunately the 'description' field in groups is only updated on Z2M restart,
                // so we'll have to rely on the "info" topic to set/update it.
                for(const [id, info] of Object.entries(payload.config.groups as Record<string, {description: string | undefined}>)) {
                    const group = this.store.groups[parseInt(id)];
                    if (group) group.description = info.description;
                    this.groupDescriptionsCache[id] = info.description;
                }
            }  
            else if (topic === "extensions") {
                // Extract hash from lightlynx.js extension
                const lightlynxExt = (payload || []).find((e: any) => e.name === 'lightlynx.js');
                if (lightlynxExt) {
                    const hash = this.extractHashFromExtension(lightlynxExt.code);
                    if (hash) {
                        this.store.extensionHash = hash;
                        console.log('Extension hash:', hash);
                        this.checkAndUpgradeExtension();
                    }
                }
            }
            else if (topic === "lightlynx/users") {
                copy(this.store.users, payload || {});
            }
            else if (topic === "lightlynx/config") {
                this.store.remoteAccessEnabled = payload.remoteAccess;
                this.store.automationEnabled = payload.automation;
                this.store.latitude = payload.latitude;
                this.store.longitude = payload.longitude;
                this.store.externalAddress = payload.externalAddress;
                
                // Update server credentials with external address
                const server = this.store.servers[0];
                if (server && this.store.connected) {
                    server.externalAddress = this.store.externalAddress;
                }
            }
            else if (topic === "lightlynx/sceneSet") {
                // Merge incoming scene updates into activeScenes
                for (const [groupName, sceneId] of Object.entries(payload)) {
                    if (sceneId === undefined) {
                        delete this.store.activeScenes[groupName];
                    } else {
                        this.store.activeScenes[groupName] = sceneId as number;
                    }
                }
            }
            else if (topic === "devices") {
                let newDevs: Record<string, Device> = {};
                for (let z2mDev of payload) {
                    if (!z2mDev.definition) continue;
                    const model = (z2mDev.definition.description || z2mDev.model_id) + " (" + (z2mDev.definition.vendor || z2mDev.manufacturer) + ")";
                    let newDev : Device = {
                        name: z2mDev.friendly_name,
                        description: z2mDev.description,
                        model,
                    };
                    for (let expose of z2mDev.definition.exposes) {
                        if (expose.type === "light" || expose.type === "switch") {
                            let features: any = {};
                            for (let feature of (expose.features || [])) {
                                features[feature.name] = {};
                                if (feature.value_max !== undefined) {
                                    features[feature.name].valueMin = feature.value_min;
                                    features[feature.name].valueMax = feature.value_max;
                                }
                            }
                            newDev.lightCaps = {
                                supportsBrightness: !!features.brightness,
                                supportsColor: !!(features.color_hs || features.color_xy),
                                supportsColorTemp: !!features.color_temp,
                                brightness: features.brightness,
                                colorTemp: features.color_temp,
                                colorHs: !!features.color_hs,
                                colorXy: !!features.color_xy
                            };
                        }
                        else if (expose.name === "action") {
                            newDev.actions = expose.values;
                        }
                    }
                    let ieee = z2mDev.ieee_address;
                    const oldDev = this.store.devices[ieee];
                    newDev.lightState = oldDev?.lightState;
                    newDev.meta = oldDev?.meta;

                    newDevs[ieee] = newDev;
                    this.nameToIeeeMap.set(newDev.name, ieee);
                }
                copy(this.store.devices, newDevs);
            }
            else if (topic === "groups") {
                let groups: Record<number, Group> = {};
                let newGroupIds: Array<number> = [];
                for (let z2mGroup of payload) {
                    const id = z2mGroup.id;
                    const oldGroup = this.store.groups[z2mGroup.id];
                    const newGroup: Group = {
                        name: z2mGroup.friendly_name,
                        description: this.groupDescriptionsCache[z2mGroup.id],
                        scenes: z2mGroup.scenes.map((obj: any) => {
                            // Scenes use parentheses suffix for metadata (triggers, etc)
                            let m = obj.name.match(/^(.*?)\s*\((.*)\)\s*$/)
                            if (m)
                                return {id: obj.id, name: obj.name, shortName: m[1], suffix: m[2]}
                            return {id: obj.id, name: obj.name, shortName: obj.name, suffix: ''}
                        }),
                        members: z2mGroup.members.map((obj: any) => obj.ieee_address),
                        lightState: oldGroup?.lightState || {},
                        lightCaps: oldGroup?.lightCaps || {},
                    };
                    groups[id] = newGroup;
                    if (!this.store.groups[id]) {
                        newGroupIds.push(id);
                    }
                }
                copy(this.store.groups, groups);
                for(let groupId of newGroupIds) {
                    this.streamGroupState(groupId);
                }
            }
        } else {
            if (topic.endsWith("/availability")) {
                let deviceName = topic.substr(0,topic.length-13);
                let ieee = this.nameToIeeeMap.get(deviceName);
                if (ieee) {
                    const dev = this.store.devices[ieee]!;
                    dev.meta ||= {};
                    dev.meta.online = payload.state==="online";
                }
            }
            else { // A device state
                let ieee = this.nameToIeeeMap.get(topic);
                if (payload && ieee) {
                    const dev = this.store.devices[ieee]!;
                    if (payload.update) {
                        payload.update = payload.update.state;
                    }
                    for(const key of ['battery', 'linkquality', 'update'] as const) {
                        if (payload[key]!=null) {
                            dev.meta ||= {};
                            dev.meta[key] = payload[key];
                            delete payload[key];
                        }
                    }
                
                    if (payload.state) {
                        this.handleLightState(ieee, payload)
                    } else {
                        dev.otherState = payload;
                    }
                }
            }
        }
    }
}

// Start API instance
const api = new Api();
export default api;
