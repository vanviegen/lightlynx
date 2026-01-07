import {$, proxy, ref, onEach, isEmpty, map, copy, dump, unproxy, clone, peek, partition} from 'aberdeen';
import * as route from 'aberdeen/route';
import {grow} from 'aberdeen/transitions';
import api from './api';
import * as icons from './icons';
import * as colors from './colors';
import {drawColorPicker, drawBulbCircle, getBulbRgb} from "./color-picker";
import { Device, Group } from './types';

import logoUrl from './logo.webp';
import swUrl from './sw.ts?worker&url';

route.setLog(true);

if ('serviceWorker' in navigator) {
	navigator.serviceWorker.register(swUrl);
	
	// Listen for reload messages from the service worker
	navigator.serviceWorker.addEventListener('message', (event) => {
		if (event.data && event.data.type === 'RELOAD_PAGE') {
			console.log('Reload on service worker request');
			window.location.reload();
		}
	});
}

const routeState = proxy({
	title: '',
	subTitle: '',
	drawIcons: undefined as (() => void) | undefined
});

const admin = proxy(!!route.current.search.admin);
$(() => {
	route.current.search.admin; // subscribe to this, so we'll force-update it when it changes
	if (admin.value) route.current.search.admin = 'y';
	else delete route.current.search.admin;
})

// All non-light devices, partitioned group id (-1 for). {suffix: {ieee: Device}}
const GROUPS_REGEXP = /^lightlynx-groups (\d+(,\d+)*)$/m;
const groupInputs = partition(api.store.devices, (device: Device, _ieee: string): number[] | undefined => {
	if (device.lightCaps) return; // Ignore lights
	return getGroupIdsFromDescription(device.description);
});

function drawEmpty(text: string): void {
	$('div.empty#', text);
}

function drawBulb(ieee: string): void {
	let device = api.store.devices[ieee];
	if (!device) return drawEmpty("No such light")
	
	$(() => {
		routeState.title = device.name;
	});
	routeState.subTitle = 'bulb';
	$("div.item#", device.model);
	
	drawColorPicker(device, ieee);

	if (!admin.value) return;

	$('h1#Settings');
	const name = proxy(unproxy(device).name);
	$('div.item', () => {
		$('h2#Name');
		$('input', {bind: name});
	});
	lazySave(() => {
		const newName = name.value;
		return function() {
			api.send("bridge", "request", "device", "rename", {from: device.name, to: newName, homeassistant_rename: true});
			device.name = newName;
		};
	});


	$('h1#Actions');
	const removing = proxy(false);

	$(() => {
		if (!removing.value && deviceGroups[ieee]) onEach(deviceGroups[ieee], (groupId) => {
			const busy = proxy(false);
			const group = api.store.groups[groupId];
			if (group) {
				$(`div.item.action#Remove from "${group.name}"`, {".busy": busy}, icons.remove, {click: async function() {
					busy.value = true;
					try {
						await api.send("bridge", "request", "group", "members", "remove", {group: group!.name, device: device!.name});
					} finally {
						busy.value = false;
					}
				}});
			}
		});

		if (!removing.value) {
			$('div.item.action#Delete', icons.eject, {click: async function() {
				if (confirm(`Are you sure you want to detach '${device.name}' from zigbee2mqtt?`)) {
					removing.value = true;
					try {
						await api.send("bridge", "request", "device", "remove", {id: ieee});
					} finally {
						removing.value = false;
					}
				}
			}});
		} else {
			$('div.item.action#Force delete', icons.eject, {click: function() {
				if (confirm(`Are you sure you want to FORCE detach '${device.name}' from zigbee2mqtt?`)) {
					api.send("bridge", "request", "device", "remove", {id: ieee, force: true});
				}
			}});
		}
	})
}

function drawDump(): void {
	routeState.title = 'State dump';
	dump(api.store);
}

