'use strict';

// Useless, except for allowing the app to be installable on Android
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

import {observe, node, prop, Store, mount, text} from 'aberdeen'
import {route} from 'aberdeen/route';
import api from './api.ts'
import * as icons from './icons.ts'
import * as colors from './colors'
import drawColorPicker from "./color-picker"

import logoUrl from './holybulb.webp'

// Get a reference to the devices and groups, making sure they exist as objects
// (that may be empty, if the api is still loading).
const devices = api.store.makeRef("devices")
const groups = api.store.makeRef("groups")

function goTo(obj) {
	obj.search = obj.search || {}
	obj.search.admin = route.peek('search', 'admin')
	route.set(obj)
}

function isAdmin() {
	return !!route.get('search', 'admin')
}

function getBulbRgb(bulbRef) {
	let state = bulbRef.get('state') || {}
	if (!state.on) {
		return "#000000";
	} else if (state.color instanceof Array) {
		return colors.rgbToHex(colors.hsvToRgb(state.color[0], state.color[1], state.level/254*0.8+0.2))
	} else {
		return colors.rgbToHex(colors.miredsToRgb(state.color || 250, state.level ? state.level/254*0.8+0.2 : 1))
	}
}

function drawBulbCircle(bulbRef) {
	if (bulbRef.getType('light') === 'undefined') {
		icons.sensor()
		return
	}
	function onClick() {
		api.setLightState(bulbRef.index(), {on: !bulbRef.peek('state','on')})
	}
	node('.circle', {click: onClick}, () => {
		setBulbColor(getBulbRgb(bulbRef))
	})
}

function setBulbColor(rgb) {
	prop('style', {
		backgroundColor: rgb,
		boxShadow: rgb=='#000000' ? '' : `0 0 15px ${rgb}`,
	})
}

function drawEmpty(text) {
	node('.empty', text)
}

function drawBulb(ieee) {
	let bulbRef = devices.ref(ieee)
	if (bulbRef.getType() === 'undefined') return drawEmpty("No such light")
	let name = bulbRef.get('name')
	
	route.merge({title: name, subTitle: 'bulb'})
	node(".item", () => {
		drawBulbCircle(bulbRef)
		node('p', bulbRef.get('description'))
	})
	
	drawColorPicker(bulbRef)
}

function drawDump() {
	route.set('title', 'api.store.dump()')
	api.store.dump()
}

let deviceGroups = new Store({})
observe(() => {
	let input = groups.get()
	if (!input) return // Not ready yet
	let result = {}
	for (const [groupId, group] of input.entries()) {
		for (const ieee of group.members) {
			(result[ieee] = result[ieee] || []).push(groupId)
		}
	}
	deviceGroups.set(result)
})


