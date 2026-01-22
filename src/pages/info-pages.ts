import { $, onEach, dump } from 'aberdeen';
import * as route from 'aberdeen/route';
import api from '../api';

interface InfoPageContext {
    routeState: { title: string; subTitle?: string };
}

export function drawRemoteInfoPage(context: InfoPageContext): void {
    const { routeState } = context;
    
    routeState.title = 'Remote Access';
    routeState.subTitle = 'Information';

    $('div padding:8px line-height:1.6em', () => {
        $('h1 margin-top:0 #How it works');
        $('p#', 'Remote access allows you to control your lights from anywhere in the world. When enabled, your server becomes accessible via a secure, encrypted connection.');
        
        $('h1#Simplified Networking');
        $('p#We use two technologies to make this "zero-config":');
        $('ul', () => {
            $('li', () => {
                $('strong#UPnP: ');
                $('#The server automatically asks your router to open a port (43597) so it can be reached from the internet.');
            });
            $('li', () => {
                $('strong#Race-to-connect: ');
                $('#The app is smart. It tries to connect to your server locally and remotely at the same time, and picks whichever responds first. This makes the transition between home Wi-Fi and mobile data instant and seamless.');
            });
        });

        $('h1#Security');
        $('p#Your security is our priority:');
        $('ul', () => {
            $('li#All communication is encrypted using SSL (HTTPS/WSS).');
            $('li#Authentication is handled via PBKDF2 hashing. Your password is never sent or stored in plain text.');
            $('li#You can restrict remote access on a per-user basis in the user management settings.');
        });

        $('button.primary margin-top:2em width:100% #Got it', 'click=', () => route.up());
    });
}

export function drawAutomationInfoPage(context: InfoPageContext): void {
    const { routeState } = context;
    
    routeState.title = 'Automation';
    routeState.subTitle = 'Information';

    $('div padding:8px line-height:1.6em', () => {
        $('h1 margin-top:0 #What is Automation?');
        $('p#', 'Automation allows your lights to respond automatically to events, making your smart home truly intelligent.');
        
        $('h1#Features');
        $('ul', () => {
            $('li', () => {
                $('strong#Scene Triggers: ');
                $('#Activate scenes with button presses, motion sensors, or other Zigbee devices.');
            });
            $('li', () => {
                $('strong#Time-based Automation: ');
                $('#Schedule scenes to activate at specific times of day.');
            });
            $('li', () => {
                $('strong#Auto-off Timers: ');
                $('#Automatically turn off lights after a period of inactivity.');
            });
        });

        $('h1#Privacy');
        $('p#All automation runs locally on your Zigbee2MQTT server. No cloud services or external servers are involved.');

        $('button.primary margin-top:2em width:100% #Got it', 'click=', () => route.up());
    });
}

export function drawBatteriesPage(context: InfoPageContext): void {
    const { routeState } = context;
    
    routeState.title = 'Batteries';
    $('div.list', () => {
        onEach(api.store.devices, (device, ieee) => {
            if (device.lightCaps) return;
            const b = device.meta?.battery;
            $('div.item.link', 'click=', () => route.go(['bulb', ieee]), () => {
                $('h2#', device.name);
                $('p font-weight:bold flex:0 #', b !== undefined ? `${Math.round(b)}%` : 'Unknown', b==undefined ? '' : b <= 5 ? '.critical' : b <= 15 ? '.warning' : '');
            });
        }, (device) => {
            if (device.lightCaps) return;
            return [(device.meta?.battery ?? 101), device.name]; 
        });
    });
}

export function drawDumpPage(context: InfoPageContext): void {
    const { routeState } = context;
    
    routeState.title = 'State dump';
    dump(api.store);
}
