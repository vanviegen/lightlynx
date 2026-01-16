/// <reference types="vite/client" />
import {$, proxy, ref, onEach, isEmpty, copy, dump, unproxy, peek, partition, clone} from 'aberdeen';
import * as route from 'aberdeen/route';
import { grow, shrink } from 'aberdeen/transitions';
import api from './api';
import * as icons from './icons';
import * as colors from './colors';
import { drawColorPicker, drawBulbCircle, getBulbRgb } from "./color-picker";
import { Device, Group, ServerCredentials, User } from './types';
import { hashSecret } from './hash';

import logoUrl from './logo.webp';
import swUrl from './sw.ts?worker&url';

route.setLog(true);

if ('serviceWorker' in navigator) {
	navigator.serviceWorker.register(swUrl, { type: import.meta.env.DEV ? 'module' : 'classic' });
	
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
const menuOpen = proxy(false);

interface Toast {
	id: number;
	message: string;
}
const toasts = proxy([] as Toast[]);
export function notify(message: string) {
	const id = Math.random();
	toasts.push({ id, message });
	setTimeout(() => {
		const index = toasts.findIndex(t => t.id === id);
		if (index !== -1) toasts.splice(index, 1);
	}, 3000);
}

const confirmState = proxy({
	message: '',
	resolve: null as ((v: boolean) => void) | null
});

async function askConfirm(message: string): Promise<boolean> {
	return new Promise(resolve => {
		confirmState.message = message;
		confirmState.resolve = resolve;
		route.go(['confirm']);
	});
}

const promptState = proxy({
	message: '',
	value: '',
	resolve: null as ((v: string | null) => void) | null
});

async function askPrompt(message: string, defaultValue = ''): Promise<string | null> {
	return new Promise(resolve => {
		promptState.message = message;
		promptState.value = defaultValue;
		promptState.resolve = resolve;
		route.go(['prompt']);
	});
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

function isExtensionInstalled(ext: 'api' | 'automation'): boolean {
	return api.store.extensions.some(e => e.name === `lightlynx-${ext}.js`);
}

function promptInstallExtension(ext: 'api' | 'automation', reason: string): boolean {
	const isInstalled = isExtensionInstalled(ext);
	$(() => {
		if (admin.value && !api.store.extensions.some(e => e.name === `lightlynx-${ext}.js`)) {
			$('section.row gap:1rem align-items:start', () => {
				$('p flex:1 #', `${reason} requires our `, () => {
					$('strong#', ext);
					$('# extension.');
				});
				const busy = proxy(false);
				$(`button.secondary flex:0 margin-top:0.5rem #Install`, {'.busy': busy, click: async () => {
					busy.value = true;
					try {
						await api.installExtension(`lightlynx-${ext}`);
					} finally {
						busy.value = false;
					}
				}});
			});
		}
	});
	return isInstalled;
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
				$(`div.item.link#Remove from "${group.name}"`, {".busy": busy}, icons.remove, {click: async function() {
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
			$('div.item.link#Delete', icons.eject, {click: async function() {
				if (await askConfirm(`Are you sure you want to detach '${device.name}' from zigbee2mqtt?`)) {
					removing.value = true;
					try {
						await api.send("bridge", "request", "device", "remove", {id: ieee});
					} finally {
						removing.value = false;
					}
				}
			}});
		} else {
			$('div.item.link#Force delete', icons.eject, {click: async function() {
				if (await askConfirm(`Are you sure you want to FORCE detach '${device.name}' from zigbee2mqtt?`)) {
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

function drawConfirmPage(): void {
	routeState.title = 'Confirmation';
	if (!confirmState.resolve) {
		route.back('/');
		return;
	}

	$('div padding:8px display:flex flex-direction:column gap:2em', () => {
		$('p font-size:1.2em text-align:center #', confirmState.message);
		
		$('div.row gap:1em', () => {
			$('button.secondary flex:1 #No', 'click=', () => {
				const resolve = confirmState.resolve;
				confirmState.resolve = null;
				if (resolve) resolve(false);
				route.back();
			});
			$('button.primary flex:1 #Yes', 'click=', () => {
				const resolve = confirmState.resolve;
				confirmState.resolve = null;
				if (resolve) resolve(true);
				route.back();
			});
		});
	});
}

function drawPromptPage(): void {
	routeState.title = 'Input';
	if (!promptState.resolve) {
		route.back('/');
		return;
	}

	$('div padding:8px display:flex flex-direction:column gap:2em', () => {
		$('p font-size:1.2em text-align:center #', promptState.message);
		
		$('input type=text width:100%', {
			value: promptState.value,
			input: (e: any) => promptState.value = e.target.value,
			keydown: (e: KeyboardEvent) => {
				if (e.key === 'Enter') {
					const resolve = promptState.resolve;
					promptState.resolve = null;
					if (resolve) resolve(promptState.value);
					route.back();
				}
			}
		});

		$('div.row gap:1em', () => {
			$('button.secondary flex:1 #Cancel', 'click=', () => {
				const resolve = promptState.resolve;
				promptState.resolve = null;
				if (resolve) resolve(null);
				route.back();
			});
			$('button.primary flex:1 #OK', 'click=', () => {
				const resolve = promptState.resolve;
				promptState.resolve = null;
				if (resolve) resolve(promptState.value);
				route.back();
			});
		});
	});
}

function drawRemoteInfoPage(): void {
	routeState.title = 'Remote Access';
	routeState.subTitle = 'Information';

	$('div padding:8px line-height:1.6em', () => {
		$('h1 margin-top:0 #How it works');
		$('p#', 'Remote access allows you to control your lights from anywhere in the world. When enabled, your server becomes accessible via a secure, encrypted connection.');
		
		$('h1#Simplified Networking');
		$('p#', 'We use two technologies to make this "zero-config":');
		$('ul', () => {
			$('li#', () => {
				$('strong#UPnP: ');
				$('#The server automatically asks your router to open a port (43597) so it can be reached from the internet.');
			});
			$('li#', () => {
				$('strong#Race-to-connect: ');
				$('#The app is smart. It tries to connect to your server locally and remotely at the same time, and picks whichever responds first. This makes the transition between home Wi-Fi and mobile data instant and seamless.');
			});
		});

		$('h1#Security');
		$('p#', 'Your security is our priority:');
		$('ul', () => {
			$('li#', 'All communication is encrypted using SSL (HTTPS/WSS).');
			$('li#', 'Authentication is handled via PBKDF2 hashing. Your password is never sent or stored in plain text.');
			$('li#', 'You can restrict remote access on a per-user basis in the user management settings.');
		});

		$('button.primary margin-top:2em width:100% #Got it', 'click=', () => route.up());
	});
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
	
	async function createScene(): Promise<void> {
		const name = await askPrompt("What should the new scene be called?")
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

function drawManagementSection(): void {
	$('h1#Management');
	$('div.list', () => {
		$(() => {
			const active = api.store.permitJoin;
			$('div.item.link', {click: active ? disableJoin : permitJoin}, () => {
				(active ? icons.stop : icons.create)();
				$('h2#', active ? 'Stop searching' : 'Permit join');
				if (active) $('p#Permitting devices to join...');
			});
		});

		$('div.item.link', {click: createGroup}, () => {
			icons.createGroup();
			$('h2#Create group');
		});
	});
}

function drawBatteries(): void {
	routeState.title = 'Batteries';
	$('div.list', () => {
		onEach(api.store.devices, (device, ieee) => {
			if (device.lightCaps) return;
			const b = device.meta?.battery;
			$('div.item.link', {click: () => route.go(['bulb', ieee])}, () => {
				$('h2#', device.name);
				$('p font-weight:bold flex:0 #', b !== undefined ? `${Math.round(b)}%` : 'Unknown', b==undefined ? '' : b <= 5 ? '.critical' : b <= 15 ? '.warning' : '');
			});
		}, (device) => {
			if (device.lightCaps) return;
			return [(device.meta?.battery ?? 101), device.name]; 
		});
	});
}

function drawMain(): void {
	routeState.title = '';
	routeState.subTitle = '';


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

	$(() => {
		if (admin.value) {
			drawRemoteAccessToggle();
			drawManagementSection();
			drawUsersSection();
			drawExtensionsSection();
		}
	});
}

function drawRemoteAccessToggle(): void {
	const remoteBusy = proxy(false);
	$('h1#Remote Access');
	$('div.item', () => {
		$('label flex:1 row gap:1rem align-items:center', () => {
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
							notify("Remote access enabled. Ensure your router supports UPnP or you have manually forwarded port 43597.");
						}
					} catch (e: any) {
						notify("Failed to toggle remote access: " + e.message);
					} finally {
						remoteBusy.value = false;
					}
				}
			});
			$('h2#Enable remote access');
		});
		icons.info('margin-left:auto click=', (e: Event) => {
			e.stopPropagation();
			e.preventDefault();
			route.go(['remote-info']);
		});
	});
}

function drawLandingPage(): void {
	routeState.title = 'Light Lynx';
	
	$('div.landing', () => {
		$('div.hero', () => {
			$('h1#Control your lights, simply.');
			$('p#Light Lynx is a modern, fast, and mobile-friendly interface for Zigbee2MQTT. No hubs, no clouds, just your home.');
		});

		$('button.primary#Connect to a server', {click: () => route.go(['connect'])});
		
		$('div.features', () => {
			$('div.feature', () => {
				icons.zap();
				$('h3#Reactive UI');
				$('p#Instant feedback with optimistic updates. No more waiting for your lights to catch up.');
			});
			$('div.feature', () => {
				icons.palette();
				$('h3#Full Control');
				$('p#Manage groups, scenes, and automation triggers directly from your phone.');
			});
			$('div.feature', () => {
				icons.cloudOff();
				$('h3#Local First');
				$('p#Works entirely on your local network. Your data stays your data.');
			});
		});
	});
}

function drawConnectionPage(): void {
	const editMode = !!route.current.search.edit;
	routeState.title = editMode ? 'Edit connection' : 'Create connection';
	routeState.subTitle = 'Zigbee2MQTT';
	
	const serverToEdit = editMode ? unproxy(api.store.servers)[0] : undefined;
	const formData = proxy({
		localAddress: serverToEdit?.localAddress || '',
		username: serverToEdit?.username || 'admin',
		password: '', // Don't pre-fill password in UI if it's stored as secret
	});

	// Watch for connection success and navigate away
	$(() => {
		if (api.store.connectionState === 'connected') {
			route.back('/');
		}
	});

	// Watch for connection error and show toast
	$(() => {
		if (api.store.lastConnectError) {
			notify(api.store.lastConnectError);
			api.store.lastConnectError = '';
		}
	});

	async function handleSubmit(e: Event): Promise<void> {
		e.preventDefault();
		
		let secret = serverToEdit?.secret || '';
		if (formData.password) {
			secret = await hashSecret(formData.username, formData.password);
		}
		let externalAddress = serverToEdit?.externalAddress;
		if (formData.localAddress !== serverToEdit?.localAddress) {
			// Reset external address if local address has changed
			externalAddress = undefined;
		}

		const server: ServerCredentials = {
			localAddress: formData.localAddress,
			username: formData.username,
			secret,
			externalAddress,
			status: 'try',  // Try once, becomes 'enabled' on success or 'disabled' on failure
		};
		
		if (editMode) {
			// Update existing server credentials
			Object.assign(api.store.servers[0]!, server);
		} else {
			// Add new server
			api.store.servers.unshift(server);
			route.current.search.edit = 'y'; // Now we're editing this one
		}
	}

	async function handleDelete(): Promise<void> {
		if (await askConfirm('Are you sure you want to remove these credentials?')) {
			api.store.servers.shift();
			route.back('/');
		}
	}
	
	$('div.login-form', () => {
		$('form submit=', handleSubmit, () => {
			$('div.field', () => {
				$('label#Server Address');
				$('input placeholder=', 'e.g. 192.168.1.5[:port]', 'required=', true, 'bind=', ref(formData, 'localAddress'));
			});
			
			$('div.field', () => {
				$('label#Username');
				$('input required=', true, 'bind=', ref(formData, 'username'));
			});
			
			$('div.field', () => {
				$('label#Password');
				$('input type=password bind=', ref(formData, 'password'), 'placeholder=', editMode ? 'Leave empty to keep current' : '');
			});
			
			const busy = api.store.connectionState === 'connecting' || api.store.connectionState === 'authenticating';
			
			$('div.row margin-top:1em', () => {
				if (editMode) {
					$('button.danger text=Delete click=', handleDelete);
				}
				$('button.secondary text=Cancel click=', () => {
					route.back('/');
				});
				$('button.primary type=submit', {'.busy': busy}, () => {
					$(busy ? '#Connecting...' : '#Connect');
				});
			});
		});
	});
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

$('div.root', () => {
	$(() => {
		$({'.landing-page': isEmpty(api.store.servers) && route.current.path === '/'});
	});
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
						$('span.subTitle#'+routeState.subTitle);
					}
				});
			});
			$(() => {
				if (routeState.drawIcons) {
					routeState.drawIcons();
				}
			});
			$(() => {
				if (!isEmpty(api.store.servers) && api.store.connectionState !== 'connected') {
					const spinning = api.store.connectionState === 'connecting' || api.store.connectionState === 'authenticating';
					icons.reconnect({'.spinning=': spinning}, '.off click=', () => route.go({p: ['connect'], search: {edit: 'y'}}));
				}
			});
			$(() => {
				if (api.store.permitJoin) {
					icons.create('.on.spinning click=', disableJoin);
				}
			});
			$(() => {
				if (isEmpty(api.store.servers)) return;
				let lowest = 100;
				for (const device of Object.values(api.store.devices)) {
					const b = device.meta?.battery;
					if (b !== undefined && b < lowest) lowest = b;
				}
				if (lowest > 15) return;
				const critical = lowest <= 5;
				const icon = critical ? icons.batteryEmpty : icons.batteryLow;
				icon({
					'.critical': critical,
					'.warning': !critical,
					'.pulse': critical,
					click: () => route.go(['batteries'])
				});
			});
			$(() => {
				if (isEmpty(api.store.servers)) return;
				icons.more('click=', () => menuOpen.value = !menuOpen.value);
			});
			$(() => {
				if (admin.value) {
					icons.admin('.on click=', () => admin.value = false);
				}
			});
		});

	$(() => {
		if (!menuOpen.value) return;
		$('div.menu-overlay click=', () => menuOpen.value = false, {create: 'fadeIn', destroy: 'fadeOut'});
		$('div.menu', {create: grow, destroy: shrink}, () => {
			// Admin Toggle
			$('div.menu-item click=', () => {
				admin.value = !admin.value;
				menuOpen.value = false;
			}, () => {
				icons.admin();
				$(`# ${admin.value ? 'Leave' : 'Enter'} admin mode`);
			});

			if (admin.value) {
				$('div.menu-item click=', () => {
					menuOpen.value = false;
					route.go(['dump']);
				}, () => {
					icons.bug();
					$(`# Debug info`);
				});
			}

			$('div.menu-divider');

			// Logout
			$('div.menu-item click=', async () => {
				route.go({p: ['connect'], search: {edit: 'y'}})
				menuOpen.value = false;
			}, () => {
				icons.edit();
				$(`# Manage server settings`);
			});

			// Switch servers
			onEach(api.store.servers, (server, index) => {
				if (index === 0) return;
				$('div.menu-item click=', () => {
					menuOpen.value = false;
					// Move selected server to front and enable it
					const selectedServer = api.store.servers.splice(index, 1)[0];
					if (selectedServer) {
						selectedServer.status = 'enabled';
						api.store.servers.unshift(selectedServer);
					}
					route.go(['/']);
				}, () => {
					icons.reconnect();
					$(`# Switch to ${server.localAddress}`);
				});
			});

			if (api.store.servers.length > 1) {
				$('div.menu-divider');
			}

			// Connect to another
			$('div.menu-item click=', () => {
				menuOpen.value = false;
				route.go(['connect']);
			}, () => {
				icons.create();
				$(`#Add a server`);
			});
		});
	});
	
	$('div.mainContainer', () => {
		const p = route.current.p;
		$('main', () => {
			routeState.title = '';
			routeState.subTitle = '';
			delete routeState.drawIcons;

			// Show Landing page if no server active
			if (p[0] === 'connect') {
				drawConnectionPage();
			} else if (isEmpty(api.store.servers)) {
				drawLandingPage();
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
			} else if (p[0] === 'confirm') {
				drawConfirmPage();
			} else if (p[0] === 'prompt') {
				drawPromptPage();
			} else if (p[0] === 'remote-info') {
				drawRemoteInfoPage();
			} else {
				drawMain();
			}
			route.persistScroll();
		}, {destroy: 'fadeOut', create: route.current.nav});
	});

	// Toast container
	$('div.toasts', () => {
		onEach(toasts, (toast: Toast) => {
			$('div.toast#', toast.message);
		});
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

	
	const hasExtension = isExtensionInstalled('automation');
	$('h1#Triggers', () => {
		if (hasExtension) icons.create('click=', () => sceneState.triggers.push({type: '1'}));
	});
    if (hasExtension) {
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
	} else {
		promptInstallExtension('automation', 'Triggering scenes from buttons and sensors')
	}


	$('h1#Actions');
	async function save(e: Event): Promise<void> {
		e.stopPropagation();
		if (!await askConfirm(`Are you sure you want to overwrite the '${scene.name}' scene for group '${group.name}' with the current light state?`)) return;
		api.send(group.name, "set", {scene_store: {ID: scene.id, name: scene.name}});

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

	
	const hasExtension = isExtensionInstalled('automation');

	$("h1", () => {
		$("#Buttons and sensors");
		if (hasExtension) icons.create('click=', () => route.go(['group', groupId, 'addInput']));
	});

	if (hasExtension) {
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
	} else {
	    promptInstallExtension('automation', 'Connecting buttons and sensors to a group requires our automation Z2M extension.');
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
    
	if (hasExtension) {
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
	} else {
		promptInstallExtension('automation', 'The auto-off timer requires our automation Z2M extension.');
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

function drawUsersSection(): void {
	const isApiInstalled = isExtensionInstalled('api');

	$("h1#Users", () => {
		if (isApiInstalled) icons.create('click=', () => route.go(['user', 'new']));
	});
	
	if (!isApiInstalled) {
		promptInstallExtension('api', 'The Light Lynx API extension is required for user management.');
		return;
	}

	$('div.list', () => {
		// Implicit admin user
		if (!api.store.users['admin']) {
			$('div.item.link', {click: () => route.go(['user', 'admin'])}, () => {
				icons.shield();
				$('h2#admin');
				$('p#System Administrator');
			});
		}

		onEach(api.store.users, (user, username) => {
			$('div.item.link', {click: () => route.go(['user', username])}, () => {
				(user.isAdmin ? icons.shield : icons.user)();
				$('h2#', username);
				if (user.allowRemote) $('span.badge#Remote');
			});
		});
	});
}

function drawExtensionsSection(): void {
	$('h1#Z2M Extensions');

	const uninstall = async (name: string, busy: {value: boolean}) => {
		let warning = `Are you sure you want to uninstall '${name}'?`;
		if (name === 'lightlynx-api.js') {
			warning += "\n\nWARNING: User management and optimized state will be disabled!";
		}
		if (name === 'lightlynx-automation.js') {
			warning += "\n\nWARNING: Buttons and sensors will no longer trigger actions!";
		}

		if (await askConfirm(warning)) {
			busy.value = true;
			try {
				await api.send("bridge", "request", "extension", "remove", {name});
			} finally {
				busy.value = false;
			}
		}
	};

	$('div.list', () => {
		const standard = ['api', 'automation'];
		for (const name of standard) {
			const fullName = `lightlynx-${name}.js`;
			$(() => {
				const ext = api.store.extensions.find(e => e.name === fullName);
				$('div.item', () => {
					icons.extension();
					$('h2 flex:1 #', name);
					if (ext) {
						const version = api.extractVersionFromExtension(ext.code);
						if (version) $('p#v' + version);
						
						const busy = proxy(false);
						icons.remove('.link', {'.busy': busy, click: () => {
							uninstall(fullName, busy);
						}});
					} else {
						$('p#N/A');
						const busy = proxy(false);
						icons.create('.link', {'.busy': busy, click: async () => {
							busy.value = true;
							try {
								await api.installExtension(`lightlynx-${name}`);
							} finally {
								busy.value = false;
							}
						}});
					}
				});
			});
		}
	});
}

function drawUserEditor(): void {
	const username = route.current.p[1]!;
	const isNew = username === 'new';
	const isAdminUser = username === 'admin';
	
	const storeUser = api.store.users[username];
	const user = isNew ? proxy<User>({
		isAdmin: false,
		allowedDevices: [],
		allowedGroups: [],
		allowRemote: true,
		password: ''
	}) : proxy(clone(unproxy(storeUser || {
		isAdmin: true,
		allowedDevices: [],
		allowedGroups: [],
		allowRemote: false,
		password: ''
	})));
	
	const newUsername = proxy('');

	$(() => {
		routeState.title = isNew ? 'New User' : username;
		routeState.subTitle = 'user';
	});

	$('h1#Settings');
	if (isNew) {
		$('div.item', () => {
			$('h2#Username');
			$('input', {bind: newUsername, placeholder: 'Username'});
		});
	}

	$('div.item', () => {
		$('h2#Password');
		$('input type=password', {bind: ref(user, 'password'), placeholder: isNew ? 'Required' : 'Leave empty to keep current'});
	});

	if (!isAdminUser) {
		$('label.item', () => {
			$('input type=checkbox bind=', ref(user, 'isAdmin'));
			$('h2#Admin access');
		});

		$('label.item', () => {
			$('input type=checkbox bind=', ref(user, 'allowRemote'));
			$('h2#Allow remote access');
		});
	}

	$(() => {
		if (user.isAdmin) return;

		$('h1#Permissions');
		$('h2#Allowed Groups');
		$('div.list', () => {
			onEach(api.store.groups, (group, groupId) => {
				$('label.item', () => {
					const gid = parseInt(groupId);
					const checked = user.allowedGroups.includes(gid);
					$('input type=checkbox', {
						checked,
						change: (e: any) => {
							if (e.target.checked) user.allowedGroups.push(gid);
							else user.allowedGroups = user.allowedGroups.filter((id: number) => id !== gid);
						}
					});
					$('h2#', group.name);
				});
			});
			$(() => { if (isEmpty(api.store.groups)) drawEmpty("No groups"); });
		});

		$('h2#Allowed Devices');
		$('div.list', () => {
			onEach(api.store.devices, (device, ieee) => {
				if (!device.lightCaps) return;
				$('label.item', () => {
					const checked = user.allowedDevices.includes(ieee);
					$('input type=checkbox', {
						checked,
						change: (e: any) => {
							if (e.target.checked) user.allowedDevices.push(ieee);
							else user.allowedDevices = user.allowedDevices.filter((id: string) => id !== ieee);
						}
					});
					$('h2#', device.name);
				});
			});
			$(() => { if (isEmpty(api.store.devices)) drawEmpty("No devices"); });
		});
	});

	$('h1#Actions');
	const busy = proxy(false);
	$('div.item.link#Save', {'.busy': busy}, icons.save, 'click=', async () => {
		busy.value = true;
		try {
			const finalUsername = isNew ? newUsername.value : username;
			if (!finalUsername) throw new Error("Username required");
			const payload: any = unproxy(user);
			
			if (user.password) {
				payload.secret = await hashSecret(finalUsername, user.password);
			}
			delete payload.password;
			
			const userPayload = {
				username: finalUsername,
				...payload
			};
			if (isNew) {
				await api.addUser(userPayload);
			} else {
				await api.updateUser(userPayload);
			}
			route.up();
		} catch (e: any) {
			notify(e.message || "Failed to save user");
		} finally {
			busy.value = false;
		}
	});

	if (!isNew && !isAdminUser) {
		$('div.item.link.danger#Delete user', icons.remove, {
			click: async () => {
				if (await askConfirm(`Are you sure you want to delete user '${username}'?`)) {
					await api.deleteUser(username);
					route.up();
				}
			}
		});
	}
}
