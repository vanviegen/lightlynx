# Light Lynx WebSocket Protocol

## Current Protocol Analysis

### Overview
The current protocol is modeled on the Zigbee2MQTT MQTT stream with a topic-based message format. All messages are JSON with `{ topic, payload }` structure.

### Message Types

#### Client → Server (Commands)

1. **Device Control**
   - Topic: `{device_ieee_or_name}/set`
   - Payload: `{ state?: 'ON'|'OFF', brightness?: number, color?: {hue,saturation}|{x,y}, color_temp?: number, transition?: number }`
   - Used for: Light state changes

2. **Group Control**
   - Topic: `{group_name}/set`
   - Payload: Same as device control
   - Used for: Controlling all lights in a group

3. **Scene Recall**
   - Topic: `{group_name}/set`
   - Payload: `{ scene_recall: number }`
   - Used for: Activating a scene

4. **Bridge Requests** (Admin only)
   - Topic: `bridge/request/extension/save`
   - Payload: `{ name: string, code: string, transaction?: string }`
   - Used for: Extension upgrades
   
   - Topic: `bridge/request/lightlynx/config/setRemoteAccess`
   - Payload: `{ enabled: boolean, transaction?: string }`
   - Used for: Toggle remote access
   
   - Topic: `bridge/request/lightlynx/config/setAutomation`
   - Payload: `{ enabled: boolean, transaction?: string }`
   - Used for: Toggle automation features
   
   - Topic: `bridge/request/lightlynx/config/setLocation`
   - Payload: `{ latitude: number, longitude: number, transaction?: string }`
   - Used for: Setting location for sunrise/sunset
   
   - Topic: `bridge/request/lightlynx/config/addUser`
   - Payload: `{ username: string, secret: string, isAdmin: boolean, allowedGroups: number[], allowRemote: boolean, transaction?: string }`
   - Used for: Creating new users
   
   - Topic: `bridge/request/lightlynx/config/updateUser`
   - Payload: `{ username: string, secret?: string, isAdmin?: boolean, allowedGroups?: number[], allowRemote?: boolean, transaction?: string }`
   - Used for: Updating existing users
   
   - Topic: `bridge/request/lightlynx/config/deleteUser`
   - Payload: `{ username: string, transaction?: string }`
   - Used for: Deleting users

#### Server → Client (State Updates & Responses)

1. **Initial State Dump** (sent on connection)
   - All Z2M retained messages from `{baseTopic}/*`
   - Current state for all devices
   - Users list (admin: all users, non-admin: only own user)
   - Config data
   - Active scenes

2. **Device State Updates**
   - Topic: `{device_name}`
   - Payload: Full device state object from Z2M (battery, linkquality, state, brightness, color, etc.)
   - Sent on: Device state changes

3. **Device List**
   - Topic: `bridge/devices`
   - Payload: Array of device descriptors (filtered)
   - Sent on: Initial connection, device list changes

4. **Group List**
   - Topic: `bridge/groups`
   - Payload: Array of group descriptors with scenes (filtered)
   - Sent on: Initial connection, group list changes

5. **Bridge Info**
   - Topic: `bridge/info`
   - Payload: Z2M info including `permit_join`, `config.groups` (with descriptions)
   - Sent on: Initial connection, config changes

6. **Extensions List**
   - Topic: `bridge/extensions`
   - Payload: Array of `{ name, code }` (only first line of code with hash)
   - Sent on: Initial connection, extension changes

7. **User List** (Admin only)
   - Topic: `bridge/lightlynx/users`
   - Payload: `Record<string, { isAdmin, allowedGroups, allowRemote, secret }>`
   - Sent on: Initial connection, user changes

8. **Config Data**
   - Topic: `bridge/lightlynx/config`
   - Payload: `{ remoteAccess, automation, latitude, longitude, localAddress, externalAddress }`
   - Sent on: Initial connection, config changes

9. **Active Scenes**
   - Topic: `bridge/lightlynx/sceneSet`
   - Payload: `Record<groupName, sceneId | undefined>`
   - Sent on: Initial connection, scene changes
   - Tracks which scene is active per group

10. **Bridge Responses**
    - Topic: `bridge/response/{category}/{action}`
    - Payload: `{ status: 'ok'|'error', error?: string, transaction?: string, data?: any }`
    - Sent on: Response to bridge requests

11. **Connection Errors**
    - Topic: `bridge/lightlynx/connectError`
    - Payload: `{ message: string }`
    - Sent on: Authentication/authorization failures (then connection closes)

