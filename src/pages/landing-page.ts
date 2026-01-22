import { $, insertCss } from 'aberdeen';
import * as route from 'aberdeen/route';
import * as icons from '../icons';

const landingStyle = insertCss({
    p: '$4 $3',
    display: 'flex',
    flexDirection: 'column',
    gap: '$5',
});

const heroStyle = insertCss({
    textAlign: 'center',
    p: '$4 0',
    
    h1: {
        fontSize: '2.5rem',
        mb: '$3',
        lineHeight: 1.1,
        background: 'linear-gradient(45deg, #f4810e, #fb3403)',
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        fontWeight: 800,
    },
    
    p: {
        fontSize: '1.125rem',
        color: '$textMuted',
        maxWidth: '600px',
        m: '0 auto',
    },
});

const featuresStyle = insertCss({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '$4',
});

const featureStyle = insertCss({
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '$3',
    padding: '$4',
    bg: '#ffffff05',
    borderRadius: '12px',
    border: '1px solid #ffffff08',
    
    '.icon': {
        color: '$primary',
        w: '48px',
        h: '48px',
    },
    
    h3: {
        fontSize: '1.125rem',
        color: '$primary',
    },
    
    p: {
        fontSize: '0.875rem',
        color: '$textMuted',
    },
});

const primaryButtonStyle = insertCss({
    alignSelf: 'center',
    w: 'auto !important',
    minWidth: '280px',
    p: '$3 $4 !important',
    fontSize: '1.125rem',
    borderRadius: '50px',
    boxShadow: '0 4px 15px #f4810e40',
    transition: 'transform 0.2s, box-shadow 0.2s',
    
    '&:hover': {
        transform: 'translateY(-2px)',
        boxShadow: '0 6px 20px #f4810e60',
    },
});

export function drawLandingPage(routeState: { title: string }): void {
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
