import { $, proxy, peek, derive, onEach } from 'aberdeen';
import * as route from 'aberdeen/route';
import api from '../api';
import { ServerCredentials } from '../types';
import { routeState, hashSecret } from '../ui';
import { askConfirm } from '../components/prompt';
import { errorMessageStyle } from '../global-style';
import { isEqual } from '../utils';
import { createToast } from '../components/toasts';

export function drawConnectionPage(): void {
    routeState.title = 'Z2M Connection'

    // When this page is opened, we should disconnect
    if (peek(() => api.store.servers[0]?.status === 'enabled')) {
        api.store.servers[0]!.status = 'disabled';
    }

    // Navigate away on successful connection
    $(() => {
        if (api.store.servers[0]?.status === 'enabled') {
            route.back('/');
        }
    });

    const selectedIndex = proxy(0);
    $(() => {
        if (selectedIndex.value > api.store.servers.length) {
            selectedIndex.value = api.store.servers.length;
        }
    })

    $('h1#Select a connection');
    $('div m:$3 div.list', () => {
        onEach(api.store.servers, (server: ServerCredentials, index: number) => {
            const name = `${server.username}@${server.localAddress}`;
            if (isEqual(index, selectedIndex.value)) {
                $('div.item fg:$primary text=', name);
            } else {
                $('div.item.link text=', name, 'click=', () => {
                    delete api.store.lastConnectError;
                    selectedIndex.value = index;
                });
            }
        });
        if (isEqual(selectedIndex.value, api.store.servers.length)) {
            $('div.item fg:$primary text="New connection..."');
        } else {
            $('div.item.link text="New connection..." click=', () => {
                delete api.store.lastConnectError;
                selectedIndex.value = api.store.servers.length;
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
    const orgServer: Partial<ServerCredentials> = api.store.servers[index] || {};
    
    const localAddress = proxy(orgServer.localAddress || '');
    const username = proxy(orgServer.username || 'admin');
    const password = proxy(orgServer.secret || '');

    // Show connection errors
    $(() => {
        if (api.store.lastConnectError) {
            $('div', errorMessageStyle, '#', api.store.lastConnectError);
        }
    });

    async function handleSubmit(e: Event): Promise<void> {
        e.preventDefault();
        // Remove the existing server entry (if it exists), and shift the new/edited server to the front,
        // and change selectedIndex such that we'll keep editing it.
        api.store.servers.splice(index, 1);
        selectedIndex.value = 0;
        api.store.servers.unshift({
            localAddress: localAddress.value,
            username: username.value,
            secret: await hashSecret(password.value),
            externalAddress: localAddress.value !== orgServer.localAddress ? undefined : orgServer.externalAddress,
            status: 'try'
        });
    }

    async function handleDelete(): Promise<void> {
        if (await askConfirm('Are you sure you want to remove these credentials?')) {
            api.store.servers.shift();
            route.back('/');
        }
    }
    
    $('form submit=', handleSubmit, () => {
        $('div.field', () => {
            $('label#Server Address');
            $('input placeholder="e.g. 192.168.1.5[:port]" required=', true, 'bind=', localAddress);
        });
        $('div.field', () => {
            $('label#Username');
            $('input required=', true, 'bind=', username);
        });
        $('div.field', () => {
            $('label#Secret');
            $('input type=password bind=', password, 'placeholder=', 'Password or hash or empty');
        });
        $('div.row', () => {
            if (index < api.store.servers.length) $('button.danger type=button text=Delete click=', handleDelete);
            $('button.secondary type=button text=Cancel click=', () => route.back('/'));
            $('button.primary type=submit text=Connect .busy=', derive(() => orgServer.status !== 'disabled'));
        });
        $('small.link text-align:right text="Copy direct-connect URL" click=', async () => {
            let url = `${location.protocol}//${location.host}/?host=${encodeURIComponent(localAddress.value)}&username=${encodeURIComponent(username.value)}`;
            const secret = await hashSecret(password.value);
            if (secret) url += `&secret=${encodeURIComponent(secret)}`;
            try {
                await navigator.clipboard.writeText(url);
                createToast('info', 'URL copied to clipboard');
            } catch (e: any) {
                createToast('error', 'Failed to copy URL: ' + url);
            }
        });
    });
}
