import { $, proxy, ref, onEach, isEmpty, derive, partition, peek } from 'aberdeen';
import { grow, shrink } from 'aberdeen/transitions';
import * as route from 'aberdeen/route';
import api from '../api';
import * as icons from '../icons';
import { drawColorPicker, drawBulbCircle } from '../components/color-picker';
import { Device, Group } from '../types';
import { routeState, admin, lazySave } from '../ui';
import { askConfirm, askPrompt } from '../components/prompt';
import { lightGroups } from '../app';
import { drawSceneEditor } from './scene-editor';

// All buttons and sensors, partitioned by group. {groupId: {ieee: Toggle}}. Toggles that belong to
// no group are placed in '-1'.
const togglesByGroup = partition(api.store.toggles, device => device.linkedGroupIds.length ? device.linkedGroupIds : -1);

export function drawGroupPage(groupId: number): void {
    const optGroup = api.store.groups[groupId];
    if (!optGroup) {
        $('div.empty#No such group');
        return;
    }
    const group = optGroup;
    
    // Check if user has permission to access this group
    if (!api.canControlGroup(groupId)) {
        $("div.empty#You don't have access to this group");
        return;
    }
    
    if (route.current.p[2] === 'addLight') return drawGroupAddLight(group, groupId);
    if (route.current.p[2] === 'addInput') return drawGroupAddInput(group, groupId);
    if (route.current.p[2] === 'scene') return drawSceneEditor(group, groupId);
    
    async function createScene(): Promise<void> {
        const name = await askPrompt("What should the new scene be called?")
        if (!name) return
        
        let freeId = 0;
        while(group.scenes[freeId]) freeId++;
        api.send("scene", groupId, freeId, "store", name);
    }
    
    $(() => {
        routeState.title = group.name;
        routeState.subTitle = 'group';
    })
    
    drawColorPicker(group, groupId);
    
    $("h1#Scenes", () => {
        if (admin.value) icons.create('.link click=', createScene);
    });
    
    $('div.list', () => {
        onEach(group.scenes || [], (scene, sceneId) => {
            sceneId = parseInt(sceneId as string);
            function recall(): void {
                api.recallScene(groupId, sceneId);
            }
            const isActive = derive(() => group.activeSceneId === sceneId);
            $('div.item.link click=', recall, '.active-scene=', isActive, () => {
                let icon = icons.scenes[scene.name.toLowerCase()] || icons.empty;
                icon();
                $('h2#', scene.name);
                if (admin.value) {
                    function configure(e: Event): void {
                        e.stopPropagation();
                        route.go(['group', groupId, 'scene', sceneId]);
                    }
                    icons.configure('click=', configure);
                }
            });
        }, (scene) => scene.triggers.map(trigger => trigger.event).concat(scene.name));
        $(() => {
            if (isEmpty(group.scenes)) $('div.empty#None yet');
        });
    });

    $("h1#Bulbs", () => {
        if (admin.value) icons.create('.link click=', () => route.go(['group', groupId, 'addLight']));
    });
    
    $("div.list", () => {
        const lights = api.store.lights;
        onEach(group.lightIds, (ieee) => { 
            let light = lights[ieee]!;
            $('div.item', () => {
                drawBulbCircle(light, ieee);
                $('h2.link#', light.name, 'click=', () => route.go(['bulb', ieee]));
            });
        }, (ieee) => lights[ieee]?.name);
        
        if (isEmpty(group.lightIds)) {
            $('div.empty#None yet');
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
        onEach(api.store.lights, (device, ieee) => { 
            $("div.item", () => {
                drawBulbCircle(device, ieee);
                $('h2.link#', device.name, 'click=', () => addDevice(ieee));
            });
        }, (device, ieee) => {
            let inGroups = lightGroups[ieee] || [];
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
        api.linkToggleToGroup(groupId, ieee, true);
        route.up();
    }
    
    $("div.list", () => {
        onEach(api.store.toggles, (device, ieee) => { 
            $("div.item", () => {
                icons.sensor();
                $('h2.link#', device.name, 'click=', () => addDevice(ieee));
            });
        }, (device, _ieee) => {
            let inGroups = device.linkedGroupIds;
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
        // Convert group.timeout (seconds) back to value/unit for UI
        let timeout: {value: number, unit: 's' | 'm' | 'h' | 'd'} | null = null;
        if (group.timeout) {
            const seconds = group.timeout;
            if (seconds % 86400 === 0) {
                timeout = {value: seconds / 86400, unit: 'd'};
            } else if (seconds % 3600 === 0) {
                timeout = {value: seconds / 3600, unit: 'h'};
            } else if (seconds % 60 === 0) {
                timeout = {value: seconds / 60, unit: 'm'};
            } else {
                timeout = {value: seconds, unit: 's'};
            }
        }
        return {
            name: group.name,
            timeout,
        }
    }));

    const automationEnabled = api.store.config.automationEnabled;

    $("h1", () => {
        $("#Buttons and sensors");
        if (automationEnabled) icons.create('.link click=', () => route.go(['group', groupId, 'addInput']));
    });

    if (automationEnabled) {
        $('div.list', () => {
            onEach(togglesByGroup[groupId] || {}, (device, ieee) => {
                $("div.item", () => {
                    icons.sensor();
                    $("h2#", device.name);
                    icons.remove('.link click=', () => {
                        api.linkToggleToGroup(groupId, ieee, false);
                    });
                });
            });
            if (isEmpty(togglesByGroup[groupId] || {})) {
                $('div.empty#None yet');
            }
        });
    }

    $('h1#Settings');
    
    // Group name
    $('div.list', () => {

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
    });

    $('h1#Actions');
    $('div.list div.item.link', icons.remove, '#Delete group', 'click=', async () => {
        if (!await askConfirm(`Are you sure you want to delete group '${group.name}'?`)) return;
        api.send("bridge", "request", "group", "remove", {id: group.name});
        route.back('/');
    });

    lazySave(() => {
        return function() {
            // Update group timeout - convert UI value/unit to seconds
            const t = groupState.timeout;
            const secs = t ? t.value * {s: 1, m: 60, h: 3600, d: 86400}[t.unit] : null;
            api.setGroupTimeout(groupId, secs);
        }
    });


}


