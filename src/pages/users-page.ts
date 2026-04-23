import A from 'aberdeen';
import * as route from 'aberdeen/route';
import api from '../api';
import * as icons from '../icons';
import { User } from '../types';
import { routeState, hashSecret, copyToClipboard } from '../ui';
import { askConfirm } from '../components/prompt';
import { createToast } from '../components/toasts';

export function drawUsersSection(): void {
    A("h1#Users", () => {
        icons.create('.link click=', () => route.go(['user']));
    });

    A('div.list', () => {
        A.onEach(api.store.config.users || {}, (user, userName) => {
            A('div.item.link', 'click=', () => route.go(['user', userName]), () => {
                (user.isAdmin ? icons.shield : icons.user)();
                A('h2#', userName);
                if (!user.secret) A('span.badge.warning#No password');
                else if (user.allowRemote) A('span.badge#Remote');
            });
        });
    });
}

export function drawUserEditor(): void {
    if (!api.store.me?.isAdmin) return route.back();
    
    const userName = route.current.p[1]!;
    const existing = userName ? api.store.config.users?.[userName] : undefined;
    const userNameProxy = A.proxy(existing ? userName : "");

    const user = A.proxy<User>(
        existing ? A.clone(A.unproxy(existing)) : {
            isAdmin: false,
            defaultGroupAccess: false,
            groupAccess: {},
            allowRemote: false, // Can't enable without password
            secret: ''
        }
    );
    
    A(() => {
        routeState.title = existing ? userName : 'Add';
        routeState.subTitle = 'user';
    });

    A('h1#Settings');
    A('div.list', () => {

        if (!existing) {
            A('div.item', () => {
                A('h2.form-label#User name');
                A('input placeholder=frank bind=', userNameProxy);
            });
        }

        A('div.item', () => {
            A('h2.form-label flex:0 #Password');
            A('input flex:1 type=password bind=', A.ref(user, 'secret'), 'placeholder=', 'Password or hash or empty');
        });

        A('label.item', () => {
            A('input type=checkbox bind=', A.ref(user, 'isAdmin'));
            A('h2#Admin access');
        });

        A('label.item', () => {
            // Can only enable remote access if user has password
            A('input type=checkbox bind=', A.ref(user, 'allowRemote'), 'disabled=', A.derive(() => !user.secret), 'title=', A.derive(() => user.secret ? '' : 'Set a password first to enable remote access'));
            A('h2#Allow remote access');
            A(() => {
                if (!user.secret) A('p.muted#Requires password');
            });
        });
    });

    A(() => {
        if (user.isAdmin) return;

        A('h1#Group Permissions');
        A('div.list', () => {
            A('div.item', () => {
                A('h2 flex:1 font-weight:bold #Default group access');
                A('select change=', (e: Event) => {
                    const val = (e.target as HTMLSelectElement).value;
                    user.defaultGroupAccess = val === 'manage' ? 'manage' : val === 'true' ? true : false;
                }, () => {
                    A('option value=false #No access', 'selected=', user.defaultGroupAccess === false);
                    A('option value=true #Control', 'selected=', user.defaultGroupAccess === true);
                    A('option value=manage #Manage', 'selected=', user.defaultGroupAccess === 'manage');
                });
            });
            A.onEach(api.store.groups, (group, groupId) => {
                A('div.item', () => {
                    const gid = parseInt(groupId);
                    A('h2 flex:1 #', group.name);
                    A('select change=', (e: Event) => {
                        const val = (e.target as HTMLSelectElement).value;
                        if (val === 'default') {
                            delete user.groupAccess[gid];
                        } else {
                            user.groupAccess[gid] = val === 'manage' ? 'manage' : val === 'true' ? true : false;
                        }
                    }, () => {
                        const current = user.groupAccess[gid];
                        A('option value=default #Use default', 'selected=', current === undefined);
                        A('option value=false #No access', 'selected=', current === false);
                        A('option value=true #Control', 'selected=', current === true);
                        A('option value=manage #Manage', 'selected=', current === 'manage');
                    });
                });
            });
            A(() => { if (A.isEmpty(api.store.groups)) A('div.empty#No groups'); });
        });
    });

    const busy = A.proxy(false);
    A('form div.button-row', () => {

        if (existing && api.store.me?.name !== userName) {
            A('button.danger', icons.remove, '#Delete user', 'click=', async () => {
                if (await askConfirm(`Are you sure you want to delete user '${userName}'?`)) {
                    await api.deleteUser(userName);
                    route.up();
                }
            });
        }


        A('button.secondary type=button text=Cancel click=', () => route.up());
        A('button.primary type=button .busy=', busy, 'text=Save click=', async () => {
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

    A('form', () => {
        A('small.link text-align:right text="Copy direct-connect URL" click=', async () => {
            const instanceId = api.servers[0]?.instanceId || api.store.config.instanceId || '';
            let url = `${location.protocol}//${location.host}/?instanceId=${encodeURIComponent(instanceId)}&userName=${encodeURIComponent(userName)}`;
            if (user.secret) url += `&secret=${encodeURIComponent(user.secret)}`;
            await copyToClipboard(url, 'URL');
        });
    })
}
