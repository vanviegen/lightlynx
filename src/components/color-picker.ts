import { $, clean, onEach, insertCss } from "aberdeen"
import * as icons from '../icons'
import * as colors from "../colors"
import api from "../api"
import { LightState, XYColor, HSColor, Device, Group, isHS, isXY } from '../types'

const CT_MIN = 100, CT_MAX = 550;

// Circle toggle styles
const circleStyle = insertCss({
	'&': 'w:52px h:28px r:14px border: 1px solid $border; bg:#080808 cursor:pointer flex-shrink:0 position:relative overflow:visible transition: background-color 0.3s ease, border-color 0.3s ease;',
	// Off-state circle (always dark)
	'&::before': 'content: ""; position:absolute w:22px h:22px r:50% bg:#555 top:2px left:2px transition: transform 0.3s ease, opacity 0.3s ease; opacity:1',
	// On-state circle (with gradient)
	'&::after': 'content: ""; position:absolute w:22px h:22px r:50% bg: var(--knob-background, var(--knob-color, #555)); top:2px left:2px transition: transform 0.3s ease, opacity 0.3s ease, box-shadow 0.3s ease; box-shadow: var(--knob-glow, none); opacity:0',
	'&.on': {
		'&': 'border-color:#555',
		'&::before': 'transform:translateX(24px) opacity:0',
		'&::after': 'transform:translateX(24px) opacity:1'
	},
    '&.interacting': 'border-color:$primaryHover box-shadow: 0 0 5px $primaryHover',
});

// Color wheel container styles
const wheelStyle = insertCss('position:relative');

// Handle/marker styles
const handleStyle = insertCss('position:absolute transition: all 0.1s; r:50% border: 2px solid #fff; box-shadow: 0 0 0 1px #000 inset; touch-action:none user-select:none -webkit-touch-callout:none -webkit-tap-highlight-color:transparent');

// Scale container styles
const scaleStyle = insertCss('border: 1px solid $border; position:relative h:40px r:3px overflow:hidden');

interface TrackingState {
    event: MouseEvent | TouchEvent;
    setPosition: (pageX: number, pageY?: number) => void;
}

let tracking: TrackingState | undefined;

export function getBulbRgb(target: Device | Group): string {
    let state = target.lightState || {} as LightState;
    if (!state.on) {
        return "#000000";
    } else {
        const brightness = state.brightness || 255;
        return colors.rgbToHex(colors.toRgb(state.color as number | HSColor | XYColor | null | undefined, 0.3 + brightness / 255 * 0.7));
    }
}

export function drawBulbCircle(target: Device | Group, targetId: string | number): void {
    if (!target.lightCaps || (target as any).members && Object.keys(target.lightCaps).length === 0) {
        if (!(target as any).members) icons.sensor();
        return;
    }
    function onClick(): void {
        api.setLightState(targetId, { on: !target.lightState?.on });
    }
    
    const isGroup = !!(target as any).members;
    
    $('div.circle', circleStyle, 'click=', onClick, () => {
        // Reactive scope: only this inner function re-runs on state change
        const isOn = target.lightState?.on;
        
        let knobColor = '#555';
        let knobBackground = '';
        
        if (isGroup && isOn) {
            // For groups, collect all colors for gradient
            let bgs: string[] = [];
            const group = target as Group;
            for(let ieee of group.members) {
                let device = api.store.devices[ieee];
                if (device) {
                    bgs.push(getBulbRgb(device));
                }
            }
            bgs.sort();
            if (bgs.length === 1) {
                knobColor = bgs[0] || knobColor;
            } else if (bgs.length > 1) {
                knobBackground = `linear-gradient(135deg, ${bgs.join(', ')})`;
                knobColor = bgs[0] || knobColor; // Fallback for browsers that don't support gradients
            }
        } else if (isOn) {
            // Single device
            knobColor = getBulbRgb(target);
        }
        
        const knobGlow = isOn ? `0 0 10px ${knobColor}` : 'none';
        // Use gradient if available, otherwise use solid color
        const finalBackground = knobBackground || knobColor;
        
        $({
            '.on': isOn,
            style: `--knob-color: ${knobColor}; --knob-background: ${finalBackground}; --knob-glow: ${knobGlow}`,
        });
    });
}

