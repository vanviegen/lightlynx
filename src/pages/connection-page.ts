import A from 'aberdeen';
import * as route from 'aberdeen/route';
import api from '../api';
import { ServerCredentials } from '../types';
import { routeState, hashSecret, copyToClipboard } from '../ui';
import { askConfirm } from '../components/prompt';
import { errorMessageStyle } from '../global-style';
import { isEqual } from '../utils';
import { createToast } from '../components/toasts';

const setupInstructionsStyle = A.insertCss({
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
    A(() => {
        if (api.connection.mode === 'enabled') {
            route.back('/');
        }
    });

    const selectedIndex = A.proxy(0);
    A(() => {
        if (selectedIndex.value > api.servers.length) {
            selectedIndex.value = api.servers.length;
        }
    })

    // Show setup instructions for first-time users
    A(() => {
        if (api.servers.length === 0) {
            A('div', setupInstructionsStyle, () => {
                A('h3#First time? Install the extension:');
                A('ol', () => {
                    A('li', () => {
                        A('#Download ');
                        A('a href=/extension.js download=lightlynx.js #lightlynx.js');
                    });
                    A('li', () => {
                        A('#Copy it to your Zigbee2MQTT ');
                        A('code#data/extension');
                        A('#folder');
                    });
                    A('li#Restart Zigbee2MQTT');
                    A('li#Have instance ID autodetected below (or copy it from Zigbee2MQTT logs)');
                });
            });
        }
    });

    A('h1#Select a connection');
    A('div m:$3 div.list', () => {
        A.onEach(api.servers, (server: ServerCredentials, index: number) => {
            const name = `${server.userName}@${server.instanceId}`;
            if (isEqual(index, selectedIndex.value)) {
                A('div.item fg:$primary text=', name);
            } else {
                A('div.item.link text=', name, 'click=', () => {
                    delete api.connection.lastError;
                    selectedIndex.value = index;
                });
            }
        });
        if (isEqual(selectedIndex.value, api.servers.length)) {
            A('div.item fg:$primary text="New connection..."');
        } else {
            A('div.item.link text="New connection..." click=', () => {
                delete api.connection.lastError;
                selectedIndex.value = api.servers.length;
            });
        }
    });

    A('h1#Connection details');

    A(() => {
        drawConnectionDetails(selectedIndex);
    })
}

function drawConnectionDetails(selectedIndex: { value: number }): void {
    const index = selectedIndex.value;
    const orgServer: Partial<ServerCredentials> = api.servers[index] || {};
    
    const instanceId = A.proxy(orgServer.instanceId || '');
    const userName = A.proxy(orgServer.userName || 'admin');
    const password = A.proxy(orgServer.secret || '');

    // Keep the user-name normalized (trim + lower-case) in the UI as it's edited
    A(() => {
        userName.value = (userName.value || '').trim().toLowerCase();
    });

    // Change-password UI
    const newSecret = A.peek(api.connection, 'newSecret')
    const changePassword = A.proxy(newSecret !== undefined);
    const newPassword = A.proxy(newSecret  || '');
    const newPasswordAgain = A.proxy(newSecret  || '');

    async function autoLookup(event?: Event) {
        if (event) createToast('info', 'Looking up instance ID…', 'auto');
        const res = await fetch('https://cert.lightlynx.eu/auto');
        const data = await res.json();
        if (data?.instanceId && !instanceId.value) {
            instanceId.value = data.instanceId;
            if (event) createToast('info', `Instance ID found: ${data.instanceId}`, 'auto');
            return;
        }
        if (event) createToast('error', data?.error || 'No instance ID found for this IP.', 'auto');
    }

    if (!orgServer.instanceId) autoLookup();

    // Show connection errors
    A(() => {
        if (api.connection.stalling) {
            A('div', errorMessageStyle, '#The server is taking longer than usual to respond…');
        } else if (api.connection.lastError) {
            A('div', errorMessageStyle, '#', api.connection.lastError);
        }
    });

    async function handleSubmit(e: Event): Promise<void> {
        e.preventDefault();
        // If changing password, validate new passwords match and include newSecret
        if (changePassword.value) {
            if (newPassword.value !== newPasswordAgain.value) {
                createToast('error', 'New passwords do not match');
                return;
            }
            api.connection.newSecret = await hashSecret(newPassword.value);
        }

        // Remove the existing server entry (if it exists), and shift the new/edited server to the front,
        // and change selectedIndex such that we'll keep editing it.
        api.servers.splice(index, 1);
        selectedIndex.value = 0;
        api.servers.unshift({
            instanceId: instanceId.value,
            userName: userName.value,
            secret: await hashSecret(password.value),
            externalPort: orgServer.externalPort, // Keep original external port - it might still work
        });
        api.connection.mode = 'try';
        api.connection.attempts = 0;
        api.connection.lastError = undefined;
    }

    async function handleDelete(): Promise<void> {
        if (await askConfirm('Are you sure you want to remove these credentials?')) {
            api.servers.shift();
        }
    }
    
    A('form submit=', handleSubmit, () => {
        A('div.field', () => {
            A('label#Instance ID or host:port - ', () => {
                A('a text=Auto-detect click=', autoLookup);
            });
            A('input placeholder="Eg: a0324d3 or 1.2.3.4:43597" required=', true, 'bind=', instanceId);
        });
        A('div.field', () => {
            A('label#User name');
            A('input required=', true, 'bind=', userName);
        });
        A('div.field', () => {
            A('label#Password');
            A('input type=password bind=', password, 'placeholder=', 'Password or hash or empty');
        });

        // New password fields shown when Change password is toggled
        A(() => {
            if (!changePassword.value) return;
            A('div.field', () => {
                A('label#New password');
                A('input type=password bind=', newPassword);
            });
            A('div.field', () => {
                A('label#New password (again)');
                A('input type=password bind=', newPasswordAgain);
            });
        });

        A('div.button-row', () => {
            if (index < api.servers.length) A('button.danger type=button text=Logout click=', handleDelete);
            A('button.secondary type=button text=Cancel click=', () => route.back('/'));
            A('button.primary type=submit .busy=', A.derive(() => api.connection.mode !== 'disabled'), 'text=', A.derive(() => changePassword.value ? 'Change' : 'Connect'));
        });
        A('small.link text-align:right text="Copy direct-connect URL" click=', async () => {
            let url = `${location.protocol}//${location.host}/?instanceId=${encodeURIComponent(instanceId.value)}&userName=${encodeURIComponent(userName.value)}`;
            const secret = await hashSecret(password.value);
            if (secret) url += `&secret=${encodeURIComponent(secret)}`;
            copyToClipboard(url, 'URL');
        });

        // Toggle Change password link
        A('small.link text-align:right text=', A.derive(() => changePassword.value ? "Don't change password" : "Change password"), "click=", () => {
            changePassword.value = !changePassword.value;
        });
    });
}
