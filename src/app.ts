/// <reference types="vite/client" />
import './global-style';
import {$, proxy, ref, onEach, isEmpty, copy, dump, unproxy, peek, partition, clone, derive, insertCss} from 'aberdeen';
import * as route from 'aberdeen/route';
import { grow, shrink } from 'aberdeen/transitions';
import api from './api';
import * as icons from './icons';
import * as colors from './colors';
import { drawColorPicker, drawBulbCircle } from "./components/color-picker";
import { drawToasts, Toast } from './components/toasts';
import { drawHeader } from './components/header';
import { drawMenu } from './components/menu';
import { drawLandingPage } from './pages/landing-page';
import { drawDeviceItem as drawDeviceItemHelper } from './components/list-items';
import { drawBulbPage } from './pages/bulb-page';
import { drawGroupPage } from './pages/group-page';
import { drawConnectionPage as drawConnectionPageComponent } from './pages/connection-page';
import { drawUsersSection, drawUserEditor as drawUserEditorComponent } from './pages/users-page';
import { drawRemoteInfoPage as drawRemoteInfoPageComponent, drawAutomationInfoPage as drawAutomationInfoPageComponent, drawBatteriesPage as drawBatteriesPageComponent, drawDumpPage as drawDumpPageComponent } from './pages/info-pages';
import { drawPromptPage as drawPromptPageComponent } from './pages/prompt-page';
import { Device, Group, ServerCredentials, User } from './types';
import swUrl from './sw.ts?worker&url';

const TIMEOUT_REGEXP = /^lightlynx-timeout (\d+(?:\.\d+)?)([smhd])$/m;

// Root container styles
const rootStyle = insertCss({
	'&': 'max-width:500px m: 0 auto; min-height:100% display:flex flex-direction:column transition: max-width 0.2s ease-in-out; position:relative',
	'&.landing-page': 'max-width:900px',
	'@media screen and (min-width: 501px)': 'box-shadow: 0 0 256px #f4810e20;'
});

const mainContainerStyle = insertCss('flex:1 position:relative overflow:hidden');

const mainStyle = insertCss({
    '&': 'overflow:auto overflow-x:hidden position:absolute z-index:2 transition: transform 0.2s ease-out, opacity 0.2s ease-out, visibility 0.2s ease-out; left:0 top:0 right:0 bottom:0 bg:$bg scrollbar-width:none -ms-overflow-style:none',
    
    '&::-webkit-scrollbar': 'display:none',
    
    '&.fadeOut': {
        '&': 'z-index:1 opacity:0 visibility:hidden pointer-events:none',
        '*': 'visibility:hidden pointer-events:none'
    },
    
    '&.forward, &.go': 'transform:translateX(100%)',
    
    '&.back': 'transform:translateX(-100%)',
    
    '&.load': 'opacity:0',
    
    h1: {
        '&': 'overflow:hidden text-align:center font-size:1.125rem text-transform:uppercase font-weight:normal fg:$textMuted mt:$3 mb:$2 position:relative pointer-events:none',
        
        '.icon': 'position:absolute right:$2 vertical-align:middle cursor:pointer z-index:10 pointer-events:auto w:24px h:24px'
    }
});


route.setLog(true);
route.interceptLinks();

const updateAvailable = proxy(false);

// Disable service worker in dev mode to avoid caching conflicts with Vite HMR
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
	navigator.serviceWorker.register(swUrl, { type: 'classic' });
	
	// Listen for update available messages from the service worker
	navigator.serviceWorker.addEventListener('message', (event) => {
		if (event.data && event.data.type === 'UPDATE_AVAILABLE') {
			console.log('Update available from service worker');
			updateAvailable.value = true;
		}
	});
}

const routeState = proxy({
	title: '',
	subTitle: '',
	drawIcons: undefined as (() => void) | undefined
});

const admin = proxy(!!route.current.search.admin);
const menuOpen = proxy(false);

