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
    brightness?: number;  // Standardized brightness property (0-255)
    color?: ColorValue;
}

export interface Z2MLightDelta {
    state?: 'ON' | 'OFF';
    brightness?: number;
    color?: { hue: number; saturation: number } | XYColor;
    color_temp?: number;
    transition?: number;
}

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
    meta: {
        battery?: number;
        online?: boolean;
        linkquality?: number;
        update?: string;
    };
}

export interface Light extends Device {
    lightCaps: LightCaps;
    lightState: LightState;
}

export interface Toggle extends Device {
    actions: string[];
    linkedGroupIds: number[]; // IDs of groups this input device controls
}

export interface Trigger {
    event: string, // "time" or "1" .. "5" or "sensor"
    startTime?: string; // Conditional start and end times
    endTime?: string; // in extension.parseTime() format
}

// Scene interface
export interface Scene {
    name: string;
    triggers: Trigger[];
    lightStates?: Record<string, LightState>; // IEEE address -> LightState
} 

// Group interface
export interface Group {
    name: string;
    lightIds: string[]; // IEEE addresses of member (light) devices
    toggleIds: string[]; // IEEE addresses of associated non-member button/sensor devices
    scenes: Record<number, Scene>;
    description?: string;
    activeSceneId?: number;
    timeout: number | undefined; // Auto-off timeout in seconds

    _autoOffTimer?: NodeJS.Timeout; // Auto off timer
    _lastTimedSceneId?: number | undefined; // Last scene set by a time interval rule (so we don't reapply it)
}


export interface User {
    isAdmin: boolean;
    allowedGroupIds: number[];
    allowRemote: boolean;
    secret: string;
}

export interface UserWithName extends User {
    name: string;
}

export interface ServerCredentials {
    localAddress: string;  // Server address (ip[:port])
    externalAddress?: string;  // External address (ip:port)
    userName: string;
    secret: string;
}

// Connection state machine
export type ConnectionState = 'idle' | 'connecting' | 'initializing' | 'connected' | 'reconnecting';

export type StripUnderscoreKeys<T> =
  T extends (infer U)[] ? StripUnderscoreKeys<U>[] :
  T extends object ? {
    [K in keyof T as K extends `_${string}` ? never : K]:
      T[K] extends infer V ? StripUnderscoreKeys<V> : never;
  } : T;

export interface SslConfig {
    expiresAt: number;
    nodeHttpsOptions: {
        cert: string;
        key: string;
    };
    localIp?: string;
    externalIp?: string;
}

export interface Config {
    allowRemote: boolean;
    automationEnabled: boolean;
    latitude: number;  // For sunrise/sunset calculations
    longitude: number;
    users: Record<string, User>;  // Filtered out if user is not admin
    _externalPort?: number;  // For persistent UPnP mapping
    _ssl?: SslConfig;
    _sceneStates: Record<number, Record<number, Record<string, LightState>>>; // groupId -> sceneId -> ieeeAddress -> LightState
    _groupTimeouts: Record<number, number>; // groupId -> timeout in seconds
    _sceneTriggers: Record<number, Record<number, Trigger[]>>; // groupId -> sceneId -> triggers
    _toggleGroupLinks: Record<string, number[]>; // ieee -> groupId[]
}

// Store interface for the global application state
export interface State {
    // Derived on startup (and stored in cache):
    lights: Record<string, Light>;  // IEEE address -> Light
    toggles: Record<string, Toggle>;  // IEEE address -> Toggle
    groups: Record<number, Group>;  // Group ID -> Group
    permitJoin: boolean;
    localAddress?: string;
    externalAddress?: string;

    // In our config file:
    config: Config;

    // Different per connection:
    me?: UserWithName;
}

export interface GroupWithDerives extends Group {
    lightState?: LightState;
    lightCaps?: LightCaps;
}

/** The client-side version of State is the same except:
 * - Keys starting with underscore are stripped
 * - Group items are augmented to be GroupWithDerives items
 */
export type ClientState = Exclude<StripUnderscoreKeys<State>, 'groups'> & {groups: Record<number, GroupWithDerives>};