function drawColorWheelMarker(state: LightState, size: number = 24): void {
    $('div', handleStyle, () => {
        let color = state.color;

        if (typeof color === 'number') {
            color = colors.miredsToHs(color);
        }
        else if (color == null) {
            $('display:none');
            return;
        }
        else if (isXY(color)) {
            color = colors.xyToHs(color as XYColor);
        }
        
        if (!isHS(color)) {
            $('display:none');
            return;
        }

        let lsize = state.on ? size : size / 4;
        let hueRadians = color.hue * (Math.PI / 180);
        let left = Math.cos(hueRadians) * color.saturation * 50 + 50;
        let top = Math.sin(hueRadians) * color.saturation * 50 + 50;

        $(`display:block h:${lsize}px w:${lsize}px mt:${-lsize/2}px ml:${-lsize/2}px top:${top}% left:${left}%`);
    });
}

export function drawColorWheel(target: Device | Group, targetId: string | number): void {
    const state = target.lightState;
    if (!state) return;
    
    let canvas: HTMLCanvasElement;

    $('div', wheelStyle, () => {
        let canvasEl = $('canvas w:100% mousedown=', startTrack, 'touchstart=', startTrack, {
            width: 1,
            height: 1
        }) as HTMLCanvasElement;

        canvas = canvasEl;
        setTimeout(paintColorWheelCanvas, 0);

        window.addEventListener('resize', paintColorWheelCanvas);
        clean(() => {
            window.removeEventListener('resize', paintColorWheelCanvas);
        })

        drawColorWheelMarker(state);
        if ('members' in target) onEach(target.members, ieee => {
            let memberState = api.store.devices[ieee]?.lightState;
            if (memberState) {
                drawColorWheelMarker(memberState, 8);
            }
        });
    });

    function startTrack(event: MouseEvent | TouchEvent): void {
        tracking = { event, setPosition };
    }

    function setPosition(pageX: number, pageY: number = 0): void {
        let bounding = canvas.getBoundingClientRect();

        let radius = bounding.width / 2;
        let relX = (pageX - bounding.left - radius) / radius;
        let relY = (pageY - bounding.top - radius) / radius;

        let hue = Math.atan2(relY, relX) * 180 / Math.PI;
        if (hue < 0) hue += 360;
        let saturation = Math.sqrt(relX * relX + relY * relY);
        api.setLightState(targetId, { color: { hue, saturation }, on: true });
    }

    function paintColorWheelCanvas(): void {
        let radius = canvas.offsetWidth / 2;
        canvas.height = canvas.width = radius * 2;
        let ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let step = 0.5 * Math.atan(1 / radius);

        for (let rad = -Math.PI; rad < Math.PI; rad += step) {
            let hue = rad / Math.PI * 180;

            let x = radius * Math.cos(rad),
                y = radius * Math.sin(rad);

            ctx.strokeStyle = 'hsl(' + hue + ', 100%, 50%)';

            ctx.beginPath();
            ctx.moveTo(radius, radius);
            ctx.lineTo(radius + x, radius + y);
            ctx.stroke();
        }

        let grd = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
        grd.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grd.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(radius, radius, radius, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.fill();
    }
}

function drawScaleMarker(state: LightState, colorTempRange?: [number, number], size: number = 24): void {
    $('div', handleStyle, () => {
        let lsize = size;
        let fraction: number;
        
        if (colorTempRange) {
            let colorTemp = state.color;

            if (isHS(colorTemp)) {
                const brightness = state.brightness || 255;
                let rgb = colors.hsvToRgb(colorTemp.hue, colorTemp.saturation, brightness / 255);
                colorTemp = colors.rgbToMireds(rgb, 50, CT_MIN, CT_MAX);
                lsize = Math.min(lsize, 8);
            }
            if (colorTemp == null || typeof colorTemp !== 'number') {
                $('display:none');
                return;
            }
            fraction = (colorTemp - colorTempRange[0]) / (colorTempRange[1] - colorTempRange[0]);
        } else {
            const brightness = state.brightness || 255;
            fraction = brightness / 255;
        }
        
        if (!state.on) {
            lsize /= 4;
        }
        
        $(`display:block h:${lsize}px w:${lsize}px mt:${-lsize/2}px ml:${-lsize/2}px top:50% left:${fraction*100}%`);
    });
}

export function drawColorPicker(device: Device, ieee: string): void;
export function drawColorPicker(group: Group, groupId: number): void;
export function drawColorPicker(target: Device | Group, targetId: string | number): void {

    const capabilities = target.lightCaps;
    if (!capabilities) return;
            
    $('div m:$3 display:flex gap:$3 flex-direction:column', () => {
        $('div display:flex gap:$3 align-items:center', () => {
            if ('members' in target) { // group
                drawBulbCircle(target as Device, targetId as string);
            }
            if (capabilities.brightness) {
                drawScale(target, targetId);
            }
        });

        if (capabilities.colorTemp || capabilities.colorXy || capabilities.colorHs) {
            let temps: [number, number] = capabilities.colorTemp ? 
                [capabilities.colorTemp.valueMin, capabilities.colorTemp.valueMax] : 
                [CT_MIN, CT_MAX];
            drawScale(target, targetId, temps);
        }
            
        if (capabilities.colorXy || capabilities.colorHs) {
            drawColorWheel(target, targetId);
        }
    });
}

function drawScale(target: Device | Group, targetId: string | number, colorTempRange?: [number, number]): void {
    $('div', scaleStyle, () => {

        let state = target.lightState || {};

        let canvasEl = $('canvas h:100% w:100%', {
            width: 300,
            height: 1
        }) as HTMLCanvasElement;

        let ctx = canvasEl.getContext("2d")!;
        var imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
        let pixels = imageData.data;

        let pos = 0;

        let baseColor: [number, number, number] | undefined;
        if (!colorTempRange) {
            baseColor = colors.toRgb(state.color as number | HSColor | XYColor | null | undefined);
        }

        for (let x = 0; x <= 300; x++) {
            let rgb: [number, number, number];
            if (colorTempRange) {
                rgb = colors.miredsToRgb(x / 300 * (colorTempRange[1] - colorTempRange[0]) + colorTempRange[0]);
            } else {
                rgb = baseColor!.map(v => Math.round(v / 300 * x)) as [number, number, number];
            }
            pixels[pos++] = rgb[0];
            pixels[pos++] = rgb[1];
            pixels[pos++] = rgb[2];
            pixels[pos++] = 255; // alpha
        }

        ctx.putImageData(imageData, 0, 0);

        drawScaleMarker(state, colorTempRange);

        if ('members' in target) onEach(target.members, ieee => {
            let memberState = api.store.devices[ieee]?.lightState;
            if (memberState) {
                drawScaleMarker(memberState, colorTempRange, 8);
            }
        });


        function setPosition(pageX: number): void {
            let bounding = canvasEl.getBoundingClientRect();
            let fraction = (pageX - bounding.left) / bounding.width;
            let state = colorTempRange ? {
                on: true,
                color: Math.min(colorTempRange[1], Math.max(colorTempRange[0], Math.round(fraction * (colorTempRange[1] - colorTempRange[0]) + colorTempRange[0]))),
            } : {
                on: true,
                brightness: Math.min(255, Math.max(0, Math.round(fraction * 255))),
            };
            api.setLightState(targetId, state);
        }

        function startTrack(event: MouseEvent | TouchEvent): void {
            tracking = { event, setPosition: (pageX: number) => setPosition(pageX) };
        }

        $('mousedown=', startTrack, 'touchstart=', startTrack);
    });
}

function trackMouse(e: MouseEvent): void {
    if (!tracking) return;

    tracking.setPosition(e.pageX, e.pageY);

    if (e.type === "mouseup") tracking = undefined;
}

function trackTouch(e: TouchEvent): void {
    if (!tracking) return;

    let startTouch = (tracking.event as TouchEvent).touches[0]!;
    let touch = e.touches[0]!;
    if (Math.max(
        Math.abs(touch.pageX - startTouch.pageX),
        Math.abs(touch.pageY - startTouch.pageY),
    ) > 10) {
        tracking = undefined;
    } else if (e.type === "touchend") {
        tracking.setPosition(touch.pageX, touch.pageY);
        tracking = undefined;
    }
}

document.body.addEventListener('mousemove', trackMouse);
document.body.addEventListener('mouseup', trackMouse);
document.body.addEventListener('touchmove', trackTouch);
document.body.addEventListener('touchend', trackTouch);
