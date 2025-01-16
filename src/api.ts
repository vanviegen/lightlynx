import ReconnectingWebSocket from "reconnecting-websocket";
import { local } from "@toolz/local-storage";
import { Store, observe, peek } from "aberdeen";
import * as colors from "./colors";

const TOKEN_LOCAL_STORAGE_ITEM_NAME = "z2m-token-v2";
const AUTH_FLAG_LOCAL_STORAGE_ITEM_NAME = "z2m-auth-v2";
const UNAUTHORIZED_ERROR_CODE = 4401;


interface Callable {
    (): void;
}

interface LightState {
    on?: boolean,
    level?: number,
    color?: number|Array<number>,
}

function objectIsEmpty(obj) {
    for(let k in obj) return false;
    return true;
}

function createLightStateDelta(o: LightState, n: LightState): any {
    let delta: any = {}
    if (n.on != null && o.on !== n.on) {
        delta.state = n.on ? 'ON' : 'OFF';
    }
    if (n.level != null && o.level !== n.level) {
        delta.brightness = n.level;
    }
    if (n.color != null && o.color !== n.color && JSON.stringify(o.color) !== JSON.stringify(n.color)) {
        if (n.color instanceof Array) {
            delta.color = {hue: Math.round(n.color[0]), saturation: Math.round(n.color[1]*100)}
        }
        else if (n.color.x != null) {
            delta.color = n.color
        }
        else {
            delta.color_temp = n.color
        }
    }
    return delta;
}

function tailorLightState(from: LightState, cap: any): LightState {
    let to: LightState = {};

    if (from.on != null) {
        to.on = from.on;
    }

    if (from.color instanceof Array) {
        if (cap.color_hs) {
            to.color = from.color;
        }
        else if (cap.color_xy) {
            to.color = colors.hsToXy(from.color);
        }
        // else if (cap.color_temp) {
        //     // Convert hue/sat to closest color temperature
        //     to.color = colors.rgbToMireds(colors.hsvToRgb(from.color[0], from.color[1], 1))
        // }
    }
    else if (typeof from.color === 'number') {
        if (cap.color_temp) {
            to.color = from.color;
        }
        else if (cap.color_hs) {
            // Convert color temperature to hue/sat
            to.color = colors.miredsToHs(from.color);
        }
        else if (cap.color_xy) {
            to.color = colors.hsToXy(colors.miredsToHs(from.color));
        }
    }
    if (typeof to.color === 'number') {
        to.color = Math.min(cap.color_temp.value_max, Math.max(cap.color_temp.value_min, to.color));
    }
    
    if (from.level != null) {
        if (cap.brightness) {
            to.level = Math.min(cap.brightness.value_max, Math.max(cap.brightness.value_min, 1, from.level));
        }
    }
    console.log('api/tailorLightState', 'from', from, 'to', to, 'cap', cap)

    return to;
}

class Api {
    url: string;
    socket: ReconnectingWebSocket;
    requests: Map<string, [Callable, Callable]> = new Map<string, [Callable, Callable]>();
    transactionNumber = 1;
    transactionRndPrefix: string;
    store: Store = new Store({});
    errorHandlers: Array<(msg: string) => void> = [];
    nameToIeeeMap: Map<string, string> = new Map();
    
