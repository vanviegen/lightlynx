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

export interface User {
    isAdmin: boolean;
    allowedDevices: string[];
    allowedGroups: number[];
    allowRemote: boolean;
    password?: string; // Only used for UI editing, not stored in state dump
}

// Extension interface
export interface Extension {
    name: string;
    code: string;
}

export interface ServerCredentials {
    name: string;      // user-friendly name (hostname or user-provided)
    hostname: string;
    port: number;
    useHttps: boolean;
    username: string;
    password: string;
    lastConnected?: number;  // timestamp
}

// Connection state machine
export type ConnectionState = 'idle' | 'connecting' | 'authenticating' | 'connected' | 'error';

// Store interface for the global application state
export interface Store {
    devices: Record<string, Device>; // IEEE address -> Device
    groups: Record<number, Group>;   // Group ID -> Group
    permit_join: boolean;
    servers: ServerCredentials[];    // All saved servers
    activeServerIndex: number;       // Index of currently active server (-1 if none)
    connected: boolean;              // Connection status (legacy, derived from connectionState)
    connectionState: ConnectionState; // Explicit connection state
    lastConnectError?: string;       // Last connection error message
    extensions: Extension[]; // Available Z2M extensions
    users: Record<string, User>;    // Users from lightlynx-api
}

// Helper functions for color type checking
export function isHS(color: any): color is HSColor {
    return color && typeof color === 'object' && 'hue' in color;
}

export function isXY(color: any): color is XYColor {
    return color && typeof color === 'object' && 'x' in color;
}