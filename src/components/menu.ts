/**
 * NOTE: This component is currently unused, but kept for future use.
 */

import { $, insertCss, onEach } from 'aberdeen';
import { grow, shrink } from 'aberdeen/transitions';
import * as route from 'aberdeen/route';
import * as icons from '../icons';
import api from '../api';
import { ServerCredentials } from '../types';
import { errorMessageStyle } from '../global-style';

const overlayStyle = insertCss('position:fixed top:0 left:0 right:0 bottom:0 z-index:100');

const menuStyle = insertCss({
	'&': 'position:absolute top:48px right:$2 bg:#222 border: 1px solid #444; r:8px p: $2 0; z-index:101 min-width:200px box-shadow: 0 4px 12px rgba(0,0,0,0.5); transition: opacity 0.2s ease-out, transform 0.2s ease-out;',
	'&.menu-fade': 'opacity:0 transform:translateY(-10px)'
});

const menuItemStyle = insertCss({
	'&': 'p: $3 $4; cursor:pointer display:flex align-items:center gap:$3 font-size:1rem',
	'&.interacting': 'bg:#333',
	'&.danger': 'fg:$danger',
	'.icon': {
		'&': 'w:24px h:24px',
		'&.on': 'fg:#0d8'
	},
	'&.busy .icon': 'animation: header-spin 2s linear infinite; opacity:0.5 pointer-events:none'
});

const menuDividerStyle = insertCss('h:1px bg:#444 mv:$1');

export function drawMenu(menuOpen: { value: boolean }): void {
    $(() => {
        if (!menuOpen.value) return;
        
        $('div', overlayStyle, 'click=', () => menuOpen.value = false);
        $('div', menuStyle, 'create=.menu-fade destroy=.menu-fade', () => {
            // Show connection error if present
            $(() => {
                if (api.store.lastConnectError) {
                    $('div', errorMessageStyle, 'create=', grow, 'destroy=', shrink, () => {
                        icons.reconnect('.off');
                        $('span#', api.store.lastConnectError);
                    });
                    $('div', menuDividerStyle);
                }
            });
            
            // Manage server settings
            $('div', menuItemStyle, 'click=', async () => {
                route.go({ p: ['connect'], state: { edit: 'y' } });
                menuOpen.value = false;
            }, () => {
                icons.edit();
                $('span#Manage server settings');
            });

            // Switch servers
            onEach(api.store.servers, (server: ServerCredentials, index: number) => {
                if (index === 0) return;
                $('div', menuItemStyle, 'click=', () => {
                    menuOpen.value = false;
                    // Move selected server to front and enable it
                    const selectedServer = api.store.servers.splice(index, 1)[0];
                    if (selectedServer) {
                        selectedServer.status = 'enabled';
                        api.store.servers.unshift(selectedServer);
                    }
                    route.go(['/']);
                }, () => {
                    icons.reconnect();
                    $('span#Switch to ' + server.localAddress);
                });
            });

            if (api.store.servers.length > 1) {
                $('div', menuDividerStyle);
            }

            // Connect to another
            $('div', menuItemStyle, 'click=', () => {
                menuOpen.value = false;
                route.go(['connect']);
            }, () => {
                icons.create();
                $('span#Add a server');
            });
        });
    });
}
