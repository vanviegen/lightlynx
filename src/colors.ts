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

/** Convert CIE xy chromaticity to hue/saturation.
 * Uses the Wide RGB D65 gamut matrix (Zigbee/Hue) for the xy→RGB step,
 * then extracts HSV hue and saturation from the resulting RGB.
 */
export function xyToHs(x: number, y: number): {hue: number, saturation: number} {
    // CIE xy → XYZ (with Y=1)
    const X = x / y;
    const Z = (1 - x - y) / y;

    // XYZ → RGB (Wide RGB D65 gamut matrix)
    let r = X *  1.656492 - 0.354851 - Z * 0.255038;
    let g = X * -0.707196 + 1.655397 + Z * 0.036152;
    let b = X *  0.051713 - 0.121364 + Z * 1.011530;

    // Normalize so max component is 1, clamp negatives
    const scale = Math.max(r, g, b, 1.0);
    r = Math.max(0, r / scale);
    g = Math.max(0, g / scale);
    b = Math.max(0, b / scale);

    // RGB → HSV hue and saturation
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;

    let hue: number;
    if (chroma === 0) {
        hue = 0;
    } else if (max === r) {
        hue = (60 * ((g - b) / chroma) + 360) % 360;
    } else if (max === g) {
        hue = (60 * ((b - r) / chroma) + 120) % 360;
    } else {
        hue = (60 * ((r - g) / chroma) + 240) % 360;
    }
    const saturation = max === 0 ? 0 : 1 - min / max;

    return { hue: Math.round(hue), saturation: Math.round(saturation * 100) };
}

/** Calculate the distance between two HS (hue, saturation) values as a value 0..1.5. Accounts for
 * hue being circular.
 */
export function getHsDistance(hs1: {hue: number, saturation: number}, hs2: {hue: number, saturation: number}): number {
    const d = Math.abs(hs1.hue - hs2.hue)/360;
    return (d < 0.5 ? d : 1-d) + Math.abs(hs1.saturation - hs2.saturation)/100;
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


/**
 * Convert a color temperature in mireds to CIE xy chromaticity coordinates.
 * Uses the Kim et al. cubic spline approximation of the Planckian locus.
 * Valid for 1667K–25000K (i.e. roughly 40–600 mireds).
 */
export function miredsToXy(mireds: number): {x: number, y: number} {
    const T = Math.max(1667, Math.min(25000, 1e6 / mireds));
    const T2 = T * T;
    const T3 = T2 * T;

    let x: number;
    if (T <= 4000) {
        x = -0.2661239e9 / T3 - 0.2343589e6 / T2 + 0.8776956e3 / T + 0.179910;
    } else {
        x = -3.0258469e9 / T3 + 2.1070379e6 / T2 + 0.2226347e3 / T + 0.240390;
    }

    const x2 = x * x;
    const x3 = x2 * x;
    let y: number;
    if (T <= 2222) {
        y = -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683;
    } else if (T <= 4000) {
        y = -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867;
    } else {
        y =  3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;
    }

    return { x, y };
}

/** Convert a color temperature in mireds to hue/saturation. */
export function miredsToHs(temperature: number): {hue: number, saturation: number} {
    const { x, y } = miredsToXy(temperature);
    return xyToHs(x, y);
}

/**
 * Given a generic light state and a certain light's capability, return a light state that
 * fits what the light can handle.
 */
export function mergeLightStateWithCaps(dst: LightState, src: LightState, cap: LightCaps) {
    if (src.on != null) dst.on = src.on;
    if (src.brightness != null && cap.brightness) dst.brightness = Math.min(cap.brightness.max, Math.max(cap.brightness.min, 1, src.brightness));
    if ((src.hue != null || src.saturation != null) && cap.color) {
        dst.hue = src.hue ?? dst.hue;
        dst.saturation = src.saturation ?? dst.saturation;
        if (dst.hue == null || dst.saturation == null) {
            // Default hue/saturation based on current color temp, if not already set
            const hs = dst.mireds ? miredsToHs(dst.mireds) : {hue: 45, saturation: 100}; 
            dst.hue ??= hs.hue;
            dst.saturation ??= hs.saturation;
        }
        delete dst.mireds; // Clear mireds if we're setting hue, since they conflict
    } else if (src.mireds != null && cap.mireds) {
        dst.mireds = Math.min(cap.mireds.max, Math.max(cap.mireds.min, src.mireds));
        delete dst.hue; // Clear hue/sat if we're setting mireds, since they conflict
        delete dst.saturation;
    }
}


export const DEFAULT_TRIGGERS: Record<number|string, object> = {
    1: {brightness: 150, color_temp: 365, state: 'ON'},
    2: {brightness: 40, color_temp: 450, state: 'ON'},
    3: {brightness: 254, color_temp: 225, state: 'ON'},
    sensor: {brightness: 150, color_temp: 365, state: 'ON'},
};