12. **Device Availability**
    - Topic: `{device_name}/availability`
    - Payload: `{ state: 'online'|'offline' }`
    - Sent on: Device availability changes

### Current Protocol Issues

1. **Ad-hoc Topic Structure**: Mix of Z2M native topics and custom `lightlynx` topics
2. **Filtered vs Full State**: Extension filters Z2M payloads but doesn't maintain authoritative state
3. **No Scene State Storage**: Active scenes tracked but not bulb states within scenes
4. **Implicit Conventions**: Scene metadata encoded in names with parentheses, device→group associations in descriptions
5. **Optimistic Updates on Client**: Client does its own predictions, no server confirmation
6. **Transaction IDs**: Manual transaction management for request/response pairing
7. **Full State Dumps**: Initial connection sends full Z2M retained messages
8. **Permission Checking**: Done reactively on client based on user data, then server validates

---

## Proposed Protocol: Light Lynx State Sync Protocol

### Design Principles

1. **Authoritative Server State**: Extension maintains canonical state of all lights, groups, and scenes
2. **State Synchronization**: Client receives state updates, not raw MQTT events
3. **Scene State Storage**: Store bulb states for each scene for accurate client predictions
4. **Structured API**: Clear RPC-style commands with typed responses
5. **Optimistic Updates**: Server confirms/rejects state changes explicitly
6. **Efficient Sync**: Only send deltas after initial state

### Message Format

All messages use JSON with this structure:

```typescript
{
  type: 'state' | 'command' | 'response' | 'error',
  id?: string,  // Request ID for command/response pairing
  data: any
}
```

### Core State Model

The extension maintains this authoritative state:

```typescript
interface ServerState {
  // Lights (devices with light capabilities)
  lights: Record<IEEE, {
    ieee: string;
    name: string;
    model: string;
    description?: string;
    state: LightState;  // { on, brightness, color }
    caps: LightCaps;
    meta: {
      online: boolean;
      battery?: number;
      linkquality?: number;
      updateAvailable?: boolean;
    };
  }>;
  
  // Groups
  groups: Record<GroupId, {
    id: number;
    name: string;
    description?: string;
    members: IEEE[];
    state: LightState;  // Aggregate of members
    caps: LightCaps;    // Aggregate of members
    timeout?: number;   // Auto-off timeout in ms
    linkedDevices: IEEE[];  // Non-light devices (buttons, sensors)
  }>;
  
  // Scenes
  scenes: Record<GroupId, Record<SceneId, {
    id: number;
    name: string;
    triggers?: SceneTrigger[];  // Parsed from name suffix
    states?: Record<IEEE, LightState>;  // Stored bulb states (NEW!)
    lastRecalled?: number;  // Timestamp
  }>>;
  
  // Non-light devices (buttons, sensors, switches)
  devices: Record<IEEE, {
    ieee: string;
    name: string;
    model: string;
    description?: string;
    actions?: string[];  // Available actions (single, double, etc.)
    state: any;  // Raw state
    meta: {
      online: boolean;
      battery?: number;
      linkquality?: number;
    };
  }>;
  
  // Active scenes (which scene is currently active per group)
  activeScenes: Record<GroupId, SceneId | null>;
  
  // System config
  config: {
    permitJoin: boolean;
    remoteAccess: boolean;
    automation: boolean;
    location?: { latitude: number; longitude: number };
    addresses: {
      local?: string;
      external?: string;
    };
  };
  
  // Users (admin only)
  users?: Record<Username, {
    isAdmin: boolean;
    allowedGroups: number[];
    allowRemote: boolean;
  }>;
}

interface SceneTrigger {
  type: 'click' | 'sensor' | 'time';
  clicks?: number;
  timeRange?: { start: string; end: string };
}
```

### Connection Flow

1. **Client Connects** with username/secret in URL
2. **Server Authenticates** and sends filtered initial state
3. **Client Receives** `{ type: 'state', data: { full: ServerState } }`
4. **Server Sends Deltas** as state changes occur

### State Updates (Server → Client)

All state changes use the `state` message type with delta paths:

```typescript
{
  type: 'state',
  data: {
    lights?: {
      [ieee: string]: Partial<Light> | null  // null = removed
    },
    groups?: {
      [id: number]: Partial<Group> | null
    },
    scenes?: {
      [groupId: number]: {
        [sceneId: number]: Partial<Scene> | null
      }
    },
    devices?: {
      [ieee: string]: Partial<Device> | null
    },
    activeScenes?: {
      [groupId: number]: number | null
    },
    config?: Partial<Config>,
    users?: Record<string, User | null>  // Admin only
  }
}
```