const deviceGroups: Record<string, number[]> = {};
$(() => {
	let result: Record<string, number[]> = {};
	for (const [groupId, group] of Object.entries(api.store.groups)) {
		for (const ieee of group.members) {
			(result[ieee] = result[ieee] || []).push(parseInt(groupId));
		}
	}
	copy(deviceGroups, result);
});

function drawGroup(groupId: number): void {
	const optGroup = api.store.groups[groupId];
	if (!optGroup) return drawEmpty('No such group');
	const group = optGroup;
	
	if (route.current.p[2] === 'addLight') return drawGroupAddLight(group, groupId);
	if (route.current.p[2] === 'addInput') return drawGroupAddInput(group, groupId);
	if (route.current.p[2] === 'scene') return drawSceneEditor(group, groupId);
	
	function createScene(): void {
		let name = prompt("What should the new scene be called?")
		if (!name) return
		
		let freeId = 0;
		while(group.scenes.find(s => s.id === freeId)) freeId++;
		api.send(group.name, "set", {scene_store: {ID: freeId, name}});
	}
	
	$(() => {
		routeState.title = group.name;
		routeState.subTitle = 'group';
	})
	
	drawColorPicker(group, groupId);
	
	$("h1#Scenes", () => {
		if (admin.value) icons.create('click=', createScene);
	});
	
	$('div.list', () => {
		onEach(group.scenes || [], (scene) => {
			function recall(): void {
				api.send(group.name, "set", {scene_recall: scene.id});
			}
			$('div.item.link click=', recall, () => {
				let icon = icons.scenes[scene.shortName.toLowerCase()] || icons.empty;
				icon();
				$('h2#', admin.value ? scene.name : scene.shortName);
				if (admin.value) {
					function configure(e: Event): void {
						e.stopPropagation();
						route.go(['group', groupId, 'scene', scene.id]);
					}
					icons.configure('click=', configure);
				}
			});
		}, (scene) => `${scene.suffix || "x"}#${scene.shortName}`);
		$(() => {
			if (isEmpty(group.scenes)) drawEmpty("None yet");
		});
	});

		$("h1#Bulbs", () => {
		if (admin.value) icons.create('click=', () => route.go(['group', groupId, 'addLight']));
	});
	
	$("div.list", () => {
		const devices = api.store.devices;
		onEach(group.members, (ieee) => { 
			let device = devices[ieee]!;
			drawDeviceItem(device, ieee);
		}, (ieee) => devices[ieee]?.name);
		
		if (isEmpty(group.members)) {
			drawEmpty("None yet");
		}
	});

	// Group configuration section for admin users
	$(() => {
		if (admin.value) {
			drawGroupConfigurationEditor(group, groupId);
		}
	});
}

function drawGroupAddLight(group: Group, groupId: number): void {
	function addDevice(ieee: string): void {
		api.send("bridge", "request", "group", "members", "add", {group: group.name, device: ieee});
		route.up();
	}
	
	routeState.title = group.name;
	routeState.subTitle = 'add light';
	
	$("div.list", () => {
		onEach(api.store.devices, (device, ieee) => { 
			$("div.item", () => {
				drawBulbCircle(device, ieee);
				$('h2.link#', device.name, 'click=', () => addDevice(ieee));
			});
		}, (device, ieee) => {
			if (!device.lightCaps) return; // Skip sensors
			let inGroups = deviceGroups[ieee] || [];
			if (inGroups.includes(groupId)) return; // Skip, already in this group
			return [inGroups.length ? 1 : 0, device.name];
		});
	});
}


function drawGroupAddInput(group: Group, groupId: number): void {
	routeState.title = group.name;
	routeState.subTitle = 'add input';

	function addDevice(ieee: string): void {
		let groupIds = getGroupIdsFromDescription(api.store.devices[ieee]?.description);
		const description = buildDescriptionWithGroupIds(api.store.devices[ieee]?.description, groupIds.concat([groupId]));
		api.send("bridge", "request", "device", "options", {id: ieee, options: {description}});
		route.up();
	}
	
	$("div.list", () => {
		onEach(api.store.devices, (device, ieee) => { 
			$("div.item", () => {
				drawBulbCircle(device, ieee);
				$('h2.link#', device.name, 'click=', () => addDevice(ieee));
			});
		}, (device, _ieee) => {
			if (device.lightCaps) return; // Skip bulbs
			let inGroups = getGroupIdsFromDescription(device.description);
			if (inGroups.includes(groupId)) return; // Skip, already in this group
			return [inGroups.length ? 1 : 0, device.name];
		});
	});
}

