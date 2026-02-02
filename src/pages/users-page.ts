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
        icons.create('.link click=', () => route.go(['user', 'new']));
    });

    $('div.list', () => {
        onEach(api.store.users, (user, username) => {
            $('div.item.link', 'click=', () => route.go(['user', username]), () => {
                (user.isAdmin ? icons.shield : icons.user)();
                $('h2#', username);
                if (!user.secret) $('span.badge.warning#No password');
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
        secret: ''
    }) : proxy(clone(unproxy(storeUser || {
        isAdmin: true,
        allowedGroups: [],
        allowRemote: false,
        secret: ''
    })));
    
    const password = proxy(storeUser?.secret || '');
    
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
            $('h2.form-label flex:0 #Password');
            $('input flex:1 type=password bind=', password, 'placeholder=', 'Password or secret');
        });

        if (!isAdminUser) {
            $('label.item', () => {
                $('input type=checkbox bind=', ref(user, 'isAdmin'));
                $('h2#Admin access');
            });
        }

        $('label.item', () => {
            // Can only enable remote access if user has password
            $('input type=checkbox bind=', ref(user, 'allowRemote'), 'disabled=', () => !password.value, 'title=', () => password.value ? '' : 'Set a password first to enable remote access');
            $('h2#Allow remote access');
            $(() => {
                if (!password.value) $('p.muted#Requires password');
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
    $('form div.button-row', () => {

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
                
                const userPayload: any = {
                    username: finalUsername,
                    isAdmin: user.isAdmin,
                    allowedGroups: [...user.allowedGroups],
                    allowRemote: user.allowRemote,
                    secret: await hashSecret(password.value),
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
