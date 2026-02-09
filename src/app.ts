/// <reference types="vite/client" />
import './global-style';
import {$, proxy, clone, isEmpty, insertCss, peek, disableCreateDestroy} from 'aberdeen';
import * as route from 'aberdeen/route';

import api from './api';
import { routeState } from './ui';
import { preventFormNavigation } from './utils';

import { drawToasts, createToast } from './components/toasts';
import { drawHeader } from './components/header';
import { drawPromptPage } from './components/prompt';

import { drawLandingPage } from './pages/landing-page';
import { drawBulbPage } from './pages/bulb-page';
import { drawGroupPage } from './pages/group-page';
import { drawConnectionPage } from './pages/connection-page';
import { drawUserEditor } from './pages/users-page';
import { drawRemoteInfoPage, drawAutomationInfoPage, drawLocationInfoPage, drawBatteriesPage, drawDumpPage } from './pages/info-pages';
import { drawTopPage } from './pages/top-page';

import swUrl from './sw.ts?worker&url';

// Configure Aberdeen
route.setLog(true);
route.interceptLinks();
// Disable transitions in Playwright)
if ((navigator as any).webdriver) {
    disableCreateDestroy();
}
preventFormNavigation();

const updateAvailable = proxy(false);

// Disable service worker in dev mode to avoid caching conflicts with Vite HMR
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
	navigator.serviceWorker.register(swUrl, { type: 'classic' });
	
	// Listen for update available messages from the service worker
	navigator.serviceWorker.addEventListener('message', (event) => {
		if (event.data && event.data.type === 'UPDATE_AVAILABLE') {
			console.log('Update available from service worker');
			updateAvailable.value = true;
		}
	});
}

// Register notify handler to show API messages as toasts
api.notifyHandlers.push(createToast);


const mainStyle = insertCss({
    '&': 'overflow:auto box-shadow: 0 0 10px $primary; overflow-x:hidden position:absolute z-index:2 transition: transform 0.2s ease-out, opacity 0.2s ease-out; left:0 top:0 right:0 bottom:0 bg:$bg scrollbar-width:none -ms-overflow-style:none',
    '&::-webkit-scrollbar': 'display:none',
    '&.fadeOut': {
        '&': 'z-index:-1 opacity:0 pointer-events:none',
        '*': 'pointer-events:none'
    },
    '&.forward, &.go': 'transform:translateX(100%)',
    '&.back': 'transform:translateX(-100%)',
    '&.load': 'opacity:0',
    h1: {
        '&': 'overflow:hidden text-align:center font-size:1.125rem text-transform:uppercase font-weight:normal fg:$textMuted mt:$3 mb:$2 position:relative pointer-events:none',
        '.icon': 'position:absolute right:$2 vertical-align:middle cursor:pointer z-index:10 pointer-events:auto w:24px h:24px'
    }
});

// Root container styles
const rootStyle = insertCss({
	'&': 'max-width:500px m: 0 auto; min-height:100% display:flex flex-direction:column transition: max-width 0.2s ease-in-out; position:relative',
	'&.landing-page': 'max-width:900px',
	'@media screen and (min-width: 501px)': 'box-shadow: 0 0 256px #f4810e20;'
});

const mainContainerStyle = insertCss('flex:1 position:relative overflow:hidden');

$('div', rootStyle, () => {
	$(() => {
		$('.landing-page=', isEmpty(api.servers) && route.current.path === '/');
	});

	drawHeader(updateAvailable);
	
	$('div', mainContainerStyle, () => {
		const p = clone(route.current.p); // Subscribe to full 'p', so we'll create new main elements for each page
		
		const nav = peek(() => route.current.nav);
		$('main', mainStyle, 'destroy=fadeOut create=', nav, () => {
			$(() => {
				routeState.title = '';
				routeState.subTitle = '';
				delete routeState.drawIcons;

				// Show Landing page if no server active
				if (p[0] === 'connect') {
					drawConnectionPage();
				} else if (p[0]==='group' && p[1]) {
					drawGroupPage(parseInt(p[1]));
				} else if (p[0] === 'bulb' && p[1]) {
					drawBulbPage(p[1]);
				} else if (p[0] === 'batteries') {
					drawBatteriesPage();
				} else if (p[0] === 'user') {
					drawUserEditor();
				} else if (p[0] === 'dump') {
					drawDumpPage();
				} else if (p[0] === 'remote-info') {
					drawRemoteInfoPage();
				} else if (p[0] === 'automation-info') {
					drawAutomationInfoPage();
				} else if (p[0] === 'location-info') {
					drawLocationInfoPage();
				} else if (isEmpty(api.servers)) {
					drawLandingPage();
				} else {
					drawTopPage();
				}
			});
			route.persistScroll();
		});
	}); // end mainContainer

	drawToasts();
}); // end root


// Show prompt modal, if any
$(() => {
	if (route.current.state.prompt) {
		drawPromptPage(route.current.state.prompt);
	}
})