const toasts = proxy([] as Toast[]);
export function notify(type: 'error' | 'info' | 'warning', message: string) {
	const id = Math.random();
	toasts.push({ id, type, message });
	setTimeout(() => {
		const index = toasts.findIndex(t => t.id === id);
		if (index !== -1) toasts.splice(index, 1);
	}, 10000);
}

// Register notify handler to show API messages as toasts
api.notifyHandlers.push(notify);


const dialogResolvers: Record<number, (value: any) => void> = {};

function askDialog(type: 'confirm' | 'prompt', message: string, options: {defaultValue?: string, title?: string} = {}): Promise<any> {
	const resolveId = 0 | (Math.random() * 1000000);
	const result = new Promise(resolve => {
		dialogResolvers[resolveId] = resolve;
		route.go({p: ['prompt'], state: {type, message, resolveId, value: options.defaultValue || '', title: options.title}});
	});
	delete dialogResolvers[resolveId];
	return result as any;
}

async function askConfirm(message: string, title?: string): Promise<boolean> {
	return askDialog('confirm', message, {title});
}

async function askPrompt(message: string, defaultValue = '', title?: string): Promise<string | undefined> {
	return askDialog('prompt', message, {defaultValue, title});
}

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
	drawBulbPage(ieee, { routeState, admin, deviceGroups, askConfirm, lazySave });
}

function drawDump(): void {
	drawDumpPageComponent({ routeState });
}

function drawPromptPage(): void {
	drawPromptPageComponent({ routeState, dialogResolvers });
}

function drawRemoteInfoPage(): void {
	drawRemoteInfoPageComponent({ routeState });
}

function drawAutomationInfoPage(): void {
	drawAutomationInfoPageComponent({ routeState });
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
	drawGroupPage(groupId, { routeState, admin, deviceGroups, groupInputs, askConfirm, askPrompt, lazySave, drawDeviceItem, drawSceneEditor });
}



function drawDeviceItem(device: Device, ieee: string): void {
	$("div.item", () => {
		drawBulbCircle(device, ieee);
		$('h2.link#', device.name, 'click=', () => route.go(['bulb', ieee]));
	});
}

function drawManagementSection(): void {
	$('h1#Management');
	$('div.list', () => {
		$(() => {
			const active = api.store.permitJoin;
			$('div.item.link', {click: active ? disableJoin : permitJoin}, () => {
				(active ? icons.stop : icons.create)();
				$('h2#', active ? 'Stop searching for devices' : 'Search for devices');
			});
		});

		$('div.item.link', {click: createGroup}, () => {
			icons.createGroup();
			$('h2#Create group');
		});

		drawRemoteAccessToggle();
		
		const automationBusy = proxy(false);
		$('label.item', () => {
			$({'.busy': automationBusy.value});
			$('input type=checkbox', {
				checked: api.store.automationEnabled,
				disabled: automationBusy.value,
				change: async (e: Event) => {
					const checked = (e.target as HTMLInputElement).checked;
					automationBusy.value = true;
					try {
						await api.setAutomation(checked);
					} finally {
						automationBusy.value = false;
					}
				}
			});
			$('h2#Automation');
			icons.info('margin-left:auto click=', (e: Event) => {
				e.stopPropagation();
				e.preventDefault();
				route.go(['automation-info']);
			});
		});
	});
}

function drawBatteries(): void {
	drawBatteriesPageComponent({ routeState });
}

