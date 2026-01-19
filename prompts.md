When I try to enable remote access, I get the following error: Jan 19 13:48:13 iffy node[1474614]: [2026-01-19 13:48:13] info:         z2m: LightLynx API: Requesting SSL certificate Jan 19 13:48:29 iffy node[1474614]: [2026-01-19 13:48:29] error:         z2m: LightLynx API: SSL certificate request failed: Failed to create: Failed to finalize order: 403 { Jan 19 13:48:29 iffy node[1474614]:   "type": "urn:ietf:params:acme:error:unauthorized", Jan 19 13:48:29 iffy node[1474614]:   "detail": "Error finalizing order :: CSR does not specify same identifiers as Order", Jan 19 13:48:29 iffy node[1474614]:   "status": 403 Jan 19 13:48:29 iffy node[1474614]: } Jan 19 13:48:30 iffy node[1474614]: [2026-01-19 13:48:30] info:         z2m: LightLynx API: UPnP port mapped: <router>:28027 -> 192.168.1.94:43597 Jan 19 13:48:30 iffy node[1474614]: [2026-01-19 13:48:30] info:         z2m:mqtt: MQTT publish: topic 'zigbee2mqtt/bridge/response/lightlynx/config/setRemoteAccess', payload '{"data":{"remoteAccess":true},"status":"ok","transaction":"oij26-1"}' 


Change the three-dots menu transition to a simple css class-based effect (fade and a slight vertical movement), instead of shrink/grow.


Remove the 'Enter admin mode' from the three-dots menu. Instead, always show the admin icon in the top bar *if* the current user is an admin (use something like `store.users[store.servers[0]?.user].isAdmin`). Highlight it (primary color) when admin mode is enabled. Remove the 'Debug info' option as well, instead having the dump triggered by doing a long-press on the admin icon. The three-dots menu is now just a 'server' menu - change the icon accordingly.


When turning off a group, it sends individual off commands to all lights in the group. Change this to send a single command to the group instead.


Remove the 'lights off' icon with the on/off switch. Instead, put a drawBulbCircle, acting as a on/off toggle for all bulbs in the group, to the left of the group name. Change that function such that it can accept either a Device or a Group. 


In the 'New user' dialog, make sure username and password inputs are aligned.
