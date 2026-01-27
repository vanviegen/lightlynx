import { $, proxy, ref, onEach, isEmpty, clone, unproxy } from 'aberdeen';
import * as route from 'aberdeen/route';
import api from '../api';
import * as icons from '../icons';
import { User } from '../types';
import { routeState, notify, askConfirm, hashSecret, drawEmpty } from '../ui';

export function drawUsersSection(): void {
    $("h1#Users", () => {
        icons.create('click=', () => route.go(['user', 'new']));
    });

    $('div.list', () => {
        onEach(api.store.users, (user, username) => {
            $('div.item.link', 'click=', () => route.go(['user', username]), () => {
                (user.isAdmin ? icons.shield : icons.user)();
                $('h2#', username);
                if (!user.hasPassword) $('span.badge.warning#No password');
                else if (user.allowRemote) $('span.badge#Remote');
            });
        });
    });
}

export function drawUserEditor(): void {
    
    const username = route.current.p[1]!;
    const isNew = username === 'new';
    const isAdminUser = username === 'admin';
    
    const storeUser = api.store.users[username];
    const user = isNew ? proxy<User>({
        isAdmin: false,
        allowedDevices: [],
        allowedGroups: [],
        allowRemote: false, // Can't enable without password
        password: ''
    }) : proxy(clone(unproxy(storeUser || {
        isAdmin: true,
        allowedDevices: [],
        allowedGroups: [],
        allowRemote: false,
        password: ''
    })));
    
    const newUsername = proxy('');

    $(() => {
        routeState.title = isNew ? 'New User' : username;
        routeState.subTitle = 'user';
    });

    $('h1#Settings');
    if (isNew) {
        $('div.item', () => {
            $('h2.form-label#Username');
            $('input bind=', newUsername, 'placeholder=Username');
        });
    }

    $('div.item', () => {
        $('h2.form-label#Password');
        $('input type=password bind=', ref(user, 'password'), 'placeholder=', isNew ? 'Required' : 'Password or secret (empty to clear)');
    });

    if (!isAdminUser) {
        $('label.item', () => {
            $('input type=checkbox bind=', ref(user, 'isAdmin'));
            $('h2#Admin access');
        });
    }

    $('label.item', () => {
        // Can only enable remote access if user has password (either existing or being set)
        const hasOrSettingPassword = () => user.password || storeUser?.hasPassword;
        $('input type=checkbox bind=', ref(user, 'allowRemote'), '.disabled=', () => !hasOrSettingPassword(), 'title=', () => hasOrSettingPassword() ? '' : 'Set a password first to enable remote access');
        $('h2#Allow remote access');
        $(() => {
            if (!hasOrSettingPassword()) $('p.muted#Requires password');
        });
    });

    $(() => {
        if (user.isAdmin) return;

        $('h1#Permissions');
        $('h2#Allowed Groups');
        $('div.list', () => {
            onEach(api.store.groups, (group, groupId) => {
                $('label.item', () => {
                    const gid = parseInt(groupId);
                    const checked = user.allowedGroups.includes(gid);
                    $('input type=checkbox', 'checked=', checked, 'change=', (e: any) => {
                        if (e.target.checked) user.allowedGroups.push(gid);
                        else user.allowedGroups = user.allowedGroups.filter((id: number) => id !== gid);
                    });
                    $('h2#', group.name);
                });
            });
            $(() => { if (isEmpty(api.store.groups)) drawEmpty("No groups"); });
        });

        $('h2#Allowed Devices');
        $('div.list', () => {
            onEach(api.store.devices, (device, ieee) => {
                if (!device.lightCaps) return;
                $('label.item', () => {
                    const checked = user.allowedDevices.includes(ieee);
                    $('input type=checkbox', 'checked=', checked, 'change=', (e: any) => {
                        if (e.target.checked) user.allowedDevices.push(ieee);
                        else user.allowedDevices = user.allowedDevices.filter((id: string) => id !== ieee);
                    });
                    $('h2#', device.name);
                });
            });
            $(() => { if (isEmpty(api.store.devices)) drawEmpty("No devices"); });
        });
    });

    $('h1#Actions');
    const busy = proxy(false);
    $('div.item.link#Save', '.busy=', busy, icons.save, 'click=', async () => {
        busy.value = true;
        try {
            const finalUsername = isNew ? newUsername.value : username;
            if (!finalUsername) throw new Error("Username required");
            const payload: any = unproxy(user);
            
            if (user.password) {
                // Check if it's already a 64-char hex secret
                if (/^[0-9a-f]{64}$/i.test(user.password)) {
                    payload.secret = user.password.toLowerCase();
                } else {
                    payload.secret = await hashSecret(user.password);
                }
            }
            delete payload.password;
            
            const userPayload = {
                username: finalUsername,
                ...payload
            };
            if (isNew) {
                await api.addUser(userPayload);
            } else {
                await api.updateUser(userPayload);
            }
            route.up();
        } catch (e: any) {
            notify('error', e.message || "Failed to save user");
        } finally {
            busy.value = false;
        }
    });

    if (!isNew && !isAdminUser) {
        $('div.item.link.danger#Delete user', icons.remove, 'click=', async () => {
            if (await askConfirm(`Are you sure you want to delete user '${username}'?`)) {
                await api.deleteUser(username);
                route.up();
            }
        });
    }
}
