const CT_DEFAULT = 300

// input: h in [0,360] and s,v in [0,1] - output: r,g,b in [0,255]
// from https://stackoverflow.com/a/54024653
export function hsvToRgb(h,s,v)  {
    return [5, 3, 1].map(n => {
        let k = (n+h/60) % 6;
        return Math.max(0, Math.min(255, Math.round((v - v * s * Math.max( Math.min(k,4-k,1), 0)) * 255)));
    });
}

export function rgbToHsv([r, g, b]) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let hue;
    if (max === min) {
        hue = 0;
    } else if (max === r) {
        hue = (60 * ((g - b) / (max - min)) + 360) % 360;
    } else if (max === g) {
        hue = (60 * ((b - r) / (max - min)) + 120) % 360;
    } else if (max === b) {
        hue = (60 * ((r - g) / (max - min)) + 240) % 360;
    }

    let sat = max===0 ? 0 : 1 - min/max;
    return [hue, sat, max];
}

// From: https://github.com/usolved/cie-rgb-converter/blob/master/cie_rgb_converter.js
export function rgbToXy([r, g, b]) {

    // RGB values to XYZ using the Wide RGB D65 conversion formula
    const X = r * 0.664511 + g * 0.154324 + b * 0.162028;
    const Y = r * 0.283881 + g * 0.668433 + b * 0.047685;
    const Z = r * 0.000088 + g * 0.072310 + b * 0.986039;
    const sum = X + Y + Z;

    const retX = (sum == 0) ? 0 : X / sum;
    const retY = (sum == 0) ? 0 : Y / sum;

    return {x: retX, y: retY}
}

export function xyToRgb({x, y}) {
    // use maximum brightness
    const brightness = 254;

    const z = 1.0 - x - y;
    const Y = Number((brightness / 254).toFixed(2));
    const X = (Y / y) * x;
    const Z = (Y / y) * z;

    // Convert to RGB using Wide RGB D65 conversion
    let red = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
    let green = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
    let blue = X * 0.051713 - Y * 0.121364 + Z * 1.011530;

    // If red, green or blue is larger than 1.0 set it back to the maximum of 1.0
    if (red > blue && red > green && red > 1.0) {
        green = green / red;
        blue = blue / red;
        red = 1.0;
    } else if (green > blue && green > red && green > 1.0) {
        red = red / green;
        blue = blue / green;
        green = 1.0;
    } else if (blue > red && blue > green && blue > 1.0) {
        red = red / blue;
        green = green / blue;
        blue = 1.0;
    }

    // This fixes situation when due to computational errors value get slightly below 0, or NaN in case of zero-division.
    red = (isNaN(red) || red < 0) ? 0 : red;
    green = (isNaN(green) || green < 0) ? 0 : green;
    blue = (isNaN(blue) || blue < 0) ? 0 : blue;

    return [red*255, green*255, blue*255];
}

export function hsToXy([h,s]) {
    let [r,g,b] = hsvToRgb(h,s,1);
    return rgbToXy([r, g, b]);
}

export function xyToHsv(xy) {
    return rgbToHsv(xyToRgb(xy))
}

export function xyToHs(xy) {
    console.log('xy', xy)
    console.log('rgb', xyToRgb(xy))
    console.log('hsv', rgbToHsv(xyToRgb(xy)))
    console.log('hs', rgbToHsv(xyToRgb(xy)).slice(0,2))
    return rgbToHsv(xyToRgb(xy)).slice(0,2)
}

export function miredsToHs(mireds) {
    return rgbToHsv(miredsToRgb(mireds, 1)).slice(0,2)
}


export function miredsToRgb(mireds, brightness=1) {
    let temp = 10000 / mireds; // in hundreds of kelvins

    let rgb = [
        temp <= 66 ? 255 : 329.698 * Math.pow(temp-60, -0.133205),
        temp <= 66 ? 99.47989 * Math.log(temp) - 161.120 : 288.122 * Math.pow(temp-60, -0.0755148),
        temp >= 66 ? 255 : 138.518 * Math.log(temp-10) - 305.044
    ];
    for(let i=0; i<3; i++) {
        rgb[i] = Math.max(0,Math.min(255,Math.round(brightness * rgb[i])));
    }
    return rgb;
};


export function rgbToMireds(rgb, maxDelta=50, min=10, max=1000) {
    const maxStep = 7;
    
    let bestI = 0;
    let results = [];
    for(let i=0; i<=maxStep; i++) {
        let mireds = Math.round((max-min) / maxStep * i + min);
        let rgb2 = miredsToRgb(mireds);
        let delta = Math.abs(rgb2[0]-rgb[0]) + Math.abs(rgb2[1]-rgb[1]) + Math.abs(rgb2[2]-rgb[2]);
        results.push({delta,mireds});
        if (delta < results[bestI].delta) bestI = i;
    }
    if (Math.abs(max-min) <= maxStep) {
        return results[bestI].delta <= maxDelta ? results[bestI].mireds : undefined;
    }
    let nextI = bestI==maxStep || (bestI>0 && results[bestI-1].delta < results[bestI+1].delta) ? bestI-1 : bestI+1;
    return rgbToMireds(rgb, maxDelta, results[bestI].mireds, results[nextI].mireds);
};



export function rgbToHex(rgb) {
    return '#' + rgb.map(c => Math.max(0,Math.min(255,Math.round(c))).toString(16).padStart(2,'0')).join('')
}

export function toRgb(color) {
    if (color instanceof Array) return hsvToRgb(color[0], color[1], 1)
    if (color && color.x != null) return xyToRgb(color)
    return miredsToRgb(color||CT_DEFAULT)
}

