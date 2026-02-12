import { $, proxy, clone, copy, unproxy, peek, merge, onEach } from "aberdeen";
import { applyPrediction, applyCanon, Patch } from "aberdeen/prediction";
import * as route from "aberdeen/route";
import { mergeLightStateWithCaps }  from "./colors";
import { LightState, LightCaps, ServerCredentials, Config, GroupWithDerives, ClientState, UserWithName, GroupAccess } from "./types";
import { applyDelta } from "./json-merge-patch";

const REQUIRED_EXTENSION_VERSION = 1;
const RECOMMENDED_EXTENSION_VERSION = 1;

interface PendingSend {
    args: any[];
    resolve: (result: any) => void;
    reject: (err: Error) => void;
    prediction?: Patch;
    predictionDelay: number;
    sentAt: number;
}

const DEFAULT_PORT = 43597;
const DOMAIN = 'lightlynx.eu';

function createFreshStoreState(): ClientState {
    return {
        lights: {},
        toggles: {},
        groups: {},
        permitJoin: false,
        config: {
            allowRemote: false,
            automationEnabled: false,
            latitude: 0,
            longitude: 0,
            sceneStates: {},
            groupTimeouts: {},
            sceneTriggers: {},
            toggleGroupLinks: {},
        }
    };
}

class Api {
    private socket?: WebSocket; // Current active socket

    private tryingSockets?: Set<WebSocket>; // One or two sockets trying to connect
    
    private pendingSends: PendingSend[] = [];
    private awaitingReplies: Map<number, PendingSend> = new Map();
    private transactionCount = 0;

    private connectTimeout?: ReturnType<typeof setTimeout>;
    private stallingTimeout?: ReturnType<typeof setTimeout>;

    store: ClientState = proxy(createFreshStoreState());

    lightGroups: Record<string, number[]> = proxy({}); // Reactive list of group ids per ieee

    servers: ServerCredentials[] = proxy([]); // Preserved to localStorage. servers[0] is the current server.

    connection: {
        mode: 'enabled' | 'disabled' | 'try';
        state: "idle" | "connecting" | "initializing" | "connected" | "reconnecting";
        lastError?: string;
        attempts: number;
        stalling: boolean;
    } = proxy({ mode: 'enabled', state: 'idle', attempts: 0, stalling: false });

    notifyHandlers: Array<(type: 'error' | 'info' | 'warning', msg: string, channel?: string) => void> = [];
    
    constructor() {
        // Load server list
        try {
            const data = localStorage.getItem("lightlynx-servers");
            if (data) copy(this.servers, JSON.parse(data));
        } catch(e) {
            console.error("Failed to load lightlynx-servers from localStorage:", e);
        }

        // Load cached data from localStorage
        try {
            const data = localStorage.getItem("lightlynx-store");
            if (data) {
                merge(this.store, JSON.parse(data));
                for (const light of Object.values(this.store.lights)) {
                    if (!light.lightState) light.lightState = {} as any;
                }
            }
        } catch(e) {
            console.error("Failed to load lightlynx-store from localStorage:", e);
        }
        
        // Persist servers list to localStorage on changes
        $(() => {
            const json = JSON.stringify(this.servers);
            setTimeout(() => {
                localStorage.setItem("lightlynx-servers", json);
            }, 25); // Delay- don't keep UI thread busy during events
        });

        // Persist store to localStorage on changes
        $(() => {
            const data = {
                lights: this.cloneLightsWithoutState(),
                toggles: clone(this.store.toggles),
                groups: clone(this.store.groups),
                config: clone(this.store.config),
                me: this.store.me ? clone(this.store.me) : undefined,
            };
            setTimeout(() => {
                localStorage.setItem("lightlynx-store", JSON.stringify(data));
            }, 250); // Delay- don't keep UI thread busy during events
        });

        // Flush store when changing server
        let prevInstanceId = peek(() => this.servers[0]?.instanceId);
        $(() => {
            if (this.servers[0]?.instanceId !== prevInstanceId) {
                prevInstanceId = this.servers[0]?.instanceId;
                copy(this.store, createFreshStoreState());
            }
        })

        // Auto-connect from URL parameters
        // As we're not in any scope, this peek shouldn't do anything, but just for clarity:
        peek(() => {
            const initialInstanceId = route.current.search.instanceId;
            const initialUserName = route.current.search.userName;
            if (!initialInstanceId || !initialUserName) return;
            const initialSecret = route.current.search.secret;

            console.log(`Auto-connecting from URL parameters: ${initialUserName}@${initialInstanceId}`);
            let server = this.servers.find(s => s.instanceId === initialInstanceId && s.userName === initialUserName);
            if (server) {
                if (initialSecret) server.secret = initialSecret;
                const index = this.servers.indexOf(server);
                if (index > 0) {
                    this.servers.splice(index, 1);
                    this.servers.unshift(server);
                }
            } else {
                this.servers.unshift({instanceId: initialInstanceId, userName: initialUserName, secret: initialSecret || ''});
                this.connection.mode = 'enabled';
            }
            // Remove from the route
            delete route.current.search.instanceId;
            delete route.current.search.userName;
            delete route.current.search.secret;
        });
                
        // Connect and disconnect/reconnect as servers[0] changes
        $(() => {
            const server = this.servers[0];
            this.disconnect();
            
            if (server && this.connection.mode !== 'disabled') {
                // Whenever connection.attempts changes, try to connect again
                this.connection.attempts;
                this.connect({
                    instanceId: server.instanceId,
                    userName: server.userName,
                    secret: server.secret,
                    externalPort: server.externalPort,
                });
            } else {
                // Not going to reconnect; reject anything still pending
                this.rejectAllPending();
            }
        });

        $(() => {
            onEach(this.store.groups, this.deriveGroupLightState.bind(this));
        })

        $(() => {
            let result: Record<string, number[]> = {};
            for (const [groupId, group] of Object.entries(this.store.groups)) {
                for (const ieee of group.lightIds) {
                    (result[ieee] = result[ieee] || []).push(parseInt(groupId));
                }
            }
            copy(this.lightGroups, result);
        });
    }

