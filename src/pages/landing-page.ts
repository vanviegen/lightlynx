import { $, insertCss, proxy, onEach } from 'aberdeen';
import * as route from 'aberdeen/route';
import * as icons from '../icons';
import { routeState } from '../ui';
import { showInfo } from '../components/prompt';
import api from '../api';

const landingStyle = insertCss('p: $4 $3; display:flex flex-direction:column gap:$4');

const heroStyle = insertCss({
	'&': 'text-align:center p: $3 0;',
	h1: 'font-size:2.5rem mb:$2 line-height:1.1 bg: linear-gradient(45deg, #f4810e, #fb3403); background-clip:text -webkit-background-clip:text -webkit-text-fill-color:transparent font-weight:800;',
	p: 'font-size:1rem fg:$textMuted max-width:600px m: 0 auto; line-height:1.5'
});

const featuresStyle = insertCss('display:grid grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:$3');

const featureStyle = insertCss({
	'&': 'text-align:center display:flex flex-direction:column align-items:center gap:$2 p:$3 bg:#ffffff05 r:12px border: 1px solid #ffffff08;',
	'.icon': 'fg:$primary w:36px h:36px',
	h3: 'font-size:1rem fg:$primary m:0',
	p: 'font-size:0.85rem fg:$textMuted m:0 line-height:1.5',
	'.more': 'font-size:0.8rem fg:$primaryLight cursor:pointer mt:$1'
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

const contentStyle = insertCss({
	'&': 'line-height:1.6 fg:$textLight',
	'ol, ul': 'pl:1.5em m:0',
	'li': 'mb:$2',
	'strong': 'fg:$text',
	'code': 'bg:$surfaceLight p: 2px 6px; r:4px font-size:0.9em'
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
        $('div', featuresStyle, () => {
            drawFeatureCard(icons.zap, 'Instant Response',
                'Optimistic updates and native Zigbee groups for instant light control.',
                'Instant Response', () => {
                    $('p#Light Lynx uses several techniques to feel fast:');
                    $('ul', () => {
                        $('li rich=', '**Optimistic updates:** The UI updates immediately when you tap, before confirmation from the server.');
                        $('li rich=', '**Native Zigbee groups:** Lights in a group receive commands simultaneously via multicast, rather than one-by-one.');
                        $('li rich=', "**Zigbee scenes:** Scene activations are single commands — the coordinator doesn't need to send individual brightness/color values.");
                        $('li rich=', '**Debounced updates:** Rapid changes (like dragging a slider) are batched to avoid flooding the network.');
                    });
                });

            drawFeatureCard(icons.palette, 'Groups & Scenes',
                'Organize lights, create scenes, set up button and sensor triggers.',
                'Groups & Scenes', () => {
                    $('p#Organize your lights the way you want:');
                    $('ul', () => {
                        $('li rich=', '**Groups:** Combine multiple lights to control together. Uses native Zigbee groups for speed.');
                        $('li rich=', '**Scenes:** Save lighting presets with custom colors and brightness levels.');
                        $('li rich=', '**Triggers:** Assign buttons, motion sensors, or time schedules to activate scenes.');
                        $('li rich=', '**Tap patterns:** Single press toggles on/off. Double or triple press can activate different scenes.');
                        $('li rich=', '**Auto-off timers:** Automatically turn off groups after a period of inactivity.');
                    });
                });

            drawFeatureCard(icons.extension, 'Z2M Extension',
                'Runs inside Zigbee2MQTT. No separate server needed.',
                'How the Extension Works', () => {
                    $('p#Light Lynx runs as an extension inside your Zigbee2MQTT instance:');
                    $('ul', () => {
                        $('li rich=', '**WebSocket API:** The extension exposes a secure WebSocket server (WSS) on a random high port for this web app to connect to.');
                        $('li rich=', "**SSL certificates:** Automatic Let's Encrypt certificates via lightlynx.eu DNS challenge. Your browser gets a valid HTTPS connection without manual setup.");
                        $('li rich=', "**Data storage:** All configuration (users, automation rules) is stored in Z2M's data directory. Groups/scenes/triggers are stored in device/group descriptions.");
                        $('li rich=', '**Auto-upgrade:** When you connect, the app checks if your extension needs updating and can install new versions automatically.');
                    });
                });

            drawFeatureCard(icons.cloud, 'Optional Remote Access',
                'Control from anywhere via UPnP and encrypted connections.',
                'Remote Access', () => {
                    $('p#Access your lights from outside your home network:');
                    $('ul', () => {
                        $('li rich=', '**UPnP port forwarding:** The extension automatically requests a port forward from your router (if supported).');
                        $('li rich=', '**IP-encoded domains:** Your server gets a unique subdomain like `x192168001005.lightlynx.eu` that resolves to your IP.');
                        $('li rich=', '**Race-to-connect:** The app tries both local and remote addresses simultaneously, using whichever responds first. Seamless WiFi/mobile transitions.');
                        $('li rich=', '**Encrypted always:** All connections use WSS/HTTPS with valid certificates, even on your local network.');
                        $('li rich=', '**Per-user permissions:** Enable remote access system-wide, then grant it to specific users.');
                    });
                    $('p mt:$2 rich=', 'Note: Remote access requires a small cloud dependency for SSL certificates and DNS. The app works LAN-only indefinitely once initially loaded.');
                });
        });

        // How it works (technical)
        $('div', sectionStyle, () => {
            $('h2#Technical Overview');
            $('div', contentStyle, () => {
                $('ul', () => {
                    $('li rich=', '**Extension:** Light Lynx provides a Zigbee2MQTT extension that exposes a secure WebSocket API. It obtains a Let\'s Encrypt certificate through lightlynx.eu.');
                    $('li rich=', '**Service worker caching:** You open the web app through *lightlynx.eu*. It caches itself via a service worker. After first load, it opens instantly — even offline.');
                    $('li rich=', '**Optional remote access:** When enabled on the extension, it sets up UPnP port forwarding and add the external IP to the SSL certificate. Clients will attempt to connect both the internal and external addresses simultaneously.');
                });
            });
        });

        // Get started
        $('div', sectionStyle, () => {
            $('h2#Get Started');
            $('div', contentStyle, () => {
                $('ol', () => {
                    $('li', () => {
                        $('strong#Download the extension: ');
                        $('a href=/extension.js download=lightlynx.js #lightlynx.js');
                    });
                    $('li rich=', "**Install it:** Copy to your Zigbee2MQTT `data/extension` folder (restart required), or upload via Z2M's frontend (Settings → Extensions).");
                    $('li rich=', "**Connect:** [Connect](/connect) using your server's IP address. User `admin`, no initial password.");
                    $('li rich=', '**Configure:** Press the wrench icon to toggle admin-mode and setup your users, devices, groups, scenes, and triggers.');
                });
            });
        });
    });
}

function drawFeatureCard(icon: () => void, title: string, description: string, moreTitle: string, moreContent: () => void): void {
    $('div', featureStyle, () => {
        icon();
        $('h3#', title);
        $('p#', description);
        $('span.more #More...', 'click=', () => showInfo(moreTitle, moreContent));
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
