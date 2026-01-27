import { $, proxy, ref, onEach, isEmpty, derive, peek } from 'aberdeen';
import { grow, shrink } from 'aberdeen/transitions';
import * as route from 'aberdeen/route';
import api from '../api';
import * as icons from '../icons';
import { drawColorPicker, drawBulbCircle } from '../components/color-picker';
import { Group } from '../types';
import { routeState, admin, askConfirm, askPrompt, lazySave, drawEmpty } from '../ui';
import { 
    deviceGroups, 
    groupInputs, 
    drawDeviceItem, 
    drawSceneEditor, 
    getGroupIdsFromDescription, 
    buildDescriptionWithGroupIds,
    getGroupTimeoutFromDescription,
    buildDescriptionWithGroupTimeout
} from '../app';

export function drawGroupPage(groupId: number): void {
    const optGroup = api.store.groups[groupId];
    if (!optGroup) {
        drawEmpty('No such group');
        return;
    }
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
            const isActive = derive(() => api.store.activeScenes[group.name] == scene.id && group.lightState?.on);
            $('div.item.link click=', recall, '.active-scene=', isActive, () => {
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

function drawGroupAddLight(
    group: Group, 
    groupId: number
): void {
    
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

function drawGroupAddInput(
    group: Group, 
    groupId: number
): void {
    
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

function drawGroupConfigurationEditor(
    group: Group,
    groupId: number
): void {
    
    const groupState = proxy(peek(() => {
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
        $('input type=text placeholder="Group name" bind=', ref(groupState, 'name'));
    });
    
    if (automationEnabled) {
        // Lights off timer checkbox
        $('label.item', () => {
            $('input type=checkbox', 'checked=', !!groupState.timeout, 'change=', (e: Event) => {
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
            $('label.item', 'create=', grow, 'destroy=', shrink, () => {
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
    $('div.item.link', icons.remove, '#Delete group', 'click=', async () => {
        if (!await askConfirm(`Are you sure you want to delete group '${group.name}'?`)) return;
        api.send("bridge", "request", "group", "remove", {id: group.name});
        route.back('/');
    });

    lazySave(() => {
        // Update description with timeout metadata
        const description = buildDescriptionWithGroupTimeout(groupState.description, groupState.timeout);
        
        return function() {
            // Update description with timeout metadata
            if (groupState.description !== description) {
                api.send("bridge", "request", "group", "options", {id: groupId, options: {description}});
                groupState.description = description;
            }
        }
    });


}

