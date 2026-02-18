import { $, proxy, ref, onEach, isEmpty, clone, unproxy, derive } from 'aberdeen';
import * as route from 'aberdeen/route';
import api from '../api';
import * as icons from '../icons';
import { User } from '../types';
import { routeState, hashSecret, copyToClipboard } from '../ui';
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
    const userNameProxy = proxy(existing ? userName : "");

    const user = proxy<User>(
        existing ? clone(unproxy(existing)) : {
            isAdmin: false,
            defaultGroupAccess: false,
            groupAccess: {},
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
                $('h2.form-label#User name');
                $('input placeholder=frank bind=', userNameProxy);
            });
        }

        $('div.item', () => {
            $('h2.form-label flex:0 #Password');
            $('input flex:1 type=password bind=', ref(user, 'secret'), 'placeholder=', 'Password or hash or empty');
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

        $('h1#Group Permissions');
        $('div.list', () => {
            $('div.item', () => {
                $('h2 flex:1 font-weight:bold #Default group access');
                $('select change=', (e: Event) => {
                    const val = (e.target as HTMLSelectElement).value;
                    user.defaultGroupAccess = val === 'manage' ? 'manage' : val === 'true' ? true : false;
                }, () => {
                    $('option value=false #No access', 'selected=', user.defaultGroupAccess === false);
                    $('option value=true #Control', 'selected=', user.defaultGroupAccess === true);
                    $('option value=manage #Manage', 'selected=', user.defaultGroupAccess === 'manage');
                });
            });
            onEach(api.store.groups, (group, groupId) => {
                $('div.item', () => {
                    const gid = parseInt(groupId);
                    $('h2 flex:1 #', group.name);
                    $('select change=', (e: Event) => {
                        const val = (e.target as HTMLSelectElement).value;
                        if (val === 'default') {
                            delete user.groupAccess[gid];
                        } else {
                            user.groupAccess[gid] = val === 'manage' ? 'manage' : val === 'true' ? true : false;
                        }
                    }, () => {
                        const current = user.groupAccess[gid];
                        $('option value=default #Use default', 'selected=', current === undefined);
                        $('option value=false #No access', 'selected=', current === false);
                        $('option value=true #Control', 'selected=', current === true);
                        $('option value=manage #Manage', 'selected=', current === 'manage');
                    });
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
            const normalizedName = (userNameProxy.value || '').trim().toLowerCase();
            if (!normalizedName) {
                createToast('error', 'User name is required');
            } else {
                busy.value = true;
                user.secret = await hashSecret(user.secret);
                userNameProxy.value = normalizedName;
                await api.updateUser({...user, name: normalizedName});
                busy.value = false;
                route.up();
            }
        });
    });

    $('form', () => {
        $('small.link text-align:right text="Copy direct-connect URL" click=', async () => {
            const instanceId = api.servers[0]?.instanceId || api.store.config.instanceId || '';
            let url = `${location.protocol}//${location.host}/?instanceId=${encodeURIComponent(instanceId)}&userName=${encodeURIComponent(userName)}`;
            if (user.secret) url += `&secret=${encodeURIComponent(user.secret)}`;
            await copyToClipboard(url, 'URL');
        });
    })
}
