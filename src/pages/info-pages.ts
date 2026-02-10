import { $, onEach, dump } from 'aberdeen';
import * as route from 'aberdeen/route';
import api from '../api';
import { routeState } from '../ui';

export function drawBatteriesPage(): void {
    
    routeState.title = 'Batteries';
    $('div.list', () => {
        onEach(api.store.toggles, (device, ieee) => {
            const b = device.meta?.battery;
            $('div.item.link', 'click=', () => route.go(['bulb', ieee]), () => {
                $('h2#', device.name);
                $('p font-weight:bold flex:0 #', b !== undefined ? `${Math.round(b)}%` : 'Unknown', b==undefined ? '' : b <= 5 ? '.critical' : b <= 15 ? '.warning' : '');
            });
        }, (device) => {
            return [(device.meta?.battery ?? 101), device.name]; 
        });
    });
}

export function drawDumpPage(): void {
    
    routeState.title = 'State dump';
    dump(api.store);
}
