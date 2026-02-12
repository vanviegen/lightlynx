import { $, onEach, insertCss } from "aberdeen"
import * as icons from '../icons'
import * as colors from "../colors"
import api from "../api"
import { LightState, GroupWithDerives, Light } from '../types'

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

// Handle/marker styles
const handleStyle = insertCss('position:absolute transition: none 0.1s; r:50% border: 2px solid #fff; box-shadow: 0 0 0 1px #000 inset; touch-action:none user-select:none -webkit-touch-callout:none -webkit-tap-highlight-color:transparent');

// Scale container styles
const scaleStyle = insertCss('border: 1px solid $border; position:relative h:40px r:3px overflow:hidden');

interface TrackingState {
    event: MouseEvent | TouchEvent;
    setPosition: (pageX: number, pageY?: number) => void;
}

let tracking: TrackingState | undefined;

export function getBulbRgb(target: Light | GroupWithDerives): string {
    let state = target.lightState || {} as LightState;
    if (!state.on) {
        return "#000000";
    } else {
        const brightness = state.brightness || 255;
        return colors.rgbToHex(colors.stateToRgb(state, 0.3 + brightness / 255 * 0.7));
    }
}

export function drawToggle(target: Light | GroupWithDerives, targetId: string | number): void {
    if (!target.lightCaps || (target as any).members && Object.keys(target.lightCaps).length === 0) {
        if (!(target as any).members) icons.sensor();
        return;
    }
    function onClick(): void {
        api.setLightState(targetId, { on: !target.lightState?.on });
    }
    
    const isGroup = 'lightIds' in target;
    
    $('div.circle', circleStyle, 'click=', onClick, () => {
        // Reactive scope: only this inner function re-runs on state change
        const isOn = target.lightState?.on;
        
        let knobColor = '#555';
        let knobBackground = '';
        
        if (isGroup && isOn) {
            // For groups, collect all colors for gradient
            let bgs: string[] = [];
            const group = target as GroupWithDerives;
            for(let ieee of group.lightIds) {
                let device = api.store.lights[ieee];
                if (device) {
                    bgs.push(getBulbRgb(device));
                }
            }
            bgs.sort();
            if (bgs.length && bgs.every(color => color === bgs[0])) { // All the same color, no need for gradient
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

function drawScaleMarker(state: LightState, mode: 'brightness' | 'temperature' | 'hue' | 'saturation', tempRange?: [number, number], size: number = 24): void {
    $('div', handleStyle, () => {
        let lsize = size;
        let fraction: number;
        
        if (mode === 'brightness') {
            fraction = (state.brightness || 255) / 255;
        } else if (mode === 'temperature') {
            const temp = state.mireds;
            if (temp == null) {
                // HS color light shown on temperature slider: show approximate position (small marker)
                if (state.hue != null) {
                    const rgb = colors.hsvToRgb(state.hue, (state.saturation ?? 100) / 100, 1);
                    const approxMireds = approximateTemperature(rgb, tempRange);
                    if (approxMireds != null) {
                        fraction = (approxMireds - tempRange![0]) / (tempRange![1] - tempRange![0]);
                        lsize = Math.min(lsize, 8);
                    } else {
                        $('display:none');
                        return;
                    }
                } else {
                    $('display:none');
                    return;
                }
            } else {
                fraction = (temp - tempRange![0]) / (tempRange![1] - tempRange![0]);
            }
        } else if (mode === 'hue') {
            if (state.hue == null) {
                $('display:none');
                return;
            }
            fraction = state.hue / 360;
        } else { // saturation
            if (state.saturation == null) {
                $('display:none');
                return;
            }
            fraction = state.saturation / 100;
        }

        if (!state.on) {
            lsize /= 4;
        }

        $(`display:block h:${lsize}px w:${lsize}px mt:${-lsize/2}px ml:${-lsize/2}px top:50% left:${fraction*100}%`);
    });
}

/** Try to approximate an RGB color as a color temperature in mireds. */
function approximateTemperature(rgb: [number, number, number], tempRange?: [number, number]): number | undefined {
    if (!tempRange) return undefined;
    const maxStep = 7;
    let bestI = 0;
    let results: Array<{ delta: number; mireds: number }> = [];
    for (let i = 0; i <= maxStep; i++) {
        let mireds = Math.round((tempRange[1] - tempRange[0]) / maxStep * i + tempRange[0]);
        let rgb2 = colors.miredsToRgb(mireds);
        let delta = Math.abs(rgb2[0] - rgb[0]) + Math.abs(rgb2[1] - rgb[1]) + Math.abs(rgb2[2] - rgb[2]);
        results.push({ delta, mireds });
        if (delta < results[bestI]!.delta) bestI = i;
    }
    return results[bestI]!.delta <= 50 ? results[bestI]!.mireds : undefined;
}

export function drawColorPicker(target: Light | GroupWithDerives, targetId: string | number): void {

    const capabilities = target.lightCaps;
    if (!capabilities) return;
            
    $('div m:$3 display:flex gap:$3 flex-direction:column', () => {
        $('div display:flex gap:$3 align-items:center', () => {
            if ('lightIds' in target) { // group
                drawToggle(target as GroupWithDerives, targetId as string);
            }
            if (capabilities.brightness) {
                drawScale(target, targetId, 'brightness');
            }
        });

        if (capabilities.mireds || capabilities.color) {
            let temps: [number, number] = capabilities.mireds ? 
                [capabilities.mireds.min, capabilities.mireds.max] : 
                [CT_MIN, CT_MAX];
            drawScale(target, targetId, 'temperature', temps);
        }
            
        if (capabilities.color) {
            drawScale(target, targetId, 'hue');
            drawScale(target, targetId, 'saturation');
        }
    });
}

const CANVAS_WIDTH = 64;

function drawScale(target: Light | GroupWithDerives, targetId: string | number, mode: 'brightness' | 'temperature' | 'hue' | 'saturation', tempRange?: [number, number]): void {
    $('div', scaleStyle, () => {

        let state = target.lightState || {} as LightState;

        // For saturation mode, use 360px height to show all hues vertically
        const canvasHeight = mode === 'saturation' ? 16 : 1;

        // We'll create a small canvas, and scale it to fit. Lineair interpolation is great for gradients!
        let canvasEl = $('canvas h:100% w:100%', {
            width: CANVAS_WIDTH,
            height: canvasHeight,
        }) as HTMLCanvasElement;

        let ctx = canvasEl.getContext("2d")!;

        if (mode === 'hue') {
            // Rainbow hue gradient — static, doesn't depend on state
            var imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
            let pixels = imageData.data;
            let pos = 0;
            for (let x = 0; x <= CANVAS_WIDTH; x++) {
                const rgb = colors.hsvToRgb(x / CANVAS_WIDTH * 360, 1, 1);
                pixels[pos++] = rgb[0];
                pixels[pos++] = rgb[1];
                pixels[pos++] = rgb[2];
                pixels[pos++] = 255;
            }
            ctx.putImageData(imageData, 0, 0);
        } else if (mode === 'saturation') {
            // Saturation gradient: white → fully saturated (horizontal), all hues 0-360 (vertical)
            var imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
            let pixels = imageData.data;
            let pos = 0;
            for (let y = 0; y < canvasEl.height; y++) {
                const hue = y / canvasHeight * 360;
                for (let x = 0; x < CANVAS_WIDTH; x++) {
                    const sat = x / CANVAS_WIDTH;
                    const rgb = colors.hsvToRgb(hue, sat, 1);
                    pixels[pos++] = rgb[0];
                    pixels[pos++] = rgb[1];
                    pixels[pos++] = rgb[2];
                    pixels[pos++] = 255;
                }
            }
            ctx.putImageData(imageData, 0, 0);
        } else {
            var imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
            let pixels = imageData.data;
            let pos = 0;

            if (mode === 'temperature') {
                for (let x = 0; x <= CANVAS_WIDTH; x++) {
                    const rgb = colors.miredsToRgb(x / CANVAS_WIDTH * (tempRange![1] - tempRange![0]) + tempRange![0]);
                    pixels[pos++] = rgb[0];
                    pixels[pos++] = rgb[1];
                    pixels[pos++] = rgb[2];
                    pixels[pos++] = 255;
                }
            } else {
                // Brightness: use current color
                const baseColor = colors.stateToRgb(state);
                for (let x = 0; x <= CANVAS_WIDTH; x++) {
                    pixels[pos++] = Math.round(baseColor[0] / CANVAS_WIDTH * x);
                    pixels[pos++] = Math.round(baseColor[1] / CANVAS_WIDTH * x);
                    pixels[pos++] = Math.round(baseColor[2] / CANVAS_WIDTH * x);
                    pixels[pos++] = 255;
                }
            }
            ctx.putImageData(imageData, 0, 0);
        }

        drawScaleMarker(state, mode, tempRange);

        if ('lightIds' in target) onEach(target.lightIds, ieee => {
            let memberState = api.store.lights[ieee]?.lightState;
            if (memberState) {
                drawScaleMarker(memberState, mode, tempRange, 8);
            }
        });


        function setPosition(pageX: number): void {
            let bounding = canvasEl.getBoundingClientRect();
            let fraction = Math.min(1, Math.max(0, (pageX - bounding.left) / bounding.width));
            
            if (mode === 'temperature') {
                api.setLightState(targetId, {
                    on: true,
                    mireds: Math.round(fraction * (tempRange![1] - tempRange![0]) + tempRange![0]),
                });
            } else if (mode === 'brightness') {
                api.setLightState(targetId, {
                    on: true,
                    brightness: Math.round(fraction * 255),
                });
            } else if (mode === 'hue') {
                api.setLightState(targetId, {
                    on: true,
                    hue: Math.round(fraction * 360),
                });
            } else { // saturation
                api.setLightState(targetId, {
                    on: true,
                    saturation: Math.round(fraction * 100),
                });
            }
        }

        function startTrack(event: MouseEvent | TouchEvent): void {
            tracking = { event, setPosition: (pageX: number) => setPosition(pageX) };
            if (event instanceof TouchEvent) trackTouch(event);
            else trackMouse(event);
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
