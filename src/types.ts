// Shared type definitions for the lighting application

// Color can be represented in multiple ways
export interface XYColor {
    x: number;
    y: number;
}

export interface HSColor {
    hue: number;
    saturation: number;
}

export type ColorValue = /* color temperature */ number | HSColor | XYColor;

export interface LightState {
    on?: boolean;
    brightness?: number; // Standardized brightness property (0-255)
    color?: ColorValue;
}

// Light capabilities interface
export interface LightCaps {
    color_modes?: string[];
    supports_color?: boolean;
    supports_brightness?: boolean;
    supports_color_temp?: boolean;
    brightness?: {
        value_min: number;
        value_max: number;
    };
    color_temp?: {
        value_min: number;
        value_max: number;
    };
    color_hs?: boolean;
    color_xy?: boolean;
}

// Device interface
export interface Device {
    name: string;
    description?: string;
    model?: string;
    lightState?: LightState;
    otherState?: any;
    lightCaps?: LightCaps;
    actions?: string[];
    meta?: {
        battery?: number;
        online?: boolean;
        linkquality?: number;
        update?: string;
    };
}

// Scene interface
export interface Scene {
    id: number;
    name: string;
    shortName: string;
    suffix?: string;
    description?: string;
}

// Group interface
export interface Group {
    name: string;
    members: string[];
    scenes: Scene[];
    lightState: LightState;
    lightCaps: LightCaps;
    description?: string;
}

// Extension interface
export interface Extension {
    name: string;
    code: string;
}

// Store interface for the global application state
export interface Store {
    devices: Record<string, Device>; // IEEE address -> Device
    groups: Record<number, Group>;   // Group ID -> Group
    permit_join: boolean;
    credentials: {
        url?: string,
        token?: string,
        change?: true
    },
    invalidCredentials: string | undefined, // Reason for invalidity, if any
    extensions: Extension[]; // Available Z2M extensions
}

// Helper functions for color type checking
export function isHS(color: any): color is HSColor {
    return color && typeof color === 'object' && 'hue' in color;
}

export function isXY(color: any): color is XYColor {
    return color && typeof color === 'object' && 'x' in color;
}