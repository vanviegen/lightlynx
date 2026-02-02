# AGENTS.md - Light Lynx

## Project Overview

**Light Lynx** is a modern, fast web application for controlling Zigbee2MQTT smart lights and devices. It provides a mobile-friendly PWA (Progressive Web App) interface for managing Zigbee smart home lighting with features like color picking, groups, scenes, and device management.

## Tech Stack

- **Language**: TypeScript
- **UI Framework**: [Aberdeen](https://github.com/vanviegen/aberdeen) - a reactive UI library with proxy-based state management (use the provided Aberdeen Skill to learn how to use it)
- **Build Tool**: Vite 6.x
- **Backend**: Connects to Zigbee2MQTT via WebSocket
- **PWA**: Service Worker for offline caching and stale-while-revalidate strategy

## Project Structure

```
src/
- app.ts   # Main application - routing, UI components, device/group views
- api.ts   # WebSocket API client for Z2M communication
- types.ts   # TypeScript interfaces (Device, Group, LightState, ServerCredentials, User, Store, etc.)
- color-picker.ts   # Color wheel and brightness picker UI components
- colors.ts   # Color conversion utilities (HSV, RGB, XY, mireds)
- icons.ts   # SVG icon components
- sw.ts   # Service Worker for PWA caching
- style.css   # Application styles
- index.html   # HTML entry point
- extensions/   # Z2M extension (deployed to CDN)
  - lightlynx.ts   # Single extension: user auth, optimized state, permission checking, and optional automation
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
- `connected`: Boolean connection status
- `extensionHash`: Hash of installed lightlynx extension (for auto-upgrade)
- `users`: User management data
- `remoteAccessEnabled`: Remote access toggle state
- `automationEnabled`: Automation toggle state (off by default)
- `localIp`: The local server IP address used for connectivity
- `externalIp`: The external server IP address (if remote access enabled)
- `activeScenes`: Current active scene per group

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
npm run build   # Production build to build.frontend/
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
- Connection URL: `wss://x<hex-ip>.lightlynx.eu:43598/api`
- Authentication: `user` and `secret` (PBKDF2 hash of password) provided as URL search parameters
- Messages follow Z2M's topic-based format: `api.send(topic, ...path, payload)`
- Light state changes use optimistic updates with debouncing


The single `lightlynx` extension provides:
- Configuration stored in `lightlynx.json` within Z2M data directory
- User authentication with client-side PBKDF2 hashing (no raw passwords transmitted or stored)
- Automated SSL/DNS management using IP-encoded domains (`x<hex-ip>.lightlynx.eu`)
- Optimized state dump for Light Lynx clients
- Permission checking (admin, allowedGroups) - groups/devices without permission appear disabled in the UI
- Remote access control toggle via admin-only MQTT API
- User management API
- **Optional automation features** (toggleable via admin UI, off by default):
  - Scene triggers (tap patterns, motion, time-based)
  - Lights-off timer for groups

The extension is deployed with a hash in its filename (`lightlynx-<hash>.js`) but installed on Z2M as `lightlynx.js`. The hash is prepended as a comment line (`// hash=<hash>`) for version tracking. The web app auto-upgrades the extension when the hash mismatches
Version checking via first-line comments (`// lightlynx-<name> v<version>`). Auto-upgrade on version mismatch.

## Code Conventions

- Routing via `aberdeen/route` with path-based navigation
- Icons are SVG functions from `icons.ts`
- Admin mode toggled via `?admin=y` query parameter or three-dot menu, stored in `admin.value` observable

## Development

### Quick Start Development Environment

The `mock` script provides a complete development environment:

```bash
npm run mock start
```

This will start a mock-z2m and a Vite dev server and print the connection URL. If already running, it will just print the URL.

Point the Playwright MCP at this URL to interact with the app.

To stop the servers:
```bash
npm run mock stop
```

### Direct-connection URL

You can connect to a server directly via URL parameters. Example:

```
http://localhost:5173/?host=192.168.1.94:41791&username=admin&secret=<hash>
```

This will connect to the specified server, saving the credentials in localStorage for future use (if they're not there yet).

### Mock Server Configuration

The mock server (`src/mock-z2m.ts`) accepts extensions as command-line arguments:

```bash
MOCK_Z2M_PORT=43598 MOCK_Z2M_INSECURE=true node --experimental-strip-types src/mock-z2m.ts [extension-path...]
```

Environment variables:
- `MOCK_Z2M_PORT`: Port for WebSocket server (default: 43598)
- `MOCK_Z2M_INSECURE`: If 'true', use HTTP/WS instead of HTTPS/WSS

If no extension paths are provided, it loads `build.frontend/extension.js` by default. You can provide one or more extension paths as command-line arguments to load custom extensions.

## Testing

Integration tests use Playwright and a mock Zigbee2MQTT server (`src/mock-z2m.ts`). The mock server doesn't do any Zigbee, MQTT, or web API, but runs the lightlynx extension (exposing a WebSocket API) and can run automation features.

### Running Tests

```bash
npm test  # Run all tests
```

Playwright automatically starts the mock server and Vite dev server on fixed ports during testing.

### Diagnosing Test Failures

Each test gets its own results directory named `tests-<status>/<test-file>-<line-number>` where `<status>` can be 'failed' or 'passed', `<test-file>` matches the base name of the .spec.ts file, and <line-number> points at the start of the test function in that file.

**Files in a failed test directory:**
- `NNNN.png` / `NNNN.body.html` / `NNNN.head.html` - Screenshots and HTML snapshots at specific line numbers in the test file. You should usually look at the body html. The head html is mostly useful for checking CSS <style> generated by Aberdeen.
- `error.png` / `error.body.html` / `error.head.html` - Final page state when the test failed.
- `error.txt` - Complete error information (error message, stack trace, URL).

Read the .html files to understand the DOM structure at steps that may be of interest. Use the .png files for layout work.

### Interactive Testing with Playwright MCP

You can use the Playwright MCP (Model Context Protocol) to interactively test the app:

1. Run `npm run mock start`. It outputs a direct-connection URL.
2. Use Playwright MCP to navigate to that URL.

```
mcp_playwright_browser_navigate(url)
mcp_playwright_browser_snapshot()  # Get page structure
mcp_playwright_browser_click(element, ref)
```

However, please *prefer* to use the automated tests and diagnostic artifacts for most debugging, as they provide a complete history of test step and provide future value.

If the playwright MCP is not available or not working correctly, ask the user for it.


#### Example: Debugging a Failed Test

Relevant files are in `tests-out/integration-0005/` (where integration is the base name of the .spec.ts file, and 0005 is the starting line number of the test in that file).

- error.txt: Error message and stack trace.
- error.md: Playwright short DOM state dump at error time.
- error.html: HTML DOM snapshot at error time.
- error.png: Screenshot at error time.
- NNNN[a-z].png / NNNN[a-z].html: Screenshots and HTML DOM snapshots at specific line numbers in the test file. So 0010b.png would be the second screenshot created in line 10 of the test file.

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