Examples:

```typescript
// Light state changed
{
  type: 'state',
  data: {
    lights: {
      "0x00158d0001a2b3c4": {
        state: { on: true, brightness: 200 }
      }
    }
  }
}

// Scene recalled (with stored states for prediction)
{
  type: 'state',
  data: {
    activeScenes: { 1: 5 },
    scenes: {
      1: {
        5: {
          lastRecalled: 1738512345678,
          states: {
            "0x00158d0001a2b3c4": { on: true, brightness: 150, color: 350 },
            "0x00158d0001a2b3c5": { on: true, brightness: 100, color: 400 }
          }
        }
      }
    }
  }
}

// Device online status changed
{
  type: 'state',
  data: {
    lights: {
      "0x00158d0001a2b3c4": {
        meta: { online: false }
      }
    }
  }
}
```

### Commands (Client → Server)

Commands use structured RPC format:

```typescript
{
  type: 'command',
  id: 'unique-request-id',
  cmd: string,
  args: any
}
```

#### Light Control Commands

**Set Light State**
```typescript
{
  type: 'command',
  id: 'req-123',
  cmd: 'light.set',
  args: {
    ieee: '0x00158d0001a2b3c4',
    state: { on: true, brightness: 200, color: { hue: 120, saturation: 0.8 } },
    transition?: 0.5
  }
}
```

**Set Group State**
```typescript
{
  type: 'command',
  id: 'req-124',
  cmd: 'group.set',
  args: {
    id: 1,
    state: { on: false },
    transition?: 2
  }
}
```

**Recall Scene**
```typescript
{
  type: 'command',
  id: 'req-125',
  cmd: 'scene.recall',
  args: {
    groupId: 1,
    sceneId: 5,
    transition?: 0.4
  }
}
```

**Store Scene State** (Admin only, called after scene recall)
```typescript
{
  type: 'command',
  id: 'req-126',
  cmd: 'scene.store',
  args: {
    groupId: 1,
    sceneId: 5,
    states: {
      "0x00158d0001a2b3c4": { on: true, brightness: 150, color: 350 },
      "0x00158d0001a2b3c5": { on: true, brightness: 100, color: 400 }
    }
  }
}
```

#### Configuration Commands (Admin)

**Toggle Remote Access**
```typescript
{
  type: 'command',
  id: 'req-127',
  cmd: 'config.setRemoteAccess',
  args: { enabled: true }
}
```

**Toggle Automation**
```typescript
{
  type: 'command',
  id: 'req-128',
  cmd: 'config.setAutomation',
  args: { enabled: false }
}
```

**Set Location**
```typescript
{
  type: 'command',
  id: 'req-129',
  cmd: 'config.setLocation',
  args: { latitude: 52.24, longitude: 6.88 }
}
```

**Toggle Permit Join**
```typescript
{
  type: 'command',
  id: 'req-130',
  cmd: 'config.setPermitJoin',
  args: { enabled: true, duration?: 60 }
}
```

#### User Management Commands (Admin)

**Add User**
```typescript
{
  type: 'command',
  id: 'req-131',
  cmd: 'user.add',
  args: {
    username: 'alice',
    secret: 'hashed-secret',
    isAdmin: false,
    allowedGroups: [1, 2],
    allowRemote: false
  }
}
```

**Update User**
```typescript
{
  type: 'command',
  id: 'req-132',
  cmd: 'user.update',
  args: {
    username: 'alice',
    allowedGroups: [1, 2, 3]
  }
}
```

**Delete User**
```typescript
{
  type: 'command',
  id: 'req-133',
  cmd: 'user.delete',
  args: { username: 'alice' }
}
```

#### Device/Group Management Commands (Admin)

**Rename Device**
```typescript
{
  type: 'command',
  id: 'req-134',
  cmd: 'device.rename',
  args: {
    ieee: '0x00158d0001a2b3c4',
    name: 'Living Room Light'
  }
}
```

**Link Device to Groups** (for non-light devices)
```typescript
{
  type: 'command',
  id: 'req-135',
  cmd: 'device.linkGroups',
  args: {
    ieee: '0x00158d0001a2b3c4',
    groupIds: [1, 2]
  }
}
```

