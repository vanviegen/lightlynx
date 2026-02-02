# Light Lynx

A modern, fast web application for controlling Zigbee2MQTT smart lights and devices, optimized for smartphones. Light Lynx features a single extension for simple light automation, multi-user access permissions, and optional remote access.

It loads from the browser cache (using a service worker) and connects directly to your existing Zigbee2MQTT server (via a secure WebSocket running as a Z2M extension), allowing you to control your lights without involving the internet. Light Lynx automatically obtains a domain name and SSL certificate for your server. Optionally, you can enable remote access to control your lights from anywhere.

## Installation

To use the app, you must install the **Light Lynx** extension on your Zigbee2MQTT server. You can then access your lights from [https://lightlynx.eu](https://lightlynx.eu).

1.  **Automatic**: Copy the contents of [lightlynx.js](build.frontend/extensions/) (the hashed filename) and add it as a new "External Extension" in the Zigbee2MQTT web interface (Settings -> External Extensions). Name it `lightlynx.js`.
2.  **Manual**: Copy the hashed lightlynx JS file from [build.frontend/extensions/](build.frontend/extensions/) to your Zigbee2MQTT `data/extension` directory, renaming it to `lightlynx.js`, and restart Zigbee2MQTT.

Once started, the extension will listen on HTTPS port 43597 and automatically provision your Instance ID.

## Architecture

- **Language**: TypeScript
- **Reactive UI library**: [Aberdeen](https://github.com/vanviegen/aberdeen)
- **Connectivity**: Secure WebSocket API on port 43597 with automated SSL/DNS management.
- **Security**: Client-side PBKDF2 password hashing (passwords never leave the device).
- **State Management**: Uses Aberdeen's `proxy()` to create a reactive global store (`api.store`). UI components automatically re-render when the part of the state they depend on changes.
- **Data Flow**: The app communicates over WebSocket with the `lightlynx` extension. [src/api.ts](src/api.ts) acts as the central hub, handling connection cycles, message serialization, and synchronizing the local state with Z2M's topic-based updates.
- **Routing**: Client-side routing is handled by `aberdeen/route`, using the URL path to determine which component to render (e.g., `/group/:id`, `/connect`).
- **Extension**: A single custom Zigbee2MQTT extension optimizes state payloads, handles authentication, and optionally implements automation logic directly on the Z2M server:
    - Provides a WebSocket API used by the web app
    - Supports multi-user permissions and remote access control
    - Stores configuration in `data/lightlynx.json`
    - Optional automation features (toggleable in UI): hub-side automation triggers (motion, tap patterns, time-based) and "auto-off" group timers

### Scripts

- `npm run dev`: Start Vite development server on port 43599 (watches for file changes).
- `npm run start-mock`: Start complete development environment (mock Z2M + Vite dev server with auto-connection URL).
- `npm run build`: Production build to `build.frontend/`.
- `npm test`: Run Playwright integration tests with a mock Zigbee2MQTT backend.
- `npm run mock-z2m`: Start the mock Zigbee2MQTT server independently (port 43598, insecure mode).
- `npm run deploy`: Build and deploy to Bunny.net CDN. Requires `.env` configuration.

### Development

For development, use:

```bash
npm run start-mock
```

This starts both a mock Zigbee2MQTT server and Vite dev server on random ports, and outputs a direct connection URL. The servers listen on all network interfaces, making them accessible from other devices.

The mock server runs without TLS (`LIGHTLYNX_INSECURE=true`), and the frontend automatically uses `ws://` instead of `wss://` when loaded over HTTP.

### Testing

Integration tests use Playwright and a custom mock Zigbee2MQTT server ([src/mock-z2m.ts](src/mock-z2m.ts)). The mock server simulates Zigbee2MQTT's behavior and runs the actual lightlynx extension.

Run tests with:
```bash
npm test
```

Playwright automatically manages server lifecycle during testing.
