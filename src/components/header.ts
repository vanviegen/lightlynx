import { $, insertCss, isEmpty, proxy } from 'aberdeen';
import * as route from 'aberdeen/route';
import * as icons from '../icons';
import api from '../api';
import logoUrl from '../logo.webp';

const headerStyle = insertCss({
    bg: '$surface',
    display: 'flex',
    gap: '$2',
    alignItems: 'center',
    pr: '$2',
    
    '& > .logo': {
        maxHeight: '40px',
        cursor: 'pointer',
    },
    
    '& > h1': {
        fontSize: '1.5rem',
        lineHeight: 0.9,
        p: '0.1em 0 0.25em',
    },
    
    '& > .title': {
        flex: 1,
    },
    
    '& .subTitle': {
        ml: '$3',
        color: '$textMuted',
        fontWeight: 'normal',
    },
    
    '& .icon': {
        w: '32px',
        h: '32px',
        cursor: 'pointer',
        color: '$textMuted',
    },
    
    '& .off, & .critical': {
        color: '$danger',
    },
    
    '& .warning': {
        color: '$warning',
    },
    
    '& .spinning': {
        animation: 'header-spin 2s linear infinite',
    },
    
    '& .pulse': {
        animation: 'pulse-opacity 1.5s ease-in-out infinite',
    },
    
    '& .update-available': {
        color: '$success',
        animation: 'pulse-opacity 1.5s ease-in-out infinite',
    },
    
    '@keyframes pulse-opacity': {
        '0%': { opacity: 1 },
        '50%': { opacity: 0.3 },
        '100%': { opacity: 1 },
    },
    
    '@keyframes header-spin': {
        from: { transform: 'rotate(0deg)' },
        to: { transform: 'rotate(-360deg)' },
    },
});

export interface RouteState {
    title: string;
    subTitle: string;
    drawIcons?: () => void;
}

export function drawHeader(
    routeState: RouteState,
    admin: { value: boolean },
    updateAvailable: { value: boolean },
    menuOpen: { value: boolean },
    disableJoin: () => void,
    DEBUG_route_back: (...args: any[]) => void
): void {
    $('header', headerStyle, () => {
        $('img.logo src=', logoUrl, 'click=', () => DEBUG_route_back('/'));
        
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
                    'click': () => menuOpen.value = !menuOpen.value
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
                'click': () => admin.value = !admin.value,
            });
        });
    });
}
