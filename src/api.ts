import { $, proxy, clone, copy, unproxy } from "aberdeen";
import * as colors from "./colors";
import { LightState, XYColor, HSColor, ColorValue, isHS, isXY, Store, LightCaps, Device, Group, ServerCredentials } from "./types";

const CREDENTIALS_LOCAL_STORAGE_ITEM_NAME = "lightlynx-servers";
const UNAUTHORIZED_ERROR_CODE = 4401;

export const EXTENSION_VERSIONS: Record<string, string> = {
    'lightlynx-api': '1',
    'lightlynx-automation': '1',
};

interface PromiseCallbacks {
    resolve: () => void;
    reject: () => void;
}

interface LightStateDelta {
    state?: 'ON' | 'OFF';
    brightness?: number;
    color?: { hue: number; saturation: number } | XYColor;
    color_temp?: number;
    transition?: number; // Added transition property
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
    socket?: WebSocket;
    private tryingSockets: WebSocket[] = [];
    requests: Map<string, PromiseCallbacks> = new Map();
    transactionNumber = 1;
    transactionRndPrefix: string;
    store: Store = proxy({
        devices: {},
        groups: {},
        permitJoin: false,
        servers: getLocalStorage(CREDENTIALS_LOCAL_STORAGE_ITEM_NAME) || [],
        activeServerIndex: -1,
        connected: false,
        connectionState: 'idle',
        extensions: [],
        users: {},
    });
    errorHandlers: Array<(msg: string) => void> = [];
    nameToIeeeMap: Map<string, string> = new Map();
    
    // Reconnection state
    private reconnectAttempts = 0;
    private reconnectTimeout?: ReturnType<typeof setTimeout>;
    private currentServer?: ServerCredentials;  // The server we're connected/connecting to
    private shouldReconnect = false;  // Only reconnect after a successful connection drops

    
    // Extension management
    private extensionCheckPerformed = false;

    public extractVersionFromExtension(extensionContent: string): string | null {
        const lines = extensionContent.split('\n');
        if (lines.length === 0) return null;
        
        const firstLine = lines[0];
        if (!firstLine) return null;
        
        const versionMatch = firstLine.match(/v(\d+(?:\.\d+)?)/);
        return versionMatch?.[1] || null;
    }

    public async checkAndUpdateExtensions(): Promise<void> {
        if (this.extensionCheckPerformed) return;
        this.extensionCheckPerformed = true;

        for (const [name, expectedVersion] of Object.entries(EXTENSION_VERSIONS)) {
            const ext = this.store.extensions.find(e => e.name === name + '.js');
            const installedVersion = ext ? this.extractVersionFromExtension(ext.code) : null;
            
            if (ext && installedVersion !== expectedVersion) {
                console.log(`Extension ${name} version mismatch: installed=${installedVersion}, expected=${expectedVersion}`);
                await this.installExtension(name);
            }
        }
    }

    public async installExtension(name: string): Promise<void> {
        const version = EXTENSION_VERSIONS[name];
        if (!version) return;

        try {
            const response = await fetch(`/extensions/${name}.js`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            let code = await response.text();
            
            // Ensure first line is the version comment
            const firstLine = `// ${name} v${version}`;
            if (!code.startsWith(firstLine)) {
                code = firstLine + '\n' + code;
            }

            await this.send("bridge", "request", "extension", "save", {
                name: `${name}.js`,
                code
            });
            console.log(`Extension ${name} installed successfully`);
        } catch (error) {
            console.error(`Failed to install extension ${name}:`, error);
        }
    }
    
    constructor() {
        this.transactionRndPrefix = (Math.random() + 1).toString(36).substring(2,7);

        // Load data cached in localStorage
        for (const topic of ['bridge/devices', 'bridge/groups']) {
            let data = localStorage.getItem(topic);
            if (data) this.onMessage({data} as MessageEvent);
        }
        
        // Persist servers list to localStorage on changes
        $(() => {
            setLocalStorage(CREDENTIALS_LOCAL_STORAGE_ITEM_NAME, this.store.servers);
        });
        
        // Auto-connect to saved server on startup
        if (this.store.servers.length > 0) {
            if (this.store.activeServerIndex === -1) {
                this.store.activeServerIndex = 0;
            }
            const server = this.store.servers[this.store.activeServerIndex];
            if (server) {
                this.connect(clone(unproxy(server)));
            }
        }
    }
    
    /**
     * Connect to a server with the given credentials.
     * This is the only way to initiate a connection - no reactive triggers.
     */
    connect(server: ServerCredentials): void {
        console.log("api/connect", server.serverIp);
        
        // Stop any existing connection
        this.disconnect();
        
        // Store the server we're connecting to
        this.currentServer = server;
        this.store.connectionState = 'connecting';
        this.store.connected = false;
        delete this.store.lastConnectError;
        
        this.connectInternal(server);
    }
    
    /**
     * Disconnect from the current server and stop any reconnection attempts.
     */
    disconnect(): void {
        console.log("api/disconnect");
        this.shouldReconnect = false;
        this.reconnectAttempts = 0;
        clearTimeout(this.reconnectTimeout);
        
        if (this.socket) {
            this.socket.close();
            this.socket = undefined;
        }
        for (const s of this.tryingSockets) {
            s.close();
        }
        this.tryingSockets = [];
        
        this.store.connectionState = 'idle';
        this.store.connected = false;
    }
    
    send = (...topicAndPayload: any[]): Promise<void> => {
        let payload: any = topicAndPayload.pop()
        let topic = topicAndPayload.join("/")
        console.log("api/send", topic, JSON.stringify(payload).substr(0,100));

        let promise: Promise<void>;
        if (topic.startsWith('bridge/request/')) {
            const transaction = `${this.transactionRndPrefix}-${this.transactionNumber++}`;
            promise = new Promise<void>((resolve, reject) => {
                this.requests.set(transaction, { resolve, reject });
            });
            payload = { ...payload, transaction };
        } else {
            promise = Promise.resolve();
        }
        
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.warn("api/send - WebSocket not connected, message dropped");
            return Promise.reject(new Error("WebSocket not connected"));
        }
        
        let message = JSON.stringify({topic, payload}, (_, v) => v === undefined ? null : v);
        this.socket.send(message);
        return promise;
    }