function drawDeviceItem(device: Device, ieee: string): void {
	$("div.item", () => {
		drawBulbCircle(device, ieee);
		$('h2.link#', device.name, 'click=', () => route.go(['bulb', ieee]));
	});
}

function drawMain(): void {
	routeState.title = '';
	routeState.subTitle = '';
	routeState.drawIcons = () => {
		if (admin.value) {
			icons.create('click=', permitJoin);
			icons.createGroup('click=', createGroup);
			icons.bug('click=', () => route.go(['dump']));
		} else {
			icons.reconnect('click=', () => api.store.credentials.change = true);
		}
	};

		
	$(() => {
		const emptyDevices = map(api.store.devices, (device) => (device.meta?.battery||99) < 10 ? device.name : undefined); 
		$(() => {
			if (isEmpty(emptyDevices)) return;
			$('div.banner', () => {
				$('p#Replace battery for ' + Object.values(emptyDevices).join(' & ') + '!');
			});
		});
	});


	$("div.grid", () => {
		onEach(api.store.groups, (group, groupId) => {
			$("div", () => {
				let bgs: string[] = [];
				let totalBrightness = 0;
				for(let ieee of group.members) {
					let device = api.store.devices[ieee];
					if (device) {
						let rgb = getBulbRgb(device);
						totalBrightness += [1,3,5].map(idx => parseInt(rgb.substr(idx,2), 16)).reduce((a,b)=>a+b, 0);
						bgs.push(rgb);
					}
				}
				bgs.sort();
				if (bgs.length == 1) {
					$({$backgroundColor: bgs[0]});
				} else {
					$({$backgroundImage: `linear-gradient(45deg, ${bgs.join(', ')})`});
				}
				
				let brightness = totalBrightness / bgs.length / 3;
				$({
					".bright": brightness > 127,
					".off": brightness < 1,
				});
				
				$('h2.link#', group.name, 'click=', () => route.go(['group', groupId]));
				$("div.options", () => {
					icons.off('click=', () => api.setLightState(parseInt(groupId), {on: false}));
					onEach(group.scenes, (scene) => {
						function onClick(): void {
							api.send(group.name, "set", {scene_recall: scene.id});
						}
						const icon = icons.scenes[scene.shortName.toLowerCase()];
						if (icon) icon('.link click=', onClick);
						else $('div.scene.link#', scene.shortName, 'click=', onClick);
					},  scene => `${scene.suffix || 'x'}#${scene.name}`);
					
					if (!group.scenes || group.scenes.length === 0) {
						icons.scenes.normal('click=', () => api.setLightState(parseInt(groupId), {on: false, brightness: 140, color: colors.CT_DEFAULT}));
					}
				});
			});
		}, group => group.name);
	});
	
	$("div.list", () => {
		onEach(api.store.devices, drawDeviceItem, (device, ieee) => {
			let inGroups = deviceGroups[ieee];
			return (!inGroups && device.lightCaps) ? device.name : undefined;
		});
	});
}

function drawLogin(): void {
	routeState.subTitle = 'Login';
	
	let formData = clone(unproxy(api.store).credentials);
	delete formData.change;
	function handleSubmit(e: Event): void {
		e.preventDefault();
		copy(api.store.credentials, formData);
	}
	
	$('div.login-form', () => {
		$('div.empty.field', () => {
			$('#', api.store.invalidCredentials || "Please provide Zigbee2MQTT credentials.");
		});
		
		$('form submit=', handleSubmit, () => {
			$('div.field', () => {
				$('label#WebSocket URL');
				$('input type=url placeholder=wss://your-server.com/api required=', true, 'bind=', ref(formData, 'url'));
			});
			
			$('div.field', () => {
				$('label#Z2M password');
				$('input type=password placeholder=Secret autocomplete=current-password bind=', ref(formData, 'token'));
			});

			$('button#Connect type=submit');
		});
	});
}

