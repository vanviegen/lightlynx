import A from 'aberdeen';
import { grow, shrink } from 'aberdeen/transitions';
import * as route from 'aberdeen/route';
import api from '../api';
import * as icons from '../icons';
import { Group, Trigger } from '../types';
import { routeState, manage, lazySave } from '../ui';
import { askConfirm } from '../components/prompt';

// Parse individual time string into structured format for editing
function parseTime(timeStr: string): {hour: number, minute: number, type: 'wall' | 'bs' | 'as' | 'br' | 'ar'} | undefined {
    const m = timeStr.match(/^(\d{1,2})(?::(\d{2}))?((b|a)(s|r))?$/);
    if (!m) return;
    return {
        hour: parseInt(m[1]!),
        minute: m[2] ? parseInt(m[2]) : 0,
        type: (m[3] || 'wall') as any
    };
}

// Format time back to string
function formatTime({hour, minute, type}: {hour: number, minute: number, type: string}): string {
    const minuteStr = minute === 0 ? '' : `:${minute.toString().padStart(2, '0')}`;
    return type === 'wall' ? `${hour}${minuteStr}` : `${hour}${minuteStr}${type}`;
}

// Draw the scene options in a grid, each at least 150px wide
const scenePresetsClass = A.insertCss({
    "&": "display:grid grid-template-columns:repeat(auto-fit,minmax(150px,1fr)) gap:$2 m:$3",
    ".item": "display:flex flex-direction:column align-items:center padding:$2 r:8px border: 1px solid $border; cursor:pointer",
    ".item.selected, .item.selected input": "color:$primary",
    ".custom": {
        "&": "display:flex flex-direction:column align-items:center justify-content:center",
        "input": "width:100% background-color:#fff1 text-align:center",
        "&:selected input": "color:$primary"
    },
});