    setLightState(target: string|number, lightState: LightState) {
        console.log('api/setLightState', target, lightState)

        if (typeof target === 'number') {
            let groupId: number = target;
            for(let ieee of this.store.groups[groupId]?.members || []) {
                this.setLightState(ieee, lightState)
            }
            return;
        }

        let ieee: string = target;
        const dev = this.store.devices[ieee];
        if (!dev?.lightCaps) {
            console.log('api/setLightState unknown device', target)
            return;
        }
        let cap = dev.lightCaps;
        lightState = tailorLightState(lightState, cap);
        let oldState = dev.lightState || {};

        let delta = createLightStateDelta(oldState, lightState);
        if (!objectIsEmpty(delta)) {
            console.log('merge', dev.lightState, lightState)
            if (dev.lightState) copy(dev.lightState, lightState);
            else dev.lightState = lightState;
            let held = this.heldLightDeltas.get(ieee);
            if (held != null) {
                copy(held, delta);
            }
            else {
                this.heldLightDeltas.set(ieee, delta);
                this.heldLightTimeouts.set(ieee, setTimeout(() => this.transmitHeldLightDelta(ieee), 0));
            }
        }
    }

    private scheduleReconnect(): void {
        if (!this.shouldReconnect || !this.currentServer) return;
        
        this.reconnectAttempts += 1;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
        console.log(`api/scheduleReconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

        this.reconnectTimeout = setTimeout(() => {
            if (this.currentServer) {
                this.store.connectionState = 'connecting';
                this.connectInternal(this.currentServer);
            }
        }, delay);
    }
    
    /**
     * Internal connection method used for reconnection (doesn't reset state)
     */
    private connectInternal(server: ServerCredentials): void {
        for (const s of this.tryingSockets) {
            s.close();
        }
        this.tryingSockets = [];

        const connections: { hostname: string, port: number }[] = [];
        connections.push({ hostname: ipToHexDomain(server.serverIp), port: 43597 });
        
        if (server.externalIp) {
            connections.push({ hostname: ipToHexDomain(server.externalIp), port: server.externalPort || 43597 });
        }

        const protocols = ["lightlynx"];

        for (const { hostname, port } of connections) {
            try {
                const protocol = "wss";
                const url = new URL(`${protocol}://${hostname}:${port}/api`);
                url.searchParams.append("lightlynx", "1");
                if (server.username && server.secret) {
                    url.searchParams.append("user", server.username);
                    url.searchParams.append("secret", server.secret);
                }

                const socket = new WebSocket(url.toString(), protocols);
                this.tryingSockets.push(socket);
                socket.addEventListener("message", this.onMessage);
                socket.addEventListener("close", this.onClose);
                socket.addEventListener("open", this.onOpen);
                socket.addEventListener("error", this.onError);
            } catch (error) {
                console.error(`Failed to initiate connection to ${hostname}:`, error);
            }
        }

