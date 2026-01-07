# Light Lynx Design Document

Light Lynx is a turnkey web application for controlling Zigbee2MQTT lights, designed for www.lightlynx.eu.

## Architecture

### Hosting
- Static web server serving HTML/JS/CSS/Service Worker
- Deployed as BunnyCDN storage zone (FTP upload) from a package.json 'deploy' script
- Default serving on HTTPS; dynamically switches to HTTP when connecting to non-HTTPS Z2M servers

### Connection Modes

**Standard Mode**: Connects to Z2M's built-in `frontend.ts` extension API
- Provides admin-only access
- No user management
- Full state dump on connection
- Used for initial setup

**Enhanced Mode**: Connects to custom `lightlynx-api` extension
- Backward compatible with standard frontend (serves original Z2M UI if enabled)
- User management with permission levels
- Optimized state dump (excludes data not used by `api.ts`)
- Will automatically disable original frontend extension via `bridge/request/options` message (as it conflicts with it)

### Protocol Switching
When connecting to HTTP server from HTTPS client:
- Dynamically change page URL to HTTP to bypass mixed content blocking
- By default (not connected), serve on HTTPS

---

## User Management

### Permission Model
- **Admin**: Boolean flag. Grants full control (manage users, groups, scenes, names, devices, etc.)
- **Allow remote**: Boolean flag. If false, user can only access from internal network (checked against IP: 192.168.x.x, 10.x.x.x, 172.16-31.x.x, 127.x.x.x, ::1, fc00::/7)
- **Non-admin users**: Allowed lights/groups array of IDs they can control

The `admin` user always exists implicitly (not stored in JSON file) with full permissions, using Z2M's `frontend.auth_token` as password. It does not allow remote access.

### Storage
- Server-side: Stored in `data/lightlynx-users.json` (managed by `lightlynx-api` extension)
- JSON format: `{<username>: {passwordHash, salt, isAdmin, allowedDevices: ["ieee1"], allowedGroups: [1, 2], allowRemote: boolean}}`
- Password hashing: `node:crypto` scrypt: `crypto.scryptSync(password, salt, 64).toString('hex')`
- Client-side: Credentials stored in plain text localStorage (key: `lightlynx-servers`)

---

## Extensions

### lightlynx-api Extension
Based on Z2M's `frontend.ts` (copy and modify). Core features:

**Client Detection**: Detects Light Lynx via WebSocket query parameter `?lightlynx=1`. When detected, sends optimized state dump and includes user permissions.

**State Optimization for Light Lynx Clients**:
- `bridge/extensions`: Send only first line of each extension's code (version comment) instead of full source (~500KB → ~5KB)
- `bridge/devices`: Include only: `ieee_address`, `friendly_name`, `description`, `model_id`, `manufacturer`, `definition.description`, `definition.vendor`, `definition.exposes` (only `type`, `name`, `values`, `features` with `name`, `value_min`, `value_max`). Exclude: endpoints, clusters, bindings, configured_reportings, interview status, network info, power_source details
- `bridge/groups`: Include only: `id`, `friendly_name`, `description`, `scenes` (just `id`, `name`), `members` (just `ieee_address`)
- `bridge/info`: Send as-is (needed for permit_join status)
- Device state messages: Send as-is (already minimal)

**Extra state**:
- `bridge/lightlynx/users`: The full users json data structure (only excluding passwordHash).

