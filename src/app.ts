/// <reference types="vite/client" />
import './global-style';
import {$, proxy, copy, clone, onEach, isEmpty, derive, insertCss, peek, disableCreateDestroy} from 'aberdeen';
import * as route from 'aberdeen/route';
import api from './api';

import * as icons from './icons';
import * as colors from './colors';
import { drawBulbCircle } from "./components/color-picker";
import { drawToasts, createToast } from './components/toasts';
import { drawHeader } from './components/header';
import { drawLandingPage } from './pages/landing-page';
import { drawBulbPage } from './pages/bulb-page';
import { drawGroupPage } from './pages/group-page';
import { drawConnectionPage } from './pages/connection-page';
import { drawUsersSection, drawUserEditor } from './pages/users-page';
import { drawRemoteInfoPage, drawAutomationInfoPage, drawLocationInfoPage, drawBatteriesPage, drawDumpPage } from './pages/info-pages';
import { routeState, admin, copyToClipboard } from './ui';
import { askPrompt, drawPromptPage } from './components/prompt';
import swUrl from './sw.ts?worker&url';
import { preventFormNavigation } from './utils';

// Configure Aberdeen
route.setLog(true);
route.interceptLinks();
// Disable transitions in Playwright)
if ((navigator as any).webdriver) {
    disableCreateDestroy();
}
preventFormNavigation();

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

// Register notify handler to show API messages as toasts
api.notifyHandlers.push(createToast);

export const deviceGroups: Record<string, number[]> = {};
$(() => {
	let result: Record<string, number[]> = {};
	for (const [groupId, group] of Object.entries(api.store.groups)) {
		for (const ieee of group.members) {
			(result[ieee] = result[ieee] || []).push(parseInt(groupId));
		}
	}
	copy(deviceGroups, result);
});

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
			icons.info('.link margin-left:auto click=', (e: Event) => {
				e.stopPropagation();
				e.preventDefault();
				route.go(['automation-info']);
			});
		});

		drawLocationSetting();
	});
}

