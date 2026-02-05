import { $, proxy, ref, onEach, isEmpty, clone, unproxy, derive } from 'aberdeen';
import * as route from 'aberdeen/route';
import api from '../api';
import * as icons from '../icons';
import { User } from '../types';
import { routeState, hashSecret } from '../ui';
import { askConfirm } from '../components/prompt';
import { createToast } from '../components/toasts';

export function drawUsersSection(): void {
    $("h1#Users", () => {
        icons.create('.link click=', () => route.go(['user']));
    });

    $('div.list', () => {
        onEach(api.store.config.users || {}, (user, userName) => {
            $('div.item.link', 'click=', () => route.go(['user', userName]), () => {
                (user.isAdmin ? icons.shield : icons.user)();
                $('h2#', userName);
                if (!user.secret) $('span.badge.warning#No password');
                else if (user.allowRemote) $('span.badge#Remote');
            });
        });
    });
}

export function drawUserEditor(): void {
    if (!api.store.me?.isAdmin) return route.back();
    
    const userName = route.current.p[1]!;
    const existing = userName ? api.store.config.users?.[userName] : undefined;

    const user = proxy<User>(
        existing ? clone(unproxy(existing)) : {
            name: userName || '',
            isAdmin: false,
            allowedGroupIds: [],
            allowRemote: false, // Can't enable without password
            secret: ''
        }
    );
    
    $(() => {
        routeState.title = existing ? userName : 'Add';
        routeState.subTitle = 'user';
    });

    $('h1#Settings');
    $('div.list', () => {

        if (!existing) {
            $('div.item', () => {
                $('h2.form-label#UserName');
                $('input bind=', ref(user, 'name'), 'placeholder=UserName');
            });
        }

        $('div.item', () => {
            $('h2.form-label flex:0 #Password');
            $('input flex:1 type=password bind=', ref(user, 'secret'), 'placeholder=', 'Password or secret');
        });

        $('label.item', () => {
            $('input type=checkbox bind=', ref(user, 'isAdmin'));
            $('h2#Admin access');
        });

        $('label.item', () => {
            // Can only enable remote access if user has password
            $('input type=checkbox bind=', ref(user, 'allowRemote'), 'disabled=', derive(() => !user.secret), 'title=', derive(() => user.secret ? '' : 'Set a password first to enable remote access'));
            $('h2#Allow remote access');
            $(() => {
                if (!user.secret) $('p.muted#Requires password');
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
                    const checked = user.allowedGroupIds.includes(gid);
                    $('input type=checkbox', 'checked=', checked, 'change=', (e: any) => {
                        if (e.target.checked) user.allowedGroupIds.push(gid);
                        else user.allowedGroupIds = user.allowedGroupIds.filter((id: number) => id !== gid);
                    });
                    $('h2#', group.name);
                });
            });
            $(() => { if (isEmpty(api.store.groups)) $('div.empty#No groups'); });
        });
    });

    const busy = proxy(false);
    $('form div.button-row', () => {

        if (existing && api.store.me?.name !== userName) {
            $('button.danger', icons.remove, '#Delete user', 'click=', async () => {
                if (await askConfirm(`Are you sure you want to delete user '${userName}'?`)) {
                    await api.deleteUser(userName);
                    route.up();
                }
            });
        }


        $('button.secondary type=button text=Cancel click=', () => route.up());
        $('button.primary type=button .busy=', busy, 'text=Save click=', async () => {
            if (!user.name) {
                createToast('error', 'User name is required');
            } else {
                busy.value = true;
                user.secret = await hashSecret(user.secret);                
                await api.updateUser(user);
                busy.value = false;
                route.up();
            }
        });
    });

}
