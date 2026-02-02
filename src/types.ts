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
    colorModes?: string[];
    supportsColor?: boolean;
    supportsBrightness?: boolean;
    supportsColorTemp?: boolean;
    brightness?: {
        valueMin: number;
        valueMax: number;
    };
    colorTemp?: {
        valueMin: number;
        valueMax: number;
    };
    colorHs?: boolean;
    colorXy?: boolean;
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
    allowedGroups: number[];
    allowRemote: boolean;
    hasPassword?: boolean; // Whether user has a password set
    secret?: string; // Only used for UI editing, not stored in state dump
    password?: string;
}

export type ServerStatus = 'enabled' | 'disabled' | 'try';

export interface ServerCredentials {
    localAddress: string;  // Server address (ip[:port])
    externalAddress?: string; // External address (ip:port)
    username: string;
    secret: string;
    status: ServerStatus;  // enabled: maintain connection, disabled: no connection, try: single attempt
}

// Connection state machine
export type ConnectionState = 'idle' | 'connecting' | 'authenticating' | 'connected' | 'reconnecting';

// Store interface for the global application state
export interface Store {
    devices: Record<string, Device>; // IEEE address -> Device
    groups: Record<number, Group>;   // Group ID -> Group
    permitJoin: boolean;
    servers: ServerCredentials[];    // All saved servers
    connected: boolean;              // Connection status (legacy, derived from connectionState)
    connectionState: ConnectionState; // Explicit connection state
    lastConnectError?: string;       // Last connection error message
    extensionHash?: string; // Hash of installed lightlynx extension
    users: Record<string, User>;    // Users from lightlynx extension
    remoteAccessEnabled?: boolean;  // From lightlynx extension config
    automationEnabled?: boolean;    // From lightlynx extension config
    latitude?: number;              // From lightlynx extension config (for sunrise/sunset)
    longitude?: number;             // From lightlynx extension config
    localAddress?: string;          // From lightlynx extension config
    externalAddress?: string;       // From lightlynx extension config
    activeScenes: Record<string, number | undefined>; // Group name -> active scene ID
    isAdmin: boolean;               // Whether current user is admin (reactive)
    allowedGroupIds: Record<number, true>; // Group IDs current user can control (reactive)
}

// Helper functions for color type checking
export function isHS(color: any): color is HSColor {
    return color && typeof color === 'object' && 'hue' in color;
}

export function isXY(color: any): color is XYColor {
    return color && typeof color === 'object' && 'x' in color;
}