function createGroup(): void {
	let name = prompt("What should the group be called?");
	if (!name) return;
	api.send("bridge", "request", "group", "add", {friendly_name: name});
}

function permitJoin(): void {
	api.send("bridge", "request", "permit_join", {time: 254});
}

function disableJoin(): void {
	api.send("bridge", "request", "permit_join", {time: 0});
}

$('div.root', () => {
	$('header', () => {
		$('img.logo src=', logoUrl, 'click=', () => route.back('/'));
		$(() => {
			if (route.current.path !== '/') {
				icons.back('click=', route.up);
			}
			$("h1.title", () => {
				let title = routeState.title || "Light Lynx";
				$(`#`, title);
				if (routeState.subTitle) {
					$('span.subTitle# '+routeState.subTitle);
				}
			});
		});
		$(() => {
			if (routeState.drawIcons) {
				routeState.drawIcons();
			}
		});
		$(() => {
			if (!api.store.credentials.url || api.store.credentials.change) return;
			icons.admin('click=', () => admin.value = !admin.value, {'.on': ref(route.current.search, 'admin')});
		});
	});
	
	$(() => {
		if (api.store.permit_join) {
			$('div.banner', () => {
				$('p#Permitting devices to join...');
				icons.stop('click=', disableJoin);
			});
		}
	});
	
	$('div.mainContainer', () => {
		const p = route.current.p;
		$('main', () => {
			routeState.title = '';
			routeState.subTitle = '';
			delete routeState.drawIcons;

			// Show login form if credentials are invalid
			if (api.store.invalidCredentials || !api.store.credentials.url || api.store.credentials.change) {
				drawLogin();
			} else if (p[0]==='group' && p[1]) {
				drawGroup(parseInt(p[1]));
			} else if (p[0] === 'bulb' && p[1]) {
				drawBulb(p[1]);
			} else if (p[0] === 'dump') {
				drawDump();
			} else {
				drawMain();
			}
			route.persistScroll();
		}, {destroy: 'fadeOut', create: route.current.nav});
	});
});

export interface TriggerItem {
    type: '1' | '2' | '3' | '4' | '5' | 'motion' | 'time';
    startTime?: Time;
    endTime?: Time;
}

export interface Time {
    hour: number;
    minute: number;
    type: 'wall' | 'bs' | 'as' | 'br' | 'ar';
}

export interface GroupTimeout {
    value: number;
    unit: TimeUnit;
}

export type TimeUnit = 's' | 'm' | 'h' | 'd';

// Parse scene automation from suffix  
export function parseSceneTriggers(suffix: string): TriggerItem[] {
    const triggers: TriggerItem[] = [];

    const parts = suffix.split(',').map(s => s.trim());
    
    for (const part of parts) {
        const match = part.match(/^\s*([0-9a-z]+)(?:\s+([^)-]*?)-([^)-]*))?\s*$/);
        if (!match) {
            if (part.length) console.error(`Unrecognized trigger spec: "${part}"`);
            continue;
        }
        
        let [, triggerPart, startTime, endTime] = match as [unknown, string, string?, string?];

        if (triggerPart == 'sensor') triggerPart = 'motion'; // legacy support

        if (!['motion', 'time', '1', '2', '3', '4', '5'].includes(triggerPart)) {
            console.error(`Unrecognized trigger type: "${triggerPart}"`);
            continue;
        }
        
        // Handle motion sensor
        const trigger: TriggerItem = {type: triggerPart as any};
        
        if (startTime && endTime) {
            trigger.startTime = parseTime(startTime);
            trigger.endTime = parseTime(endTime);
        }
            
        triggers.push(trigger);
    }
    
    return triggers;
}


