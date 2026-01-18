/**
 * Sunrise/sunset script logic and LightLynxAutomation logic transposed to TS
 */

const defaultZenith = 90.8333;
const degreesPerHour = 360 / 24;
const msecInDay = 8.64e7;

function getDayOfYear(date: Date) {
  return Math.ceil((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / msecInDay);
}

function sinDeg(deg: number) { return Math.sin(deg * 2.0 * Math.PI / 360.0); }
function acosDeg(x: number) { return Math.acos(x) * 360.0 / (2 * Math.PI); }
function asinDeg(x: number) { return Math.asin(x) * 360.0 / (2 * Math.PI); }
function tanDeg(deg: number) { return Math.tan(deg * 2.0 * Math.PI / 360.0); }
function cosDeg(deg: number) { return Math.cos(deg * 2.0 * Math.PI / 360.0); }
function mod(a: number, b: number) { const r = a % b; return r < 0 ? r + b : r; }

function calculate(latitude: number, longitude: number, isSunrise: boolean, zenith: number, date: Date) {
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

function getSunrise(lat: number, lon: number, zenith?: number, date?: Date) { return calculate(lat, lon, true, zenith || defaultZenith, date || new Date()); }
function getSunset(lat: number, lon: number, zenith?: number, date?: Date) { return calculate(lat, lon, false, zenith || defaultZenith, date || new Date()); }

function parseTimeRange(str: string) {
    let m = str.trim().match(/^([0-9]{1,2})(:([0-9]{2}))?((b|a)(s|r))?$/);
    if (!m) return 0;
    let hour = 0 | parseInt(m[1]!);
    let minute = 0 | parseInt(m[3] || '0');
    let beforeAfter = m[5];
    let riseSet = m[6];

    if (riseSet) {
        let sunTime = (riseSet==='r' ? getSunrise : getSunset)(52.24, 6.88);
        if (sunTime) {
            if (beforeAfter==='a') {
                hour += sunTime.getHours();
                minute += sunTime.getMinutes();
            } else {
                hour = sunTime.getHours() - hour;
                minute = sunTime.getMinutes() - minute;
            }
        }
    }
    hour += Math.floor(minute / 60);
    hour = ((hour%24) + 24) % 24;
    minute = ((minute%60) + 60) % 60;
    return hour * 60 + minute;
}

function checkTimeRange(startStr: string, endStr: string) {
    let start = parseTimeRange(startStr);
    let end = parseTimeRange(endStr);
    if (end < start) end += 24 * 60;
    let now = new Date();
    let nowMins = now.getHours() * 60 + now.getMinutes();
    if (nowMins < start) nowMins += 24 * 60;
    if (nowMins >= start && nowMins <= end) return end - start;
    return null;
}

const clickCountsConfig: Record<string, number> = {single: 1, double: 2, triple: 3, quadruple: 4, many: 5};

interface Scene {
    id: number;
    name: string;
    start?: string;
    end?: string;
}

interface Group {
    name: string;
    scenes: Record<string, Scene[]>;
    timeout: number;
    timer: NodeJS.Timeout | undefined;
    touch: () => void;
}

class LightLynxAutomation {
    private zigbee: any;
    private mqtt: any;
    private state: any;
    private settings: any;
    private eventBus: any;
    private mqttBaseTopic: string = '';
    private clickCounts: Map<string, number> = new Map();
    private clickTimers: Map<string, NodeJS.Timeout> = new Map();
    private groups: Record<string, Group> = {};
    private lastTimedSceneIds: Record<string, number | undefined> = {};
    private timeInterval?: NodeJS.Timeout;

    constructor(zigbee: any, mqtt: any, state: any, _publishEntityState: any, eventBus: any, _enableDisableExtension: any, _restartCallback: any, _addExtension: any, settings: any, _logger: any) {
        this.zigbee = zigbee;
        this.mqtt = mqtt;
        this.state = state;
        this.eventBus = eventBus;
        this.settings = settings;
    }

    start() {
        this.mqttBaseTopic = this.settings.get().mqtt.base_topic;
        this.eventBus.onStateChange(this, this.onStateChange.bind(this));
        this.eventBus.onScenesChanged(this, this.loadScenes.bind(this));
        this.eventBus.onGroupMembersChanged(this, this.loadScenes.bind(this));
        this.timeInterval = setInterval(this.handleTimeTriggers.bind(this), 10000);
        this.loadScenes();
    }

    stop() {
        this.eventBus.removeListeners(this);
        if (this.timeInterval) clearInterval(this.timeInterval);
        for(let group of Object.values(this.groups)) {
            clearTimeout(group.timer);
        }
    }

    loadScenes() {
        let groups: Record<string, Group> = {};
        for(let zigbeeGroup of this.zigbee.groupsIterator()) {
            let resultScenes: Record<string, Scene[]> = {};
            let discovered: Record<number, boolean> = {};
            for(let endpoint of zigbeeGroup.zh.members) {
                let scenes = endpoint.meta?.scenes; 
                for(let key in scenes) {
                    let groupId = parseInt(key.split('_')[1]!);
                    if (groupId === zigbeeGroup.ID) {
                        for(let scene of scenes[key]) {
                            if (!discovered[scene.id]) {
                                discovered[scene.id] = true;
                                let m = scene.name.match(/^(.*?)\s*\((.*)\)\s*$/)
                                if (m) {
                                    let trigger = m[2];
                                    let timeMatch = trigger.match(/^([0-9arbse:]+)-([0-9arbse:]+)$/);
                                    if (timeMatch) {
                                        (resultScenes.time = resultScenes.time || []).push({id: scene.id, name: scene.name, start: timeMatch[1], end: timeMatch[2]});
                                    } else {
                                        (resultScenes[trigger] = resultScenes[trigger] || []).push({id: scene.id, name: scene.name});
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (Object.keys(resultScenes).length) {
                let timeout = 0;
                let m = (zigbeeGroup.description || '').match(/lightlynx-timeout\s+([0-9]+)(s|m|h)/)
                if (m) {
                    timeout = parseInt(m[1]);
                    if (m[2]==='m') timeout *= 60;
                    if (m[2]==='h') timeout *= 3600;
                }

                groups[zigbeeGroup.name] = {
                    name: zigbeeGroup.name,
                    scenes: resultScenes,
                    timeout: timeout,
                    timer: undefined,
                    touch: function(this: any) {
                        clearTimeout(this.timer);
                        if (this.timeout) {
                            this.timer = setTimeout(() => {
                                this.mqtt.onMessage(`${this.mqttBaseTopic}/${this.name}/set`, JSON.stringify({state: 'OFF', transition: 30}));
                            }, this.timeout * 1000);
                        }
                    }.bind({name: zigbeeGroup.name, timeout, mqtt: this.mqtt, mqttBaseTopic: this.mqttBaseTopic})
                };
            }
        }
        this.groups = groups;
    }

    onStateChange(data: any) {
        let group = this.groups[data.entity.name];
        if (group && data.update.state === 'ON') group.touch();
        if (data.update.action) {
            let action = data.update.action;
            let m = (data.entity.description || '').match(/lightlynx-groups\s+([0-9,]+)/)
            if (m) {
                let groupIds = m[1].split(',').map((id: string) => parseInt(id));
                for(let groupId of groupIds) {
                    let zigbeeGroup = this.zigbee.groupByID(groupId);
                    if (zigbeeGroup) this.handleAction(zigbeeGroup.name, action);
                }
            }
        }
    }

    handleAction(shortGroupName: string, action: string) {
        let key = shortGroupName + action;
        let count = (this.clickCounts.get(key) || 0) + 1;
        this.clickCounts.set(key, count);
        if (this.clickTimers.has(key)) clearTimeout(this.clickTimers.get(key));
        this.clickTimers.set(key, setTimeout(() => {
            this.executeAction(shortGroupName, action, count);
            this.clickCounts.delete(key);
        }, 300));
    }

    executeAction(shortGroupName: string, action: string, count: number) {
        let group = this.groups[shortGroupName];
        if (!group) return;
        let triggerNames = [action];
        for(let name in clickCountsConfig) if (clickCountsConfig[name] === count) triggerNames.push(name);
        for(let triggerName of triggerNames) {
            let scenes = group.scenes[triggerName];
            if (scenes && scenes[0]) {
                group.touch();
                this.mqtt.onMessage(`${this.mqttBaseTopic}/${shortGroupName}/set`, JSON.stringify({scene_recall: scenes[0].id}));
                return;
            }
        }
        if (count === 1) {
            let state = this.state.get(this.zigbee.groupByName(shortGroupName));
            let newState = state.state === 'ON' ? 'OFF' : 'ON';
            this.mqtt.onMessage(`${this.mqttBaseTopic}/${shortGroupName}/set`, JSON.stringify({state: newState}));
        }
    }

    handleTimeTriggers() {
        for(let shortGroupName in this.groups) {
            let group = this.groups[shortGroupName]!;
            let newState: any;
            let scene = this.findScene(shortGroupName, 'time');
            if (scene) {
                group.touch();
                if (this.lastTimedSceneIds[shortGroupName] !== scene.id) {
                    newState = { scene_recall: scene.id };
                    this.lastTimedSceneIds[shortGroupName] = scene.id;
                }
            } else {
                if (this.lastTimedSceneIds[shortGroupName] !== undefined) {
                    newState = {state: 'OFF'};
                    this.lastTimedSceneIds[shortGroupName] = undefined;
                }
            }
            if (newState) {
                newState.transition = 10;
                this.mqtt.onMessage(`${this.mqttBaseTopic}/${group.name}/set`, JSON.stringify(newState));
            }
        }
    }

    findScene(shortGroupName: string, trigger: string): Scene | undefined {
        if (!this.groups[shortGroupName]) return;
        let sceneOptions = this.groups[shortGroupName].scenes[trigger];
        if (sceneOptions) {
            let foundRange = 25*60, foundScene: Scene | undefined;
            for(let scene of sceneOptions) {
                let range = scene.start ? checkTimeRange(scene.start, scene.end!) : 24*60;
                if (range!=null && range < foundRange) {
                    foundScene = scene;
                    foundRange = range;
                }
            }
            return foundScene;
        }
    }
}

module.exports = LightLynxAutomation;
