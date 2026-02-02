import { $, onEach, dump } from 'aberdeen';
import * as route from 'aberdeen/route';
import api from '../api';
import { routeState } from '../ui';

export function drawRemoteInfoPage(): void {
    
    routeState.title = 'Remote Access';

    $('div p:8px line-height:1.6em', () => {
        $('h1 mt:0 #What');
        $('p#', 'Remote access allows you to control your lights from anywhere in the world. When enabled, your server becomes accessible via a secure, encrypted connection.');
        
        $('h1#How');
        $('ul', () => {
            $('li', () => {
                $('strong#UPnP: ');
                $('#The server automatically asks your home router to forward a random (but consistent) port from the internet to the secure WebSocket endpoint of our Z2M extension.');
            });
            $('li', () => {
                $('strong#Race-to-connect: ');
                $('#The app receives the external address whenever it is connected to your server locally. For subsequent connections it will try to connect to both the internal and the external address, preferring whichever is fastest to respond. Transition between Wi-Fi and mobile should be seamless.');
            });
        });

        $('h1#Security');
        $('ul', () => {
            $('li#All communication is encrypted using SSL (HTTPS/WSS).');
            $('li#Setting a password is required for remote access. Passwords are only stored and transmitted in hashed form.');
            $('li#The port number used for remote access is random and not publicly listed anywhere.');
            $('li#You must enable remote access both system-side and on a per-user basis.');
            $('li#Still, exposing a service to the internet carries inherent risks.');
        });

        $('button.primary mt:2em w:100% #Got it', 'click=', () => route.up());
    });
}

export function drawAutomationInfoPage(): void {
    
    routeState.title = 'Automation';

    $('div p:8px line-height:1.6em', () => {
        $("h1 mt:0 #What's this?");
        $('p#', 'LightLynx Automation allows you to trigger scenes based on button, motion sensor and time events. This runs entirely as an extension in your Zigbee2MQTT server. No cloud or complicated setup required.');
        
        $('h1#Features');
        $('ul', () => {
            $('li', () => {
                $('strong#Scene Triggers: ');
                $('#Activate scenes with (multiple) button presses, motion sensors, or other Zigbee devices.');
            });
            $('li', () => {
                $('strong#Time-based Automation: ');
                $('#Schedule scenes to activate at specific times of day, optionally relative to sunrise/sunset.');
            });
            $('li', () => {
                $('strong#Auto-off Timers: ');
                $('#Automatically turn off lights after a period of inactivity.');
            });
            $('li', () => {
                $('strong#Fast: ');
                $('#Uses Zigbee-native groups and scenes and runs entirely within Zigbee2MQTT.');
            });
            $('li', () => {
                $('strong#Easy: ');
                $('#Fully configurable from the LightLynx app. Even easier than Signify Hue!');
            });
        });

        $('h1#Technical details');
        $('ul', () => {
            $(`li#The extension is opinionated, it is not for generic automation. Use something like Home Assistant for that.`)
            $(`li#It connects buttons/sensors to one or multiple groups. For these groups they can trigger different scenes depending on the number of presses. A single press will always toggle between off and the first scene.`);
            $(`li#We store automation rules within Zigbee2MQTT's device description, group descriptions and scene names. If you remove them (using some other tool) they will stop working.`);
            $(`li#We haven't tested many button/sensor devices yet. Feel free to reach out if you have a specific model that's not behaving well.`);
        });

        $('button.primary mt:2em w:100% #Got it', 'click=', () => route.up());
    });
}

export function drawBatteriesPage(): void {
    
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

export function drawDumpPage(): void {
    
    routeState.title = 'State dump';
    dump(api.store);
}
