import { $, insertCss, onEach, derive, proxy, isEmpty } from "aberdeen";
import * as route from 'aberdeen/route';
import api from "../api";
import * as colors from '../colors';
import { drawBulbCircle } from "../components/color-picker";
import { routeState, manage, copyToClipboard } from '../ui';
import { drawUsersSection } from "./users-page";
import { askPrompt } from "../components/prompt";
import { createToast } from "../components/toasts";
import * as icons from '../icons';

const groupListClass = insertCss({
	'&': 'display:flex flex-direction:column',
	'.group.off h2': 'fg:$textMuted',
	'h2': 'white-space:nowrap overflow:hidden text-overflow:ellipsis',
	'.scenes': 'fg:$textMuted display:flex gap:$2 align-items:center overflow-x:auto scrollbar-width:none white-space:nowrap',
	'.scenes > *': {
		'&.active-scene': 'fg:$primary'
	}
});

export function drawTopPage(): void {
	if (isEmpty(api.store.groups) && api.connection.state !== 'connected') {
		if (api.connection.state === 'idle') {
			api.connection.mode = 'try';
		}
		$('div.empty#Connecting...');
	}

	routeState.title = '';
	routeState.subTitle = '';

	$("div.list mt:$2", groupListClass, () => {
		onEach(api.store.groups, (group, groupId) => {
			groupId = parseInt(groupId);
			
			$('div.item.group', () => {
				// Add 'off' class if lights are off
				$('.off=', derive(() => !group.lightState?.on));
				// Add 'disabled' class if user cannot control this group (CSS handles pointer-events:none)
				$('.disabled=', derive(() => !api.canControlGroup(groupId)));

				// Toggle button
				drawBulbCircle(group, groupId);
				
				// Name and chevron (includes spacer, min 20px padding)
				$('h2.link flex-grow:1 click=', () => route.go(['group', groupId]), () => {
					$('#', group.name);
					icons.chevronRight("vertical-align:middle");
				});
				
				// Scene icons (horizontally scrollable)
				$("div.scenes", () => {
					onEach(group.scenes, (scene, sceneId) => {
						sceneId = parseInt(sceneId);
						function onClick(): void {
							api.recallScene(groupId, sceneId);
						}
						const isActive = derive(() => group.activeSceneId === sceneId);
						const icon = icons.scenes[scene.name.toLowerCase()];
						if (icon) icon('.link click=', onClick, {'.active-scene': isActive});
						else $('div.scene.link#', scene.name, {'.active-scene': isActive}, 'click=', onClick);
					},  (scene, sceneId) => {
						const triggers = api.store.config.sceneTriggers[groupId]?.[Number(sceneId)] || [];
						return triggers.map(t => t.event).sort().concat([scene.name]);
					}); // Sort be trigger event, and then by name
					
					if (isEmpty(group.scenes)) {
						icons.scenes.normal('click=', () => api.setLightState(groupId, {on: false, brightness: 140, mireds: colors.CT_DEFAULT}));
					}
				});
			});
		}, group => group.name);
	});

	$("div.list", () => {
		onEach(api.store.lights, (device, ieee) => {
			$('div.item', () => {
				// Add 'disabled' class if user is not admin (CSS handles pointer-events:none)
				$('.disabled=', derive(() => !api.store.me?.isAdmin));
				drawBulbCircle(device, ieee);
				$('h2.link#', device.name, 'click=', () => route.go(['bulb', ieee]));
			});
		}, (device, ieee) => {
			return api.lightGroups[ieee] ? undefined : device.name;
		});
	});

	$(() => {
		if (manage.value && api.store.me?.isAdmin) {
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
			checked: api.store.config.allowRemote,
			disabled: remoteBusy.value,
			change: async (e: Event) => {
				const checked = (e.target as HTMLInputElement).checked;
				remoteBusy.value = true;
				try {
					await api.setRemoteAccess(checked);
					if (checked) {
						createToast('info', "Remote access enabled!", 'remote-access');
					}
				} catch (e: any) {
					createToast('error', "Failed to toggle remote access: " + e.message, 'remote-access');
				} finally {
					remoteBusy.value = false;
				}
			}
		});
		$('h2#Remote access');
		if (api.store.config.allowRemote && api.store.config.instanceId) {
			let address = api.store.config.instanceId;
			if (address.indexOf('.')<0) address = `ext-${address}.lightlynx.eu`;
			if (address.indexOf(':')<0 && api.store.config.externalPort) address += `:${api.store.config.externalPort}`;
			$('span.link opacity:0.6 #'+address, 'click=', (e: Event) => {
				e.stopPropagation();
				e.preventDefault();
				if (address) {
					copyToClipboard(address, 'Address');
				}
			});
		}
		icons.info('.link margin-left:auto click=', (e: Event) => {
			e.stopPropagation();
			e.preventDefault();
			window.open('https://www.lightlynx.eu/#remote-access', '_blank');
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
				checked: api.store.config.automationEnabled,
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
			icons.info('.link margin-left:auto click=', (e: Event) => {
				e.stopPropagation();
				e.preventDefault();
				window.open('https://www.lightlynx.eu/#automation', '_blank');
			});
		});

		drawLocationSetting();
	});
}

function drawLocationSetting(): void {
	$('div.item gap:$2', () => {
		$('h2 flex:0 #Location:');
		$('input type=number step=0.01 placeholder=Latitude width:5rem flex:initial', {
			value: api.store.config.latitude,
			change: async (e: Event) => {
				const lat = parseFloat((e.target as HTMLInputElement).value);
				const lon = api.store.config.longitude ?? 6.88;
				if (!isNaN(lat)) await api.setLocation(lat, lon);
			}
		});
		$('input type=number step=0.01 placeholder=Longitude width:5rem flex:initial', {
			value: api.store.config.longitude,
			change: async (e: Event) => {
				const lon = parseFloat((e.target as HTMLInputElement).value);
				const lat = api.store.config.latitude ?? 52.24;
				if (!isNaN(lon)) await api.setLocation(lat, lon);
			}
		});
		$('a #Use current', {
			click: (e: Event) => {
				e.preventDefault();
				if (!navigator.geolocation) {
					createToast('error', 'Geolocation not supported', 'location');
					return;
				}
				navigator.geolocation.getCurrentPosition(
					async (position) => {
						const lat = Math.round(position.coords.latitude * 100) / 100;
						const lon = Math.round(position.coords.longitude * 100) / 100;
						await api.setLocation(lat, lon);
						createToast('info', `Location set to ${lat}, ${lon}`, 'location');
					},
					(error) => {
						createToast('error', `Location error: ${error.message}`, 'location');
					},
					{ enableHighAccuracy: false, timeout: 10000 }
				);
			}
		});
		icons.info('.link margin-left:auto click=', (e: Event) => {
			e.stopPropagation();
			e.preventDefault();
			window.open('https://www.lightlynx.eu/#location', '_blank');
		});
	});
}