// Parse individual time
function parseTime(timeStr: string): Time | undefined {
    const sunMatch = timeStr.match(/^(\d{1,2})(?::(\d{2}))?((b|a)(s|r))?$/);
    if (!sunMatch) {
        console.error(`Unrecognized time format: "${timeStr}"`);
        return;
    }
    const hour = parseInt(sunMatch[1]!);
    const minute = sunMatch[2] ? parseInt(sunMatch[2]) : 0;
    const type = (sunMatch[3] || 'wall') as any;
    if (!['wall', 'bs', 'as', 'br', 'ar'].includes(type)) {
        console.error(`Unrecognized time type in: "${timeStr}"`);
        return;
    }
    return { hour, minute, type };
}

// Format time back to string
function formatTime({hour, minute, type}: Time): string {
    if (type === 'wall') {
        return minute === 0 ? hour.toString() : `${hour}:${minute.toString().padStart(2, '0')}`;
    } else {
        const minuteStr = minute === 0 ? '' : `:${minute.toString().padStart(2, '0')}`;
        return `${hour}${minuteStr}${type}`;
    }
}

// Parse group timeout from suffix
export function parseGroupTimeout(suffix: string): GroupTimeout | null {
    if (!suffix) return null;
    
    const match = suffix.match(/^(\d+(?:\.\d+)?)([smhd])$/);
    if (!match || !match[1] || !match[2]) return null;
    
    return {
        value: parseFloat(match[1]),
        unit: match[2] as TimeUnit
    };
}

// Build group timeout suffix
export function buildGroupTimeoutSuffix(timeout: GroupTimeout | null): string {
    if (!timeout) return '';
    return `${timeout.value}${timeout.unit}`;
}

function lazySave(getState: () => void | (() => void), delay: number = 1000): void {
    let timeoutId: number | undefined;
    let firstRun = true;
    $(() => {
        clearTimeout(timeoutId);
        let saveFunc = getState();
        if (firstRun) firstRun = false;
        else if (saveFunc) timeoutId = setTimeout(saveFunc, delay);
    });
}

