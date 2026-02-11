// Shared type definitions for the lighting application

export interface LightState {
    on?: boolean;
    brightness?: number;  // Standardized brightness property (0-255)
    hue?: number;         // 0-360 degrees
    saturation?: number;  // 0-100
    mireds?: number; // Color temperature in mireds. When set, hue/saturation should be unset, and vice versa.
}

export interface Z2MLightDelta {
    state?: 'ON' | 'OFF';
    brightness?: number;
    color?: { hue: number; saturation: number };
    color_temp?: number;
    transition?: number;
    scene_recall?: number;
}

export interface LightCaps {
    colorModes?: string[];
    brightness?: {
        min: number;
        max: number;
    };
    mireds?: { // Color temperature
        min: number;
        max: number;
    };
    _fakeMireds?: true; // true when temperature is emulated via color
    color?: boolean;
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
}

export interface Trigger {
    event: string, // "time" or "1" .. "5" or "sensor"
    startTime?: string; // Conditional start and end times
    endTime?: string; // in extension.parseTime() format
}

// Scene interface
export interface Scene {
    name: string;
} 

// Group interface
export interface Group {
    name: string;
    lightIds: string[]; // IEEE addresses of member (light) devices
    toggleIds: string[]; // IEEE addresses of associated non-member button/sensor devices
    scenes: Record<number, Scene>;
    description?: string;
    activeSceneId?: number;

    _autoOffTimer?: NodeJS.Timeout; // Auto off timer
    _lastTimedSceneId?: number | undefined; // Last scene set by a time interval rule (so we don't reapply it)
}


export type GroupAccess = false | true | 'manage';

export interface User {
    isAdmin: boolean;
    defaultGroupAccess: GroupAccess;
    groupAccess: Record<number, GroupAccess>;
    allowRemote: boolean;
    secret: string;
}

export interface UserWithName extends User {
    name: string;
}

export interface ServerCredentials {
    instanceId: string;  // Instance ID (server-assigned code)
    userName: string;
    secret: string;
    externalPort?: number; // External port for ext-<instanceId> connections
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
    externalPort?: number;
    instanceKey?: string;
}

export interface Config {
    instanceId?: string;  // Unique instance identifier, assigned by cert backend
    systemMessage?: string; // Optional message displayed on top page (set via lightlynx.json)
    allowRemote: boolean;
    automationEnabled: boolean;
    latitude: number;  // For sunrise/sunset calculations
    longitude: number;
    users?: Record<string, User>;  // Filtered out if user is not admin
    externalPort?: number;  // For persistent UPnP mapping
    _ssl?: SslConfig;
    sceneStates: Record<number, Record<number, Record<string, LightState>>>; // groupId -> sceneId -> ieeeAddress -> LightState
    groupTimeouts: Record<number, number>; // groupId -> timeout in seconds
    sceneTriggers: Record<number, Record<number, Trigger[]>>; // groupId -> sceneId -> triggers
    toggleGroupLinks: Record<string, number[]>; // ieee -> groupId[]
}

// Store interface for the global application state
export interface State {
    // Derived on startup (and stored in cache):
    lights: Record<string, Light>;  // IEEE address -> Light
    toggles: Record<string, Toggle>;  // IEEE address -> Toggle
    groups: Record<number, Group>;  // Group ID -> Group
    permitJoin: boolean;
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
