# AGENTS.md - Light Lynx

## Project Overview

**Light Lynx** is a modern, fast web application for controlling Zigbee2MQTT smart lights and devices. It provides a mobile-friendly PWA (Progressive Web App) interface for managing Zigbee smart home lighting with features like color picking, groups, scenes, and device management.

## Tech Stack

- **Language**: TypeScript
- **UI Framework**: [Aberdeen](https://github.com/vanviegen/aberdeen) - a reactive UI library with proxy-based state management
- **Build Tool**: Vite 6.x
- **Backend**: Connects to Zigbee2MQTT via WebSocket
- **PWA**: Service Worker for offline caching and stale-while-revalidate strategy

## Project Structure

```
src/
- app.ts   # Main application - routing, UI components, device/group views
- api.ts   # WebSocket API client for Zigbee2MQTT communication
- types.ts   # TypeScript interfaces (Device, Group, LightState, ServerCredentials, User, etc.)
- color-picker.ts   # Color wheel and brightness picker UI components
- colors.ts   # Color conversion utilities (HSV, RGB, XY, mireds)
- icons.ts   # SVG icon components
- sw.ts   # Service Worker for PWA caching
- style.css   # Application styles
- index.html   # HTML entry point
- extensions/   # Z2M extensions (deployed to CDN)
  - lightlynx-api.js   # User auth, optimized state, permission checking
  - lightlynx-automation.js   # Scene triggers and automation
- backend/   # Bunny.net edge scripts
  - cert.ts   # SSL certificate provisioning

build.frontend/   # Generated index.html, css, js bundles and extensions/ directory
build.backend/   # Generated bunny cert.js script
```

## Key Concepts

### State Management
Uses Aberdeen's `proxy()` for reactive state. The global store (`api.store`) contains:
- `devices`: Record of devices keyed by IEEE address
- `groups`: Record of groups keyed by group ID
- `permitJoin`: Boolean for pairing mode
- `servers`: Array of saved server credentials
- `activeServerIndex`: Index of currently connected server (-1 if none)
- `connected`: Boolean connection status
- `extensions`: Z2M extensions list
- `users`: User management data (admin only)
- `remoteAccessEnabled`: Current remote access toggle state (admin only)
- `serverIp`: The local server IP address used for connectivity
- `externalIp`: The external server IP address (if remote access enabled)

### Multi-Server Management
- Credentials stored in localStorage (`lightlynx-servers`)
- Support for multiple Z2M server connections using IP-encoded domains
- Connectivity handled via `x<hex-ip>.lightlynx.eu` where `<hex-ip>` is the hex representation of the IPv4 address
- The client tries both internal and external domains in parallel ("racing")
- Automated SSL certificate management via `cert.lightlynx.eu` edge API using DNS-01 challenges (no A-records)

### Color Systems
The app handles multiple color representations:
- **HSColor**: `{ hue: 0-360, saturation: 0-1 }`
- **XYColor**: `{ x: number, y: number }` (CIE color space)
- **Color Temperature**: Mireds (number)

### Device Types
- **Lights**: Devices with `lightCaps` property (brightness, color, colorTemp support)
- **Sensors/Inputs**: Devices without `lightCaps` (buttons, switches, motion sensors)

### Groups
Groups can contain lights and have associated scenes. Non-light devices can be linked to groups via the `description` field using `lightlynx-groups 1,2,3` syntax.

## NPM Scripts

```bash
npm run dev   # Start Vite dev server with hot reload
npm run build   # Production build to public/
npm run watch   # Build in watch mode
npm run deploy   # Build and deploy to BunnyCDN via SFTP
npm run purge-cache   # Purge BunnyCDN cache
```

## Deployment

Requires `.env` file with BunnyCDN credentials (see `.env.example`):
- `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PASS_OBSCURED` for SFTP
- `BUNNY_PZ_ID`, `BUNNY_ACCESS_KEY` for cache purging

## API Communication

The app communicates with Zigbee2MQTT via WebSocket:
- Connection URL: `wss://x<hex-ip>.lightlynx.eu:43597/api`
- Authentication: `user` and `secret` (PBKDF2 hash) provided as URL search parameters
- Adds `?lightlynx=1` parameter for optimized state from `lightlynx-api` extension
- Messages follow Z2M's topic-based format: `api.send(topic, ...path, payload)`
- Light state changes use optimistic updates with debouncing

## Z2M Extensions

### lightlynx-api
- Configuration stored in `lightlynx.json` within Z2M data directory
- User authentication with client-side PBKDF2 hashing (no raw passwords transmitted or stored)
- Automated SSL/DNS management using IP-encoded domains (`x<hex-ip>.lightlynx.eu`)
- Optimized state dump for Light Lynx clients
- Permission checking (admin, allowedDevices, allowedGroups)
- Remote access control toggle via admin-only MQTT API
- User management API

### lightlynx-automation
- Scene triggers (tap patterns, motion, time-based)
- Lights-off timer for groups

Version checking via first-line comments (`// lightlynx-<name> v<version>`). Auto-upgrade on version mismatch.

## Code Conventions

- Use Aberdeen's `$()` function for reactive DOM rendering
- Components are functions that call `$()` to render DOM elements
- Routing via `aberdeen/route` with path-based navigation
- Icons are SVG functions from `icons.ts`
- Admin mode toggled via `?admin=y` query parameter or three-dot menu

## Testing

Integration tests use Playwright and a mock Zigbee2MQTT server (`src/mock-z2m.ts`).

- `npm test`: Runs the suite. Playwright orchestrates temporary servers:
  - **Vite Dev Server**: Port 5188
  - **Mock Z2M**: Port 8088
- The mock server loads real `lightlynx-api.js` and `lightlynx-automation.js` extensions in a sandboxed Node context to accurately simulate behavior.
- Use `npm run mock-z2m` to start the mock server manually.

## Important Patterns

### Reactive Rendering
```typescript
$(() => {
    // This block re-runs when any accessed proxy values change
    $('div.item#', device.name);
});
```

### Event Handling
```typescript
$('div.button click=', () => {
    // Click handler
});
```

### Conditional Admin Features
Many features check `admin.value` to show/hide configuration options.

### Extension Installation Prompts
```typescript
if (promptInstallExtension('automation', 'Reason message')) {
    // Extension is installed, show feature
}
```

## Service Worker

The service worker implements stale-while-revalidate caching:
- Serves cached responses immediately
- Revalidates in background
- Triggers page reload when updates detected

## Key Routes

- `/` - Main view (groups/devices) or landing page if not connected
- `/connect` - Server connection dialog
- `/ssl-setup` - SSL setup guide
- `/group/:id` - Group detail view
- `/user/:username` - User editor (admin)
- `/dump` - Debug state dump (admin)