function drawGroup(groupId) {
	let groupRef = groups.ref(groupId)
	if (groupRef.getType() === 'undefined') return drawEmpty('No such group')

	if (route.get('p', 2) === 'add') return drawGroupAddDevice(groupRef)

	function createScene() {
		let name = prompt("What should the new scene be called?")
		if (!name) return
		
		let freeId = 0
		while(groupRef.query({path: ['scenes', freeId], peek: true, depth: 1})) freeId++
		api.send(groupRef.get("name"), "set", {scene_store: {ID: freeId, name}})
	}

	route.merge({
		drawIcons: null,
		title: groupRef.get('name'),
		subTitle: 'group',
		drawIcons: isAdmin() ? () => {
			icons.rename({click: () => {
				let name = prompt(`What should be the new name for '${groupRef.get('name')}'?`, groupRef.get('name'))
				if (name) {
					api.send("bridge", "request", "group", "rename", {from: groupRef.get("name"), to: name, homeassistant_rename: true})
				}
			}})
			icons.remove({click: () => {
				if (confirm(`Are you sure you want to delete group '${groupRef.get('name')}'?`)) {
					api.send("bridge", "request", "group", "remove",{id:  groupRef.get("name")})
					goTo({path: '/', mode: 'back'})
				}
			}})
		} : undefined,
	})


	drawColorPicker(groupRef)
	
	node("h1", () => {
		text('Bulbs')
		if (isAdmin()) icons.create({click: () => goTo({p: ['group', groupRef.index(), 'add']}) })
	})

	node(".list", () => {
		groupRef.onEach("members", ieeeStore => {
			let deviceRef = devices.ref(ieeeStore.get())
			drawDeviceItem(deviceRef, groupRef)
		}, ieeeStore => devices.get(ieeeStore.get(), "name") || '-')

		if (groupRef.isEmpty("members")) {
			drawEmpty("None yet")
		}
	})
	
	node("h1", () => {
		text('Scenes')
		if (isAdmin()) icons.create({click: createScene})
	})
	node('.list', () => {
		groupRef.onEach("scenes", sceneRef => {
			function recall() {
				api.send(groupRef.get("name"), "set", {scene_recall: sceneRef.get('id')})
			}
			node(".item", {click: recall}, () => {
				node('h2.link', sceneRef.get('short_name'))
				if (isAdmin()) {
					function update(e) {
						e.stopPropagation()
						// e.preventDefault()
						if (!confirm(`Are you sure you want to overwrite the '${sceneRef.get('name')}' scene for group '${groupRef.get('name')}' with the current light state?`)) return;
						api.send(groupRef.get("name"), "set", {scene_store: {ID: sceneRef.get('id'), name: sceneRef.get('name')}})

						// Some devices (ikea) fail to store their state when that state is OFF. Make it explicit.
						for(let ieee of groupRef.get('members')) {
							if (!devices.get(ieee, 'state', 'on')) {
								api.send(ieee, "set", {scene_add: {ID: sceneRef.get('id'), group_id: groupRef.index(), name: sceneRef.get('name'), state: "OFF"}})
							}
						}
					}
					function remove(e) {
						e.stopPropagation()
						if (!confirm(`Are you sure you want to delete the '${sceneRef.get('name')}' scene for group '${groupRef.get('name')}'?`)) return;
						api.send(groupRef.get("name"), "set", {scene_remove: sceneRef.get('id')})
					}
					function rename(e) {
						e.stopPropagation()
						let name = prompt(`What should be the new name for '${sceneRef.get('name')}'?`, sceneRef.get('name'))
						if (name) {
							api.send(groupRef.get("name"), "set", {scene_rename: {ID: sceneRef.get('id'), name: name}})
						}
					}
					icons.rename({click: rename})
					icons.save({click: update})
					icons.remove({click: remove})
				}
			})

		}, sceneRef => sceneRef.get("suffix")+'#'+sceneRef.get("short_name"))
		if (groupRef.isEmpty("scenes")) {
			drawEmpty("None yet")
		}
	})
}

function drawGroupAddDevice(groupRef) {
	function addDevice(ieee) {
		api.send("bridge", "request", "group", "members", "add", {group: groupRef.get("name"), device: ieee})
		history.back()
	}
	route.merge({
		title: groupRef.get('name'),
		subTitle: 'add device'
	})
	node(".list", () => {
		devices.onEach(deviceRef => {
			 node(".item", () => {
				drawBulbCircle(deviceRef)
				node("h2.link", deviceRef.get('name'), {click: () => addDevice(deviceRef.index())})
			})
		}, deviceRef => {
			if (deviceRef.getType('light') === 'undefined') return // Skip sensors
			let inGroups = deviceGroups.get(deviceRef.index()) || []
			if (inGroups.includes(groupRef.index())) return // Skip, already in this group
			return [inGroups.length ? 1 : 0, deviceRef.get('name')]
		})
	})
}

function drawDeviceItem(deviceRef, groupRef) {
	node(".item", () => {
		drawBulbCircle(deviceRef)
		node("h2.link", deviceRef.get('name'), {click: () => goTo({p: ['bulb', deviceRef.index()]}) })
		if (isAdmin()) drawDeviceAdminIcons(deviceRef, groupRef)
	})
}

function drawDeviceAdminIcons(deviceRef, groupRef) {
	icons.rename({click: (e) => {
		e.stopPropagation()
		let name = prompt(`What should be the new name for '${deviceRef.get('name')}'?`, deviceRef.get('name'))
		if (name) {
			api.send("bridge", "request", "device", "rename", {from: deviceRef.get("name"), to: name, homeassistant_rename: true})
		}
	}})

	if (groupRef) {
		icons.remove({click: (e) => {
			api.send("bridge", "request", "group", "members", "remove", {group: groupRef.get("name"), device: deviceRef.get("name")})
		}})
	} else {
		icons.eject({click: (e) => {
			if (confirm(`Are you sure you want to detach '${deviceRef.get('name')}' from zigbee2mqtt?`)) {
				api.send("bridge", "request", "device", "remove", "remove", groupRef.index())
			}
		}})
	}
}

