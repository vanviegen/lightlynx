import { $, proxy, clone, copy, unproxy, peek, merge, onEach } from "aberdeen";
import { applyPrediction, applyCanon } from "aberdeen/prediction";
import * as route from "aberdeen/route";
import { isHS, tailorLightState }  from "./colors";
import { LightState, LightCaps, ServerCredentials, Config, GroupWithDerives, ClientState, User } from "./types";
import { applyDelta } from "./json-merge-patch";

const REQUIRED_EXTENSION_VERSION = 1;
const RECOMMENDED_EXTENSION_VERSION = 1;

interface PromiseCallbacks {
    resolve: (result: any) => void;
    reject: (err: Error) => void;
}

function ipToHexDomain(ip: string): string {
    const parts = ip.split('.');
    if (parts.length !== 4) return ip;
    if (parts.some(p => isNaN(parseInt(p)))) return ip;
    const hex = parts.map(p => parseInt(p).toString(16).padStart(2, '0')).join('');
    return `x${hex}.lightlynx.eu`;
}

function createFreshStoreState() {
    return {
        lights: {},
        toggles: {},
        groups: {},
        permitJoin: false,
        config: {} as Config,
        extensionVersion: 0,
    };
}

class Api {
    private socket?: WebSocket; // Current active socket

    private tryingSockets?: Set<WebSocket>; // One or two sockets trying to connect
    
    private awaitingTransactions: Map<number, PromiseCallbacks> = new Map();
    private transactionCount = 0;

    private connectTimeout?: ReturnType<typeof setTimeout>;

    store: ClientState = proxy(createFreshStoreState());

    servers: ServerCredentials[] = proxy([]); // Preserved to localStorage. servers[0] is the current server.

