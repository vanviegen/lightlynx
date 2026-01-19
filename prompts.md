Fix auto-update

Enabling/disabling remote-access never stops the spinner. There is a bridge/response but it doesn't include the transaction id.


When starting the lightlynx-api.js extension with remoteAccess enabled, this is in the logs:
Jan 19 12:33:07 iffy node[1474614]: [LIGHTLYNX-API] Extension starting... Jan 19 12:33:07 iffy node[1474614]: [2026-01-19 12:33:07] info:         z2m: LightLynx API: Requesting SSL certificate Jan 19 12:33:07 iffy node[1474614]: [2026-01-19 12:33:07] info:         z2m: LightLynx API: Requesting SSL certificate Jan 19 12:33:23 iffy node[1474614]: [2026-01-19 12:33:23] error:         z2m: LightLynx API: SSL certificate request failed: Failed to create: Failed to finalize order: 403 { Jan 19 12:33:23 iffy node[1474614]:   "type": "urn:ietf:params:acme:error:unauthorized", Jan 19 12:33:23 iffy node[1474614]:   "detail": "Error finalizing order :: CSR does not specify same identifiers as Order", Jan 19 12:33:23 iffy node[1474614]:   "status": 403 Jan 19 12:33:23 iffy node[1474614]: } Jan 19 12:33:25 iffy node[1474614]: [2026-01-19 12:33:25] info:         z2m: LightLynx API: UPnP port mapped: <router>:28027 -> 192.168.1.94:43597 Jan 19 12:33:25 iffy node[1474614]: [2026-01-19 12:33:25] info:         z2m: LightLynx API: Starting HTTPS server on port 43597 Jan 19 12:33:25 iffy node[1474614]: [2026-01-19 12:33:25] info:         z2m: Loaded external extension 'lightlynx-api.js'. Jan 19 12:33:25 iffy node[1474614]: [2026-01-19 12:33:25] info:         z2m: lightlynx-api.js loaded. Contents written to '/opt/zigbee2mqtt/data/external_extensions/lightlynx-api.js'. Jan 19 12:33:25 iffy node[1474614]: [2026-01-19 12:33:25] info:         z2m:mqtt: MQTT publish: topic 'zigbee2mqtt/bridge/response/extension/save', payload '{"data":{},"status":"ok","transaction":"ahegp-1"}' Jan 19 12:33:38 iffy node[1474614]: [2026-01-19 12:33:38] info:         z2m: LightLynx API: Client connected: admin
Besides the error, it seems weird that it loks 'Requestion SSL certificate' twice. 



When within an .item using a checkbox in place of the left icon, make sure it takes the same amount of space as an item would.

Change the three-dots menu transition to a simple css class-based effect (fade and a slight vertical movement), instead of shrink/grow.

Remove the 'Enter admin mode' from the three-dots menu. Instead, always show the admin icon in the top bar *if* the current user is an admin (use something like `store.users[store.servers[0]?.user].isAdmin`). Highlight it (primary color) when admin mode is enabled. Remove the 'Debug info' option as well, instead having the dump triggered by doing a long-press on the admin icon. The three-dots menu is now just a 'server' menu - change the icon accordingly.

When turning off a group, it sends individual off commands to all lights in the group. Change this to send a single command to the group instead.

Remove the 'lights off' icon with the on/off switch. Instead, put a drawBulbCircle, acting as a on/off toggle for all bulbs in the group, to the left of the group name. Change that function such that it can accept either a Device or a Group. 

In the 'New user' dialog, make sure username and password inputs are aligned.
