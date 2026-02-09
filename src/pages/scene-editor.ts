import { $, proxy, ref, onEach, isEmpty, unproxy, peek, insertCss, copy, clone } from 'aberdeen';
import { grow, shrink } from 'aberdeen/transitions';
import * as route from 'aberdeen/route';
import api from '../api';
import * as icons from '../icons';
import { Group, Trigger } from '../types';
import { routeState, admin, lazySave } from '../ui';
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
const scenePresetsClass = insertCss({
    "&": "display:grid grid-template-columns:repeat(auto-fit,minmax(150px,1fr)) gap:$2 m:$3",
    ".item": "display:flex flex-direction:column align-items:center padding:$2 r:8px border:1px solid $border.interacting:bg:.interacting cursor:pointer",
    ".item.selected": "color:$primary",
    ".custom": {
        "&": "display:flex flex-direction:column align-items:center justify-content:center",
        "input": "width:100% background-color:#fff1 text-align:center",
        "&:selected input": "color:$primary"
    },
});

// Enhanced scene automation editor
export function drawSceneEditor(group: Group, groupId: number): void {

	if (!admin.value || route.current.p[3] == null) {
		route.up();
		return;
	}
	const sceneId = parseInt(route.current.p[3]);
	const scene = group.scenes[sceneId];
	if (!scene) {
		return route.up();
	}

	$(() => {
		routeState.title = group.name + ' · ' + scene.name;
	});
	routeState.subTitle = "scene";
	routeState.drawIcons = undefined;

    const sceneState = proxy(peek(() => ({
        shortName: scene.name,
        triggers: (api.store.config.sceneTriggers[groupId]?.[sceneId] || []).map(t => ({...t})) // Copy triggers
    })));
    
    $('h1#Scene name');
    
    // Scene identity - combined preset and custom name
    const scenePresets = Object.keys(icons.scenes).filter(name => 
        !['dim', 'soft', 'orientation'].includes(name) // Filter out legacy aliases
    );

    const selected: Record<string, boolean> = proxy({});
    $(() => {
        let name = sceneState.shortName.toLowerCase();
        if (!scenePresets.includes(name)) name = 'custom';
        copy(selected, {[name]: true});
    });

	$('div.list', scenePresetsClass, () => {
		// Permanent input field as first "button"
		$('div.custom.item', () => {
            $('small#Custom');
			$('input', {
				type: 'text',
				bind: ref(sceneState, 'shortName')
			});
            $(() => {
                $({'.selected': ref(selected, 'custom')});
            });
        });

		for (const presetName of scenePresets) {
			const icon = icons.scenes[presetName]!;
			const label = presetName.charAt(0).toUpperCase() + presetName.slice(1);
			
			$('div.item.link click=', () => {
				sceneState.shortName = label;
			}, () => {
				$(() => {
					$({'.selected': ref(selected, presetName)});
				});
				icon("color:inherit");
				$('span#', label);
			});
		}
	});

	
	const automationEnabled = api.store.config.automationEnabled;
	$('h1#Triggers', () => {
		if (automationEnabled) icons.create('.link click=', () => sceneState.triggers.push({event: '1'}));
	});
	$('div.list', () => {
	    if (!automationEnabled) return;
		onEach(sceneState.triggers, (trigger, triggerIndex) => {
			const showTimes = proxy(peek(trigger, 'startTime') != null);

			// Set/delete times when showTimes is toggled.
			$(() => {
				if (showTimes.value) {
					if (!peek(trigger, 'startTime')) trigger.startTime = (trigger.event === 'time' ? '18' : '0bs');
					if (!peek(trigger, 'endTime')) trigger.endTime = (trigger.event === 'time' ? '22' : '0ar');
				} else {
					delete trigger.startTime;
					delete trigger.endTime;
				}
			});

			$('div.item flex-direction:column align-items:stretch', () => {
				$('div display:flex justify-content:space-between gap:$3 align-items: center', () =>{
					$('select width:inherit bind=', ref(trigger, 'event'), () => {
						$('option value=1 #Single Tap');
						$('option value=2 #Double Tap');
						$('option value=3 #Triple Tap');
						$('option value=4 #Quadruple Tap');
						$('option value=5 #Quintuple Tap');
						$('option value=sensor #Motion Sensor');
						$('option value=time #Time-based');
					});
					
					$(() => {
						if (trigger.event !== 'time') {
							$('label display:flex align-items:center gap:$2 flex:1', () => {
								$('input type=checkbox bind=', showTimes);
								$('#Only between...');
							});
						}
					})

					icons.remove('click=', () => sceneState.triggers.splice(triggerIndex, 1));
				});
				$(() => {
					if (showTimes.value) {
						$('div', {create: grow, destroy: shrink}, () => {
							drawTimeEditor("From", trigger, 'startTime');
							drawTimeEditor("Until", trigger, 'endTime');
						})
					}
				})

			})
		});
		if (isEmpty(sceneState.triggers)) $('div.empty#None yet');
    });

    $('h1#Actions');
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
    $('div.list', () => {
        $('div.item.link', icons.save, '#Overwrite scene with current state', 'click=', save);
        $('div.item.link', icons.remove, '#Delete scene', 'click=', remove);
    })

    lazySave(() => {
		const name = sceneState.shortName;
        return function() {
            api.send('scene', groupId, sceneId, 'rename', name);
        }
    });
    lazySave(() => {
		const triggers = clone(sceneState.triggers);
        return function() {
            api.send('scene', groupId, sceneId, 'setTriggers', triggers);
        }
    });
}

// Time range editor component - takes a trigger object and which field to edit
function drawTimeEditor(text: string, trigger: Trigger, field: 'startTime' | 'endTime'): void {
	const timeStr = trigger[field]!;
	const parsedTime = parseTime(timeStr) || {hour: 0, minute: 0, type: 'wall' as const};
	const timeState = proxy(parsedTime);
	
	// Rebuild time string whenever component changes
	$(() => {
		const newTimeStr = formatTime(timeState);
		trigger[field] = newTimeStr;
	});
	
	$('div display:flex align-items:center gap:$2', () => {
		$('label flex:1 text-align:right text=', text+" ")
		// $('input width:4em type=number min=0 max=23 bind=', ref(timeState, 'hour'));
		$('select bind=', ref(timeState, 'hour'), () => {
			for (let h = 0; h < 24; h++) {
				$('option value=', h, '#', h.toString().padStart(2, '0'));
			}
		})
		$('b# : ');
		// $('input width:4em type=number min=0 max=59 value=', unproxy(timeState).minute.toString().padStart(2, '0'), 'input=', (event: any) => timeState.minute = parseInt(event.target.value));
		$('select bind=', ref(timeState, 'minute'), () => {
			for (let m = 0; m < 60; m+=5) {
				$('option value=', m, '#', m.toString().padStart(2, '0'));
			}
		});
		$('select bind=', ref(timeState, 'type'), () => {
			$('option value=wall #wall time');
			$('option value=br #before sunrise');
			$('option value=ar #after sunrise');
			$('option value=bs #before sunset');
			$('option value=as #after sunset');
		});
	});
}
