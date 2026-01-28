import { $, insertCss, insertGlobalCss, isEmpty } from 'aberdeen';
import * as route from 'aberdeen/route';
import * as icons from '../icons';
import api from '../api';
import logoUrl from '../logo.webp';
import { routeState, admin, notify } from '../ui';

const headerStyle = insertCss({
	'&': 'bg:$surface display:flex gap:$2 align-items:center pr:$2',
	'.logo': 'max-height:40px cursor:pointer',
	h1: 'font-size:1.5rem line-height:0.9 p: 0.1em 0 0.25em; m:0 text-transform:none letter-spacing:normal font-weight:600',
	'.title': 'flex:1',
	'.subTitle': 'ml:$3 fg:$textMuted font-weight:normal text-transform:uppercase letter-spacing:0.05em font-size:1rem',
	'.icon': 'w:32px h:32px cursor:pointer fg:$textMuted',
	'.off, .critical': 'fg:$danger',
	'.warning': 'fg:$warning',
	'.spinning': 'animation: header-spin 2s linear infinite;',
	'.pulse': 'animation: pulse-opacity 1.5s ease-in-out infinite;',
	'.update-available': 'fg:$success animation: pulse-opacity 1.5s ease-in-out infinite;',
});

insertGlobalCss({
    '@keyframes pulse-opacity': {
		'0%': 'opacity:1',
		'50%': 'opacity:0.3',
		'100%': 'opacity:1'
	},
	'@keyframes header-spin': {
		from: 'transform:rotate(0deg)',
		to: 'transform:rotate(-360deg)'
	}
});

export function drawHeader(
    updateAvailable: { value: boolean },
    disableJoin: () => void
): void {
    $('header', headerStyle, () => {
        $('img.logo src=', logoUrl, 'click=', () => route.back('/'));
        
        $(() => {
            if (route.current.path !== '/') {
                icons.back('click=', route.up);
            }
            $('h1.title', () => {
                const title = routeState.title || 'Light Lynx';
                $(`#${title}`);
                if (routeState.subTitle) {
                    $('span.subTitle#' + routeState.subTitle);
                }
            });
        });
        
        $(() => {
            if (routeState.drawIcons) {
                routeState.drawIcons();
            }
        });
        
        $(() => {
            if (updateAvailable.value) {
                icons.reload('.update-available click=', () => window.location.reload());
            }
        });
        
        $(() => {
            icons.reconnect(() => {
                const state = api.store.connectionState;
                $({
                    '.spinning': state !== 'connected' && state !== 'idle',
                    '.off': state === 'idle',
                    '.critical': !!api.store.lastConnectError,
                    '.link': true,
                    'click': () => route.go('/connect'),
                });
            });
        });
        
        $(() => {
            if (api.store.permitJoin) {
                icons.create('.on.spinning click=', disableJoin);
            }
        });
        
        $(() => {
            if (isEmpty(api.store.servers)) return;
            let lowest = 100;
            for (const device of Object.values(api.store.devices)) {
                const b = device.meta?.battery;
                if (b !== undefined && b < lowest) lowest = b;
            }
            if (lowest > 15) return;
            const critical = lowest <= 5;
            const icon = critical ? icons.batteryEmpty : icons.batteryLow;
            icon({
                '.critical': critical,
                '.warning': !critical,
                '.pulse': critical,
                click: () => route.go(['batteries'])
            });
        });
        
        $(() => {
            const server = api.store.servers[0];
            if (!server) return;
            const user = api.store.users[server.username];
            if (!user?.isAdmin) return;
            
            let holdTimeout: any;
            icons.admin({
                '.on': admin.value,
                'mousedown': () => { holdTimeout = setTimeout(() => route.go(['dump']), 1000); },
                'mouseup': () => clearTimeout(holdTimeout),
                'mouseleave': () => clearTimeout(holdTimeout),
                'touchstart': () => { holdTimeout = setTimeout(() => route.go(['dump']), 1000); },
                'touchend': () => clearTimeout(holdTimeout),
                'click': () => {
                    admin.value = !admin.value;
                    notify('info', admin.value ? 'Entered admin mode' : 'Left admin mode');
                },
            });
        });
    });
}
