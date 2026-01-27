/// <reference types="vite/client" />
import './global-style';
import {$, proxy, ref, onEach, isEmpty, copy, unproxy, peek, partition, derive, insertCss} from 'aberdeen';
import * as route from 'aberdeen/route';
import { grow, shrink } from 'aberdeen/transitions';
import api from './api';
import * as icons from './icons';
import * as colors from './colors';
import { drawBulbCircle } from "./components/color-picker";
import { drawToasts } from './components/toasts';
import { drawHeader } from './components/header';
import { drawMenu } from './components/menu';
import { drawLandingPage } from './pages/landing-page';
import { drawBulbPage } from './pages/bulb-page';
import { drawGroupPage } from './pages/group-page';
import { drawConnectionPage } from './pages/connection-page';
import { drawUsersSection, drawUserEditor } from './pages/users-page';
import { drawRemoteInfoPage, drawAutomationInfoPage, drawBatteriesPage, drawDumpPage } from './pages/info-pages';
import { drawPromptPage } from './pages/prompt-page';
import { Device } from './types';
import { routeState, admin, toasts, notify, askConfirm, askPrompt, drawEmpty, lazySave } from './ui';
import swUrl from './sw.ts?worker&url';



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

const menuOpen = proxy(false);

// Register notify handler to show API messages as toasts
api.notifyHandlers.push(notify);

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

export function drawDeviceItem(device: Device, ieee: string): void {
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
	routeState.title = '';
	routeState.subTitle = '';

	$("div.list mt:$2", groupListClass, () => {
		onEach(api.store.groups, (group, groupId) => {
			$('div.item.group', () => {
				// Add 'on' class if any lights are on
				$('.off=', derive(() => !group.lightState?.on));

				// Toggle button
				drawBulbCircle(group, parseInt(groupId));
				
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

// Root container styles
const rootStyle = insertCss({
	'&': 'max-width:500px m: 0 auto; min-height:100% display:flex flex-direction:column transition: max-width 0.2s ease-in-out; position:relative',
	'&.landing-page': 'max-width:900px',
	'@media screen and (min-width: 501px)': 'box-shadow: 0 0 256px #f4810e20;'
});

const mainContainerStyle = insertCss('flex:1 position:relative overflow:hidden');

$('div', rootStyle, () => {
	$(() => {
		$('.landing-page:', isEmpty(api.store.servers) && route.current.path === '/');
	});

	drawHeader(updateAvailable, menuOpen, disableJoin);
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
				drawLandingPage();
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
			} else if (p[0] === 'prompt') {
				drawPromptPage();
			} else if (p[0] === 'remote-info') {
				drawRemoteInfoPage();
			} else if (p[0] === 'automation-info') {
				drawAutomationInfoPage();
			} else {
				drawTopPage();
			}
			route.persistScroll();
		}, {destroy: 'fadeOut', create: route.current.nav});
	}); // end mainContainer

	drawToasts(toasts);
}); // end root
