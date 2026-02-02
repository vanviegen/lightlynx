import { $, proxy, ref, onEach, isEmpty, clone, unproxy } from 'aberdeen';
import * as route from 'aberdeen/route';
import api from '../api';
import * as icons from '../icons';
import { User } from '../types';
import { routeState, hashSecret } from '../ui';
import { askConfirm } from '../components/prompt';
import { createToast } from '../components/toasts';

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
        allowedGroups: [],
        allowRemote: false, // Can't enable without password
        password: ''
    }) : proxy(clone(unproxy(storeUser || {
        isAdmin: true,
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
    $('div.list', () => {

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
            $('input type=checkbox bind=', ref(user, 'allowRemote'), 'disabled=', () => !hasOrSettingPassword(), 'title=', () => hasOrSettingPassword() ? '' : 'Set a password first to enable remote access');
            $('h2#Allow remote access');
            $(() => {
                if (!hasOrSettingPassword()) $('p.muted#Requires password');
            });
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
            $(() => { if (isEmpty(api.store.groups)) $('div.empty#No groups'); });
        });
    });

    const busy = proxy(false);
    $('form div.row', () => {

        if (!isNew && !isAdminUser) {
            $('button.danger', icons.remove, '#Delete user', 'click=', async () => {
                if (await askConfirm(`Are you sure you want to delete user '${username}'?`)) {
                    await api.deleteUser(username);
                    route.up();
                }
            });
        }


        $('button.secondary type=button text=Cancel click=', () => route.up());
        $('button.primary type=button .busy=', busy, 'text=Save click=', async () => {
            busy.value = true;
            try {
                const finalUsername = isNew ? newUsername.value : username;
                if (!finalUsername) throw new Error("Username required");
                const payload: any = unproxy(user);
                
                // Handle password/secret - only include if user entered something
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
                    isAdmin: payload.isAdmin,
                    allowedGroups: payload.allowedGroups,
                    allowRemote: payload.allowRemote,
                    secret: payload.secret, // could be undefined
                };
                
                if (isNew) {
                    await api.addUser(userPayload);
                } else {
                    await api.updateUser(userPayload);
                }
                route.up();
            } catch (e: any) {
                createToast('error', e.message || "Failed to save user");
            } finally {
                busy.value = false;
            }
        });
    });

}
