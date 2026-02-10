# AGENTS.md - Light Lynx

Smartphone-optimized web app for controlling Zigbee2MQTT lights. PWA that loads from cache and connects directly to Z2M via a secure WebSocket extension. Features: groups, scenes, color picking, multi-user permissions, optional remote access, and hub-side automation.

**Tech**: TypeScript, [Aberdeen](https://github.com/vanviegen/aberdeen) (reactive UI — use the provided Aberdeen Skill), Vite 6, Playwright tests.

## Project Structure

```
src/
  app.ts              # Routing and top-level UI
  api.ts              # WebSocket client, connection management, reactive store
  types.ts            # All TypeScript interfaces
  extension.ts        # Z2M extension: auth, state sync, permissions, automation
  ui.ts               # Shared UI helpers (admin mode, routeState, lazySave)
  mock-z2m.ts         # Mock Z2M server for dev/testing
  colors.ts           # Color conversion (HSV ↔ RGB ↔ XY ↔ mireds)
  icons.ts            # SVG icon components
  global-style.ts     # Global CSS
  sw.ts               # Service worker (stale-while-revalidate, auto-reload)
  components/         # Reusable UI: color-picker, header, menu, prompt, toasts
  pages/              # Route pages: top, group, bulb, connection, users, info, etc.
  backend/cert.ts     # Bunny.net edge script for SSL cert provisioning
tests/
  base-test.ts        # Test helpers (connectToMockServer, etc.)
  *.spec.ts           # Playwright integration tests
build.frontend/       # Production output (HTML, JS, CSS, extension.js)
build.backend/        # Generated Bunny edge script
```

## Architecture

**State**: `api.store` is an Aberdeen `proxy()`. Contains `lights` (by IEEE), `toggles` (buttons/sensors by IEEE), `groups` (by group ID), `permitJoin`, `config` (users, automation settings, etc.), `me` (current user). UI re-renders automatically on changes.

**Networking**: Extension listens on port **43597** (override with `LIGHTLYNX_PORT`; tests use 43598). Each server gets an instance ID from the cert backend. External access via `ext-<instanceId>.lightlynx.eu`. Client races local vs external connections. SSL via `cert.lightlynx.eu` (DNS-01 challenges).

**Auth**: Client-side PBKDF2 hashing — passwords never leave the device. `user` + `secret` passed as URL search params on WebSocket connect.

**Extension**: Single Z2M extension (`extension.ts`) handles everything server-side: WebSocket API, user auth, optimized state payloads, permission filtering, config storage (`data/lightlynx.json`), and optional automation (scene triggers, auto-off timers).

**Routing**: `aberdeen/route` with paths: `/` (main/landing), `/connect`, `/group/:id`, `/bulb/:ieee`, `/user/:userName`, `/dump` (admin debug).

**Admin mode**: Toggle via `?admin=y` URL param or three-dot menu. Stored in `admin.value` observable.

**WebSocket commands**: `set-state`, `scene` (recall/store/add/remove/rename/setTriggers), `bridge` (relay to Z2M), `patch-config`, `link-toggle-to-group`, `set-group-timeout`, `update-user`, `set-remote-access`, `set-automation`, `set-location`, `convert`.

## Development

```bash
npm run mock start     # Start mock Z2M + Vite dev server, prints connection URL
npm run mock stop      # Stop both servers
npm run dev            # Vite dev server only (port 43599)
npm run build          # Production build → build.frontend/
npm test               # Playwright integration tests
```

`npm run mock start` is the primary dev workflow. It starts an insecure mock Z2M and Vite, outputs a direct-connect URL. Point Playwright MCP at this URL for interactive testing.

### Direct-connection URL

```
http://localhost:5173/?instanceId=<host:port or instance-code>&userName=admin&secret=<hash>
```

Credentials auto-save to localStorage (`lightlynx-servers`).

### Mock server standalone

```bash
LIGHTLYNX_PORT=43598 LIGHTLYNX_INSECURE=true node --experimental-strip-types src/mock-z2m.ts [extension-path...]
```

Without extension args, loads `build.frontend/extension.js`.

## Testing

Playwright + mock Z2M. Playwright auto-starts mock on port 43598 and Vite dev server.

```bash
npm test
```

### Demo Video Recording

A scripted demo video can be recorded to showcase app functionality:

```bash
npm run build:video    # Records ~2 min video → video-out/demo.webm
```

**How it works:**
- Uses the same test script as `npm test` ([video/demo.spec.ts](video/demo.spec.ts))
- In video mode: records 450×800 px video with touch ripples, transitions enabled, and viewing pauses
- In test mode: runs fast without video, ripples, transitions, or pauses
- Mode detection via `window.__VIDEO_MODE__` flag set by [video/video-helpers.ts](video/video-helpers.ts)

**Video helpers:**
- `tap(page, locator, delayMs)` — click with visual ripple (video) or instant (test)
- `slowType(page, locator, text, charDelayMs)` — char-by-char (video) or instant fill (test)
- `pause(page, ms)` — viewing delay (video only, skipped in test)
- `swipe(page, locator, direction, distance)` — smooth gesture animation

Output: `video-out/demo.webm` (Playwright's intermediate directory is auto-cleaned)

### Diagnosing Failures

Results in `tests-out/<test-file>-<start-line>/`:

| File | Purpose |
|------|---------|
| `error.txt` | Error message + stack trace |
| `error.body.html` / `error.png` | DOM / screenshot at failure |
| `NNNN[a-z].body.html` / `.png` | Snapshots at test source line numbers |
| `*.head.html` | Aberdeen-generated `<style>` tags (rarely needed) |

`NNNN` = zero-padded line number, letter suffix = occurrence within that line (e.g. `0010b.png` = second snapshot at line 10).

Read `.body.html` to understand DOM state. Use `.png` for visual/layout. Prefer automated tests + artifacts over Playwright MCP for debugging.

### Playwright MCP (interactive)

1. `npm run mock start` → get URL
2. `mcp_playwright_browser_navigate(url)` / `_snapshot()` / `_click(element, ref)`

If Playwright MCP is unavailable, ask the user.

## Deployment

Requires `.env` (see `.env.example`): `BUNNY_STORAGE_ZONE_APP`, `DEPLOY_PASS_OBSCURED`, `BUNNY_PZ_ID`, `BUNNY_ACCESS_KEY`.

```bash
npm run deploy         # Build + SFTP upload
npm run purge-cache    # Purge BunnyCDN cache
```