function drawLocationSetting(): void {
	$('div.item gap:$2', () => {
		$('h2 flex:0 #Location:');
		$('input type=number step=0.01 placeholder=Latitude width:5rem flex:initial', {
			value: api.store.latitude,
			change: async (e: Event) => {
				const lat = parseFloat((e.target as HTMLInputElement).value);
				const lon = api.store.longitude ?? 6.88;
				if (!isNaN(lat)) await api.setLocation(lat, lon);
			}
		});
		$('input type=number step=0.01 placeholder=Longitude width:5rem flex:initial', {
			value: api.store.longitude,
			change: async (e: Event) => {
				const lon = parseFloat((e.target as HTMLInputElement).value);
				const lat = api.store.latitude ?? 52.24;
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
			route.go(['location-info']);
		});
	});
}

const groupListClass = insertCss({
	'&': 'display:flex flex-direction:column',
	'.group.off h2': 'fg:$textMuted',
	'h2': 'white-space:nowrap overflow:hidden text-overflow:ellipsis',
	'.scenes': 'fg:$textMuted display:flex gap:$2 align-items:center overflow-x:auto scrollbar-width:none',
	'.scenes > *': {
		'&.active-scene': 'fg:$primary'
	}
});

function drawTopPage(): void {
	if (isEmpty(api.store.servers)) return drawLandingPage();

	if (isEmpty(api.store.groups) && api.store.connectionState !== 'connected') {
		if (api.store.connectionState === 'idle') {
			api.store.servers[0]!.status = 'try';
		}
		$('div.empty#Connecting...');
	}

	routeState.title = '';
	routeState.subTitle = '';

	$("div.list mt:$2", groupListClass, () => {
		onEach(api.store.groups, (group, groupId) => {
			const gid = parseInt(groupId);
			
			$('div.item.group', () => {
				// Add 'off' class if lights are off
				$('.off=', derive(() => !group.lightState?.on));
				// Add 'disabled' class if user cannot control this group (CSS handles pointer-events:none)
				$('.disabled=', derive(() => !api.canControlGroup(gid)));

				// Toggle button
				drawBulbCircle(group, gid);
				
				// Name and chevron (includes spacer, min 20px padding)
				$('h2.link flex:1 click=', () => route.go(['group', groupId]), () => {
					$('#', group.name);
					icons.chevronRight("vertical-align:middle");
				});
				
				// Scene icons (horizontally scrollable)
				$("div.scenes", () => {
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
						icons.scenes.normal('click=', () => api.setLightState(gid, {on: false, brightness: 140, color: colors.CT_DEFAULT}));
					}
				});
			});
		}, group => group.name);
	});
	
	$("div.list", () => {
		onEach(api.store.devices, (device, ieee) => {
			$('div.item', () => {
				// Add 'disabled' class if user is not admin (CSS handles pointer-events:none)
				$('.disabled=', derive(() => !api.store.isAdmin));
				drawBulbCircle(device, ieee);
				$('h2.link#', device.name, 'click=', () => route.go(['bulb', ieee]));
			});
		}, (device, ieee) => {
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
		if (api.store.remoteAccessEnabled) {
			const address = api.store.servers[0]?.externalAddress || "No address yet";
			$('span.link opacity:0.6 #'+address, 'click=', (e: Event) => {
				e.stopPropagation();
				e.preventDefault();
				if (api.store.servers[0]?.externalAddress) {
					copyToClipboard(api.store.servers[0].externalAddress, 'Address');
				}
			});
		}
		icons.info('.link margin-left:auto click=', (e: Event) => {
			e.stopPropagation();
			e.preventDefault();
			route.go(['remote-info']);
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

const mainStyle = insertCss({
    '&': 'overflow:auto box-shadow: 0 0 10px $primary; overflow-x:hidden position:absolute z-index:2 transition: transform 0.2s ease-out, opacity 0.2s ease-out; left:0 top:0 right:0 bottom:0 bg:$bg scrollbar-width:none -ms-overflow-style:none',
    '&::-webkit-scrollbar': 'display:none',
    '&.fadeOut': {
        '&': 'z-index:-1 opacity:0 pointer-events:none',
        '*': 'pointer-events:none'
    },
    '&.forward, &.go': 'transform:translateX(100%)',
    '&.back': 'transform:translateX(-100%)',
    '&.load': 'opacity:0',
    h1: {
        '&': 'overflow:hidden text-align:center font-size:1.125rem text-transform:uppercase font-weight:normal fg:$textMuted mt:$3 mb:$2 position:relative pointer-events:none',
        '.icon': 'position:absolute right:$2 vertical-align:middle cursor:pointer z-index:10 pointer-events:auto w:24px h:24px'
    }
});

// Root container styles
const rootStyle = insertCss({
	'&': 'max-width:500px m: 0 auto; min-height:100% display:flex flex-direction:column transition: max-width 0.2s ease-in-out; position:relative',
	'&.landing-page': 'max-width:900px',
	'@media screen and (min-width: 501px)': 'box-shadow: 0 0 256px #f4810e20;'
});

const mainContainerStyle = insertCss('flex:1 position:relative overflow:hidden');

$('div', rootStyle, () => {
	$(() => {
		$('.landing-page=', isEmpty(api.store.servers) && route.current.path === '/');
	});

	drawHeader(updateAvailable, disableJoin);
	
	$('div', mainContainerStyle, () => {
		const p = clone(route.current.p); // Subscribe to full 'p', so we'll create new main elements for each page
		
		const nav = peek(() => route.current.nav);
		$('main', mainStyle, 'destroy=fadeOut create=', nav, () => {
			$(() => {
				routeState.title = '';
				routeState.subTitle = '';
				delete routeState.drawIcons;

				// Show Landing page if no server active
				if (p[0] === 'connect') {
					drawConnectionPage();
				} else if (p[0]==='group' && p[1]) {
					drawGroupPage(parseInt(p[1]));
				} else if (p[0] === 'bulb' && p[1]) {
					drawBulbPage(p[1]);
				} else if (p[0] === 'batteries') {
					drawBatteriesPage();
				} else if (p[0] === 'user' && p[1]) {
					drawUserEditor();
				} else if (p[0] === 'dump') {
					drawDumpPage();
				} else if (p[0] === 'remote-info') {
					drawRemoteInfoPage();
				} else if (p[0] === 'automation-info') {
					drawAutomationInfoPage();
				} else if (p[0] === 'location-info') {
					drawLocationInfoPage();
				} else {
					drawTopPage();
				}
			});
			route.persistScroll();
		});
	}); // end mainContainer

	drawToasts();
}); // end root


// Show prompt modal, if any
$(() => {
	if (route.current.state.prompt) {
		drawPromptPage(route.current.state.prompt);
	}
})