**User Authentication**: 
- Validates credentials on WebSocket connection (username + password, or legacy token-only for "admin" user)
- Permission checking on all incoming MQTT messages (validates against user's `allowedDevices`/`allowedGroups` or `isAdmin`)

**User Management API** (admin-only, via custom MQTT topics):
- `bridge/request/lightlynx/users/list` - returns user list (without passwordHash/salt)
- `bridge/request/lightlynx/users/add` - add new user
- `bridge/request/lightlynx/users/update` - update user (if username is "admin", updates `frontend.auth_token` via bridge options instead)
- `bridge/request/lightlynx/users/delete` - delete user (cannot delete "admin")

For any change, `bridge/lightlynx/users` broadcasts the new data.

**On startup**:
- Calls `bridge/request/options` with `{options: {frontend: {enabled: false}}}`, to make sure the original frontend is disabled (conflicts with this extension). Can we wait for this to complete? Otherwise our binding port will still be in use.

### lightlynx-automation Extension
- Start out as copy of current `data/external_extensions/automation.js`
- Should be part of lightlynx project (in src/extensions/)
- Provides trigger/automation features for groups
- Optional but recommended
- Admin UI prompts installation if not detected
- Should also be deployed the CDN for auto-installation by client

### Extension Version Management
- Expected versions hardcoded as constants in `app.ts`
- Client checks version on connect via `bridge/extensions` topic. The first line of "code" should contain version comment: `// lightlynx-<name> v<version>`
- Auto-upgrade if mismatch: fetches latest from CDN, uploads via `api.send("bridge", "request", "extension", "save", {name: "filename.js", code: "..."})` -- prefixing the new version comment automatically.
- Extension source files stored in `src/extensions/` should be deployed to CDN

---

## Client Features

### Multi-Server Management
- Track credentials for multiple servers in localStorage
- Only one active connection at a time
- Cached state only kept for last-connected server

**ServerCredentials Interface**:
```typescript
interface ServerCredentials {
  name: string;      // user-friendly name (hostname or user-provided)
  hostname: string;
  port: number;
  useHttps: boolean;
  username: string;
  password: string;
  lastConnected?: number;  // timestamp
}
```

### Three-Dot Menu (top-right corner)
- Enter/Leave admin mode (if permitted)
- Connect to another server
- Logout from current server (removes from credentials storage, switch to other set of credentials if any, landing page otherwise)
- Switch to... (one for each set of saved credentials, excluding current)

### Connection (modal) Dialog
Fields:
- **Hostname/IP**: Server address (required)
- **Use HTTPS**: Checkbox (default true) with "read more" link to SSL guide
- **Port**: Number (defaults: 443 for HTTPS, 8080 for HTTP; auto-switches on HTTPS toggle)
- **Username**: Text (default "admin"; when "admin" uses legacy token-only auth)
- **Password/Token**: Password input (can be empty for legacy mode)
- **Save credentials**: Checkbox

### Admin UI

**Users Section** (visible in admin mode):
- If `lightlynx-api` not installed: Show installation button and explanation
- If installed: List/edit/delete users with admin/remote flags and device/group permissions (if not admin). Allow password (re)setting.
- Note: Editing "admin" user's password updates Z2M's `frontend.auth_token`

**Extension Status**:
- Check extension versions on admin login
- Show notification (like low-battery warnings) if updates available
- One-click update/install buttons

**Extensions Section** (bottom of admin screen):
- List installed Light Lynx extensions with versions
- Uninstall button with confirmation dialog
- Warning that users other than admin can no longer log in when uninstalling `lightlynx-api`
- Uses `api.send("bridge", "request", "extension", "remove", {name: extensionFilename})`

### Landing Page (Not Connected)
Marketing content (keep simple, don't sound like AI):
- Prominent "Connect to Server" button that open connection modal dialog.  
- Turnkey Zigbee light management solution
- Designed to reduce clicks
- Fast startup
- Access permissions (family, guests)
- PWA installation (phone/computer)
- Offline functionality (service worker caching)
- Note: HTTPS recommended for full benefits (link to setup guide)
- Screenshot carousel (placeholders for now). 

Mobile and desktop responsive. Should look attractive and aligned with app style. Study the existing CSS and add some .frontpage scopes selectors on top of that. Keep things small. We want a tiny bundle, even while including the frontpage!

### SSL Setup Guide (App Page)
Recommend [webcentral](https://github.com/vanviegen/webcentral) if no reverse proxy yet. Easy setup, assuming default http ports:

curl -LsSf https://github.com/vanviegen/webcentral/releases/latest/download/webcentral-$(uname -m)-unknown-linux-musl.tar.xz | sudo tar xJf - -C /usr/local/bin --strip-components=1 '*/webcentral'
sudo webcentral --email YOUR_EMAIL_ADDRESS --systemd

Requires domain (suggest [freemyip.com](https://freemyip.com/) if user does not have one or has a dynamic IP). Recommend setting ip from a cron job.

Create `~/webcentral-projects/YOURNAME.freemyip.com/` (or whatever the domain is)

Add `webcentral.ini` to that directory:
  ```ini
  port = 8080  # Your Z2M frontend port
  ```

Connect app to `YOURNAME.freemyip.com` enabling SSL

---

## Deployment

**BunnyCDN Credentials**:
- SFTP Host: storage.bunnycdn.com
- Username: lightlynx-static
- Password: 6f1e89c6-95b1-4888-9f7d680ea1f5-d5fa-42e9

Write the details into a `.env` file (.gitignore it) and create a deployment script.

Use something rsync-like, so spurious files are deleted on the server.

**URLs**:
- CDN base: `https://lightlynx.eu/`
- Extensions: `https://lightlynx.eu/extensions/*.js`

---

## Implementation Steps

Each step can be assigned to a separate AI agent.

### Step 1: lightlynx-api Extension
**Dependencies**: None  
**Files**: `src/extensions/lightlynx-api.js`

Create extension based on Z2M's `lib/extension/frontend.ts`:
1. Implement user authentication (see User Management section)
2. Implement client detection and state optimization (see lightlynx-api Extension section)
3. Implement permission checking on incoming MQTT messages
4. Register user management API handlers (see lightlynx-api Extension section)
5. Have it disable the original frontend (if enabled) on startup (see lightlynx-api Extension section)

---

### Step 2: lightlynx-automation Extension
**Dependencies**: None  
**Files**: `src/extensions/lightlynx-automation.js`

1. Copy from `/opt/zigbee2mqtt/data/external_extensions/automation.js` into lightlynx src/extensions/
2. Rename internal references from "automation" to "lightlynx-automation"
3. Verify Z2M compatibility

---

### Step 3: Multi-Server Credential Management
**Dependencies**: None  
**Files**: `src/api.ts`, `src/types.ts`

1. Define `ServerCredentials` interface (see Multi-Server Management section)
2. Implement credential storage in localStorage
3. Add `?lightlynx=1` to WebSocket URL

---

### Step 4: Connection Dialog UI
**Dependencies**: Step 3  
**Files**: `src/app.ts`, `src/style.css`

Implement connection dialog (see Connection Dialog section for fields). Handle validation and connection errors.

---

### Step 5: Protocol Switching
**Dependencies**: Steps 3, 4  
**Files**: `src/app.ts`

Implement HTTP/HTTPS protocol switching (see Protocol Switching under Architecture). Preserve connection intent when redirecting.

---

### Step 6: Three-Dot Menu
**Dependencies**: Step 3  
**Files**: `src/app.ts`, `src/icons.ts`, `src/style.css`

Implement dropdown menu (see Three-Dot Menu section for options).

---

### Step 7: Extension Version Management
**Dependencies**: Step 3  
**Files**: `src/app.ts`, `src/api.ts`

1. Define expected versions:
   ```typescript
   const EXPECTED_VERSIONS: Record<string, number> = {
     'lightlynx-api.js': 1,
     'lightlynx-automation.js': 1
   };
   ```
2. Implement version checking and auto-upgrade (see Extension Version Management section)

---

### Step 8: Users Section (Admin UI)
**Dependencies**: Steps 1, 6  
**Files**: `src/app.ts`, `src/style.css`

Implement Users admin section (see Admin UI section). Include extension installation flow when `lightlynx-api` not installed.

---

### Step 9: Automation Extension Detection
**Dependencies**: Step 7  
**Files**: `src/app.ts`

For features requiring automation: show install prompt if `lightlynx-automation` not installed.

---

### Step 9.5: Extension Uninstall UI
**Dependencies**: Steps 7, 8  
**Files**: `src/app.ts`

Implement Extensions admin section (see Admin UI section).

---

### Step 10: Landing Page
**Dependencies**: None  
**Files**: `src/app.ts`, `src/style.css`

Implement landing page (see Landing Page section).

---

### Step 11: SSL Setup Guide
**Dependencies**: None  
**Files**: `src/app.ts` (or `src/pages/ssl-setup.ts`)

Implement SSL guide page (see SSL Setup Guide section). Link from landing page and connection dialog.

---

### Step 12: Remote Access Control
**Dependencies**: Steps 1, 3  
**Files**: `src/extensions/lightlynx-api.js`

Implement remote IP detection and `allowRemote` enforcement (see Permission Model section for IP ranges).

This is a bit tricky, as at least when https is used, the user will always connect to the external IP of the server. So we need to detect if the client IP (from header X-Forwarded headers in WebSocket connection) matches our server's external IP (which we can probably check using some web service on startup). If they match, it's an internal connection. If not, it's external.

---

### Step 13: Deployment
**Dependencies**: Step 13

1. Make `npm run deploy` work
2. Deploy using commands in Deployment section
3. Test end-to-end at production URL

---

### Step 14: Verify
**Dependencies**: All of the above

Verify that the app as described in the document has now been fully realized do this based on `git diff 3232bc5..HEAD`. List what's still missing/broken. Fix the little things yourself.

---

IMORTANT GUIDANCE:
- If unsure: ask!
- Keep things small and simple - if you can reduce line count without sacrificing clarity nor functionality, you will be celebrated for it!