    private cloneLightsWithoutState() {
        const result: Record<string, any> = {};
        for (const [ieee, light] of Object.entries(this.store.lights)) {
            result[ieee] = {
                name: light.name,
                description: light.description,
                model: light.model,
                meta: clone(light.meta),
                lightCaps: clone(light.lightCaps),
            }
        }
        return result;
    }

    notify(type: 'error' | 'info' | 'warning', msg: string) {
        for (const handler of this.notifyHandlers) {
            handler(type, msg, 'api');
        }
    };    

    private disconnect(): void {
        clearTimeout(this.connectTimeout);
        this.connectTimeout = undefined;

        const sockets = this.tryingSockets;
        if (sockets) {
            this.tryingSockets = undefined;
            for(const socket of sockets) {
                socket.close();
            }
        }
        
        const socket = this.socket;
        if (socket) {
            this.socket = undefined;
            socket.close();
        }

        // Move sent-but-unreplied messages back to the front of the queue for retry
        if (this.awaitingReplies.size) {
            this.pendingSends.unshift(...this.awaitingReplies.values());
            this.awaitingReplies.clear();
        }
        
        this.connection.state = 'idle';
    }

    /** Reject all pending and queued sends, dropping their predictions */
    private rejectAllPending(): void {
        for (const entry of [...this.awaitingReplies.values(), ...this.pendingSends]) {
            if (entry.prediction) applyCanon(undefined, [entry.prediction]);
            entry.reject(new Error("Connection lost"));
        }
        this.awaitingReplies.clear();
        this.pendingSends.length = 0;
        this.connection.stalling = false;
        clearTimeout(this.stallingTimeout);
        this.stallingTimeout = undefined;
    }