function drawMain(): void {
	routeState.title = '';
	routeState.subTitle = '';


	$("div.list", () => {
		onEach(api.store.groups, (group, groupId) => {
			$('div.item.group-row', () => {
				// Toggle button
				drawBulbCircle(group, parseInt(groupId));
				
				// Name and chevron (includes spacer, min 20px padding)
				$('h2.link flex:1 click=', () => route.go(['group', groupId]), () => {
					$('#', group.name);
					icons.chevronRight();
				});
				
				// Scene icons (horizontally scrollable)
				$("div.group-scenes", () => {
					onEach(group.scenes, (scene) => {
						function onClick(): void {
							api.send(group.name, "set", {scene_recall: scene.id});
						}
						const isActive = derive(() => api.store.activeScenes[group.name] == scene.id && group.lightState?.on);
						const icon = icons.scenes[scene.shortName.toLowerCase()];
						if (icon) icon('.link click=', onClick, {'.active-scene': isActive});
						else $('div.scene.link#', scene.shortName, {'.active-scene': isActive}, 'click=', onClick);
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

	$(() => {
		if (admin.value) {
			drawManagementSection();
			drawUsersSection();
		}
	});
}

function drawRemoteAccessToggle(): void {
	const remoteBusy = proxy(false);
	$('label.item', () => {
		$({'.busy': remoteBusy.value});
		$('input type=checkbox', {
			checked: api.store.remoteAccessEnabled,
			disabled: remoteBusy.value,
			change: async (e: Event) => {
				const checked = (e.target as HTMLInputElement).checked;
				remoteBusy.value = true;
				try {
					await api.setRemoteAccess(checked);
					if (checked) {
						notify('info', "Remote access enabled. Ensure your router supports UPnP or you have manually forwarded port 43597.");
					}
				} catch (e: any) {
					notify('error', "Failed to toggle remote access: " + e.message);
				} finally {
					remoteBusy.value = false;
				}
			}
		});
		$('h2#Remote access');
		icons.info('margin-left:auto click=', (e: Event) => {
			e.stopPropagation();
			e.preventDefault();
			route.go(['remote-info']);
		});
	});
}


function drawConnectionPage(): void {
	drawConnectionPageComponent({ routeState, notify, askConfirm });
}

async function hashSecret(password: string): Promise<string> {
    if (!password) return '';
    const saltString = "LightLynx-Salt-v2";
    const salt = new TextEncoder().encode(saltString);
    const pw = new TextEncoder().encode(password);
    
    const keyMaterial = await window.crypto.subtle.importKey("raw", pw, "PBKDF2", false, ["deriveBits"]);
    
    const derivedBits = await window.crypto.subtle.deriveBits({
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
        }, keyMaterial, 256);
    
    return Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createGroup(): Promise<void> {
	const name = await askPrompt("What should the group be called?");
	if (!name) return;
	api.send("bridge", "request", "group", "add", {friendly_name: name});
}

function permitJoin(): void {
	api.send("bridge", "request", "permit_join", {time: 254});
}

function disableJoin(): void {
	api.send("bridge", "request", "permit_join", {time: 0});
}

$('div', rootStyle, () => {
	$(() => {
		$('.landing-page:', isEmpty(api.store.servers) && route.current.path === '/');
	});

	drawHeader(routeState, admin, updateAvailable, menuOpen, disableJoin);
	drawMenu(menuOpen);
	
	$('div', mainContainerStyle, () => {
		const p = route.current.p;
		
		$('main', mainStyle, 'destroy=fadeOut create=', route.current.nav, () => {
			routeState.title = '';
			routeState.subTitle = '';
			delete routeState.drawIcons;

			// Show Landing page if no server active
			if (p[0] === 'connect') {
				drawConnectionPage();
			} else if (isEmpty(api.store.servers)) {
				drawLandingPage(routeState);
			} else if (p[0]==='group' && p[1]) {
				drawGroup(parseInt(p[1]));
			} else if (p[0] === 'bulb' && p[1]) {
				drawBulb(p[1]);
			} else if (p[0] === 'batteries') {
				drawBatteries();
			} else if (p[0] === 'user' && p[1]) {
				drawUserEditor();
			} else if (p[0] === 'dump') {
				drawDump();
			} else if (p[0] === 'prompt') {
				drawPromptPage();
			} else if (p[0] === 'remote-info') {
				drawRemoteInfoPage();
			} else if (p[0] === 'automation-info') {
				drawAutomationInfoPage();
			} else {
				drawMain();
			}
			route.persistScroll();
		}, {destroy: 'fadeOut', create: route.current.nav});
	}); // end mainContainer

	drawToasts(toasts);
}); // end root

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
    let timeoutId: any;
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
	if (!scene) {
		return route.up();
	}

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
    
    $('h1#Scene name');
    
    // Scene identity - combined preset and custom name
    const scenePresets = Object.keys(icons.scenes).filter(name => 
        !['dim', 'soft', 'orientation'].includes(name) // Filter out legacy aliases
    );

	$('div.scene-presets', () => {
		// Permanent input field as first "button"
		$('div.scene-preset.custom', () => {
			$('input', {
				type: 'text',
				bind: ref(sceneState, 'shortName')
			});
			// $('span#Type here');
		});

		for (const presetName of scenePresets) {
			const icon = icons.scenes[presetName]!;
			const label = presetName.charAt(0).toUpperCase() + presetName.slice(1);
			
			$('div.scene-preset.item.link click=', () => {
				sceneState.shortName = label;
			}, () => {
				$(() => {
					$({'.selected': sceneState.shortName.toLowerCase() === presetName.toLowerCase()});
				});
				icon("color:inherit");
				$('span#', label);
			});
		}
	});

	
	const automationEnabled = api.store.automationEnabled;
	$('h1#Triggers', () => {
		if (automationEnabled) icons.create('click=', () => sceneState.triggers.push({type: '1'}));
	});
    if (automationEnabled) {
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
						$('div.scene-times', {create: grow, destroy: shrink}, () => {
							$('label#From ')
							drawTimeEditor(trigger.startTime!);
							$('label#Until ')
							drawTimeEditor(trigger.endTime!);
						})
					}
				})

			})
		});
		if (isEmpty(sceneState.triggers)) drawEmpty("None yet");
    }

	$('h1#Actions');
	async function save(e: Event): Promise<void> {
		e.stopPropagation();
		if (!await askConfirm(`Are you sure you want to overwrite the '${scene.name}' scene for group '${group.name}' with the current light state?`)) return;
		api.send(group.name, "set", {scene_store: {ID: scene.id, name: scene.name}});

		// Also store any off-states into the scene (for some reason that doesn't happen by default)
		for(let ieee of group.members) {
			if (!api.store.devices[ieee]?.lightState?.on) {
				api.send(ieee, "set", {scene_add: {ID: scene.id, group_id: groupId, name: scene.name, state: "OFF"}});
			}
		}
	}
	async function remove(e: Event): Promise<void> {
		e.stopPropagation();
		if (!await askConfirm(`Are you sure you want to delete the '${scene.name}' scene for group '${group.name}'?`)) return;
		api.send(group.name, "set", {scene_remove: scene.id});
	}
	$('div.item.link#Save current state', 'click=', save, icons.save);
	$('div.item.link#Delete scene', 'click=', remove, icons.remove);

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
	console.log('Parsing timeout from description:', description);
	if (!description) return null;
	const m = description.match(TIMEOUT_REGEXP);
	console.log(m);
	if (!m) return null;
	return {
		value: parseFloat(m[1]!),
		unit: m[2] as TimeUnit
	};
}

// Build description with group timeout metadata
function buildDescriptionWithGroupTimeout(description: string | undefined, timeout: GroupTimeout | null): string {
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
		console.log('GROUP' ,group)
        return {
            name: group.name,
            description: group.description,
            timeout: getGroupTimeoutFromDescription(group.description),
        }
    }));

	
	const automationEnabled = api.store.automationEnabled;

	$("h1", () => {
		$("#Buttons and sensors");
		if (automationEnabled) icons.create('click=', () => route.go(['group', groupId, 'addInput']));
	});

	if (automationEnabled) {
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
    
	if (automationEnabled) {
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
			$('label.item', {create: grow, destroy: shrink}, () => {
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
	}

	$('h1#Actions');
	$('div.item.link#Delete group', 'click=', async () => {
		if (!await askConfirm(`Are you sure you want to delete group '${group.name}'?`)) return;
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

function drawUserEditor(): void {
	drawUserEditorComponent({ routeState, notify, askConfirm, hashSecret });
}
