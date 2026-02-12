import { $, proxy, ref, onEach, isEmpty, derive, partition, peek, insertCss } from 'aberdeen';
import { grow, shrink } from 'aberdeen/transitions';
import * as route from 'aberdeen/route';
import api from '../api';
import * as icons from '../icons';
import { drawColorPicker, drawToggle } from '../components/color-picker';
import { Group } from '../types';
import { routeState, manage, lazySave } from '../ui';
import { askConfirm, askPrompt } from '../components/prompt';
import { drawSceneEditor } from './scene-editor';
import { Trigger } from '../types';

const triggerBadgeClass = insertCss({
    '&': 'fg:$textMuted font-size:16px font-weight:bold ml:$3',
    '> *': 'vertical-align:middle fg: inherit !important; ml:$2',
});

function drawTriggerBadges(triggers: Trigger[]): void {
    if (!triggers?.length) return;
    $('span', triggerBadgeClass, () => {
        for (const trigger of triggers) {
            if (trigger.event >= '1' && trigger.event <= '5') {
                $('span #', trigger.event);
            } else if (trigger.event === 'sensor') {
                icons.sensor("w:14px h:14px");
            } else if (trigger.event === 'time') {
                icons.timer("w:14px h:14px");
            }
        }
    });
}

// All buttons and sensors, partitioned by group. {groupId: {ieee: Toggle}}. Toggles that belong to
// no group are placed in '-1'.
const togglesByGroup = partition(api.store.toggles, device => {
    const ieee = Object.keys(api.store.toggles).find(key => api.store.toggles[key] === device)!;
    const linkedGroupIds = api.store.config.toggleGroupLinks[ieee] || [];
    return linkedGroupIds.length ? linkedGroupIds : -1;
});

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
    
    if (!isEmpty(group.lightIds)) drawColorPicker(group, groupId);
    
    $('h1#Scenes', () => {
        if (manage.value && api.canControlGroup(groupId) === 'manage') icons.create('.link click=', createScene);
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
                $('h2', () => {
                    $('#', scene.name);
                    const triggers = api.store.config.sceneTriggers[groupId]?.[sceneId] || [];
                    drawTriggerBadges(triggers);
                });
                if (manage.value && api.canControlGroup(groupId) === 'manage') {
                    function configure(e: Event): void {
                        e.stopPropagation();
                        route.go(['group', groupId, 'scene', sceneId]);
                    }
                    icons.configure('click=', configure);
                }
            });
        }, (scene, sceneId) => {
            const triggers = api.store.config.sceneTriggers[groupId]?.[Number(sceneId)] || [];
            return triggers.map(trigger => trigger.event).concat(scene.name);
        });
        $(() => {
            if (isEmpty(group.scenes)) $('div.empty#None yet');
        });
    });

    $("h1#Bulbs", () => {
        if (manage.value && api.store.me?.isAdmin) icons.create('.link click=', () => route.go(['group', groupId, 'addLight']));
    });
    
    $("div.list", () => {
        const lights = api.store.lights;
        onEach(group.lightIds, (ieee) => { 
            let light = lights[ieee]!;
            $('div.item', () => {
                drawToggle(light, ieee);
                $('h2.link#', light.name, 'click=', () => route.go(['device', ieee]));
            });
        }, (ieee) => lights[ieee]?.name);
        
        if (isEmpty(group.lightIds)) {
            $('div.empty#None yet');
        }
    });

    // Group configuration section for users with manage access
    $(() => {
        if (manage.value && api.canControlGroup(groupId) === 'manage') {
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
                drawToggle(device, ieee);
                $('h2.link#', device.name, 'click=', () => addDevice(ieee));
            });
        }, (device, ieee) => {
            let inGroups = api.lightGroups[ieee] || [];
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
            $('div.item', () => {
                icons.sensor();
                $('h2.link#', device.name, 'click=', () => addDevice(ieee));
            });
        }, (device, ieee) => {
            let inGroups = api.store.config.toggleGroupLinks[ieee] || [];
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
        // Convert group timeout (seconds from config) back to value/unit for UI
        let timeout: {value: number, unit: 's' | 'm' | 'h' | 'd'} | null = null;
        const timeoutSeconds = api.store.config.groupTimeouts[groupId];
        if (timeoutSeconds) {
            if (timeoutSeconds % 86400 === 0) {
                timeout = {value: timeoutSeconds / 86400, unit: 'd'};
            } else if (timeoutSeconds % 3600 === 0) {
                timeout = {value: timeoutSeconds / 3600, unit: 'h'};
            } else if (timeoutSeconds % 60 === 0) {
                timeout = {value: timeoutSeconds / 60, unit: 'm'};
            } else {
                timeout = {value: timeoutSeconds, unit: 's'};
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
                $("div.item.link", 'click=', () => route.go(['device', ieee]), () => {
                    icons.sensor();
                    $("h2#", device.name);
                });
            });
            if (isEmpty(togglesByGroup[groupId] || {})) {
                $('div.empty#None yet');
            }
        });
    } else {
        $('div.empty#Automations must be enabled to add buttons and sensors');
    }

    $('h1#Settings');
    
    // Group name (admin only - uses bridge command)
    $('div.list', () => {

        $(() => {
            if (!api.store.me?.isAdmin) return;
            $('div.item', () => {
                $('h2#Name');
                $('input type=text placeholder="Group name" bind=', ref(groupState, 'name'));
            });
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
        } else {
            $('div.empty#Automations must be enabled to set a lights off timer');
        }
    });

    $(() => {
        if (!api.store.me?.isAdmin) return;
        $('h1#Actions');
        $('div.list div.item.link', icons.remove, '#Delete group', 'click=', async () => {
            if (!await askConfirm(`Are you sure you want to delete group '${group.name}'?`)) return;
            api.send("bridge", "request", "group", "remove", {id: group.name});
            route.back('/');
        });
    });

    lazySave(() => {
        // Read reactive state here to establish dependency tracking
        const t = groupState.timeout;
        const secs = t ? t.value * {s: 1, m: 60, h: 3600, d: 86400}[t.unit] : null;
        return function() {
            api.setGroupTimeout(groupId, secs);
        }
    });


}


