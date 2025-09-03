'use strict';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

import {$, proxy, ref, onEach, isEmpty, map, copy, dump} from 'aberdeen'
import {route, Route, persistScroll} from 'aberdeen/route';
import api from './api'
import * as icons from './icons'
import * as colors from './colors'
import {drawColorPicker, drawBulbCircle, getBulbRgb} from "./color-picker"
import { Device, Group } from './types'

import logoUrl from './logo.webp';


const routeState = proxy({
    title: '',
    subTitle: '',
    drawIcons: undefined as (() => void) | undefined
});

function isAdmin(): boolean {
	return !!route.search.admin
}

function drawEmpty(text: string): void {
    $('div.empty:' + text);
}

function drawBulb(ieee: string): void {
	let device = api.store.devices[ieee];
	if (!device) return drawEmpty("No such light")
	
	routeState.title = device.name;
	routeState.subTitle = 'bulb';
	$("div.item:" + device.description);
	
	drawColorPicker(device, ieee);
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

	if (route.p[2] === 'add') return drawGroupAddDevice(group, groupId);

	function createScene(): void {
		let name = prompt("What should the new scene be called?")
		if (!name) return
		
		let freeId = 0;
		while(group.scenes.find(s => s.id === freeId)) freeId++;
		api.send(group.name, "set", {scene_store: {ID: freeId, name}});
	}

	routeState.title = group.name;
	routeState.subTitle = 'group';
	routeState.drawIcons = isAdmin() ? () => {
		icons.rename({click: () => {
			let name = prompt(`What should be the new name for '${group.name}'?`, group.name)
			if (name) {
				api.send("bridge", "request", "group", "rename", {from: group.name, to: name, homeassistant_rename: true})
			}
		}});
		icons.remove({click: () => {
			if (confirm(`Are you sure you want to delete group '${group.name}'?`)) {
				api.send("bridge", "request", "group", "remove",{id: group.name});
				Object.assign(route, {path: '/', mode: 'back'});
			}
		}});
	} : undefined;

	drawColorPicker(group, groupId);
	
	$("h1", () => {
		$(":Bulbs");
		if (isAdmin()) icons.create({click: () => route.p = ['group', ''+groupId, 'add']});
	});

	$("div.list", () => {
		const devices = api.store.devices;
		onEach(group.members, (ieee) => { 
			let device = devices[ieee]!;
			drawDeviceItem(device, ieee, group);
		}, (ieee) => devices[ieee]?.name);

		if (isEmpty(group.members)) {
			drawEmpty("None yet");
		}
	});
	
	$("h1", () => {
		$(":Scenes");
		if (isAdmin()) icons.create({click: createScene});
	});
	
	$('div.list', () => {
		onEach(group.scenes || [], (scene) => {
			function recall(): void {
				api.send(group.name, "set", {scene_recall: scene.id});
			}
			$("div.item", {click: recall}, () => {
				$('h2.link:' + (isAdmin() ? scene.name : scene.shortName));
				if (isAdmin()) {
					function update(e: Event): void {
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
					function rename(e: Event): void {
						e.stopPropagation();
						let name = prompt(`What should be the new name for '${scene.name}'?`, scene.name);
						if (name) {
							api.send(group.name, "set", {scene_rename: {ID: scene.id, name: name}});
						}
					}
					icons.rename({click: rename});
					icons.save({click: update});
					icons.remove({click: remove});
				}
			});
		}, (scene) => `${scene.suffix}#${scene.shortName}`);
		$(() => {
			if (isEmpty(group.scenes)) drawEmpty("None yet");
		});
	});
}

function drawGroupAddDevice(group: Group, groupId: number): void {
	function addDevice(ieee: string): void {
		api.send("bridge", "request", "group", "members", "add", {group: group.name, device: ieee});
		history.back();
	}
	
	routeState.title = group.name;
	routeState.subTitle = 'add device';
	
	$("div.list", () => {
		onEach(api.store.devices, (device, ieee) => { 
			$("div.item", () => {
				drawBulbCircle(device, ieee);
				$("h2.link:" + device.name, {click: () => addDevice(ieee)});
			});
		}, (device, ieee) => {
			if (!device.lightCaps) return; // Skip sensors
			let inGroups = deviceGroups[ieee] || [];
			if (inGroups.includes(groupId)) return; // Skip, already in this group
			return [inGroups.length ? 1 : 0, device.name];
		});
	});
}

function drawDeviceItem(device: Device, ieee: string, group?: Group): void {
	$("div.item", () => {
		drawBulbCircle(device, ieee);
		$("h2.link:" + device.name, {click: () => route.p = ['bulb', ieee]});
		if (isAdmin()) drawDeviceAdminIcons(device, ieee, group);
	});
}

function drawDeviceAdminIcons(device: Device, ieee: string, group?: Group): void {
	icons.rename({click: (e: Event) => {
		e.stopPropagation();
		let name = prompt(`What should be the new name for '${device.name}'?`, device.name);
		if (name) {
			api.send("bridge", "request", "device", "rename", {from: device.name, to: name, homeassistant_rename: true});
		}
	}});

	let removing = proxy<boolean | string>(false);
	$(() => {
		if (group && !removing.value) {
			icons.remove({click: (e: Event) => {
				api.send("bridge", "request", "group", "members", "remove", {group: group.name, device: device.name});
				removing.value = true;
			}});
		} else if (removing.value !== 'eject') {
			icons.eject({click: (e: Event) => {
				if (confirm(`Are you sure you want to detach '${device.name}' from zigbee2mqtt?`)) {
					api.send("bridge", "request", "device", "remove", {id: ieee});
					removing.value = 'eject';
				}
			}});
		} else {
			icons.eject({$color: 'red', click: (e: Event) => {
				if (confirm(`Are you sure you want to FORCE detach '${device.name}' from zigbee2mqtt?`)) {
					api.send("bridge", "request", "device", "remove", {id: ieee, force: true});
				}
			}});
		}
	});
}

function drawMain(): void {
	routeState.title = '';
	routeState.subTitle = '';
	routeState.drawIcons = isAdmin() ? () => {
		icons.create({click: permitJoin});
		icons.createGroup({click: createGroup});
		icons.bug({click: () => route.p = ['dump']});
	} : undefined;

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

				$("h2.link:" + (isAdmin() ? group.name : group.shortName), {click: () => route.p = ['group', groupId]});
				$("div.options", () => {
					icons.off({click: () => api.setLightState(parseInt(groupId), {on: false}) });
					onEach(group.scenes, (scene) => {
						function onClick(): void {
							api.send(group.name, "set", {scene_recall: scene.id});
						}
						const name = scene.shortName;
						const lowerName = name.toLowerCase();
						const icon = icons.scenes[icons.sceneAliases[lowerName] || lowerName];
						if (icon) icon(".link", {click: onClick});
						else $("div.scene.link:" + name, {click: onClick});
					},  scene => `${scene.suffix}#${scene.name}`);

					if (!group.scenes || group.scenes.length === 0) {
						icons.scenes.normal({click: () => api.setLightState(parseInt(groupId), {on: false, brightness: 140, color: colors.CT_DEFAULT}) });
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
		$("img.logo", {src: logoUrl, click: () => Object.assign(route, {path: '/', mode: 'back'}) });
		$(() => {
			if (route.path !== '/') {
				icons.back({click: () => history.back()});
			}
			$("h1.title", () => {
				let title = routeState.title || "Light Lynx";
				$(`:${title}`);
				if (routeState.subTitle) {
					$('span.subTitle: ' + routeState.subTitle);
				}
			});
		});
		$(() => {
			if (routeState.drawIcons) {
				routeState.drawIcons();
			}
		});
		$(() => {
			icons.admin({
				click: () => {
					if (route.search.admin) {
						delete route.search.admin;
					} else {
						route.search.admin = "y";
					}
				},
				'.on': ref(route.search, 'admin'),
			});
		});
	});
	
	$(() => {
		if (api.store.permit_join) {
			$('div.banner', () => {
				$('p:Permitting devices to join...');
				icons.stop({click: disableJoin});
			});
		}
	});
	
	$(() => {
		const emptyDevices = map(api.store.devices, (device) => (device.meta?.battery||99) < 10 ? device.name : undefined); 
		$(() => {
			if (isEmpty(emptyDevices)) return;
			$('div.banner', () => {
				$('p:Replace battery for ' + Object.values(emptyDevices).join(' & ') + '!');
			});
		});
	});

	$('div.mainContainer', () => {
		const p = route.p;
		console.log('p', p);
		$('main', () => {
			if (p[0]==='group' && p[1]) drawGroup(parseInt(p[1]));
			else if (p[0] === 'bulb' && p[1]) drawBulb(p[1]);
			else if (p[0] === 'dump') drawDump();
			else drawMain();
			persistScroll();
		}, {destroy: 'fadeOut', create: route.nav});
	});
});

api.connect();
