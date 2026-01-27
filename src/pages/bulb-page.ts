import { $, proxy, unproxy, onEach } from 'aberdeen';
import api from '../api';
import * as icons from '../icons';
import { drawColorPicker } from '../components/color-picker';
import { routeState, admin, askConfirm, lazySave } from '../ui';
import { deviceGroups } from '../app';

export function drawBulbPage(ieee: string): void {
    let device = api.store.devices[ieee];
    if (!device) {
        $('div.empty#No such light');
        return;
    }
    
    $(() => {
        routeState.title = device.name;
    });
    routeState.subTitle = 'bulb';
    $("div.item#", device.model);
    
    drawColorPicker(device, ieee);

    if (!admin.value) return;

    $('h1#Settings');
    const name = proxy(unproxy(device).name);
    $('div.item', () => {
        $('h2#Name');
        $('input', 'bind=', name);
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

    $(() => {
        if (!removing.value && deviceGroups[ieee]) onEach(deviceGroups[ieee], (groupId) => {
            const busy = proxy(false);
            const group = api.store.groups[groupId];
            if (group) {
                $(`div.item.link#Remove from "${group.name}"`, '.busy=', busy, icons.remove, 'click=', async function() {
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
            $('div.item.link#Delete', icons.eject, 'click=', async function() {
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
            $('div.item.link#Force delete', icons.eject, 'click=', async function() {
                if (await askConfirm(`Are you sure you want to FORCE detach '${device.name}' from zigbee2mqtt?`)) {
                    api.send("bridge", "request", "device", "remove", {id: ieee, force: true});
                }
            });
        }
    })
}
