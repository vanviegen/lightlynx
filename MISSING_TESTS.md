# Missing Tests

This document lists test files that need to be created or expanded, with detailed test case descriptions. Tests use Playwright and the existing test infrastructure from `tests/base-test.ts`.

## How to Write Tests

1. Import from `base-test.ts`: `import { test, expect, connectToMockServer } from './base-test';`
2. Call `await connectToMockServer(page)` at the start of each test to connect with admin credentials
3. Use `page.locator()` with semantic selectors like `h1`, `h2`, `.item`, etc.
4. Use `expect(locator).toBeVisible()` for assertions
5. The mock server (`mock-z2m.ts`) provides test devices: "Color Light", "White Light", "Dimmer Switch", and groups "Living Room", "Bedroom"

---

## File: `tests/user-management.spec.ts` (NEW FILE)

### Test: "should create a new user"
**Steps:**
1. Connect to mock server with admin mode (`connectToMockServer(page)`)
2. Scroll down to "Users" section on main page
3. Click the "+" icon next to the "Users" heading (use `page.locator('h1', { hasText: 'Users' }).locator('svg.icon')`)
4. Fill in username: "testuser"
5. Fill in password: "testpass"
6. Leave "Admin access" unchecked
7. Check "Allow remote access"
8. Click "Save"
9. **Verify**: New user "testuser" appears in Users list on main page

### Test: "should edit an existing user"
**Steps:**
1. Connect to mock server
2. Create a user "editme" first (follow steps from previous test)
3. Click on "editme" in the Users list
4. Change password to "newpass"
5. Toggle "Admin access" checkbox
6. Click "Save"
7. **Verify**: User still exists in list; clicking on user shows Admin mode enabled

### Test: "should delete a user"
**Steps:**
1. Connect to mock server
2. Create a user "deleteme"
3. Click on "deleteme" in Users list
4. Click "Delete user" button
5. Confirm deletion in the confirmation dialog (click "Yes")
6. **Verify**: User "deleteme" no longer appears in Users list

### Test: "should set user permissions for groups and devices"
**Steps:**
1. Connect to mock server
2. Create a new non-admin user "limiteduser"
3. In the user editor, uncheck "Admin access" to show permissions section
4. Under "Allowed Groups", check "Living Room"
5. Under "Allowed Devices", check "Color Light"
6. Click "Save"
7. **Verify**: User is saved successfully, navigate back to see user in list

---

## File: `tests/bulb-control.spec.ts` (NEW FILE)

### Test: "should navigate to a bulb and see color picker"
**Steps:**
1. Connect to mock server
2. Go to "Living Room" group (click on its name in the grid)
3. Click on "Color Light" in the Bulbs list
4. **Verify**: Page title shows "Color Light" with subtitle "bulb"
5. **Verify**: Color picker canvas is visible (`.color-picker` or similar selector)

### Test: "should rename a bulb in admin mode"
**Steps:**
1. Connect to mock server (already in admin mode via `?admin=y`)
2. Navigate to "Color Light" bulb
3. Find "Settings" section and "Name" input
4. Clear the input and type "Renamed Bulb"
5. Wait for auto-save (1 second debounce)
6. Navigate back to main page
7. **Verify**: Bulb now appears as "Renamed Bulb" in the group

### Test: "should remove a bulb from a group"
**Steps:**
1. Connect to mock server
2. Navigate to "Living Room" group
3. Click on "Color Light" to go to bulb page
4. In admin mode, find "Remove from Living Room" action
5. Click it
6. **Verify**: Navigating back to "Living Room" shows "Color Light" is no longer in the members list

### Test: "should delete a bulb"
**Steps:**
1. Connect to mock server
2. Navigate to any bulb (e.g., "White Light")
3. Click "Delete" action
4. Confirm in confirmation dialog (click "Yes")
5. **Verify**: Bulb no longer appears anywhere in the app (check main page)

---

## File: `tests/group-management.spec.ts` (NEW FILE)

### Test: "should rename a group"
**Steps:**
1. Connect to mock server
2. Navigate to "Living Room" group
3. Scroll to "Settings" section
4. Find "Name" input and change to "New Room Name"
5. Wait for auto-save
6. Navigate back to main page
7. **Verify**: Group appears as "New Room Name" in the grid