        if (this.tryingSockets.length === 0 && !this.socket) {
            this.store.connectionState = 'error';
            this.store.lastConnectError = "Failed to initiate any connection.";
        }
    }
    
    private onOpen = (event: Event): void => {
        const socket = event.target as WebSocket;
        console.log("api/onOpen - WebSocket opened", socket.url);
        
        if (this.socket) {
            // We already have a winner!
            socket.close();
            return;
        }

        // We have a winner
        this.socket = socket;
        
        // Close all other "trying" sockets
        for (const s of this.tryingSockets) {
            if (s !== socket) {
                s.close();
            }
        }
        this.tryingSockets = [];

        // Don't mark as connected yet - wait for first message to confirm auth succeeded
        this.store.connectionState = 'authenticating';
        delete this.store.lastConnectError;
        clearTimeout(this.reconnectTimeout);
    }

    private onError = (event: any): void => {
        console.error("WebSocket error", (event.target as WebSocket)?.url);
        // Don't set error state here - wait for onClose which always follows onError
    }
    
    private resolvePromises(payload: any): void {
        const {transaction, status} = payload || {};
        if (transaction !== undefined && this.requests.has(transaction)) {
            const { resolve, reject } = this.requests.get(transaction)!;
            if (status === "ok" || status === undefined) {
                resolve();
            } else {
                reject();
            }
            this.requests.delete(transaction);
        }
    }

    private onClose = (e: CloseEvent): void => {
        const socket = e.target as WebSocket;
        console.log("api/onClose", socket.url, e.code, e.reason);

        if (this.socket && socket !== this.socket) {
            // Not our active socket, or it was one of the losers we just closed
            return;
        }

        if (this.socket === socket) {
            // Our active socket closed
            this.socket = undefined;
            this.store.connected = false;
            
            if (e.code === UNAUTHORIZED_ERROR_CODE) {
                this.store.connectionState = 'error';
                this.store.lastConnectError = "Unauthorized, please check your credentials.";
                this.shouldReconnect = false;  // Don't retry bad credentials
            } else if (this.shouldReconnect) {
                // Connection dropped after successful connection - try to reconnect
                this.scheduleReconnect();
            } else {
                // Initial connection failed
                this.store.connectionState = 'error';
                this.store.lastConnectError = "Connection failed. Please check the server address.";
            }
        } else {
            // One of the "trying" sockets failed
            this.tryingSockets = this.tryingSockets.filter(s => s !== socket);
            if (this.tryingSockets.length === 0 && !this.socket) {
                // All attempts failed
                this.store.connectionState = 'error';
                this.store.lastConnectError = "Connection failed. Please check the server address.";
            }
        }
    }

    // Used to send at most 3 updates per second to zigbee2mqtt
    heldLightDeltas: Map<string, LightStateDelta> = new Map();
    heldLightTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

    // Used to delay updates from zigbee2mqtt shortly after we've ask it to update state,
    // as it's probably just an echo, and perhaps its echoing an older value than our latest
    // update, which would interfere with sliding in our UI.
    echoTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
    echoLightStates: Map<string, LightState> = new Map();

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
                        else if (typeof obj === 'boolean') groupCaps[name] = groupCaps[name] || obj;
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

    addUser(payload: any): Promise<void> {
        return this.send('bridge/request/lightlynx/config/addUser', payload);
    }

    updateUser(payload: any): Promise<void> {
        return this.send('bridge/request/lightlynx/config/updateUser', payload);
    }

    deleteUser(username: string): Promise<void> {
        return this.send('bridge/request/lightlynx/config/deleteUser', { username });
    }

    private onMessage = (event: MessageEvent): void => {
        const socket = event.target as WebSocket;
        if (socket && socket !== this.socket) {
            // Shouldn't happen if we close others onOpen, but good to check
            return;
        }

        // First message confirms authentication succeeded
        if (this.store.connectionState === 'authenticating') {
            console.log("api/onMessage - Authentication confirmed");
            this.store.connected = true;
            this.store.connectionState = 'connected';
            this.reconnectAttempts = 0;
            this.shouldReconnect = true;  // Enable auto-reconnect after successful connection
        }
        
        const message = JSON.parse(event.data);
        let topic = message.topic;
        let payload = message.payload;

        if (!topic && message.transaction) {
            // Raw Z2M response over WebSocket
            this.resolvePromises(message);
            return;
        }

        if (!topic) return;

        if (topic==='bridge/devices' || topic==='bridge/groups') {
            localStorage.setItem(topic, event.data);
        }
        // console.log('api/incoming', topic, payload);

        if (topic.startsWith("bridge/")) {
            topic = topic.substr(7);
            if (topic.startsWith("response/")) {
                if (payload.status === 'error') {
                    for(let handler of this.errorHandlers) {
                        handler(payload.error);
                    }
                }
                this.resolvePromises(payload);
            }
            else if (topic === "info") {
                this.store.permitJoin = payload.permit_join;
            }  
            else if (topic === "extensions") {
                this.store.extensions = payload || [];
                console.log('api/received extensions', this.store.extensions.length);
                // Check extension after receiving the list
                this.checkAndUpdateExtensions();
            }
            else if (topic === "info" || topic === "logging") {
                // Ignore!
            }
            else if (topic === "lightlynx/users") {
                copy(this.store.users, payload || {});
            }
            else if (topic === "lightlynx/config") {
                this.store.remoteAccessEnabled = payload.remoteAccess;
                this.store.serverIp = payload.serverIp;
                this.store.externalIp = payload.externalIp;
                this.store.externalPort = payload.externalPort;
                // Update current server credentials with external IP/port if we're connected
                if (this.currentServer) {
                    this.currentServer.externalIp = payload.externalIp;
                    this.currentServer.externalPort = payload.externalPort;
                    
                    // Also update it in the stored servers list to ensure it's persisted for next session
                    for (const s of this.store.servers) {
                        if (s.serverIp === this.currentServer.serverIp && s.username === this.currentServer.username) {
                            s.externalIp = payload.externalIp;
                            s.externalPort = payload.externalPort;
                        }
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
                        description: z2mGroup.description,
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

const api = new Api();

export default api;
