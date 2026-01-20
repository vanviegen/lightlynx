# AGENTS.md - Light Lynx

## Project Overview

**Light Lynx** is a modern, fast web application for controlling Zigbee2MQTT smart lights and devices. It provides a mobile-friendly PWA (Progressive Web App) interface for managing Zigbee smart home lighting with features like color picking, groups, scenes, and device management.

## Tech Stack

- **Language**: TypeScript
- **UI Framework**: [Aberdeen](https://github.com/vanviegen/aberdeen) - a reactive UI library with proxy-based state management (use the provided Skill to learn how to use it)
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
- Permission checking (admin, allowedDevices, allowedGroups)
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

The `start-mock` script provides a complete development environment:

```bash
npm run start-mock
```

This will start a mock-z2m and a Vite dev server and print the connection URL. If already running, it will just print the URL.

Point the Playwright MCP at this URL to interact with the app.

To stop the servers:
```bash
npm run stop-mock
```




### URL-Based Connection

You can connect to a server directly via URL parameters:

```
http://localhost:5173/connect?host=192.168.1.94:41791&username=admin&secret=<optional-hash>
```

Parameters:
- `host`: Server address with optional port (required)
- `username`: Username (required)
- `secret`: Pre-hashed password secret (optional)

When these parameters are present, the app will:
1. Check if a server with matching host/username exists in saved servers
2. If found: Update secret (if provided) and attempt connection
3. If not found: Create new server entry and attempt connection
4. Clear URL parameters after processing

This is useful for:
- Development workflows
- Sharing pre-configured connection links
- Automated testing with Playwright MCP

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

### Interactive Testing with Playwright MCP

You can use the Playwright MCP (Model Context Protocol) to interactively test the app:

1. Start the development environment:
   ```bash
   npm run start-mock
   ```

2. Copy the output URL (e.g., `http://192.168.1.94:33229/connect?host=192.168.1.94:41791&username=admin`)

3. Use Playwright MCP tools to navigate and interact:
   ```
   mcp_playwright_browser_navigate(url)
   mcp_playwright_browser_snapshot()  # Get page structure
   mcp_playwright_browser_click(element, ref)
   ```

The development URLs use your machine's actual IP address, making them accessible from Playwright MCP running in Docker or other network contexts.

### Diagnosing Test Failures

When tests fail, Playwright saves artifacts to `test-results/<test-name>/`:

- `*.png`: Screenshots at each step showing the visual state
- `*.html`: Page HTML snapshots at each step (preserves DOM structure for element matching)
- `error-state.html`: Final HTML state when test failed
- `error-context.md`: Error details and context
- `attachments/`: Additional files

The test framework captures both a PNG screenshot and HTML snapshot at every test step. The HTML files contain the full DOM structure of the page, making it easy to identify elements and understand the page hierarchy.

#### Diagnostic Workflow

1. **Read the error**: Start with `error-context.md` for the error message and stack trace
2. **Find the failure point**: Look at the step numbers to identify where the test failed
3. **Analyze page state**: 
   - For visual issues: Check the `.png` file at or just before the failure
   - For element/structure issues: Check the `.html` file to see the full DOM
   - For final state: Check `error-state.html` for the page state when the test failed
4. **Review console logs**: Check the error context for browser console messages
5. **Compare steps**: Look at previous steps' HTML/PNG files to understand state progression

#### HTML Snapshot Format

The HTML files contain the complete page markup including:
- Full DOM structure with all elements and attributes
- Inline styles and class names for element identification
- Current values of form inputs
- Dynamic content rendered by JavaScript

This makes it easy to locate elements by their selectors, understand nesting, and debug element matching issues.

#### Interactive Debugging

For hands-on debugging, use the Playwright MCP:
1. Start the test environment: `npm run start-mock`
2. Navigate to the URL in the MCP browser
3. Use `mcp_playwright_browser_snapshot()` to get live page structure
4. Replicate test actions interactively to isolate the issue

### Manual Mock Server

Start mock server independently:
```bash
npm run mock-z2m  # Uses MOCK_Z2M_PORT=43598 MOCK_Z2M_INSECURE=true
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