### Test: "should delete a group"
**Steps:**
1. Connect to mock server
2. First create a test group via "Create group" flow
3. Navigate into that group
4. In admin mode, find "Delete group" action
5. Click and confirm
6. **Verify**: Group no longer appears on main page grid

### Test: "should configure lights-off timer for a group"
**Steps:**
1. Connect to mock server
2. Ensure automation extension is installed (see extension-lifecycle test for reference)
3. Navigate to "Living Room" group
4. Scroll to Settings section
5. Check "Lights off timer" checkbox
6. Set value to "15" and unit to "minutes"
7. Wait for auto-save
8. **Verify**: Timer configuration is saved (re-navigate to same group, timer should still be set)

---

## File: `tests/scene-management.spec.ts` (NEW FILE)

### Test: "should recall a scene"
**Steps:**
1. Connect to mock server
2. Navigate to a group that has scenes (create one if needed via integration test flow)
3. In the Scenes section, click on a scene name/icon
4. **Verify**: No error occurs, scene is recalled (check API call or visual feedback)

### Test: "should configure a scene name"
**Steps:**
1. Connect to mock server
2. Create a group and add a scene named "Test Scene"
3. Navigate to group, click the configure icon (gear) next to the scene
4. In scene editor, change the scene name by clicking a preset icon (e.g., "Night")
5. Wait for auto-save
6. Navigate back
7. **Verify**: Scene now shows with new name/icon

### Test: "should add a trigger to a scene"
**Steps:**
1. Connect to mock server
2. Ensure automation extension is installed
3. Create a group and scene, navigate to scene editor
4. Under "Triggers" section, click the "+" icon
5. Select "Double Tap" from dropdown
6. **Verify**: Trigger is added to the list

### Test: "should configure time range for a trigger"
**Steps:**
1. Connect to mock server with automation extension
2. Navigate to scene editor
3. Add a "Motion Sensor" trigger
4. Check the "Time range" checkbox
5. Set start time to 18:00 and end time to 22:00
6. Wait for auto-save
7. **Verify**: Trigger shows time range configuration

### Test: "should delete a scene"
**Steps:**
1. Connect to mock server
2. Create a scene in a group
3. Navigate to scene editor (click configure icon)
4. Click "Delete scene"
5. Confirm in dialog
6. **Verify**: Scene no longer appears in group's Scenes list

### Test: "should save current light state to scene"
**Steps:**
1. Connect to mock server
2. Create a group with lights and a scene
3. Navigate to scene editor
4. Click "Save current state"
5. Confirm in dialog
6. **Verify**: No error, scene is updated

---

## File: `tests/buttons-sensors.spec.ts` (NEW FILE)

### Test: "should add a button/sensor to a group"
**Steps:**
1. Connect to mock server
2. Ensure automation extension is installed
3. Navigate to "Living Room" group
4. Under "Buttons and sensors" section, click the "+" icon
5. Select "Dimmer Switch" from the list (non-light device from mock-z2m)
6. **Verify**: "Dimmer Switch" now appears under "Buttons and sensors"

### Test: "should remove a button/sensor from a group"
**Steps:**
1. Connect to mock server with automation extension
2. Add "Dimmer Switch" to "Living Room" (follow previous test)
3. In "Buttons and sensors" section, click the remove icon next to "Dimmer Switch"
4. **Verify**: "Dimmer Switch" no longer appears in the list

---

## File: `tests/connection-management.spec.ts` (NEW FILE)

### Test: "should show landing page when not connected"
**Steps:**
1. Navigate to `http://localhost:PORT/` without connecting
2. **Verify**: Landing page is shown with "Control your lights, simply." heading
3. **Verify**: "Connect to a server" button is visible

