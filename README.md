# Light Lynx

A modern, fast web application for controlling Zigbee2MQTT smart lights and devices, optimized for smartphones. Light Lynx features auto-installing extensions for simple light automation and multi-user access permissions.

It loads from the browser cache (using a service worker) and connects directly to your existing Zigbee2MQTT server (via a secure WebSocket running as a Z2M extension), allowing you to control your lights without involving the internet. Light Lynx automatically obtains a domain name and SSL certificate for your server. Optionally, you can enable remote access to control your lights from anywhere.

## Installation

To use the app, you must install the **Light Lynx API** extension on your Zigbee2MQTT server. You can then access your lights from [https://lightlynx.eu](https://lightlynx.eu).

1.  **Automatic**: Copy the contents of [lightlynx-api.js](src/public/extensions/lightlynx-api.js) and add it as a new "External Extension" in the Zigbee2MQTT web interface (Settings -> External Extensions).
2.  **Manual**: Copy [lightlynx-api.js](src/public/extensions/lightlynx-api.js) directly to your Zigbee2MQTT `data/extension` directory and restart Zigbee2MQTT.

Once started, the extension will listen on HTTPS port 43597 and automatically provision your Instance ID.

## Architecture

- **Language**: TypeScript
- **Reactive UI library**: [Aberdeen](https://github.com/vanviegen/aberdeen)
- **Connectivity**: Secure WebSocket API on port 43597 with automated SSL/DNS management.
- **Security**: Client-side PBKDF2 password hashing (passwords never leave the device).
- **State Management**: Uses Aberdeen's `proxy()` to create a reactive global store (`api.store`). UI components automatically re-render when the part of the state they depend on changes.
- **Data Flow**: The app communicates over WebSocket with the `lightlynx-api` extension. [src/api.ts](src/api.ts) acts as the central hub, handling connection cycles, message serialization, and synchronizing the local state with Z2M's topic-based updates.
- **Routing**: Client-side routing is handled by `aberdeen/route`, using the URL path to determine which component to render (e.g., `/group/:id`, `/connect`).
- **Extensions**: Custom Zigbee2MQTT extensions are used to optimize state payloads, handle authentication, and implement automation logic directly on the Z2M server:
    - **lightlynx-api**: Provides a WebSocket API used by the web app. It supports multi-user permissions, remote access control, and stores its configuration in `data/lightlynx.yaml`.
    - **lightlynx-automation**: Handles hub-side automation triggers (motion, tap patterns, time-based) and "auto-off" group timers.

### Scripts

- `npm run dev`: Start development server on port 5173.
- `npm run build`: Production build to `public/`.
- `npm test`: Run Playwright integration tests with a mock Zigbee2MQTT backend.
- `npm run mock-z2m`: Start the mock Zigbee2MQTT server independently.
- `npm run deploy`: Deploy to `public/` folder to Bunny.net CDN. You'll need `.env` set up.

### Testing

Integration tests use Playwright and a custom mock Zigbee2MQTT server ([src/mock-z2m.ts](src/mock-z2m.ts)). When running `npm test`, temporary servers are started:
- Vite Dev Server: Port 5188
- Mock Z2M: Port 8088
