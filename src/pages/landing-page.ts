import { $, insertCss, proxy, onEach } from 'aberdeen';
import * as route from 'aberdeen/route';
import * as icons from '../icons';
import { routeState } from '../ui';
import api from '../api';

const landingStyle = insertCss('p: $4 $3; display:flex flex-direction:column gap:$4');

const heroStyle = insertCss({
	'&': 'text-align:center p: $3 0;',
	h1: 'font-size:2.5rem mb:$2 line-height:1.1 bg: linear-gradient(45deg, #f4810e, #fb3403); background-clip:text -webkit-background-clip:text -webkit-text-fill-color:transparent font-weight:800;',
	p: 'font-size:1rem fg:$textMuted max-width:600px m: 0 auto; line-height:1.5'
});

const featuresStyle = insertCss('display:grid grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap:$3');

const featureStyle = insertCss({
	'&': 'display:flex flex-direction:column gap:$2 p:$3 bg:#ffffff05 r:12px border: 1px solid #ffffff08;',
	'.icon': 'fg:$primary w:32px h:32px',
	h3: 'font-size:1rem fg:$text m:0 display:flex align-items:center gap:$2',
	p: 'font-size:0.85rem fg:$textMuted m:0 line-height:1.5',
});

const buttonRowStyle = insertCss('display:flex flex-direction:column gap:$2 align-items:center mt:$2');

const primaryButtonStyle = insertCss({
	'&': 'w:auto !important; min-width:280px p: $3 $4 !important; font-size:1.125rem r:50px box-shadow: 0 4px 15px #f4810e40; transition: transform 0.2s, box-shadow 0.2s;',
	'&.interacting': 'transform:translateY(-2px) box-shadow: 0 6px 20px #f4810e60;'
});

const secondaryButtonStyle = insertCss({
	'&': 'w:auto !important; min-width:280px p: $2 $4 !important; font-size:1rem r:50px;'
});

const sectionStyle = insertCss({
	'&': 'mt:$3',
	h2: 'font-size:1.2rem fg:$primary mb:$2 text-align:center',
});

const infoCardStyle = insertCss({
	'&': 'display:flex flex-direction:column gap:$1 p:$3 bg:#ffffff05 r:12px border: 1px solid #ffffff08;',
	h3: 'font-size:0.95rem fg:$text m:0',
	p: 'font-size:0.85rem fg:$textMuted m:0 line-height:1.5',
	'code': 'bg:$surfaceLight p: 1px 4px; r:3px font-size:0.9em',
	'a': 'fg:$primaryLight'
});

const stepCardStyle = insertCss({
	'&': 'display:flex flex-direction:column gap:$1 p:$3 bg:#ffffff05 r:12px border: 1px solid #ffffff08;',
	'.title-row': 'display:flex align-items:center gap:$2',
	'.num': 'font-size:1.5rem font-weight:800 fg:$primary line-height:1',
	h3: 'font-size:0.95rem fg:$text m:0',
	p: 'font-size:0.85rem fg:$textMuted m:0 line-height:1.5',
	'code': 'bg:$surfaceLight p: 1px 4px; r:3px font-size:0.9em',
	'a': 'fg:$primaryLight'
});

const carouselStyle = insertCss({
	'&': 'position:relative overflow:hidden r:12px bg:$surface',
	'.carousel-track': 'display:flex transition: transform 0.3s ease-out;',
	'.carousel-slide': 'min-width:100% display:flex justify-content:center p:$2',
	'.carousel-slide img': 'max-width:100% max-height:400px r:8px object-fit:contain cursor:pointer',
	'.carousel-dots': 'display:flex justify-content:center gap:$1 p:$2',
	'.carousel-dot': 'w:10px h:10px r:50% bg:$border cursor:pointer transition: background 0.2s;',
	'.carousel-dot.active': 'bg:$primary',
	'.placeholder': 'w:100% h:200px display:flex align-items:center justify-content:center fg:$textMuted font-style:italic'
});

const lightboxStyle = insertCss({
	'&': 'position:fixed top:0 left:0 w:100vw h:100vh bg:rgba(0,0,0,0.9) display:flex align-items:center justify-content:center z-index:2000 cursor:pointer',
	'img': 'max-width:95vw max-height:95vh object-fit:contain'
});

// Screenshots placeholder - replace with actual URLs when available
const screenshots: string[] = [
	// '/screenshots/main.png',
];