### Test: "should edit server connection settings"
**Steps:**
1. Connect to mock server
2. Click the three-dot menu icon in header
3. Click "Manage server settings"
4. **Verify**: Connection form shows with pre-filled address
5. Change the username to "admin2"
6. Click "Cancel" (don't save)
7. **Verify**: Returns to main page

### Test: "should handle connection errors gracefully"
**Steps:**
1. Navigate to app
2. Go to connection page
3. Enter invalid server address: "invalid.server.local"
4. Enter username: "test", password: "test"
5. Click Connect
6. **Verify**: Error toast/notification appears indicating connection failed

### Test: "should delete server credentials"
**Steps:**
1. Connect to mock server
2. Open menu, go to "Manage server settings"
3. Click "Delete" button
4. Confirm deletion
5. **Verify**: Returns to landing page (no servers configured)

---

## File: `tests/permit-join.spec.ts` (NEW FILE)

### Test: "should enable and disable permit join"
**Steps:**
1. Connect to mock server
2. In Management section, click "Permit join"
3. **Verify**: Button changes to "Stop searching" with spinning animation
4. **Verify**: Header shows permit join icon with animation
5. Click "Stop searching"
6. **Verify**: Returns to "Permit join" state

---

## File: `tests/batteries.spec.ts` (NEW FILE)

### Test: "should show batteries page with device battery levels"
**Steps:**
1. Connect to mock server (mock-z2m needs to provide battery metadata for devices)
2. Navigate to `/batteries` route (click battery icon if visible, or navigate directly)
3. **Verify**: Page title is "Batteries"
4. **Verify**: List shows non-light devices with battery percentages

---

## File: `tests/remote-access.spec.ts` (NEW FILE)

### Test: "should toggle remote access setting"
**Steps:**
1. Connect to mock server
2. Under "Remote Access" section on main page, find the toggle
3. Click the checkbox to enable remote access
4. **Verify**: Notification appears about UPnP/port forwarding
5. Click to disable remote access
6. **Verify**: Checkbox becomes unchecked

### Test: "should show remote access info page"
**Steps:**
1. Connect to mock server
2. Click the info icon next to "Enable remote access"
3. **Verify**: "Remote Access" info page is shown
4. **Verify**: Page contains information about UPnP and security
5. Click "Got it" button
6. **Verify**: Returns to main page

---

## File: `tests/admin-mode.spec.ts` (NEW FILE)

### Test: "should toggle admin mode via menu"
**Steps:**
1. Connect to mock server (starts in admin mode due to `?admin=y`)
2. **Verify**: Admin icon shows "on" state in header
3. Click three-dot menu
4. Click "Leave admin mode"
5. **Verify**: Admin sections (Management, Users, Extensions) are hidden
6. **Verify**: Admin icon no longer shows "on" state
7. Open menu again, click "Enter admin mode"
8. **Verify**: Admin sections are visible again

### Test: "should show debug dump page in admin mode"
**Steps:**
1. Connect to mock server in admin mode
2. Open three-dot menu
3. Click "Debug info"
4. **Verify**: Page shows "State dump" title
5. **Verify**: Page contains JSON/debug information about the store

---

## File: `tests/integration.spec.ts` (APPEND)

### Test: "should turn off a group from the main grid"
**Steps:**
1. Connect to mock server
2. On main page grid, find "Living Room" tile
3. Click the "off" icon in the tile's options area
4. **Verify**: Group lights are turned off (tile becomes darker/shows "off" state)

### Test: "should recall a scene from the main grid"
**Steps:**
1. Connect to mock server
2. Create a scene in "Living Room" group (or use existing)
3. On main page grid, click a scene icon in the "Living Room" tile options
4. **Verify**: Scene is recalled (API call sent, no errors)

---

## Notes for Implementers

- **Mock server**: The mock Z2M server is in `src/mock-z2m.ts`. It provides devices like "Color Light", "White Light", "Dimmer Switch" and groups like "Living Room", "Bedroom".
- **Admin mode**: Most tests should start with `?admin=y` URL parameter to access admin features.
- **Extensions**: Some features (triggers, buttons/sensors, timers) require the `lightlynx-automation` extension. The extension-lifecycle test shows how to install it.
- **Selectors**: Use semantic HTML selectors like `h1`, `h2`, `.item`, `.link`, `button.primary`, etc.
- **Waiting**: Use `expect(locator).toBeVisible({ timeout: X })` for elements that may take time to appear.
- **Confirmation dialogs**: The app uses custom dialogs. Look for `button.primary:has-text("Yes")` for confirm and `button.primary:has-text("OK")` for prompts.