    connection: {
        mode: 'enabled' | 'disabled' | 'try';
        state: "idle" | "connecting" | "initializing" | "connected" | "reconnecting";
        lastError?: string;
        attempts: number;
    } = proxy({ mode: 'enabled', state: 'idle', attempts: 0 });

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
            if (data) merge(this.store, JSON.parse(data));
        } catch(e) {
            console.error("Failed to load lightlynx-store from localStorage:", e);
        }
        
        // Persist servers list to localStorage on changes
        $(() => {
            const json = JSON.stringify(this.servers);
            setTimeout(() => {
                localStorage.setItem("lightlynx-servers", json);
            }, 250); // Delay- don't keep UI thread busy during events
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

        // Auto-connect from URL parameters
        // As we're not in any scope, this peek shouldn't do anything, but just for clarity:
        peek(() => {
            const initialHost = route.current.search.host;
            const initialUserName = route.current.search.userName;
            if (!initialHost || !initialUserName) return;
            const initialSecret = route.current.search.secret;

            console.log('Auto-connecting from URL parameters:', initialHost, initialUserName);
            let server = this.servers.find(s => s.localAddress === initialHost && s.userName === initialUserName);
            if (server) {
                if (initialSecret) server.secret = initialSecret;
                const index = this.servers.indexOf(server);
                if (index > 0) {
                    this.servers.splice(index, 1);
                    this.servers.unshift(server);
                }
            } else {
                this.servers.unshift({localAddress: initialHost, userName: initialUserName, secret: initialSecret || ''});
                this.connection.mode = 'enabled';
            }
            // Remove from the route
            delete route.current.search.host;
            delete route.current.search.userName;
            delete route.current.search.secret;
        });
                
        // Flush store when changing server
        let prevLocalAddress = peek(() => this.servers[0]?.localAddress);
        $(() => {
            if (this.servers[0]?.localAddress !== prevLocalAddress) {
                prevLocalAddress = this.servers[0]?.localAddress;
                copy(this.store, createFreshStoreState());
            }
        })

        // Connect and disconnect/reconnect as servers[0] changes
        $(() => {
            const server = this.servers[0];
            this.disconnect();
            
            if (server && this.connection.mode !== 'disabled') {
                // Whenever connection.attempts changes, try to connect again
                this.connection.attempts;
                this.connect({
                    localAddress: server.localAddress,
                    externalAddress: peek(server, 'externalAddress'), // Don't trigger reconnect when this changes
                    userName: server.userName,
                    secret: server.secret,
                });
            }
        });

        $(() => {
            onEach(this.store.groups, this.deriveGroupLightState.bind(this));
        })
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
        
        this.connection.state = 'idle';
    }

    private connect(creds: { localAddress: string; externalAddress?: string; userName?: string; secret?: string }): void {
        console.log("api/connect", creds.localAddress);
        
        this.connection.state = 'connecting';
        
        // Timeout for connection attempt
        this.connectTimeout = setTimeout(() => {
            this.handleConnectionFailure("Connection timed out.");
        }, 4000);

        this.tryingSockets = new Set();
        for (const addr of [creds.localAddress, creds.externalAddress]) {
            if (!addr) continue;
            const hostname = ipToHexDomain(addr.split(':')[0]!);
            const port = parseInt(addr.split(':')[1] || '43597');

            // Use ws:// if page loaded over http://, otherwise wss://
            const protocol = location.protocol === 'http:' ? 'ws' : 'wss';
            const url = new URL(`${protocol}://${hostname}:${port}/api`);
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
            
            socket.addEventListener("error", (e) => {
                console.error("api/onError", socket.url, e);
                close(`Connection error: ${e}.`);
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
        this.connection.lastError = errorMessage;
        
        if (this.connection.mode === 'try') {
            // Single attempt mode: disable on failure
            this.connection.mode = 'disabled';
            this.connection.state = 'idle';
        } else if (this.connection.mode === 'enabled') {
            // Persistent mode: schedule retry with exponential backoff
            const delay = Math.min(500 * Math.pow(2, this.connection.attempts), 16000);
            console.log(`api/scheduleReconnect in ${delay}ms (attempt ${this.connection.attempts + 1})`);
            this.connection.state = 'reconnecting';
            this.connectTimeout = setTimeout(() => {
                this.connectTimeout = undefined;
                this.connection.attempts++; // Cause reactive method in constructor to reconnect
            }, delay);
        } else {
            this.connection.state = 'idle';
        }
    }

    async send(...commandAndArgs: any[]): Promise<void> {
        console.log("api/send", commandAndArgs);

        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.warn("api/send - WebSocket not connected, message dropped");
            throw new Error("WebSocket not connected");
        }

        const id = ++this.transactionCount;
        commandAndArgs.unshift(id);
        this.socket.send(JSON.stringify(commandAndArgs));

        await new Promise<void>((resolve, reject) => {
            this.awaitingTransactions.set(id, { resolve, reject });
            setTimeout(() => {
                if (this.awaitingTransactions.has(id)) {
                    this.awaitingTransactions.delete(id);
                    reject(new Error("Request timed out"));
                }
            }, 5000);
        });
    }

    recallScene(groupId: number, sceneId: number) {
        api.send("scene", groupId, "recall", sceneId);

        // Do a local prediction, that we'll keep around for 6s or until the server responds
        const patch = applyPrediction(() => {
            const group = api.store.groups[groupId];
            if (!group) return;
            const scene = group.scenes[sceneId];
            if (!scene || !scene.lightStates) return;
            for (const [ieee, lightState] of Object.entries(scene.lightStates)) {
                const light = api.store.lights[ieee];
                if (!light) continue;
                copy(light.lightState, tailorLightState(lightState, light.lightCaps));
            }
        });
        
        // Revert prediction after 6s. (Usually, the prediction will be dropped earlier if the server responds with new values.)
        setTimeout(() => applyCanon(undefined, [patch]), 6000);        
    }

    /**
     * Request a light state change from user input.
     * Applies optimistic update immediately, then queues for server transmission.
     */
    setLightState(target: string | number, lightState: LightState) {
        console.log('api/setLightState', target, lightState);

        // Do a local prediction, that we'll keep around for 3s or until the server responds
        // with any conflicting or affirming state.
        const patch = applyPrediction(() => {
            if (typeof target === 'number') {
                // A group
                const group = this.store.groups[target];
                if (!group) return;
                for(const ieee of group.lightIds) {
                    const light = this.store.lights[ieee];
                    if (!light) continue;
                    copy(light.lightState, tailorLightState(lightState, light.lightCaps));
                }
            } else {
                // A single light
                const light = this.store.lights[target];
                if (!light) return;
                copy(light.lightState, tailorLightState(lightState, light.lightCaps));
            }
        });
        
        // Revert prediction after 3s. (Usually, the prediction will be dropped earlier if the server responds with new values.)
        setTimeout(() => applyCanon(undefined, [patch]), 3000);


        // Send the state, but at most 3 times per second per target
        const actuallySendState = () => {
            const value = this.setLightStateObjects.get(target);
            if (value) {
                this.send('set-state', target, value);
                this.setLightStateTimers.set(target, setTimeout(actuallySendState, 333));
                this.setLightStateObjects.delete(target);
            } else {
                this.setLightStateTimers.delete(target);
            }
        }

        const org = this.setLightStateObjects.get(target) || {};
        this.setLightStateObjects.set(target, { ...org, ...lightState });

        actuallySendState();
    }

    private setLightStateObjects: Map<string|number, LightState> = new Map();
    private setLightStateTimers: Map<string|number, ReturnType<typeof setTimeout>> = new Map();

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
            
            // Merge lightState into groupState
            const lightState = light.lightState;
            groupState.on = groupState.on || lightState.on;

            if (typeof groupState.color === 'number' && typeof lightState.color === 'number' && Math.abs(groupState.color-lightState.color)<10) {
                // Color temp similar enough! Take the average.
                groupState.color = Math.round((groupState.color * lightIndex + lightState.color) / (lightIndex+1));
            }
            else if (isHS(groupState.color) && isHS(lightState.color) && Math.abs(lightState.color.hue-groupState.color.hue)<20 && Math.abs(lightState.color.saturation-groupState.color.saturation)<0.1) {
                // Hue/saturation are close enough! Take the average.
                groupState.color.hue = Math.round((groupState.color.hue * lightIndex + lightState.color.hue) / (lightIndex+1));
                groupState.color.saturation = Math.round((groupState.color.saturation * lightIndex + lightState.color.saturation) / (lightIndex+1));
            } else {
                groupState.color = undefined;
            }

            if (groupState.brightness!==undefined && lightState.brightness!==undefined && Math.abs(groupState.brightness - lightState.brightness) < 0.2) {
                groupState.brightness = Math.round((groupState.brightness * lightIndex + lightState.brightness) / (lightIndex+1));
            } else {
                groupState.brightness = undefined;
            }
        }
        copy(group, 'lightCaps', groupCaps);
        copy(group, 'lightState', groupState);

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
        const prediction = applyPrediction(() => {
            copy(this.store.config, patch);
        })
        await this.send('patch-config', patch);
        applyCanon(undefined, [prediction]);
    }

    updateUser(user: User): Promise<void> {
        return this.send('patch-config', {users: {[user.name]: user}})
    }

    deleteUser(userName: string): Promise<void> {
        return this.send('patch-config', {users: {[userName]: null}});
    }

    /**
     * Check if the current user can control a group (reactive)
     */
    canControlGroup(groupId: number): boolean {
        return this.store.me ? (this.store.me.isAdmin || this.store.me.allowedGroupIds.includes(groupId)) : false;
    }

    private onMessage = (event: MessageEvent): void => {
        const socket = event.target as WebSocket;
        if (socket && socket !== this.socket) return;

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

            applyDelta(this.store, store);
            if (this.store.me?.isAdmin && version < RECOMMENDED_EXTENSION_VERSION) {
                this.notify('warning', `Light Lynx Zigbee2MQTT extension version ${version} is outdated. Please consider updating.`);
            }
        }
        else if (command === 'reply') {
            const [id, response, error] = args;

            const promises = this.awaitingTransactions.get(id);
            if (promises) {
                if (error) {
                    promises.reject(new Error(error));
                } else {
                    promises.resolve(response);
                }
                this.awaitingTransactions.delete(id);
            }
        }
        else if (command === 'store-delta') {
            const [delta] = args;
            applyDelta(this.store, delta);
        }
        else {
            console.warn("api/onMessage - unknown command:", command);
        }
    }
}

// Start API instance
const api = new Api();
export default api;
