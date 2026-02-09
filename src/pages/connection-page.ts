import { $, proxy, derive, onEach, insertCss, peek } from 'aberdeen';
import * as route from 'aberdeen/route';
import api from '../api';
import { ServerCredentials } from '../types';
import { routeState, hashSecret, copyToClipboard } from '../ui';
import { askConfirm } from '../components/prompt';
import { errorMessageStyle } from '../global-style';
import { isEqual } from '../utils';

const setupInstructionsStyle = insertCss({
    '&': 'bg:$surface r:8px p:$3 mb:$3 line-height:1.6',
    'h3': 'mt:0 mb:$2 font-size:1rem',
    'ol': 'pl:1.5em m:0 fg:$textLight',
    'li': 'mb:$2',
    'code': 'bg:$surfaceLight p: 2px 6px; r:4px font-size:0.9em'
});

export function drawConnectionPage(): void {
    routeState.title = 'Z2M Connection'

    // When this page is opened, we should disconnect
    api.connection.mode = 'disabled';

    // Navigate away on successful connection
    $(() => {
        if (api.connection.mode === 'enabled') {
            route.back('/');
        }
    });

    const selectedIndex = proxy(0);
    $(() => {
        if (selectedIndex.value > api.servers.length) {
            selectedIndex.value = api.servers.length;
        }
    })

    // Show setup instructions for first-time users
    $(() => {
        if (api.servers.length === 0) {
            $('div', setupInstructionsStyle, () => {
                $('h3#First time? Install the extension:');
                $('ol', () => {
                    $('li', () => {
                        $('#Download ');
                        $('a href=/extension.js download=lightlynx.js #lightlynx.js');
                    });
                    $('li', () => {
                        $('#Copy it to your Zigbee2MQTT ');
                        $('code#data/extension');
                        $('#folder');
                    });
                    $('li#Restart Zigbee2MQTT');
                    $('li#Have instance ID autodetected below (or copy it from Zigbee2MQTT logs)');
                });
            });
        }
    });

    $('h1#Select a connection');
    $('div m:$3 div.list', () => {
        onEach(api.servers, (server: ServerCredentials, index: number) => {
            const name = `${server.userName}@${server.instanceId}`;
            if (isEqual(index, selectedIndex.value)) {
                $('div.item fg:$primary text=', name);
            } else {
                $('div.item.link text=', name, 'click=', () => {
                    delete api.connection.lastError;
                    selectedIndex.value = index;
                });
            }
        });
        if (isEqual(selectedIndex.value, api.servers.length)) {
            $('div.item fg:$primary text="New connection..."');
        } else {
            $('div.item.link text="New connection..." click=', () => {
                delete api.connection.lastError;
                selectedIndex.value = api.servers.length;
            });
        }
    });

    $('h1#Connection details');

    $(() => {
        drawConnectionDetails(selectedIndex);
    })
}

function drawConnectionDetails(selectedIndex: { value: number }): void {
    const index = selectedIndex.value;
    const orgServer: Partial<ServerCredentials> = api.servers[index] || {};
    
    const instanceId = proxy(orgServer.instanceId || '');
    const userName = proxy(orgServer.userName || 'admin');
    const password = proxy(orgServer.secret || '');

    function autoLookup() {
        fetch('https://cert.lightlynx.eu/auto')
            .then(res => res.ok ? res.text() : '')
            .then(code => {
                if (!instanceId.value && code) instanceId.value = code.trim();
            })
            .catch(() => {});
    }

    if (!peek(orgServer, 'instanceId')) autoLookup();

    // Show connection errors
    $(() => {
        if (api.connection.stalling) {
            $('div', errorMessageStyle, '#The server is taking longer than usual to respond…');
        } else if (api.connection.lastError) {
            $('div', errorMessageStyle, '#', api.connection.lastError);
        }
    });

    async function handleSubmit(e: Event): Promise<void> {
        e.preventDefault();
        // Remove the existing server entry (if it exists), and shift the new/edited server to the front,
        // and change selectedIndex such that we'll keep editing it.
        api.servers.splice(index, 1);
        selectedIndex.value = 0;
        api.servers.unshift({
            instanceId: instanceId.value,
            userName: userName.value,
            secret: await hashSecret(password.value),
        });
        api.connection.mode = 'try';
        api.connection.attempts = 0;
    }

    async function handleDelete(): Promise<void> {
        if (await askConfirm('Are you sure you want to remove these credentials?')) {
            api.servers.shift();
        }
    }
    
    $('form submit=', handleSubmit, () => {
        $('div.field', () => {
            $('label#Instance ID or host:port - ', () => {
                $('a text=Auto-detect click=', autoLookup);
            });
            $('input placeholder="Eg: a0324d3 or 1.2.3.4:43597" required=', true, 'bind=', instanceId);
        });
        $('div.field', () => {
            $('label#User name');
            $('input required=', true, 'bind=', userName);
        });
        $('div.field', () => {
            $('label#Secret');
            $('input type=password bind=', password, 'placeholder=', 'Password or hash or empty');
        });
        $('div.button-row', () => {
            if (index < api.servers.length) $('button.danger type=button text=Logout click=', handleDelete);
            $('button.secondary type=button text=Cancel click=', () => route.back('/'));
            $('button.primary type=submit text=Connect .busy=', derive(() => api.connection.mode !== 'disabled'));
        });
        $('small.link text-align:right text="Copy direct-connect URL" click=', async () => {
            let url = `${location.protocol}//${location.host}/?instanceId=${encodeURIComponent(instanceId.value)}&userName=${encodeURIComponent(userName.value)}`;
            const secret = await hashSecret(password.value);
            if (secret) url += `&secret=${encodeURIComponent(secret)}`;
            copyToClipboard(url, 'URL');
        });
    });
}
