import { $, insertCss } from 'aberdeen';
import { drawBulbCircle } from './color-picker';
import { Device } from '../types';
import * as route from 'aberdeen/route';

// Export style classes for flexible use
export const itemStyle = insertCss({
    display: 'flex',
    alignItems: 'center',
    gap: '$3',
    p: '$2 $3',
    mv: '$1',
    bg: '$surfaceLight',
    borderTop: '1px solid $borderLight',
    borderBottom: '1px solid rgba(0,0,0,0.3)',
    borderRadius: '4px',
    whiteSpace: 'nowrap',
    
    '&.link': {
        cursor: 'pointer',
        transition: 'background-color 0.15s',
        '&:hover': {
            bg: '$surfaceHover',
        },
        '&:active': {
            transform: 'scale(0.99)',
        },
    },
    
    '&.active-scene': {
        bg: '#f4810e30',
        borderLeft: '4px solid $primary',
        pl: '$2',
    },
    
    h2: {
        fontSize: '1.125rem',
        fontWeight: 500,
        flex: '1 0 auto',
    },
    
    '.icon:first-child': {
        flex: 'none',
        w: '32px',
        h: '32px',
    },
    
    '.icon:last-child': {
        ml: 'auto',
        w: '24px',
    },
    
    'input[type="checkbox"]:first-child': {
        flex: 'none',
        w: '32px',
        h: '32px',
        m: 0,
    },
    
    button: {
        w: 'auto',
    },
});

export const listStyle = insertCss({
    display: 'flex',
    flexDirection: 'column',
    gap: '$1',
});

export const emptyStyle = insertCss({
    p: '$3',
    textAlign: 'center',
    fontStyle: 'italic',
    color: '$textMuted',
});

export const badgeStyle = insertCss({
    p: '$1 $2',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: 500,
    bg: '#333',
    color: '#aaa',
    ml: 'auto',
    alignSelf: 'center',
    
    '&.warning': {
        bg: '#f4810e30',
        color: '$warning',
    },
});

// Helper function for common pattern: device item with bulb circle and name
export function drawDeviceItem(device: Device, ieee: string): void {
    $('div', itemStyle, () => {
        drawBulbCircle(device, ieee);
        $('h2.link#', device.name, 'click=', () => route.go(['bulb', ieee]));
    });
}
