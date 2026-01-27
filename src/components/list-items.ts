import { $, insertCss } from 'aberdeen';
import { drawBulbCircle } from './color-picker';
import { Device } from '../types';
import * as route from 'aberdeen/route';

// Export style classes for flexible use
export const itemStyle = insertCss({
	'&': 'display:flex align-items:center gap:$3 p: $2 $3; m: $1 0; bg:$surfaceLight border: 1px solid $border; r:6px white-space:nowrap',
	'&.link': {
		'&': 'cursor:pointer transition:background-color 0.15s',
		'&:hover': 'bg:$surfaceHover',
		'&:active': 'transform:scale(0.99)'
	},
	'&.active-scene': 'bg: rgba(244, 129, 14, 0.15); border-left: 4px solid $primary; pl: calc($2 - 3px);',
	h2: 'font-size:1.125rem font-weight:500 flex: 1 0 auto;',
	'.icon:first-child': 'flex:none w:32px h:32px',
	'.icon:last-child': 'ml:auto w:24px',
	'input[type="checkbox"]:first-child': 'flex:none w:32px h:32px m:0',
	button: 'w:auto'
});

export const listStyle = insertCss('display:flex flex-direction:column gap:$1');

export const emptyStyle = insertCss('p:$3 text-align:center font-style:italic color:$textMuted');

export const badgeStyle = insertCss({
    '&': 'p:$1 $2; r:4px font-size:0.75rem font-weight:500 bg:#333 color:#aaa ml:auto align-self:center',
    
    '&.warning': 'bg:#f4810e30 color:$warning'
});

// Helper function for common pattern: device item with bulb circle and name
export function drawDeviceItem(device: Device, ieee: string): void {
    $('div', itemStyle, () => {
        drawBulbCircle(device, ieee);
        $('h2.link#', device.name, 'click=', () => route.go(['bulb', ieee]));
    });
}
