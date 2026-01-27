import { $, insertCss } from 'aberdeen';
import * as route from 'aberdeen/route';
import * as icons from '../icons';
import { routeState } from '../ui';

const landingStyle = insertCss('p: $4 $3; display:flex flex-direction:column gap:$5');

const heroStyle = insertCss({
	'&': 'text-align:center p: $4 0;',
	h1: 'font-size:2.5rem mb:$3 line-height:1.1 bg: linear-gradient(45deg, #f4810e, #fb3403); background-clip:text -webkit-background-clip:text -webkit-text-fill-color:transparent font-weight:800;',
	p: 'font-size:1.125rem fg:$textMuted max-width:600px m: 0 auto;'
});

const featuresStyle = insertCss('display:grid grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:$4');

const featureStyle = insertCss({
	'&': 'text-align:center display:flex flex-direction:column align-items:center gap:$3 p:$4 bg:#ffffff05 r:12px border: 1px solid #ffffff08;',
	'.icon': 'fg:$primary w:48px h:48px',
	h3: 'font-size:1.125rem fg:$primary',
	p: 'font-size:0.875rem fg:$textMuted'
});

const primaryButtonStyle = insertCss({
	'&': 'align-self:center w:auto !important; min-width:280px p: $3 $4 !important; font-size:1.125rem r:50px box-shadow: 0 4px 15px #f4810e40; transition: transform 0.2s, box-shadow 0.2s;',
	'&:hover': 'transform:translateY(-2px) box-shadow: 0 6px 20px #f4810e60;'
});

export function drawLandingPage(): void {
    routeState.title = 'Light Lynx';
    
    $('div', landingStyle, () => {
        $('div', heroStyle, () => {
            $('h1#Control your lights, simply.');
            $('p#Light Lynx is a modern, fast, and mobile-friendly interface for Zigbee2MQTT. No hubs, no clouds, just your home.');
        });

        $('button', primaryButtonStyle, 'type:button#Connect to a server click=', () => route.go(['connect']));
        
        $('div', featuresStyle, () => {
            $('div', featureStyle, () => {
                icons.zap();
                $('h3#Reactive UI');
                $('p#Instant feedback with optimistic updates. No more waiting for your lights to catch up.');
            });
            $('div', featureStyle, () => {
                icons.palette();
                $('h3#Full Control');
                $('p#Manage groups, scenes, and automation triggers directly from your phone.');
            });
            $('div', featureStyle, () => {
                icons.cloudOff();
                $('h3#Local First');
                $('p#Works entirely on your local network. Your data stays your data.');
            });
        });
    });
}
