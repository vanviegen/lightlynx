import { $, insertCss, onEach } from 'aberdeen';
import { grow, shrink } from 'aberdeen/transitions';
import * as route from 'aberdeen/route';
import * as icons from '../icons';
import api from '../api';
import { ServerCredentials } from '../types';

const overlayStyle = insertCss({
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
});

const menuStyle = insertCss({
    position: 'absolute',
    top: '48px',
    right: '$2',
    bg: '#222',
    border: '1px solid #444',
    borderRadius: '8px',
    p: '$2 0',
    zIndex: 101,
    minWidth: '200px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    transition: 'opacity 0.2s ease-out, transform 0.2s ease-out',
    
    '&.menu-fade': {
        opacity: 0,
        transform: 'translateY(-10px)',
    },
});

const menuItemStyle = insertCss({
    p: '$3 $4',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '$3',
    fontSize: '1rem',
    
    '&:hover': {
        bg: '#333',
    },
    
    '&.danger': {
        color: '$danger',
    },
    
    '&.error': {
        color: '$danger',
        cursor: 'default',
        bg: '#3a1111',
        '&:hover': {
            bg: '#3a1111',
        },
    },
    
    '.icon': {
        w: '24px',
        h: '24px',
        '&.on': {
            color: '#0d8',
        },
    },
    
    '&.busy .icon': {
        animation: 'header-spin 2s linear infinite',
        opacity: 0.5,
        pointerEvents: 'none',
    },
});

const menuDividerStyle = insertCss({
    h: '1px',
    bg: '#444',
    mv: '$1',
});

export function drawMenu(menuOpen: { value: boolean }): void {
    $(() => {
        if (!menuOpen.value) return;
        
        $('div', overlayStyle, 'click=', () => menuOpen.value = false);
        $('div', menuStyle, 'create=.menu-fade destroy=.menu-fade', () => {
            // Show connection error if present
            $(() => {
                if (api.store.lastConnectError) {
                    $('div', menuItemStyle, '.error create=', grow, 'destroy=', shrink, () => {
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