// Enhanced scene automation editor
export function drawSceneEditor(group: Group, groupId: number): void {

	if (!manage.value || route.current.p[3] == null || api.canControlGroup(groupId) !== 'manage') {
		route.up();
		return;
	}
	const sceneId = parseInt(route.current.p[3]);
	const scene = group.scenes[sceneId];
	if (!scene) {
		return route.up();
	}

	A(() => {
		routeState.title = group.name + ' · ' + scene.name;
	});
	routeState.subTitle = "scene";
	routeState.drawIcons = undefined;

    const sceneState = A.proxy(A.peek(() => ({
        shortName: scene.name,
        triggers: (api.store.config.sceneTriggers[groupId]?.[sceneId] || []).map(t => ({...t})) // Copy triggers
    })));
    
    A('h1#Scene name');
    
    // Scene identity - combined preset and custom name
    const scenePresets = Object.keys(icons.scenes).filter(name => 
        !['dim', 'soft', 'orientation'].includes(name) // Filter out legacy aliases
    );

    const selected: Record<string, boolean> = A.proxy({});
    A(() => {
        let name = sceneState.shortName.toLowerCase();
        if (!scenePresets.includes(name)) name = 'custom';
        A.copy(selected, {[name]: true});
    });

	A('div.list', scenePresetsClass, () => {
		// Permanent input field as first "button"
		A('div.custom.item', () => {
			A('input', {
				type: 'text',
				bind: A.ref(sceneState, 'shortName')
			});
            A(() => {
                A({'.selected': A.ref(selected, 'custom')});
            });
        });

		for (const presetName of scenePresets) {
			const icon = icons.scenes[presetName]!;
			const label = presetName.charAt(0).toUpperCase() + presetName.slice(1);
			
			A('div.item.link click=', () => {
				sceneState.shortName = label;
			}, () => {
				A(() => {
					A({'.selected': A.ref(selected, presetName)});
				});
				icon("color:inherit");
				A('small#', label);
			});
		}
	});

	
	const automationEnabled = api.store.config.automationEnabled;
	A('h1#Triggers', () => {
		if (automationEnabled) icons.create('.link click=', () => sceneState.triggers.push({event: '1'}));
	});
	A('div.list', () => {
	    if (!automationEnabled) return;
		A.onEach(sceneState.triggers, (trigger, triggerIndex) => {
			const showTimes = A.proxy(A.peek(trigger, 'startTime') != null);

			// Set/delete times when showTimes is toggled.
			A(() => {
				if (showTimes.value) {
					if (!A.peek(trigger, 'startTime')) trigger.startTime = (trigger.event === 'time' ? '18' : '0bs');
					if (!A.peek(trigger, 'endTime')) trigger.endTime = (trigger.event === 'time' ? '22' : '0ar');
				} else {
					delete trigger.startTime;
					delete trigger.endTime;
				}
			});

			A('div.item flex-direction:column align-items:stretch', () => {
				A('div display:flex justify-content:space-between gap:$3 align-items: center', () =>{
					A('select width:inherit bind=', A.ref(trigger, 'event'), () => {
						A('option value=1 #Single Tap');
						A('option value=2 #Double Tap');
						A('option value=3 #Triple Tap');
						A('option value=4 #Quadruple Tap');
						A('option value=5 #Quintuple Tap');
						A('option value=sensor #Motion Sensor');
						A('option value=time #Time-based');
					});
					
					A(() => {
						if (trigger.event !== 'time') {
							A('label display:flex align-items:center gap:$2 flex:1', () => {
								A('input type=checkbox bind=', showTimes);
								A('#Only between...');
							});
						}
					})

					icons.remove('click=', () => sceneState.triggers.splice(triggerIndex, 1));
				});
				A(() => {
					if (showTimes.value || trigger.event === 'time') {
						A('div', {create: grow, destroy: shrink}, () => {
							drawTimeEditor("From", trigger, 'startTime');
							drawTimeEditor("Until", trigger, 'endTime');
						})
					}
				})

			})
		});
		if (A.isEmpty(sceneState.triggers)) A('div.empty#None yet');
    });

    A('h1#Actions');
    async function save(e: Event): Promise<void> {
        e.stopPropagation();
        if (!await askConfirm(`Are you sure you want to overwrite the '${scene!.name}' scene for group '${group.name}' with the current light state?`)) return;
        api.send("scene", groupId, sceneId, "store", scene!.name);
    }
    async function remove(e: Event): Promise<void> {
        e.stopPropagation();
        if (!await askConfirm(`Are you sure you want to delete the '${scene!.name}' scene for group '${group.name}'?`)) return;
        api.send("scene", groupId, sceneId, "remove");
    }
    A('div.list', () => {
        A('div.item.link', icons.save, '#Overwrite scene with current state', 'click=', save);
        A('div.item.link', icons.remove, '#Delete scene', 'click=', remove);
    })

    lazySave(() => {
		const name = sceneState.shortName;
        return function() {
            api.send('scene', groupId, sceneId, 'rename', name);
        }
    });
    lazySave(() => {
		const triggers = A.clone(sceneState.triggers);
        return function() {
            api.send('scene', groupId, sceneId, 'setTriggers', triggers);
        }
    });
}

// Time range editor component - takes a trigger object and which field to edit
function drawTimeEditor(text: string, trigger: Trigger, field: 'startTime' | 'endTime'): void {
	const timeStr = trigger[field] || '';
	const parsedTime = parseTime(timeStr) || {hour: 0, minute: 0, type: 'wall' as const};
	const timeState = A.proxy(parsedTime);
	
	// Rebuild time string whenever component changes
	A(() => {
		const newTimeStr = formatTime(timeState);
		trigger[field] = newTimeStr;
	});
	
	A('div display:flex align-items:center gap:$2', () => {
		A('label flex:1 text-align:right text=', text+" ")
		// $('input width:4em type=number min=0 max=23 bind=', ref(timeState, 'hour'));
		A('select bind=', A.ref(timeState, 'hour'), () => {
			for (let h = 0; h < 24; h++) {
				A('option value=', h, '#', h.toString().padStart(2, '0'));
			}
		})
		A('b# : ');
		// $('input width:4em type=number min=0 max=59 value=', unproxy(timeState).minute.toString().padStart(2, '0'), 'input=', (event: any) => timeState.minute = parseInt(event.target.value));
		A('select bind=', A.ref(timeState, 'minute'), () => {
			for (let m = 0; m < 60; m+=5) {
				A('option value=', m, '#', m.toString().padStart(2, '0'));
			}
		});
		A('select bind=', A.ref(timeState, 'type'), () => {
			A('option value=wall #wall time');
			A('option value=br #before sunrise');
			A('option value=ar #after sunrise');
			A('option value=bs #before sunset');
			A('option value=as #after sunset');
		});
	});
}