export function drawLandingPage(): void {
    routeState.title = 'Light Lynx';
    
    $('div', landingStyle, () => {
        // Hero
        $('div', heroStyle, () => {
            $('h1#Light Lynx');
            $('p#Turn Zigbee2MQTT into a polished light automation solution. Like the Philips Hue app, but running entirely on your own hardware.');
        });

        // Action buttons
        $('div', buttonRowStyle, () => {
            $('button', primaryButtonStyle, 'type:button text="Connect to my server" click=', () => route.go(['connect']));
            $('button.secondary', secondaryButtonStyle, 'type:button text="Try the demo" click=', connectToDemo);
        });

        // Screenshots carousel
        drawScreenshotCarousel();

        // Feature cards
        $('div', sectionStyle, () => {
            $('h2#Features');
            $('div', featuresStyle, () => {
                $('div', featureStyle, () => {
                    $('h3', () => { icons.zap(); $('#Fast Web App'); });
                    $('p#Single-tap light control. Loads instantly from cache, works offline. Manage groups, scenes, and devices.');
                });

                $('div', featureStyle, () => {
                    $('h3', () => { icons.sensor(); $('#Integrated Automation'); });
                    $('p#Connect buttons, motion sensors, and timers to scenes. Tap patterns, auto-off timers, sunrise/sunset triggers.');
                });

                $('div', featureStyle, () => {
                    $('h3', () => { icons.shield(); $('#Secure Multi-User'); });
                    $('p#Per-user permissions for guests and kids. Auto-SSL, optional remote access on random port. No third-party intermediates.');
                });
            });
        });

        // How it works
        $('div', sectionStyle, () => {
            $('h2#How It Works');
            $('div', featuresStyle, () => {
                $('div', infoCardStyle, () => {
                    $('h3#Z2M Extension');
                    $('p#A single JS file runs inside Zigbee2MQTT. It exposes a WebSocket API with automatic Let\'s Encrypt SSL via lightlynx.eu DNS challenge.');
                });
                $('div', infoCardStyle, () => {
                    $('h3#Web App');
                    $('p#Hosted on lightlynx.eu, cached locally via service worker. Device state is also cached — the app opens instantly and works offline.');
                });
                $('div', infoCardStyle, () => {
                    $('h3#Remote Access');
                    $('p#When enabled, uses UPnP to forward a random external port. The app races both local and external connections, picking whichever responds first.');
                });
            });
        });

        // Get started
        $('div', sectionStyle, () => {
            $('h2#Get Started');
            $('div', featuresStyle, () => {
                $('div', stepCardStyle, () => {
                    $('div.title-row', () => {
                        $('span.num #1');
                        $('h3#Install Extension');
                    });
                    $('p', () => {
                        $('#Download ');
                        $('a href=/extension.js download=lightlynx.js #lightlynx.js');
                        $('#, copy to Z2M ');
                        $('code#data/extension');
                        $('#folder, restart.');
                    });
                });
                $('div', stepCardStyle, () => {
                    $('div.title-row', () => {
                        $('span.num #2');
                        $('h3#Connect');
                    });
                    $('p rich=', "Enter your server's IP. User `admin`, no password.");
                });
                $('div', stepCardStyle, () => {
                    $('div.title-row', () => {
                        $('span.num #3');
                        $('h3#Configure');
                    });
                    $('p#Tap the wrench for admin mode. Set up users, groups, scenes, triggers.');
                });
            });
        });
    });
}

function drawScreenshotCarousel(): void {
    if (screenshots.length === 0) {
        $('div', carouselStyle, () => {
            $('div.placeholder #Screenshots coming soon...');
        });
        return;
    }

    const currentIndex = proxy(0);
    const lightboxSrc = proxy<string | null>(null);

    $('div', carouselStyle, () => {
        $('div.carousel-track', () => {
            $('style=', () => `transform: translateX(-${currentIndex.value * 100}%)`);
            onEach(screenshots, (src, i) => {
                $('div.carousel-slide', () => {
                    $('img src=', src, 'alt=', `Screenshot ${i + 1}`, 'click=', () => { lightboxSrc.value = src; });
                });
            });
        });
        if (screenshots.length > 1) {
            $('div.carousel-dots', () => {
                onEach(screenshots, (_, i) => {
                    $('div.carousel-dot', () => {
                        $('.active=', currentIndex.value === i);
                        $('click=', () => { currentIndex.value = i; });
                    });
                });
            });
        }
    });

    $(() => {
        if (lightboxSrc.value) {
            $('div', lightboxStyle, 'click=', () => { lightboxSrc.value = null; }, () => {
                $('img src=', lightboxSrc.value, 'click=', (e: Event) => e.stopPropagation());
            });
        }
    });
}

function connectToDemo(): void {
    const demoNumber = Math.floor(Math.random() * 21);
    const demoHost = `demo${String(demoNumber).padStart(2, '0')}.lightlynx.eu`;
    api.store.servers.unshift({
        localAddress: demoHost,
        username: 'admin',
        secret: '',
        status: 'try'
    });
}