// Enhanced scene automation editor
export function drawSceneEditor(group: Group, groupId: number): void {

	if (!admin.value || route.current.p[3] == null) {
		route.up();
		return;
	}
	const sceneId = parseInt(route.current.p[3]);
	const scene = group.scenes.find(s => s.id === sceneId)!;
	if (!scene) return drawEmpty('Scene not found');

	$(() => {
		routeState.title = group.name + ' · ' + scene.shortName;
	});
	routeState.subTitle = "scene";
	routeState.drawIcons = undefined;

    const sceneState = proxy(peek(() => {
        return {
            shortName: scene.shortName,
            triggers: parseSceneTriggers(scene.suffix || '')
        };
    }));
    
    $('h1#Settings');
    
    // Scene name
    $('div.item', () => {
        $('h2#Name');
        $('input', {
            type: 'text',
            bind: ref(sceneState, 'shortName'),
            placeholder: 'Scene name',
        });
    });
    
    $('h1Triggers', () => {
        icons.create('click=', () => sceneState.triggers.push({type: '1'}));
    });
        
    onEach(sceneState.triggers, (trigger, triggerIndex) => {
        $(() => {
            // There must be a time range for time-based triggers
            if (trigger.type === 'time' && !trigger.startTime) {
                trigger.startTime = {hour: 18, minute: 0, type: 'wall'};
                trigger.endTime = {hour: 22, minute: 0, type: 'wall'};
            }
        });
        $('div.item flex-direction:column', () => {
            $('div.row justify-content:space-between', () =>{
                $('select width:inherit bind=', ref(trigger, 'type'), () => {
                    $('option value=1 #Single Tap');
                    $('option value=2 #Double Tap');
                    $('option value=3 #Triple Tap');
                    $('option value=4 #Quadruple Tap');
                    $('option value=5 #Quintuple Tap');
                    $('option value=motion #Motion Sensor');
                    $('option value=time #Time-based');
                });
                
                $(() => {
                    if (trigger.type !== 'time') {
                        $('label', () => {
                            $('input type=checkbox', {checked: !!trigger.startTime}, 'change=', (e: Event) => {
                                const target = e.target as HTMLInputElement;
                                if (target.checked) {
                                    trigger.startTime = {hour: 0, minute: 30, type: 'bs'};
                                    trigger.endTime = {hour: 22, minute: 30, type: 'wall'};
                                } else {
                                    trigger.startTime = undefined;
                                    trigger.endTime = undefined;
                                }
                            });
                            $('#Time range');
                        });
                    }
                })

                icons.remove('click=', () => sceneState.triggers.splice(triggerIndex, 1));
            });
            $(() => {
                if (trigger.startTime && trigger.endTime) {
                    $('div.scene-times', {$create: grow}, () => {
						$('label#From ')
                        drawTimeEditor(trigger.startTime!);
						$('label#Until ')
                        drawTimeEditor(trigger.endTime!);
                    })
                }
            })

        })
    });


	$('h1#Actions');
	function save(e: Event): void {
		e.stopPropagation();
		if (!confirm(`Are you sure you want to overwrite the '${scene.name}' scene for group '${group.name}' with the current light state?`)) return;
		api.send(group.name, "set", {scene_store: {ID: scene.id, name: scene.name}});

		for(let ieee of group.members) {
			if (!api.store.devices[ieee]?.lightState?.on) {
				api.send(ieee, "set", {scene_add: {ID: scene.id, group_id: groupId, name: scene.name, state: "OFF"}});
			}
		}
	}
	function remove(e: Event): void {
		e.stopPropagation();
		if (!confirm(`Are you sure you want to delete the '${scene.name}' scene for group '${group.name}'?`)) return;
		api.send(group.name, "set", {scene_remove: scene.id});
	}
	$('div.item.action#Save current state', 'click=', save, icons.save);
	$('div.item.action#Delete scene', 'click=', remove, icons.remove);

    const newName = proxy('');
    lazySave(() => {
        const newSuffix = sceneState.triggers.map(trigger => {
            let out = trigger.type;
            // Click trigger
            if (trigger.startTime && trigger.endTime) {
                const startTime = formatTime(trigger.startTime);
                const endTime = formatTime(trigger.endTime);
                out += ` ${startTime}-${endTime}`;
            }
            return out;
        }).join(', ');

        newName.value = `${sceneState.shortName}${newSuffix ? ` (${newSuffix})` : ''}`;
        return function() {
            api.send(group.name, "set", {scene_rename: {ID: scene.id, name: newName.value}});
        }
    });

    $('small.item#', newName);
}

// Time range editor component
function drawTimeEditor(range: Time): void {
    // Start time
	$('input.hour type=number min=0 max=23 bind=', ref(range, 'hour'));
	$('b# : ');
	$('input.minute type=number min=0 max=59 value=', unproxy(range).minute.toString().padStart(2, '0'), 'input=', (event: any) => range.minute = parseInt(event.target.value));
	$('select.time-type bind=', ref(range, 'type'), () => {
		$('option value=wall #wall time');
		$('option value=br #before sunrise');
		$('option value=ar #after sunrise');
		$('option value=bs #before sunset');
		$('option value=as #after sunset');
	});
}

function getGroupIdsFromDescription(description: string | undefined): number[] {
	if (!description) return [];
	const m = description.match(GROUPS_REGEXP);
	return m ? m[1]!.split(',').map(id => parseInt(id)) : [];
}

function buildDescriptionWithGroupIds(description: string | undefined, groupIds: number[]): string {
	let groupStr = groupIds.length ? `lightlynx-groups ${groupIds.join(',')}` : '';
	let replaced = false;
	description = (description || '').replace(GROUPS_REGEXP, () => {
		replaced = true;
		return groupStr;
	}).trim();
	if (!replaced && groupStr) {
		return description.length ? description + "\n" + groupStr : groupStr;
	}
	return description;
}