function drawMain() {
	route.merge({
		drawIcons: null,
		subTitle: null,
		drawIcons: isAdmin() ? () => {
			icons.create({click: permitJoin})
			icons.createGroup({click: createGroup})
			icons.bug({click: () => goTo({p: ['dump']}) })
		} : undefined,
	})

	node(".grid", () => {
		groups.onEach(groupRef => {
			node("", () => {
				let bgs = []
				let totalBri = 0
				for(let ieee of groupRef.get('members')) {
					let rgb = getBulbRgb(devices.ref(ieee))
					totalBri += [1,3,5].map(idx => parseInt(rgb.substr(idx,2), 16)).reduce((a,b)=>a+b, 0)
					bgs.push(rgb)
				}
				bgs.sort() // We could be doing something smarter here...
				if (bgs.length == 1) {
					prop('style', {backgroundColor: bgs[0]})
				} else {
					prop('style', {backgroundImage: `linear-gradient(45deg, ${bgs.join(', ')})`})
				}

				let bri = totalBri / bgs.length / 3
				prop('class', {
					bright: bri>127,
					off: bri<1,
				})

				node("h2.link", groupRef.get("short_name"), {click: () => goTo({p: ['group', groupRef.index()]}) })
				node(".options", () => {
					icons.off({click: () => api.setLightState(groupRef.index(), {on: false}) })
					groupRef.onEach("scenes", sceneRef => {
						function onClick() {
							api.send(groupRef.get("name"), "set", {scene_recall: sceneRef.get('id')})
						}
						const name = sceneRef.get("short_name")
						const lowerName = name.toLowerCase()
						const icon = icons.scenes[icons.sceneAliases[lowerName] || lowerName]
						if (icon) icon({click: onClick})
						else node(".scene.link", name, {click: onClick})
					}, sceneRef => sceneRef.get("suffix")+'#'+sceneRef.get("name"))

					if (groupRef.isEmpty()) {
						icons.scenes.normal({click: () => api.setLightState(groupRef.index(), {on: false, bri: 140, ct: colors.CT_DEFAULT}) })
					}
				})
			})
		}, group => group.get("name"))
	})

	// Devices not in any groups		
	node(".list", () => {
		devices.onEach(deviceRef => {
			drawDeviceItem(deviceRef)
		}, deviceRef => deviceGroups.get(deviceRef.index()) || deviceRef.getType('light') === 'undefined' ? undefined : deviceRef.get('name'))
	})
}

function createGroup() {
	let name = prompt("What should the group be called?")
	if (!name) return
	api.send("bridge", "request", "group", "add", {friendly_name: name})
}


function permitJoin() {
	api.send("bridge", "request", "permit_join", {value: true})
}
function disableJoin() {
	api.send("bridge", "request", "permit_join", {value: false})
}


mount(document.body, () => {
	node('.root', () => {
		node('header', () => {
			node("img.logo", {src: logoUrl, click: () => goTo({path: '/', mode: 'back'}) })
			observe(() => {
				if (route.get('path') !== '/') {
					icons.back({click: () => history.back()})
				}
				node("h1.title", () => {
					let title = route.get('title') || "HolyBulb";
					text(title)
					let subTitle = route.get('subTitle');
					if (subTitle) {
						node('span.subTitle', ' '+subTitle)
					}
				})
			})
			observe(() => {
				let drawIcons = route.get("drawIcons")
				if (drawIcons) {
					drawIcons()
				}
			})
			observe(() => {
				icons.admin({click: () => route.ref("search", "admin").modify(v => v?undefined:"y"), class: route.get('search', 'admin') ? 'icon on' : 'icon' })
			})
		})
		observe(() => {
			if (api.store.get('permit_join')) {
				node('.banner', () => {
					node('p', 'Permitting devices to join...')
					icons.stop({click: disableJoin})
				})
			}
		})
		
		const emptyDevices = devices.map(device => {
			let battery = device.get("meta", "battery")
			if (battery && battery <= 5) return device.get("name")
		})
		observe(() => {
			if (!emptyDevices.isEmpty()) {
				node('.banner', () => {
					node('p', 'Replace battery for ' + Array.from(emptyDevices.get().values()).join(' & ') + '!')
				})
			}
		})
	
		node('main', () => {
			let p = route.get('p')
			if (p[0]==='group') drawGroup(0|p[1]);
			else if (p[0] === 'bulb') drawBulb(p[1]);
			else if (p[0] === 'dump') drawDump();
			else drawMain();
		})
		// routeStack.onEach(route => {
		// 	node('main', () => {
		// 		observe(() => {
		// 			prop('style', {display: route.index() === routeStack.count()-1 ? 'block' : 'none'})
		// 		})
		// 		route.get('func').apply(route, route.query({path: ['args'], depth: 1})||[])
		// 	})
		// })
	})
})

api.connect()
