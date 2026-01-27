import { $, proxy, peek, copy } from 'aberdeen';
import * as route from 'aberdeen/route';
import api from '../api';
import { ServerCredentials } from '../types';
import { routeState, notify, askConfirm, hashSecret } from '../ui';

export function drawConnectionPage(): void {
    
    // Read initial state non-reactively to avoid re-renders
    const isEdit = peek(() => route.current.state.edit);
    const oldData: Partial<ServerCredentials> = isEdit ? peek(() => api.store.servers[0] ? {...api.store.servers[0]} : {}) : {};
    const initialHost = peek(() => route.current.search.host) || oldData.localAddress || '';
    const initialUsername = peek(() => route.current.search.username) || oldData.username || 'admin';
    const initialSecret = peek(() => route.current.search.secret);
    
    // Auto-connect if both host and username came from URL
    const shouldAutoConnect = !isEdit && initialHost && initialUsername && peek(() => route.current.search.host) === initialHost;
    
    const saved = proxy(false);
    const hostProxy = proxy(initialHost);
    const usernameProxy = proxy(initialUsername);
    const password = proxy('');
    
    $(() => {
        routeState.title = isEdit ? 'Edit connection' : 'New connection';
        routeState.subTitle = 'Z2M';
    });
    
    // Update URL as user types
    $(() => { route.current.search.host = hostProxy.value; });
    $(() => { route.current.search.username = usernameProxy.value; });
    
    // Hash password and update URL (debounced)
    let hashTimeout: any;
    $(() => {
        const pw = password.value;
        clearTimeout(hashTimeout);
        if (!pw) {
            delete route.current.search.secret;
            return;
        }
        // Check if it's already a 64-char hex secret
        if (/^[0-9a-f]{64}$/i.test(pw)) {
            route.current.search.secret = pw.toLowerCase();
            return;
        }
        // Hash the password
        hashTimeout = setTimeout(async () => {
            const secret = await hashSecret(pw);
            if (password.value === pw) route.current.search.secret = secret;
        }, 300);
    });
    
    // Auto-connect on initial load with URL params
    if (shouldAutoConnect) {
        console.log('Auto-connecting from URL parameters:', initialHost, initialUsername);
        const existing = api.store.servers.find(s => s.localAddress === initialHost && s.username === initialUsername);
        if (existing) {
            if (initialSecret) existing.secret = initialSecret;
            existing.status = 'try';
            const index = api.store.servers.indexOf(existing);
            if (index > 0) {
                api.store.servers.splice(index, 1);
                api.store.servers.unshift(existing);
            }
        } else {
            api.store.servers.unshift({
                localAddress: initialHost,
                username: initialUsername,
                secret: initialSecret || '',
                status: 'try'
            });
        }
        saved.value = true;
    }

    // Navigate away on successful connection
    $(() => {
        if (saved.value && api.store.servers[0]?.status === 'enabled') {
            saved.value = false;
            route.back('/');
        }
    });

    // Show connection errors
    $(() => {
        if (api.store.lastConnectError) {
            notify('error', api.store.lastConnectError);
            api.store.lastConnectError = '';
        }
    });

    async function handleSubmit(e: Event): Promise<void> {
        e.preventDefault();
        const server: ServerCredentials = {
            localAddress: hostProxy.value,
            username: usernameProxy.value,
            secret: peek(() => route.current.search.secret) || oldData.secret || '',
            externalAddress: hostProxy.value !== oldData.localAddress ? undefined : oldData.externalAddress,
            status: 'try'
        };
        saved.value = true;
        if (isEdit) {
            copy(api.store.servers[0]!, server);
        } else {
            api.store.servers.unshift(server);
            route.current.state.edit = 'y';
        }
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
            $('input placeholder="e.g. 192.168.1.5[:port]" required=', true, 'bind=', hostProxy);
        });
        $('div.field', () => {
            $('label#Username');
            $('input required=', true, 'bind=', usernameProxy);
        });
        $('div.field', () => {
            $('label#Password');
            $('input type=password bind=', password, 'placeholder=', isEdit ? 'Password or secret (empty to clear)' : '');
        });
        $('div.row', () => {
            if (isEdit) $('button.danger type=button text=Delete click=', handleDelete);
            $('button.secondary type=button text=Cancel click=', () => route.back('/'));
            $('button.primary type=submit', () => {
                const busy = api.store.connectionState === 'connecting' || api.store.connectionState === 'authenticating';			
                $('.busy=', busy, busy ? '#Connecting...' : isEdit ? '#Save' : '#Create');
            });
        });
    });
}
