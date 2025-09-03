import ReconnectingWebSocket from "reconnecting-websocket";
import { proxy, observe, clone, copy, unproxy } from "aberdeen";
import * as colors from "./colors";
import { LightState, XYColor, HSColor, ColorValue, isHS, isXY, Store, LightCaps, Device, Group } from "./types";

const TOKEN_LOCAL_STORAGE_ITEM_NAME = "z2m-token-v2";
const AUTH_FLAG_LOCAL_STORAGE_ITEM_NAME = "z2m-auth-v2";
const UNAUTHORIZED_ERROR_CODE = 4401;

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
        if (cap.color_hs) {
            to.color = from.color;
        }
        else if (cap.color_xy) {
            to.color = colors.hsToXy(from.color as HSColor);
        }
    }
    else if (typeof from.color === 'number') {
        if (cap.color_temp) {
            to.color = from.color;
        }
        else if (cap.color_hs) {
            const hsColor = colors.miredsToHs(from.color);
            to.color = hsColor;
        }
        else if (cap.color_xy) {
            const hsColor = colors.miredsToHs(from.color);
            to.color = colors.hsToXy(hsColor);
        }
    }
    else if (isXY(from.color)) {
        to.color = from.color;
    }
    if (typeof to.color === 'number') {
        to.color = Math.min(cap.color_temp.value_max, Math.max(cap.color_temp.value_min, to.color));
    }

    if (from.brightness != null) {
        if (cap.brightness) {
            to.brightness = Math.min(cap.brightness.value_max, Math.max(cap.brightness.value_min, 1, from.brightness));
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
    return json ? JSON.parse(json) : undefined;
}

class Api {
    url: string;
    socket!: ReconnectingWebSocket;
    requests: Map<string, PromiseCallbacks> = new Map();
    transactionNumber = 1;
    transactionRndPrefix: string;
    store: Store = proxy({
        devices: {},
        groups: {},
        permit_join: false
    });
    errorHandlers: Array<(msg: string) => void> = [];
    nameToIeeeMap: Map<string, string> = new Map();
    
    constructor(url: string) {
        this.url = url;
        this.transactionRndPrefix = (Math.random() + 1).toString(36).substring(2,7);

        for (const topic of ['bridge/devices', 'bridge/groups']) {
            let data = localStorage.getItem(topic);
            if (data) this.onMessage({data} as MessageEvent);
        }
    }
    
    send = (...topicAndPayload: any[]): Promise<void> => {
        let payload: any = topicAndPayload.pop()
        let topic = topicAndPayload.join("/")
        console.log("api/send", topic, payload);

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


    urlProvider = async () => {
        const url = new URL(this.url)
        let token = new URLSearchParams(window.location.search).get("token")
            ?? getLocalStorage(TOKEN_LOCAL_STORAGE_ITEM_NAME) as string;
        const authRequired = !!getLocalStorage(AUTH_FLAG_LOCAL_STORAGE_ITEM_NAME);
        if (authRequired) {
            if (!token) {
                token = prompt("Enter your z2m admin token") as string;
                if (token) {
                    setLocalStorage(TOKEN_LOCAL_STORAGE_ITEM_NAME, token);
                }
            }
            url.searchParams.append("token", token);
        }
        return url.toString();
    }

    connect(): void {
        this.socket = new ReconnectingWebSocket(this.urlProvider);
        this.socket.addEventListener("message", this.onMessage);
        this.socket.addEventListener("close", this.onClose as any);
    }

    private resolvePromises({transaction, status}: any): void {
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

    private onClose = (e: Event): void => {
        const closeEvent = e as CloseEvent;
        if (closeEvent.code === UNAUTHORIZED_ERROR_CODE) {
            setLocalStorage(AUTH_FLAG_LOCAL_STORAGE_ITEM_NAME, true);
            localStorage.removeItem(TOKEN_LOCAL_STORAGE_ITEM_NAME);
            for(let handler of this.errorHandlers) {
                handler("Unauthorized");
            }
            setTimeout(() => {
                window.location.reload();
            }, 1000);
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

        console.log("api/handleLightState", ieee, lightState);

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
        observe(() => {
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
                    const cap = (groupCaps[name] ||= clone(obj));
                    if (obj.value_min != null) {
                        cap.value_min = Math.min(cap.value_min, obj.value_min);
                        cap.value_max = Math.max(cap.value_max, obj.value_max);
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
            console.log('api/streamGroupState update', groupId, groupState);
            if (groupState && group) {
                copy(group.lightState, groupState);
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

    private onMessage = (event: MessageEvent): void => {
        let {topic, payload} = JSON.parse(event.data);
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
                this.store.permit_join = payload.permit_join;
            }  
            else if (topic === "info" || topic === "extensions" || topic === "logging") {
                // Ignore!
            }
            else if (topic === "devices") {
                let newDevs: Record<string, Device> = {};
                for (let z2mDev of payload) {
                    if (!z2mDev.definition) continue;
                    let description = (z2mDev.definition.description || z2mDev.model_id) + " (" + (z2mDev.definition.vender || z2mDev.manufacturer) + ")";
                    let newDev : Device = {name: z2mDev.friendly_name, description};
                    for (let expose of z2mDev.definition.exposes) {
                        if (expose.type === "light" || expose.type === "switch") {
                            let features: any = {};
                            for (let feature of (expose.features || [])) {
                                features[feature.name] = {};
                                if (feature.value_max !== undefined) {
                                    features[feature.name].value_min = feature.value_min;
                                    features[feature.name].value_max = feature.value_max;
                                }
                            }
                            newDev.lightCaps = features;
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
                        shortName: z2mGroup.friendly_name.replace(/ *\(.*\) *$/, ''),
                        scenes: z2mGroup.scenes.map((obj: any) => {
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

const api = new Api(`${location.protocol==='https:' ? 'wss' : 'ws'}://z2m.vanviegen.net/api`);
export default api;