    constructor(url: string) {
        this.url = url;
        this.transactionRndPrefix = (Math.random() + 1).toString(36).substring(2,7);

        for(let topic of ['bridge/devices', 'bridge/groups']) {
            let data = localStorage.getItem(topic);
            if (data) this.onMessage({data});
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
                this.requests.set(transaction, [resolve, reject]);
            });
            payload = { ...payload, transaction };
        } else {
            promise = Promise.resolve();
        }
        let message = JSON.stringify({topic, payload}, (_, v) => v === undefined ? null : v);
        this.socket.send(message);
        return promise;
    }

    setLightState(target: string|number, state: LightState) {
        console.log('api/setLightState', target, state)

        if (typeof target === 'number') { // target is a group
            let groupId: number = target;
            for(let ieee of this.store.peek("groups", groupId, "members") || []) {
                this.setLightState(ieee, state)
            }
            return;
        }

        // target is a light
        let ieee: string = target;
        let cap = this.store.peek("devices", ieee, "light");
        if (!cap) {
            console.log('api/setLightState invalid target', target)
        }
        state = tailorLightState(state, cap);
        let oldState = this.store.peek("devices", ieee, "state") || {};

        let delta = createLightStateDelta(oldState, state);
        if (!objectIsEmpty(delta)) {
            console.log('merge', this.store.get("devices", ieee, "state"), state)
            this.store.ref("devices", ieee, "state").merge(state);
            let held = this.heldLightDeltas.get(ieee);
            if (held != null) {
                Object.assign(held, delta);
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
            ?? local.getItem<string>(TOKEN_LOCAL_STORAGE_ITEM_NAME);
        const authRequired = !!local.getItem(AUTH_FLAG_LOCAL_STORAGE_ITEM_NAME);
        if (authRequired) {
            if (!token) {
                token = prompt("Enter your z2m admin token") as string;
                if (token) {
                    local.setItem(TOKEN_LOCAL_STORAGE_ITEM_NAME, token);
                }
            }
            url.searchParams.append("token", token);
        }
        return url.toString();
    }

    connect(): void {
        this.socket = new ReconnectingWebSocket(this.urlProvider);
        this.socket.addEventListener("message", this.onMessage);
        this.socket.addEventListener("close", this.onClose);
    }

    private resolvePromises({transaction, status}): void {
        if (transaction !== undefined && this.requests.has(transaction)) {
            const [resolve, reject] = this.requests.get(transaction) as [Callable, Callable];
            if (status === "ok" || status === undefined) {
                resolve();
            } else {
                reject();
            }
            this.requests.delete(transaction);
        }
    }

    private onClose = (e: CloseEvent): void => {
        if (e.code === UNAUTHORIZED_ERROR_CODE) {
            local.setItem(AUTH_FLAG_LOCAL_STORAGE_ITEM_NAME, true);
            local.remove(TOKEN_LOCAL_STORAGE_ITEM_NAME);
            for(let handler of this.errorHandlers) {
                handler("Unauthorized");
            }
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        }
    }

    // Used to send at most 3 updates per second to zigbee2mqtt
    heldLightDeltas: Map<string, any> = new Map();
    heldLightTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

    // Used to delay updates from zigbee2mqtt shortly after we've ask it to update state,
    // as it's probably just an echo, and perhaps its echoing an older value than our latest
    // update, which would interfere with sliding in our UI.
    echoTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
    echoLightStates: Map<string, LightState> = new Map();

    private handleLightState(ieee: string, payload: any) {
        let data : LightState = {
            on: payload.state === 'ON',
            level: payload.brightness,
            color: undefined,
        };
        if (payload.color_mode === 'color_temp') {
            data.color = payload.color_temp;
        }
        else if (payload.color?.hue) {
            data.color = [payload.color.hue, payload.color.saturation/100];
        }
        else if (payload.color?.x) {
            data.color = payload.color
        }

        console.log("api/handleLightState", ieee, data);

        if (this.echoTimeouts.get(ieee)) { // Echo paused, delay set
            this.echoLightStates.set(ieee, data);
        }
        else { // Echo unpaused, apply immediately
            this.store.set("devices", ieee, "state", data);
        }
    }

    private streamGroupState(groupId: number) {
        observe(() => {
            // In case a group disappeared, this will cause the observe to end without
            // observing anything anymore.
            if (peek(() => this.store.getType("groups", groupId, "members")) === "undefined") return;
            let members = this.store.get("groups", groupId, "members");
            
            let gstate: LightState = members.length ? this.store.get("devices", members[0], "state") || {} : {};
            let caps = members.length ? this.store.peek("devices", members[0], "light") : {};
            
            for(let memberIndex=1; memberIndex<members.length; memberIndex++) {
                let ieee = members[memberIndex];

                for(let [name,obj] of <any>Object.entries(this.store.peek("devices", ieee, "light")||{})) {
                    caps[name] = caps[name] || obj;
                    if (obj.value_min != null) {
                        caps[name].value_min = Math.min(caps[name].value_min, obj.value_min);
                        caps[name].value_max = Math.max(caps[name].value_max, obj.value_max);
                    }
                }
                
                let lstate: LightState = this.store.get("devices", ieee, 'state') || {};
                if (!lstate || !gstate) continue;

                // If one light is on, the group is on.
                gstate.on = gstate.on || lstate.on;

                if (typeof gstate.color === 'number' && typeof lstate.color === 'number' && Math.abs(gstate.color-lstate.color)<10) {
                    // Color temp similar enough! Take the average.
                    gstate.color = Math.round((gstate.color * memberIndex + lstate.color) / (memberIndex+1));
                }
                else if ((gstate.color instanceof Array) && (lstate.color instanceof Array) && Math.abs(lstate.color[0]-gstate.color[0])<20 && Math.abs(lstate.color[1]-gstate.color[1])<0.1) {
                    // Hue/saturation are close enough! Take the average.
                    gstate.color[0] = Math.round((gstate.color[0] * memberIndex + lstate.color[0]) / (memberIndex+1));
                    gstate.color[1] = Math.round((gstate.color[1] * memberIndex + lstate.color[1]) / (memberIndex+1));
                } else {
                    gstate.color = undefined;
                }

                if (gstate.level!==undefined && lstate.level!==undefined && Math.abs(gstate.level - lstate.level) < 0.2) {
                    gstate.level = Math.round((gstate.level * memberIndex + lstate.level) / (memberIndex+1));
                } else {
                    gstate.level = undefined;
                }
            }
            console.log('api/streamGroupState update', groupId, gstate);
            if (gstate) {
                this.store.set("groups", groupId, "state", gstate);
            }
            this.store.set("groups", groupId, "light", caps);
        });
    }

    private transmitHeldLightDelta(ieee: string) {
        let delta = this.heldLightDeltas.get(ieee);
        if (!objectIsEmpty(delta)) {
            console.log('api/transmitHeldLightDelta', ieee, 'to', delta);
            delta.transition = 0.333;
            this.send(ieee, "set", delta);

            this.heldLightDeltas.set(ieee, {});
            this.heldLightTimeouts.set(ieee, setTimeout(() => this.transmitHeldLightDelta(ieee), 333));

            console.log('api/pause echos', ieee);
            clearTimeout(this.echoTimeouts.get(ieee));
            this.echoTimeouts.set(ieee, setTimeout(() => {
                console.log('api/unpause echos', ieee);
                this.echoTimeouts.delete(ieee)
                this.store.set("devices", ieee, "state", this.echoLightStates.get(ieee));
            }, 1500));
        }
        else {
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
                this.store.set("permit_join", payload.permit_join);
            }  
            else if (topic === "info" || topic === "extensions" || topic === "logging") {
                // Ignore!
            }
            else if (topic === "devices") {
                let devices = {};
                for (let orgDev of payload) {
                    if (!orgDev.definition) continue;
                    let description = (orgDev.definition.description || orgDev.model_id) + " (" + (orgDev.definition.vender || orgDev.manufacturer) + ")";
                    let newDev : {name: string, description: string, light?: object, actions?: Array<string>} = {name: orgDev.friendly_name, description};
                    for (let expose of orgDev.definition.exposes) {
                        if (expose.type === "light" || expose.type === "switch") {
                            let features = {};
                            for (let feature of (expose.features || [])) {
                                features[feature.name] = {};
                                if (feature.value_max !== undefined) {
                                    features[feature.name].value_min = feature.value_min;
                                    features[feature.name].value_max = feature.value_max;
                                }
                            }
                            newDev.light = features;
                        }
                        else if (expose.name === "action") {
                            newDev.actions = expose.values;
                        }
                    }
                    let ieee = orgDev.ieee_address;
                    newDev.state = this.store.get("devices", ieee, "state")
                    newDev.meta = this.store.get("devices", ieee, "meta")
            
                    devices[ieee] = newDev;
                    this.nameToIeeeMap.set(newDev.name, ieee);
                }
                this.store.set("devices", devices);
            }
            else if (topic === "groups") {
                let groups = new Map();
                let newGroupIds: Array<number> = [];
                for (let orgGroup of payload) {
                    let newGroup = {
                        name: orgGroup.friendly_name,
                        short_name: orgGroup.friendly_name.replace(/ *\(.*\) *$/, ''),
                        scenes: orgGroup.scenes.map(obj => {
                            let m = obj.name.match(/^(.*?)\s*\((.*)\)\s*$/)
                            if (m)
                                return {id: obj.id, name: obj.name, short_name: m[1], suffix: m[2]}
                            return {id: obj.id, name: obj.name, short_name: obj.name, suffix: ''}
                        }),
                        members: orgGroup.members.map(obj => obj.ieee_address),
                    };
                    newGroup.state = this.store.get('groups', orgGroup.id, "state")
                    newGroup.light = this.store.get('groups', orgGroup.id, "light")
                    groups.set(orgGroup.id, newGroup);
                    if (this.store.peek("groups", orgGroup.id, "name") == null) {
                        newGroupIds.push(orgGroup.id);
                    }
                }
                this.store.set("groups", groups);
                for(let groupId of newGroupIds) {
                    this.streamGroupState(groupId);
                }
            }
            else {
                this.store.set(...topic.split('/'), payload);
            }
        } else {
            if (topic.endsWith("/availability")) {
                let deviceName = topic.substr(0,topic.length-13);
                let ieee = this.nameToIeeeMap.get(deviceName);
                if (ieee) {
                    this.store.set("devices", ieee, "meta", "online", payload.state==="online");
                }
            }
            else { // A device state
                let ieee = this.nameToIeeeMap.get(topic);
                if (payload && ieee) {
                    if (payload.update) {
                        payload.update = payload.update.state;
                    }
                    for(let key of ['battery', 'linkquality', 'update']) {
                        if (payload[key]!=null) {
                            this.store.set("devices", ieee, "meta", key, payload[key]);
                            delete payload[key];
                        }
                    }
                
                    if (payload.state) { // A light state
                        this.handleLightState(ieee, payload)
                    } else { // Some other device state
                        this.store.set("devices", ieee, "state", payload);
                    }
                }
            }
        }
    }
}

const api = new Api(`${location.protocol==='https:' ? 'wss' : 'ws'}://z2m.vanviegen.net/api`);
export default api;