**Create Scene**
```typescript
{
  type: 'command',
  id: 'req-136',
  cmd: 'scene.create',
  args: {
    groupId: 1,
    name: 'Evening (2 18:00-22:00)',
    recallCurrent?: true  // Capture current states
  }
}
```

**Update Scene**
```typescript
{
  type: 'command',
  id: 'req-137',
  cmd: 'scene.update',
  args: {
    groupId: 1,
    sceneId: 5,
    name?: 'Evening Dim (2 18:00-22:00)',
    recallCurrent?: true
  }
}
```

**Delete Scene**
```typescript
{
  type: 'command',
  id: 'req-138',
  cmd: 'scene.delete',
  args: {
    groupId: 1,
    sceneId: 5
  }
}
```

### Responses (Server → Client)

Responses match the request ID:

```typescript
{
  type: 'response',
  id: 'req-123',  // Matches command id
  ok: boolean,
  data?: any,
  error?: string
}
```

Examples:

```typescript
// Success
{
  type: 'response',
  id: 'req-123',
  ok: true
}

// Success with data
{
  type: 'response',
  id: 'req-136',
  ok: true,
  data: { sceneId: 8 }
}

// Error
{
  type: 'response',
  id: 'req-124',
  ok: false,
  error: 'Permission denied: user cannot control group 3'
}
```

### Error Messages (Server → Client)

For errors not tied to a specific request:

```typescript
{
  type: 'error',
  error: string,
  code?: string
}
```

Examples:

```typescript
// Connection error
{
  type: 'error',
  error: 'Remote access is disabled on this server',
  code: 'REMOTE_ACCESS_DISABLED'
}

// Extension error
{
  type: 'error',
  error: 'Failed to store scene: device unreachable',
  code: 'DEVICE_UNREACHABLE'
}
```

---

## Implementation Strategy

### Phase 1: State Management in Extension

1. Build authoritative state model in extension
2. Subscribe to Z2M MQTT events and maintain state
3. Compute group aggregate states reactively
4. Parse scene triggers from names (backward compatible)
5. Track scene recall events and store bulb states

### Phase 2: State Sync API

1. Implement new WebSocket message format alongside old
2. Send initial full state on connection
3. Send delta updates as state changes
4. Filter state based on user permissions (non-admin sees only allowed groups)

### Phase 3: Command API

1. Implement command handlers in extension
2. Replace topic-based commands with RPC commands
3. Return explicit success/error responses
4. Validate permissions before executing

### Phase 4: Client Migration

1. Update client to use new protocol
2. Remove optimistic update logic (trust server state)
3. Use stored scene states for predictions
4. Simplify state management (just merge deltas)

### Phase 5: Scene State Storage

1. Store bulb states when scene first created (if admin opts in)
2. Store bulb states after scene recall (capture actual result)
3. Include stored states in scene recall state updates
4. Client uses stored states for instant UI feedback

### Benefits of New Protocol

1. **Simpler Client**: No Z2M knowledge needed, just merge state deltas
2. **Accurate Predictions**: Scene states stored server-side, sent with recall
3. **Better Security**: Server-side permission checks, filtered state
4. **Cleaner API**: Structured commands vs ad-hoc topics
5. **Extensibility**: Easy to add new commands without protocol changes
6. **Debugging**: Clear request/response flow with IDs
7. **Consistency**: Single source of truth in extension

### Backward Compatibility

During migration, extension can support both protocols:
- Old clients: Topic-based messages (current protocol)
- New clients: Send `?protocol=v2` query param to opt into new protocol
- Both protocols maintained until all clients migrated

### Scene State Storage Details

**When to store scene states:**

1. **On Scene Creation** (optional): Admin can capture current bulb states
2. **After Scene Recall**: Extension reads back actual bulb states 1-2 seconds after recall
3. **On Scene Update**: Admin can refresh stored states

**Storage format:**

```typescript
scenes: {
  [groupId]: {
    [sceneId]: {
      states: {
        [ieee]: {
          on: boolean,
          brightness?: number,
          color?: number | HSColor | XYColor
        }
      },
      lastUpdated: timestamp
    }
  }
}
```

**Client prediction flow:**

1. User recalls scene
2. Client sends `scene.recall` command
3. Client immediately applies stored states from cache (instant feedback)
4. Server recalls scene and sends state update 1-2 seconds later
5. Client merges server state (actual result)
6. If server state differs, UI updates to match

This gives instant feedback while ensuring correctness!
