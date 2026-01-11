# Light Lynx

A modern, fast web application for controlling Zigbee2MQTT smart lights and devices, optimized for smartphones. Light Lynx features auto-installing extensions for simple light automation and multi-user access permissions.

It connects directly to your existing Zigbee2MQTT server via WebSocket. You don't even need to install anything, as you can just use it at [https://lightlynx.eu](https://lightlynx.eu).

## Architecture

- **Language**: TypeScript
- **Reactive UI library**: [Aberdeen](https://github.com/vanviegen/aberdeen)
- **State Management**: Uses Aberdeen's `proxy()` to create a reactive global store (`api.store`). UI components automatically re-render when the part of the state they depend on changes.
- **Data Flow**: The app communicates over WebSocket with the Zigbee2MQTT frontend API or with our own extension (that replaces it, but with multi-user access control). [src/api.ts](src/api.ts) acts as the central hub, handling connection cycles, message serialization, and synchronizing the local state with Z2M's topic-based updates.
- **Routing**: Client-side routing is handled by `aberdeen/route`, using the URL path to determine which component to render (e.g., `/group/:id`, `/connect`).
- **Extensions**: Custom Zigbee2MQTT extensions are used to optimize state payloads, handle authentication, and implement automation logic directly on the Z2M server:
    - **lightlynx-api**: Drop-in replacement for the standard frontend API extension. It maintains existing functionality, while adding multi-user permissions and an optionally trimmed initial data dump to speed up client load times.
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