// Parse group timeout from description (lightlynx- metadata)
function getGroupTimeoutFromDescription(description: string | undefined): GroupTimeout | null {
	if (!description) return null;
	const m = description.match(/^lightlynx-timeout (\d+(?:\.\d+)?)([smhd])$/m);
	if (!m) return null;
	return {
		value: parseFloat(m[1]!),
		unit: m[2] as TimeUnit
	};
}

// Build description with group timeout metadata
function buildDescriptionWithGroupTimeout(description: string | undefined, timeout: GroupTimeout | null): string {
	const TIMEOUT_REGEXP = /^lightlynx-timeout \d+(?:\.\d+)?[smhd]$/m;
	let timeoutStr = timeout ? `lightlynx-timeout ${timeout.value}${timeout.unit}` : '';
	let replaced = false;
	description = (description || '').replace(TIMEOUT_REGEXP, () => {
		replaced = true;
		return timeoutStr;
	}).trim();
	if (!replaced && timeoutStr) {
		return description.length ? description + "\n" + timeoutStr : timeoutStr;
	}
	return description;
}

// Note: Scene trigger functions removed - Z2M scenes don't have description fields,
// so we can't move scene metadata to descriptions. Scene metadata stays in names.

// Enhanced group configuration editor 
export function drawGroupConfigurationEditor(group: Group, groupId: number): void {
    const groupState = proxy(peek(() => { // Keep in sync with upstream changes
        return {
            name: group.name,
            description: group.description,
            timeout: getGroupTimeoutFromDescription(group.description),
        }
    }));

	$("h1", () => {
		$("#Buttons and sensors");
		icons.create('click=', () => route.go(['group', groupId, 'addInput']));
	});
	onEach(groupInputs[groupId] || {}, (device, ieee) => {
		$("div.item", () => {
			drawBulbCircle(device, ieee);
			$("h2#", device.name);
			icons.remove('.link click=', () => {
				const description = buildDescriptionWithGroupIds(device.description, (getGroupIdsFromDescription(device.description) || []).filter(id => id !== groupId));
				api.send("bridge", "request", "device", "options", {id: ieee, options: {description}});
			});
		});
	});
	if (isEmpty(groupInputs[groupId] || {})) {
		drawEmpty("None yet");
	}

    $('h1#Settings');
    
    // Group name
    $('div.item', () => {
        $('h2#Name');
        $('input', {
            type: 'text',
            bind: ref(groupState, 'name'),
            placeholder: 'Group name',
        });
    });
    
    // Lights off timer checkbox
    $('label.item', () => {
        $('input type=checkbox', {checked: !!groupState.timeout}, 'change=', (e: Event) => {
            const target = e.target as HTMLInputElement;
            if (target.checked) {
                groupState.timeout = { value: 30, unit: 'm' };
            } else {
                groupState.timeout = null;
            }
        });
        $('h2#Lights off timer');
    });

    // Timer configuration (only show if checkbox is set)
    $(() => {
        if (!groupState.timeout) return;
        $('label.item', () => {
            $('h2#Turn off lights after');
            $('input type=number min=1 bind=', ref(groupState.timeout!, 'value'));
            $('select bind=', ref(groupState.timeout!, 'unit'), () => {
                $('option value=s #seconds');
                $('option value=m #minutes');
                $('option value=h #hours');
                $('option value=d #days');
            });
        });
    });

	$('h1#Actions');
	$('div.item.action#Delete group', 'click=', () => {
		if (!confirm(`Are you sure you want to delete group '${group.name}'?`)) return;
		api.send("bridge", "request", "group", "remove", {id: group.name});
		route.back('/');
	}, icons.remove);

    const newDescription = proxy('');
    lazySave(() => {
        // Update description with timeout metadata
        newDescription.value = buildDescriptionWithGroupTimeout(groupState.description, groupState.timeout);
        
        return function() {
            // Update description with timeout metadata
			if (groupState.description !== newDescription.value) {
	            api.send("bridge", "request", "group", "options", {id: groupId, options: {description: newDescription.value}});
				groupState.description = newDescription.value;
			}
        }
    });
}
