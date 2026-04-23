import A from 'aberdeen';
import * as route from 'aberdeen/route';
import api from '../api';
import { drawToggle } from '../components/color-picker';
import { routeState } from '../ui';
import * as icons from '../icons';

const filterBarClass = A.insertCss({
    '&': 'display:flex gap:$2 mb:$2 px:$2',
    'select': 'flex:1 bg:$surface border:none p:$2 rounded:$1 appearance:auto',
});

type DeviceFilter = 'all' | 'toggles' | 'lights';
type DeviceSort = 'battery' | 'name' | 'model' | 'groups';

interface DeviceItem {
    ieee: string;
    device: typeof api.store.lights[string] | typeof api.store.toggles[string];
    type: 'light' | 'toggle';
}

export function drawDevicesPage(): void {
    const filter = (route.current.search.filter as DeviceFilter) || 'all';

    routeState.title = 'Devices';
    routeState.subTitle = filter === 'toggles' ? 'buttons & sensors' : filter === 'lights' ? 'lights' : '';

    A('div display:flex mt:$1 p:$2', filterBarClass, () => {
        A('select bind=', A.ref(route.current.search, 'filter'), () => {
            A('option value=all #Show all devices');
            A('option value=toggles #Show inputs');
            A('option value=lights #Show lights');
        });
        A('select bind=', A.ref(route.current.search, 'sort'), () => {
            A('option value=name #Order by name');
            A('option value=battery #Order by battery');
            A('option value=model #Order by model');
            A('option value=groups #Order by group #');
        });
    });

    const devices = getFilteredDevices();

    A('div.list', () => {
        A.onEach(devices, (item, ieee) => {
            A('div.item.link', 'click=', () => route.go(['device', ieee]), () => {
                if (item.type === 'light') {
                    drawToggle(item.device as typeof api.store.lights[string], ieee);
                } else {
                    icons.sensor(".toggle-width");
                }
                A('div flex:1 min-width:0', () => {
                    A('h2#', item.device.name);
                    A('p fg:$textMuted text-overflow:ellipsis overflow:hidden white-space:nowrap', () => {
                        if (item.device.model) {
                            A('#', item.device.model);
                        }
                        const linkedGroups = item.type === 'toggle' 
                            ? (api.store.config.toggleGroupLinks[ieee] || []).length 
                            : (api.lightGroups[ieee] || []).length;
                        if (linkedGroups > 0) {
                            A('#', ` · ${linkedGroups} group${linkedGroups > 1 ? 's' : ''}`);
                        }
                    });
                });
                const b = item.device.meta?.battery;
                if (b !== undefined) {
                    A('p font-weight:bold flex:0 #', `${Math.round(b)}%`, b <= 5 ? '.critical' : b <= 15 ? '.warning' : '');
                }
            });
        }, (item, ieee) => getSortKey(item, ieee));

        A(() => {
            if (A.isEmpty(devices)) {
                A('div.empty#No devices');
            }
        });
    });
}

function getFilteredDevices(): Record<string, DeviceItem> {
    const filter = (route.current.search.filter as DeviceFilter | undefined) || 'all';
    const result: Record<string, DeviceItem> = {};

    if (filter === 'all' || filter === 'lights') {
        for (const [ieee, device] of Object.entries(api.store.lights)) {
            result[ieee] = { ieee, device, type: 'light' };
        }
    }

    if (filter === 'all' || filter === 'toggles') {
        for (const [ieee, device] of Object.entries(api.store.toggles)) {
            result[ieee] = { ieee, device, type: 'toggle' };
        }
    }

    return result;
}

function getSortKey(item: DeviceItem, ieee: string): any[] {
    const sort = (route.current.search.sort as DeviceSort | undefined) || 'name';
    const battery = item.device.meta?.battery;
    
    switch (sort) {
        case 'battery':
            return [battery === undefined ? 999 : battery, item.device.name];
        case 'model':
            return [item.device.model || '', item.device.name];
        case 'groups':
            const linkedGroups = item.type === 'toggle' 
                ? (api.store.config.toggleGroupLinks[ieee] || []).length 
                : (api.lightGroups[ieee] || []).length;
            return [linkedGroups, item.device.name];
        default:
            return [item.device.name];
    }
}