    /** Send all queued messages if connected */
    private flushSends(): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        while (this.pendingSends.length > 0) {
            const entry = this.pendingSends.shift()!;
            const id = ++this.transactionCount;
            this.socket.send(JSON.stringify([id, ...entry.args]));
            this.awaitingReplies.set(id, entry);
            // 7s timeout per send attempt triggers reconnect
            setTimeout(() => {
                if (this.awaitingReplies.has(id)) {
                    this.handleConnectionFailure("Request timed out. Network issues?");
                }
            }, 7000);
        }
    }

    private connect(creds: { instanceId: string; userName?: string; secret?: string; externalPort?: number }): void {
        console.log("api/connect", creds.instanceId);
        
        this.connection.state = 'connecting';
        
        // Timeout for connection attempt
        this.connectTimeout = setTimeout(() => {
            this.handleConnectionFailure("Connection timed out. Please check instance ID and network connection.");
        }, 4000);

        // Build the list of URLs to try
        const urls: string[] = [];
        const code = creds.instanceId;
        const protocol = location.protocol === 'http:' ? 'ws' : 'wss';
        
        if (code.includes('.') || code.includes(':')) {
            // Contains dots or colon: treat as a literal hostname (optionally with :port)
            const [host, portStr] = code.split(':') as [string, string | undefined];
            const port = portStr ? parseInt(portStr) : DEFAULT_PORT;
            urls.push(`${protocol}://${host}:${port}/api`);
        } else {
            // Instance ID: try both int- and ext- domains in parallel
            const externalPort = creds.externalPort || DEFAULT_PORT;
            urls.push(`${protocol}://int-${code}.${DOMAIN}:${DEFAULT_PORT}/api`);
            urls.push(`${protocol}://ext-${code}.${DOMAIN}:${externalPort}/api`);
        }

        this.tryingSockets = new Set();
        for (const baseUrl of urls) {
            const url = new URL(baseUrl);
            if (creds.userName) {
                url.searchParams.append("user", creds.userName);
                url.searchParams.append("secret", creds.secret || '');
            }
            const socket = new WebSocket(url.toString(), ["lightlynx"]);
            this.tryingSockets.add(socket);

            const close = (reason: string) => {
                if (this.socket === socket) {
                    // Our active socket closed/errored
                    this.handleConnectionFailure(reason);
                } else if (this.tryingSockets?.has(socket)) {
                    this.tryingSockets.delete(socket);
                    if (this.tryingSockets.size === 0 && !this.socket) {
                        this.handleConnectionFailure(reason);
                    }
                }
            }
            
            socket.addEventListener("close", (e) => {
                console.log("api/onClose", socket.url, e.code, e.reason);
                close("Connection lost.");
            });
            
            socket.addEventListener("error", (e: any) => {
                console.error("api/onError", socket.url, e);
                close(`Unable to establish a connection. Please check instance ID and network connection.`);
            });
            
            socket.addEventListener("open", () => {
                if (this.socket) {
                    if (socket !== this.socket) socket.close();  // Already have a winner
                    return;
                }
                console.log("api/onOpen", socket.url);
                
                this.socket = socket;

                if (this.tryingSockets) {
                    for (const s of this.tryingSockets) {
                        if (s !== socket) s.close();
                    }
                    this.tryingSockets = undefined;
                }
                this.connection.state = 'initializing';
                clearTimeout(this.connectTimeout);
                this.connectTimeout = undefined;
            });
            
            socket.addEventListener("message", this.onMessage);
        }

    }
    
    private handleConnectionFailure(errorMessage: string): void {
        console.log("api/connectionFailed", errorMessage);
        this.disconnect();
        this.connection.lastError ||= errorMessage;
        
        if (this.connection.mode === 'disabled') {
            this.connection.state = 'idle';
        } else if (this.connection.mode === 'try' && this.connection.attempts > 0) { // Allow 1 retry (that asks for a /port refresh)
            // Single attempt mode: disable on failure
            this.connection.mode = 'disabled';
            this.connection.state = 'idle';
        } else {
            // Persistent mode: schedule retry with exponential backoff
            const delay = Math.min(500 * Math.pow(2, this.connection.attempts), 16000);
            console.log(`api/scheduleReconnect in ${delay}ms (attempt ${this.connection.attempts + 1})`);
            this.connection.state = 'reconnecting';

            // On first failure, try to refresh the external port from the cert backend
            if (this.connection.attempts === 0) {
                this.refreshExternalPort();
            }

            this.connectTimeout = setTimeout(() => {
                this.connectTimeout = undefined;
                this.connection.attempts++; // Cause reactive method in constructor to reconnect
            }, delay);
        }
    }

    /** Try to fetch the current external port for this instance from the cert backend. */
    private async refreshExternalPort() {
        const server = this.servers[0];
        const instanceId = server?.instanceId;
        if (!instanceId || instanceId.includes('.') || instanceId.includes(':')) return; // This is a hostname not a instanceId
        try {
            const res = await fetch(`https://cert.${DOMAIN}/port?id=${encodeURIComponent(instanceId)}`);
            const data = await res.json();
            if (data?.error) return; // Instance not found or other error
            if (data?.externalPort && server.externalPort !== data.externalPort) {
                console.log(`api/portLookup: updated externalPort ${server.externalPort} -> ${data.externalPort}`);
                server.externalPort = data.externalPort;
            }
        } catch(e) {
            console.error(`Error refreshing external port: ${e}`);
        }
    }

    /**
     * Send a command to the server. Queues if not yet connected; retries on reconnect.
     * The last argument may be a prediction function: it will be wrapped in applyPrediction
     * and the resulting Patch kept until the server replies (+ a delay).
     * If the prediction function returns a number, that number overrides the default 2000ms
     * delay before dropping the prediction after the reply arrives.
     */
    async send(...commandAndArgs: any[]): Promise<void> {
        // Extract optional prediction function from the end
        let predictionFn: (() => number | void) | undefined;
        if (typeof commandAndArgs[commandAndArgs.length - 1] === 'function') {
            predictionFn = commandAndArgs.pop();
        }

        console.log("api/send", commandAndArgs);

        // Apply prediction immediately so UI updates right away
        let prediction: Patch | undefined;
        let predictionDelay = 2000;
        if (predictionFn) {
            let returnValue: number | void;
            prediction = applyPrediction(() => {
                returnValue = predictionFn!();
            });
            if (typeof returnValue! === 'number') {
                predictionDelay = returnValue!;
            }
        }

        if (this.connection.mode === 'disabled') {
            if (prediction) applyCanon(undefined, [prediction]);
            throw new Error("WebSocket not connected");
        }

        const hadPending = this.pendingSends.length > 0 || this.awaitingReplies.size > 0;

        await new Promise<void>((resolve, reject) => {
            this.pendingSends.push({ args: commandAndArgs, resolve, reject, prediction, predictionDelay, sentAt: Date.now() });
            if (!hadPending) {
                this.stallingTimeout = setTimeout(() => {
                    if (this.pendingSends.length > 0 || this.awaitingReplies.size > 0) {
                        this.connection.stalling = true;
                    }
                }, 500);
            }
            this.flushSends();
        });
    }

    recallScene(groupId: number, sceneId: number) {
        this.send("scene", groupId, sceneId, "recall", () => {
            const group = this.store.groups[groupId];
            if (!group) return;
            const scene = group.scenes[sceneId];
            if (!scene) return;
            const lightStates = this.store.config.sceneStates[groupId]?.[sceneId];
            if (!lightStates) return;
            for (const [ieee, lightState] of Object.entries(lightStates)) {
                const light = this.store.lights[ieee];
                if (!light) continue;
                copy(light.lightState, lightState);
            }
            return 6000;
        });
    }

    /**
     * Request a light state change from user input.
     * Applies optimistic update immediately, then queues for server transmission.
     * Keeps at most one prediction per target to avoid accumulation during dragging.
     */
    setLightState(target: string | number, lightState: LightState) {
        console.log('api/setLightState', target, lightState);

        // Drop any previous prediction for this target before making a new one
        const prevPatch = this.setLightStatePredictions.get(target);
        if (prevPatch) {
            applyCanon(undefined, [prevPatch]);
        }

        // Make a new prediction for this target
        const patch = applyPrediction(() => {
            if (typeof target === 'number') {
                const group = this.store.groups[target];
                if (!group) return;
                for(const ieee of group.lightIds) {
                    const light = this.store.lights[ieee];
                    if (!light) continue;
                    mergeLightStateWithCaps(light.lightState, lightState, light.lightCaps);
                }
            } else {
                const light = this.store.lights[target];
                if (!light) return;
                mergeLightStateWithCaps(light.lightState, lightState, light.lightCaps);
            }
        });
        this.setLightStatePredictions.set(target, patch);
        
        // Auto-expire prediction after 3s
        setTimeout(() => {
            if (this.setLightStatePredictions.get(target) === patch) {
                this.setLightStatePredictions.delete(target);
                applyCanon(undefined, [patch]);
            }
        }, 3000);

        // Send the state, but at most 3 times per second per target
        const actuallySendState = async() => {
            const value = this.setLightStateObjects.get(target);
            if (value) {
                this.setLightStateTimers.set(target, setTimeout(actuallySendState, 333));
                this.setLightStateObjects.delete(target);

                // If we've actually send the state out, we don't want to drop the prediction when shifting
                // a slider a bit further. Instead, we keep it around until the server responds.
                // Until then, it will act as the basis for more predictions on top.
                this.setLightStatePredictions.delete(target);
                try {
                    await this.send('set-state', target, value);
                }
                finally {
                    // On error (e.g. permission denied), drop the prediction so the UI reverts
                    applyCanon(undefined, [patch]);
                }
            } else {
                this.setLightStateTimers.delete(target);
            }
        }

        const org = this.setLightStateObjects.get(target) || {};
        this.setLightStateObjects.set(target, { ...org, ...lightState });

        if (!this.setLightStateTimers.has(target)) actuallySendState();
    }

    private setLightStateObjects: Map<string|number, LightState> = new Map();
    private setLightStateTimers: Map<string|number, ReturnType<typeof setTimeout>> = new Map();
    private setLightStatePredictions: Map<string|number, Patch> = new Map();

    /**
     * Compute aggregate light state/caps for a group based on its lights.
     * This runs reactively from a onEach defined in the constructor.
     */
    private deriveGroupLightState(group: GroupWithDerives) {
        let groupState: LightState | undefined;
        let groupCaps: LightCaps | undefined;

        for(const [lightIndex, lightId] of group.lightIds.entries()) {
            const light = this.store.lights[lightId];
            if (!light) continue;

            if (!groupCaps || !groupState) { // Start by copying first member's caps/state
                groupCaps = clone(light.lightCaps);
                groupState = clone(light.lightState);
                continue;
            }

            // Merge lightCaps into groupCaps
            for(const [name,obj] of Object.entries(light.lightCaps||{}) as [keyof LightCaps, any][]) {
                if (obj && typeof obj === 'object') {
                    const cap = (groupCaps[name] ||= clone(obj));
                    if (obj.min != null && cap.min != null) {
                        cap.min = Math.min(cap.min, obj.min);
                        cap.max = Math.max(cap.max, obj.max);
                    }
                } else {
                    // For booleans (supportsBrightness, etc), use OR (any member supports it)
                    if (groupCaps[name] === undefined) groupCaps[name] = obj;
                    else if (typeof obj === 'boolean') groupCaps[name] = groupCaps[name] || obj as any;
                }
            }
            
            // Merge lightState into groupState
            const lightState = light.lightState;
            groupState.on = groupState.on || lightState.on;

            if (groupState.mireds != null && lightState.mireds != null && Math.abs(groupState.mireds - lightState.mireds) < 10) {
                // Color temp similar enough! Take the average.
                groupState.mireds = Math.round((groupState.mireds * lightIndex + lightState.mireds) / (lightIndex + 1));
            } else if (groupState.mireds != null || lightState.mireds != null) {
                // Mismatched color modes or too different
                groupState.mireds = undefined;
            }

            if (groupState.hue != null && lightState.hue != null && Math.abs(groupState.hue - lightState.hue) < 20) {
                groupState.hue = Math.round((groupState.hue * lightIndex + lightState.hue) / (lightIndex + 1));
            } else if (groupState.hue != null || lightState.hue != null) {
                groupState.hue = undefined;
            }

            if (groupState.saturation != null && lightState.saturation != null && Math.abs(groupState.saturation - lightState.saturation) < 0.1) {
                groupState.saturation = (groupState.saturation * lightIndex + lightState.saturation) / (lightIndex + 1);
            } else if (groupState.saturation != null || lightState.saturation != null) {
                groupState.saturation = undefined;
            }

            if (groupState.brightness!==undefined && lightState.brightness!==undefined && Math.abs(groupState.brightness - lightState.brightness) < 0.2) {
                groupState.brightness = Math.round((groupState.brightness * lightIndex + lightState.brightness) / (lightIndex+1));
            } else {
                groupState.brightness = undefined;
            }
        }
        copy(group, 'lightCaps', groupCaps || {});
        copy(group, 'lightState', groupState || {});

        // Subscribe to the lightCaps property we just set, so that in case a server patch
        // somehow overwrites the entire Light, we will be triggered to recalculate.
        group.lightCaps;
    }

    setRemoteAccess(enabled: boolean): Promise<void> {
        return this.send('patch-config', { allowRemote: enabled });
    }

    setAutomation(enabled: boolean): Promise<void> {
        return this.send('patch-config', { automationEnabled: enabled });
    }

    setLocation(latitude: number, longitude: number): Promise<void> {
        return this.send('patch-config', { latitude, longitude });
    }

    async patchConfig(patch: any): Promise<void> {
        await this.send('patch-config', patch, () => {
            copy(this.store.config, patch);
        });
    }

    updateUser(user: UserWithName): Promise<void> {
        return this.send('patch-config', {users: {[user.name]: user}})
    }

    deleteUser(userName: string): Promise<void> {
        return this.send('patch-config', {users: {[userName]: null}});
    }

    /**
     * Link or unlink a toggle device to a group
     */
    async linkToggleToGroup(groupId: number, ieee: string, linked: boolean): Promise<void> {
        const toggle = this.store.toggles[ieee];
        if (!toggle) return;

        await this.send('link-toggle-to-group', groupId, ieee, linked, () => {
            const links = this.store.config.toggleGroupLinks;
            const currentGroups = links[ieee] || [];
            if (linked && !currentGroups.includes(groupId)) {
                links[ieee] = [...currentGroups, groupId];
            } else if (!linked && currentGroups.includes(groupId)) {
                links[ieee] = currentGroups.filter(id => id !== groupId);
                if (links[ieee].length === 0) delete links[ieee];
            }
        });
    }

    /**
     * Set or clear the auto-off timeout for a group (in seconds, or null to clear)
     */
    async setGroupTimeout(groupId: number, timeoutSecs: number | null): Promise<void> {
        const group = this.store.groups[groupId];
        if (!group) return;

        await this.send('set-group-timeout', groupId, timeoutSecs, () => {
            if (timeoutSecs) {
                this.store.config.groupTimeouts[groupId] = timeoutSecs;
            } else {
                delete this.store.config.groupTimeouts[groupId];
            }
        });
    }

    /**
     * Check if the current user can control a group (reactive).
     * Returns false, true, or 'manage'.
     */
    canControlGroup(groupId: number): GroupAccess {
        const me = this.store.me;
        if (!me) return false;
        if (me.isAdmin) return 'manage';
        const perGroup = me.groupAccess?.[groupId];
        if (perGroup !== undefined) return perGroup;
        return me.defaultGroupAccess ?? false;
    }

    private onMessage = (event: MessageEvent): void => {
        const socket = event.target as WebSocket;
        if (socket && socket !== this.socket) return;

        console.log("api/onMessage", event.data.substr(0,100));
        const args = JSON.parse(event.data);
        const command = args.shift();

        if (command === 'init' && this.connection.state === 'initializing') {
            const [version, store] = args;
            if (version < REQUIRED_EXTENSION_VERSION) {
                this.handleConnectionFailure(`Light Lynx Zigbee2MQTT extension version ${version} is no longer supported. Please update!`);
                return;
            }
            
            // Connection established!
            this.connection.state = 'connected';
            delete this.connection.lastError;
            if (this.connection.mode === 'try') {
                this.connection.mode = 'enabled';
            }
            unproxy(this.connection).attempts = 0; // Don't trigger reconnect by changing this
            clearTimeout(this.connectTimeout);
            this.connectTimeout = undefined;

            copy(this.store, {} as ClientState);
            applyDelta(this.store, store);

            // If we connected without an instance id, replace with the real instance ID
            const server = this.servers[0];
            const realCode = this.store.config.instanceId;
            if (server && !server.instanceId && realCode) {
                server.instanceId = realCode;
            }
            if (server) {
                server.externalPort = this.store.config.externalPort;
            }

            if (this.store.me?.isAdmin && version < RECOMMENDED_EXTENSION_VERSION) {
                this.notify('warning', `Light Lynx Zigbee2MQTT extension version ${version} is outdated. Please consider updating.`);
            }
            this.flushSends(); // Re-send any queued messages after reconnect
        }
        else if (command === 'reply') {
            const [id, response, error] = args;

            const entry = this.awaitingReplies.get(id);
            if (entry) {
                this.awaitingReplies.delete(id);

                // Clear stalling when no more pending work
                if (this.pendingSends.length === 0 && this.awaitingReplies.size === 0) {
                    this.connection.stalling = false;
                    clearTimeout(this.stallingTimeout);
                    this.stallingTimeout = undefined;
                }

                // Schedule prediction drop after the configured delay
                if (entry.prediction) {
                    const delay = error ? 0 : entry.predictionDelay;
                    setTimeout(() => applyCanon(undefined, [entry.prediction!]), delay);
                }

                if (error) {
                    entry.reject(new Error(error));
                } else {
                    entry.resolve(response);
                }
            }
        }
        else if (command === 'store-delta') {
            const [delta] = args;
            // Apply delta as canonical state so it's not affected by prediction rollbacks
            applyCanon(() => applyDelta(this.store, delta));
        }
        else if (command === 'error') {
            this.handleConnectionFailure(args[0] || "Unknown error from server.");
        }
        else {
            console.warn("api/onMessage - unknown command:", command);
        }
    }
}

// Start API instance
const api = new Api();
export default api;
