// lightlynx-automation v1
/**
 * Sunrise/sunset script. By Matt Kane. Adopted for NPM use by Alexey Udivankin.
 * 
 * Based loosely and indirectly on Kevin Boone's SunTimes Java implementation 
 * of the US Naval Observatory's algorithm.
 * 
 * Copyright © 2012 Triggertrap Ltd. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser General
 * Public License as published by the Free Software Foundation; either version 2.1 of the License, or (at your option)
 * any later version.
 *
 * This library is distributed in the hope that it will be useful,but WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Lesser General Public License for more
 * details.
 * You should have received a copy of the GNU Lesser General Public License along with this library; if not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA,
 * or connect to: http://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
 */

/**
 * Default zenith
 */
const DEFAULT_ZENITH = 90.8333;

/**
 * Degrees per hour
 */
const DEGREES_PER_HOUR = 360 / 24;

/**
 * Msec in hour
 */
const MSEC_IN_HOUR = 60 * 60 * 1000;

/**
 * Msec in day
 */
 const MSEC_IN_DAY = 8.64e7;

/**
 * Get day of year
 */
function getDayOfYear(date) {
  return Math.ceil((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / MSEC_IN_DAY);
}

/**
 * Get sin of value in deg
 */
function sinDeg(deg) {
    return Math.sin(deg * 2.0 * Math.PI / 360.0);
}

/**
 * Get acos of value in deg
 */
function acosDeg(x) {
    return Math.acos(x) * 360.0 / (2 * Math.PI);
}

/**
 * Get asin of value in deg
 */
function asinDeg(x) {
    return Math.asin(x) * 360.0 / (2 * Math.PI);
}

/**
 * Get tan of value in deg
 */
function tanDeg(deg) {
    return Math.tan(deg * 2.0 * Math.PI / 360.0);
}

/**
 * Get cos of value in deg
 */
function cosDeg(deg) {
    return Math.cos(deg * 2.0 * Math.PI / 360.0);
}

/**
 * Get remainder
 */
function mod(a, b) {
    const result = a % b;

    return result < 0
        ? result + b
        : result;
}

/**
 * Calculate Date for either sunrise or sunset
 */
function calculate(latitude, longitude, isSunrise, zenith, date) {
    const dayOfYear = getDayOfYear(date);
    const hoursFromMeridian = longitude / DEGREES_PER_HOUR;
    const approxTimeOfEventInDays = isSunrise
        ? dayOfYear + ((6.0 - hoursFromMeridian) / 24.0)
        : dayOfYear + ((18.0 - hoursFromMeridian) / 24.0);

    const sunMeanAnomaly = (0.9856 * approxTimeOfEventInDays) - 3.289;
    let sunTrueLong = sunMeanAnomaly + (1.916 * sinDeg(sunMeanAnomaly)) + (0.020 * sinDeg(2 * sunMeanAnomaly)) + 282.634;
    sunTrueLong = mod(sunTrueLong, 360);

    let sunRightAscension = acosDeg(cosDeg(sunTrueLong) / cosDeg(asinDeg(0.39782 * sinDeg(sunTrueLong))));
    sunRightAscension = mod(sunRightAscension, 360);
    sunRightAscension = sunRightAscension + (((Math.floor(sunTrueLong / 90.0) * 90.0) - (Math.floor(sunRightAscension / 90.0) * 90.0)) / DEGREES_PER_HOUR);

    const sunDeclinationSin = 0.39782 * sinDeg(sunTrueLong);
    const sunDeclinationCos = cosDeg(asinDeg(sunDeclinationSin));

    const localHourAngleCos = (cosDeg(zenith) - (sunDeclinationSin * sinDeg(latitude))) / (sunDeclinationCos * cosDeg(latitude));

    if (localHourAngleCos > 1 || localHourAngleCos < -1) {
        return null;
    }

    const localHourAngle = isSunrise
        ? 360 - acosDeg(localHourAngleCos)
        : acosDeg(localHourAngleCos);

    const localMeanTime = (localHourAngle / DEGREES_PER_HOUR) + (sunRightAscension / DEGREES_PER_HOUR) - (0.06571 * approxTimeOfEventInDays) - 6.622;
    const utcTimeInHours = mod(localMeanTime - hoursFromMeridian, 24);
    const utcDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    utcDate.setUTCHours(Math.floor(utcTimeInHours));
    utcDate.setUTCMinutes(Math.floor((utcTimeInHours - Math.floor(utcTimeInHours)) * 60));

    return utcDate;
}

/**
 * Get sunrise time
 * 
 * @param {Number} latitude
 * @param {Number} longitude
 * @param {Number} zenith
 * @param {Date} date
 * @return {Date}
 */
function getSunrise(latitude, longitude, zenith, date) {
    return calculate(latitude, longitude, true, zenith || DEFAULT_ZENITH, date || new Date());
}

/**
 * Get sunset time
 * 
 * @param {Number} latitude
 * @param {Number} longitude
 * @param {Number} zenith
 * @param {Date} date
 * @return {Date}
 */
function getSunset(latitude, longitude, zenith, date) {
    return calculate(latitude, longitude, false, zenith || DEFAULT_ZENITH, date || new Date());
}

// -------------------------------------

function parseTimeRange(str) {
    // 17 # 17:00 hours
    // 17:30 # 17:30 hours
    // 2bs # 2 hours before sunset
    // 
    let m = str.trim().match(/^([0-9]{1,2})(:([0-9]{2}))?((b|a)(s|r))?$/);
    if (!m) {
        console.log("cannot parse time: "+str);
        return [0,0];
    }
    let hour = 0 | m[1];
    let minute = 0 | m[3];
    let beforeAfter = m[5];
    let riseSet = m[6];

    if (riseSet) {
        let sunTime = (riseSet==='r' ? getSunrise : getSunset)(52.24, 6.88);
        if (beforeAfter==='a') {
            hour += sunTime.getHours();
            minute += sunTime.getMinutes();
        } else {
            hour = sunTime.getHours() - hour;
            minute = sunTime.getMinutes() - minute;
        }
    }
    hour += Math.floor(minute / 60);
    hour = ((hour%24) + 24) % 24;
    minute = ((minute%60) + 60) % 60;
    return hour*60 + minute;
}


function checkTimeRange(startStr,endStr) {
    let start = parseTimeRange(startStr);
    let end = parseTimeRange(endStr);
    if (end<start) end += 24*60;

    let now = new Date();
    now = now.getHours()*60 + now.getMinutes();
    if (now < start) now += 24*60;

    if (now >= start && now <= end) return end-start;
}



const CLICK_COUNTS = {single: 1, double: 2, triple: 3, quadruple: 4, many: 5};


class LightLynxAutomation {
    constructor(zigbee, mqtt, state, publishEntityState, eventBus, enableDisableExtension, restartCallback, addExtension, settings, logger) {
        this.zigbee = zigbee;
        this.mqtt = mqtt;
        this.state = state;
        this.publishEntityState = publishEntityState;
        this.eventBus = eventBus;
        this.enableDisableExtension = enableDisableExtension;
        this.restartCallback = restartCallback;
        this.addExtension = addExtension;
        this.settings = settings;
        this.logger = logger;
    }

    start() {
        console.log('lightlynx-automation.js start');
        this.mqttBaseTopic = this.settings.get().mqtt.base_topic;
        this.eventBus.onStateChange(this, this.onStateChange.bind(this));
        this.eventBus.onScenesChanged(this, this.loadScenes.bind(this));
        this.eventBus.onGroupMembersChanged(this, this.loadScenes.bind(this));

        this.clickCounts = new Map();
        this.clickTimers = new Map();
        this.groups = {};
        this.lastTimedSceneIds = {};
        this.timeInterval = setInterval(this.handleTimeTriggers.bind(this), 10000);
        this.loadScenes();
    }

    stop() {
        console.log('lightlynx-automation.js stop');
        this.eventBus.removeListeners(this);
        clearTimeout(this.timeInterval);
        for(let group of Object.values(this.groups)) {
            clearTimeout(group.timer);
        }
    }

    loadScenes() {
        console.log('lightlynx-automation.js loadScenes');
        let groups = {};
        
        for(let zigbeeGroup of this.zigbee.groupsIterator()) {
            let resultScenes = {};
            let discovered = {};
            for(let endpoint of zigbeeGroup.zh.members) {
                let scenes = endpoint.meta?.scenes; 
                for(let key in scenes) {
                    let groupId = parseInt(key.split('_')[1]);
                    if (groupId === zigbeeGroup.ID) {
                        for(let scene of scenes[key]) {
                            if (!discovered[scene.id]) {
                                discovered[scene.id] = true;
                                // console.log('lightlynx-automation.js found scene', scene.id, scene.name);
                                
                                // Parse scene name for triggers: "Morning (6:00-9:00)" or "Evening (as-1bs)"
                                // as = after sunset
                                // bs = before sunset
                                // ar = after sunrise
                                // br = before sunrise
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
                // Timeout from description
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
                    touch: function() {
                        clearTimeout(this.timer);
                        if (this.timeout) {
                            this.timer = setTimeout(() => {
                                console.log('lightlynx-automation.js timeout', this.name);
                                this.mqtt.onMessage(`${this.mqttBaseTopic}/${this.name}/set`, JSON.stringify({state: 'OFF', transition: 30}));
                            }, this.timeout * 1000);
                        }
                    }.bind({name: zigbeeGroup.name, timeout, mqtt: this.mqtt, mqttBaseTopic: this.mqttBaseTopic})
                };
            }
        }
        this.groups = groups;
    }

    onStateChange(data) {
        // console.log('lightlynx-automation.js onStateChange', data.entity.name, data.update);
        let group = this.groups[data.entity.name];
        if (group && data.update.state === 'ON') {
            group.touch();
        }

        if (data.update.action) {
            let action = data.update.action;
            // console.log('lightlynx-automation.js action', data.entity.name, action);

            // lightlynx-groups 1,2,3
            let m = (data.entity.description || '').match(/lightlynx-groups\s+([0-9,]+)/)
            if (m) {
                let groupIds = m[1].split(',').map(id => parseInt(id));
                for(let groupId of groupIds) {
                    let zigbeeGroup = this.zigbee.groupByID(groupId);
                    if (zigbeeGroup) {
                        this.handleAction(zigbeeGroup.name, action);
                    }
                }
            }
        }
    }

    handleAction(shortGroupName, action) {
        let count = (this.clickCounts.get(shortGroupName + action) || 0) + 1;
        this.clickCounts.set(shortGroupName + action, count);

        clearTimeout(this.clickTimers.get(shortGroupName + action));
        this.clickTimers.set(shortGroupName + action, setTimeout(() => {
            this.executeAction(shortGroupName, action, count);
            this.clickCounts.delete(shortGroupName + action);
        }, 300));
    }

    executeAction(shortGroupName, action, count) {
        let group = this.groups[shortGroupName];
        if (!group) return;

        let triggerNames = [action];
        for(let name in CLICK_COUNTS) {
            if (CLICK_COUNTS[name] === count) triggerNames.push(name);
        }

        for(let triggerName of triggerNames) {
            let scenes = group.scenes[triggerName];
            if (scenes) {
                console.log('lightlynx-automation.js executeAction', shortGroupName, triggerName);
                group.touch();
                this.mqtt.onMessage(`${this.mqttBaseTopic}/${shortGroupName}/set`, JSON.stringify({scene_recall: scenes[0].id}));
                return;
            }
        }
        
        // Default: toggle
        if (count === 1) {
            console.log('lightlynx-automation.js toggle', shortGroupName);
            let state = this.state.get(this.zigbee.groupByName(shortGroupName));
            let newState = state.state === 'ON' ? 'OFF' : 'ON';
            this.mqtt.onMessage(`${this.mqttBaseTopic}/${shortGroupName}/set`, JSON.stringify({state: newState}));
        }
    }

    handleTimeTriggers() {
        for(let shortGroupName in this.groups) {
            let group = this.groups[shortGroupName];
            let newState;
            let scene = this.findScene(shortGroupName, 'time');
            if (scene) {
                group.touch();
                if (this.lastTimedSceneIds[shortGroupName] !== scene.id) {
                    console.log('lightlynx-automation.js time-based recall', shortGroupName, scene);
                    newState = { scene_recall: scene.id };
                    this.lastTimedSceneIds[shortGroupName] = scene.id;
                }
            }
            else {
                if (this.lastTimedSceneIds[shortGroupName]!==undefined) {
                    console.log('lightlynx-automation.js time-based off', shortGroupName);
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

    findScene(shortGroupName, trigger) {
        if (!this.groups[shortGroupName]) return;
        let sceneOptions = this.groups[shortGroupName].scenes[trigger];
        if (sceneOptions) {
            let foundRange = 25*60, foundScene;
            for(let scene of sceneOptions) {
                let range = scene.start ? checkTimeRange(scene.start, scene.end) : 24*60;
                if (range!=null && range < foundRange) {
                    foundScene = scene;
                }
            }
            return foundScene;
        }
    }
}

module.exports = LightLynxAutomation;
