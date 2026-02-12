import { $, proxy, unproxy, onEach } from 'aberdeen';
import api from '../api';
import * as icons from '../icons';
import { drawColorPicker, drawToggle } from '../components/color-picker';
import { routeState, manage, lazySave } from '../ui';
import { askConfirm } from '../components/prompt';

export function drawDevicePage(ieee: string): void {
    const light = api.store.lights[ieee];
    const toggle = api.store.toggles[ieee];
    const device = light || toggle;
    
    if (!device) {
        $('div.empty#No such device');
        return;
    }
    
    const isLight = !!light;
    
    $(() => {
        routeState.title = device.name;
    });
    routeState.subTitle = isLight ? 'light' : 'button/sensor';
    
    $('div.list div.item', () => {
        if (isLight) {
            drawToggle(light, ieee);
        } else {
            icons.sensor();
        }
        $('span#', device.model);
    });
    
    if (isLight) {
        drawColorPicker(light, ieee);
    }

    if (!manage.value || !api.store.me?.isAdmin) return;

    $('h1#Settings');
    const name = proxy(unproxy(device).name);
    $('div.list div.item', () => {
        $('h2#Name');
        $('input flex:3 bind=', name);
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

    $('div.list', () => {
        const linkedGroupIds = isLight 
            ? api.lightGroups[ieee] 
            : api.store.config.toggleGroupLinks[ieee];
        
        if (!removing.value && linkedGroupIds) onEach(linkedGroupIds, (groupId) => {
            const busy = proxy(false);
            const group = api.store.groups[groupId];
            if (group) {
                $(`div.item.link .busy=`, busy, icons.remove, `#Remove from "${group.name}"`, 'click=', async function() {
                    busy.value = true;
                    try {
                        if (isLight) {
                            await api.send("bridge", "request", "group", "members", "remove", {group: group!.name, device: device!.name});
                        } else {
                            await api.linkToggleToGroup(groupId, ieee, false);
                        }
                    } finally {
                        busy.value = false;
                    }
                });
            }
        });

        if (!removing.value) {
            $('div.item.link', icons.eject, 'text="Delete from Zigbee2MQTT" click=', async function() {
                if (await askConfirm(`Are you sure you want to detach '${device.name}' from zigbee2mqtt?`)) {
                    removing.value = true;
                    try {
                        await api.send("bridge", "request", "device", "remove", {id: ieee});
                    } finally {
                        removing.value = false;
                    }
                }
            });
        } else {
            $('div.item.link', icons.eject, 'text="Force delete from Zigbee2MQTT" click=', async function() {
                if (await askConfirm(`Are you sure you want to FORCE detach '${device.name}' from zigbee2mqtt?`)) {
                    api.send("bridge", "request", "device", "remove", {id: ieee, force: true});
                }
            });
        }
    });
}
