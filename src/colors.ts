import { LightState, LightCaps, Z2MLightDelta } from './types';

export const CT_DEFAULT = 300;

// input: h in [0,360] and s,v in [0,1] - output: r,g,b in [0,255]
// from https://stackoverflow.com/a/54024653
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    return [5, 3, 1].map(n => {
        let k = (n + h / 60) % 6;
        return Math.max(0, Math.min(255, Math.round((v - v * s * Math.max(Math.min(k, 4 - k, 1), 0)) * 255)));
    }) as [number, number, number];
}

export function xyvToRgb(x: number, y: number, v: number): [number, number, number] {
    const z = 1.0 - x - y;
    const Y = 1.0;
    const X = (Y / y) * x;
    const Z = (Y / y) * z;
    let red = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
    let green = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
    let blue = X * 0.051713 - Y * 0.121364 + Z * 1.011530;
    const maxVal = Math.max(red, green, blue, 1.0);
    return [Math.max(0, red / maxVal) * v, Math.max(0, green / maxVal) * v, Math.max(0, blue / maxVal) * v];
}

export function xyToHs(x: number, y: number): {hue: number, saturation: number} {
    const [h, s] = rgbToHsv(xyvToRgb(x, y, 255));
    return { hue: Math.round(h), saturation: Math.round(s * 100) };
}

/** Calculate the distance between two HS (hue, saturation) values as a value 0..2. Accounts for
 * hue being circular.
 */
export function getHsDistance(hs1: {hue: number, saturation: number}, hs2: {hue: number, saturation: number}): number {
    const d = Math.abs(hs1.hue - hs2.hue)/360;
    return (d < 0.5 ? d : 1-d) + Math.abs(hs1.saturation - hs2.saturation)/100;
}

export function rgbToHsv([r, g, b]: [number, number, number]): [number, number, number] {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let hue: number;
    if (max === min) {
        hue = 0;
    } else if (max === r) {
        hue = (60 * ((g - b) / (max - min)) + 360) % 360;
    } else if (max === g) {
        hue = (60 * ((b - r) / (max - min)) + 120) % 360;
    } else if (max === b) {
        hue = (60 * ((r - g) / (max - min)) + 240) % 360;
    } else {
        hue = 0; // fallback
    }

    let sat = max === 0 ? 0 : 1 - min / max;
    return [hue, sat, max];
}

export function miredsToRgb(mireds: number, brightness: number = 1): [number, number, number] {
    let temp = 10000 / mireds; // in hundreds of kelvins

    const rgb: [number, number, number] = [
        temp <= 66 ? 255 : 329.698 * Math.pow(temp - 60, -0.133205),
        temp <= 66 ? 99.47989 * Math.log(temp) - 161.120 : 288.122 * Math.pow(temp - 60, -0.0755148),
        temp >= 66 ? 255 : 138.518 * Math.log(temp - 10) - 305.044
    ];
    for (let i = 0; i < 3; i++) {
        rgb[i] = Math.max(0, Math.min(255, Math.round(brightness * rgb[i]!)));
    }
    return rgb;
}

export function rgbToHex(rgb: [number, number, number]): string {
    return '#' + rgb.map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

/** Convert a LightState to an RGB color for display purposes. */
export function stateToRgb(state: LightState, brightness: number = 1): [number, number, number] {
    if (state.hue != null) return hsvToRgb(state.hue, (state.saturation ?? 100) / 100, brightness);
    return miredsToRgb(state.mireds ?? CT_DEFAULT, brightness);
}



export function lightStateToZ2M(state: LightState): Z2MLightDelta {
    let delta: Z2MLightDelta = {};
    if (state.on != null) {
        delta.state = state.on ? 'ON' : 'OFF';
    }
    if (state.brightness != null) {
        delta.brightness = state.brightness;
    }
    if (state.mireds != null) {
        delta.color_temp = state.mireds;
    }
    if (state.hue != null && state.saturation != null) {
        delta.color = { hue: Math.round(state.hue), saturation: Math.round(state.saturation)/100 };
    }
    return delta;
}

export function miredsToHs(temperature: number): {hue: number, saturation: number} {
    const hsv = rgbToHsv(miredsToRgb(temperature, 1));
    return { hue: Math.round(hsv[0]), saturation: Math.round(hsv[1] * 100) };
}

/**
 * Given a generic light state and a certain light's capability, return a light state that
 * fits what the light can handle.
 */
export function limitLightStateToCaps(from: LightState, cap: LightCaps): LightState {
    let to: LightState = {};

    if (from.on != null) to.on = from.on;
    if (from.brightness != null && cap.brightness) to.brightness = Math.min(cap.brightness.max, Math.max(cap.brightness.min, 1, from.brightness));
    if (from.hue != null && cap.color) {
        to.hue = from.hue;
        to.mireds = undefined; // Clear mireds if we're setting hue, since they conflict
    }
    if (from.saturation != null && cap.color) {
        to.saturation = from.saturation;
        to.mireds = undefined; // Clear mireds if we're setting saturation, since they conflict
    }
    if (from.mireds != null && cap.mireds) {
        to.mireds = Math.min(cap.mireds.max, Math.max(cap.mireds.min, from.mireds));
        to.hue = undefined; // Clear hue/sat if we're setting mireds, since they conflict
        to.saturation = undefined;
    }

    return to;
}


export const DEFAULT_TRIGGERS: Record<number|string, object> = {
    1: {brightness: 150, color_temp: 365, state: 'ON'},
    2: {brightness: 40, color_temp: 450, state: 'ON'},
    3: {brightness: 254, color_temp: 225, state: 'ON'},
    sensor: {brightness: 150, color_temp: 365, state: 'ON'},
};
