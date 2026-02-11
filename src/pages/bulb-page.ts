import { $, proxy, unproxy, onEach } from 'aberdeen';
import api from '../api';
import * as icons from '../icons';
import { drawColorPicker, drawBulbCircle } from '../components/color-picker';
import { routeState, manage, lazySave } from '../ui';
import { askConfirm } from '../components/prompt';

export function drawBulbPage(ieee: string): void {
    let device = api.store.lights[ieee];
    if (!device) {
        $('div.empty#No such light');
        return;
    }
    
    $(() => {
        routeState.title = device.name;
    });
    routeState.subTitle = 'bulb';
    
    // Device info with toggle circle
    $('div.list div.item', () => {
        drawBulbCircle(device, ieee);
        $('span#', device.model);
    });
    
    drawColorPicker(device, ieee);

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
        if (!removing.value && api.lightGroups[ieee]) onEach(api.lightGroups[ieee], (groupId) => {
            const busy = proxy(false);
            const group = api.store.groups[groupId];
            if (group) {
                $(`div.item.link .busy=`, busy, icons.remove, `#Remove from "${group.name}"`, 'click=', async function() {
                    busy.value = true;
                    try {
                        await api.send("bridge", "request", "group", "members", "remove", {group: group!.name, device: device!.name});
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
    })
}
