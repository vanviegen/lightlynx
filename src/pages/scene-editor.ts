import { $, proxy, ref, onEach, isEmpty, unproxy, peek, insertCss, map, copy } from 'aberdeen';
import { grow, shrink } from 'aberdeen/transitions';
import * as route from 'aberdeen/route';
import api from '../api';
import * as icons from '../icons';
import { Group } from '../types';
import { routeState, admin, askConfirm, lazySave, drawEmpty } from '../ui';

export interface TriggerItem {
    type: '1' | '2' | '3' | '4' | '5' | 'motion' | 'time';
    startTime?: Time;
    endTime?: Time;
}

export interface Time {
    hour: number;
    minute: number;
    type: 'wall' | 'bs' | 'as' | 'br' | 'ar';
}

export interface GroupTimeout {
    value: number;
    unit: TimeUnit;
}

export type TimeUnit = 's' | 'm' | 'h' | 'd';

// Parse scene automation from suffix  
export function parseSceneTriggers(suffix: string): TriggerItem[] {
    const triggers: TriggerItem[] = [];

    const parts = suffix.split(',').map(s => s.trim());
    
    for (const part of parts) {
        const match = part.match(/^\s*([0-9a-z]+)(?:\s+([^)-]*?)-([^)-]*))?\s*$/);
        if (!match) {
            if (part.length) console.error(`Unrecognized trigger spec: "${part}"`);
            continue;
        }
        
        let [, triggerPart, startTime, endTime] = match as [unknown, string, string?, string?];

        if (triggerPart == 'sensor') triggerPart = 'motion'; // legacy support

        if (!['motion', 'time', '1', '2', '3', '4', '5'].includes(triggerPart)) {
            console.error(`Unrecognized trigger type: "${triggerPart}"`);
            continue;
        }
        
        // Handle motion sensor
        const trigger: TriggerItem = {type: triggerPart as any};
        
        if (startTime && endTime) {
            trigger.startTime = parseTime(startTime);
            trigger.endTime = parseTime(endTime);
        }
            
        triggers.push(trigger);
    }
    
    return triggers;
}

// Parse individual time
function parseTime(timeStr: string): Time | undefined {
    const sunMatch = timeStr.match(/^(\d{1,2})(?::(\d{2}))?((b|a)(s|r))?$/);
    if (!sunMatch) {
        console.error(`Unrecognized time format: "${timeStr}"`);
        return;
    }
    const hour = parseInt(sunMatch[1]!);
    const minute = sunMatch[2] ? parseInt(sunMatch[2]) : 0;
    const type = (sunMatch[3] || 'wall') as any;
    if (!['wall', 'bs', 'as', 'br', 'ar'].includes(type)) {
        console.error(`Unrecognized time type in: "${timeStr}"`);
        return;
    }
    return { hour, minute, type };
}

// Format time back to string
function formatTime({hour, minute, type}: Time): string {
    if (type === 'wall') {
        return minute === 0 ? hour.toString() : `${hour}:${minute.toString().padStart(2, '0')}`;
    } else {
        const minuteStr = minute === 0 ? '' : `:${minute.toString().padStart(2, '0')}`;
        return `${hour}${minuteStr}${type}`;
    }
}

// Parse group timeout from suffix
export function parseGroupTimeout(suffix: string): GroupTimeout | null {
    if (!suffix) return null;
    
    const match = suffix.match(/^(\d+(?:\.\d+)?)([smhd])$/);
    if (!match || !match[1] || !match[2]) return null;
    
    return {
        value: parseFloat(match[1]),
        unit: match[2] as TimeUnit
    };
}

// Build group timeout suffix
export function buildGroupTimeoutSuffix(timeout: GroupTimeout | null): string {
    if (!timeout) return '';
    return `${timeout.value}${timeout.unit}`;
}

// Draw the scene options in a grid, each at least 150px wide
const scenePresetsClass = insertCss({
    "&": "display:grid grid-template-columns:repeat(auto-fit,minmax(150px,1fr)) gap:$2 m:$3",
    ".item": "display:flex flex-direction:column align-items:center padding:$2 r:8px border:1px solid $border hover:bg:$hover cursor:pointer",
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
	const scene = group.scenes.find(s => s.id === sceneId)!;
	if (!scene) {
		return route.up();
	}

	$(() => {
		routeState.title = group.name + ' · ' + scene.shortName;
	});
	routeState.subTitle = "scene";
	routeState.drawIcons = undefined;

    const sceneState = proxy(peek(() => {
        return {
            shortName: scene.shortName,
            triggers: parseSceneTriggers(scene.suffix || '')
        };
    }));
    
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

	$('div', scenePresetsClass, () => {
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

	
	const automationEnabled = api.store.automationEnabled;
	$('h1#Triggers', () => {
		if (automationEnabled) icons.create('click=', () => sceneState.triggers.push({type: '1'}));
	});
    if (automationEnabled) {
		onEach(sceneState.triggers, (trigger, triggerIndex) => {
			$(() => {
				// There must be a time range for time-based triggers
				if (trigger.type === 'time' && !trigger.startTime) {
					trigger.startTime = {hour: 18, minute: 0, type: 'wall'};
					trigger.endTime = {hour: 22, minute: 0, type: 'wall'};
				}
			});
			$('div.item flex-direction:column', () => {
				$('div.row justify-content:space-between', () =>{
					$('select width:inherit bind=', ref(trigger, 'type'), () => {
						$('option value=1 #Single Tap');
						$('option value=2 #Double Tap');
						$('option value=3 #Triple Tap');
						$('option value=4 #Quadruple Tap');
						$('option value=5 #Quintuple Tap');
						$('option value=motion #Motion Sensor');
						$('option value=time #Time-based');
					});
					
					$(() => {
						if (trigger.type !== 'time') {
							$('label', () => {
								$('input type=checkbox', {checked: !!trigger.startTime}, 'change=', (e: Event) => {
									const target = e.target as HTMLInputElement;
									if (target.checked) {
										trigger.startTime = {hour: 0, minute: 30, type: 'bs'};
										trigger.endTime = {hour: 22, minute: 30, type: 'wall'};
									} else {
										trigger.startTime = undefined;
										trigger.endTime = undefined;
									}
								});
								$('#Time range');
							});
						}
					})

					icons.remove('click=', () => sceneState.triggers.splice(triggerIndex, 1));
				});
				$(() => {
					if (trigger.startTime && trigger.endTime) {
						$('div.scene-times', {create: grow, destroy: shrink}, () => {
							$('label#From ')
							drawTimeEditor(trigger.startTime!);
							$('label#Until ')
							drawTimeEditor(trigger.endTime!);
						})
					}
				})

			})
		});
		if (isEmpty(sceneState.triggers)) drawEmpty("None yet");
    }

	$('h1#Actions');
	async function save(e: Event): Promise<void> {
		e.stopPropagation();
		if (!await askConfirm(`Are you sure you want to overwrite the '${scene.name}' scene for group '${group.name}' with the current light state?`)) return;
		api.send(group.name, "set", {scene_store: {ID: scene.id, name: scene.name}});

		// Also store any off-states into the scene (for some reason that doesn't happen by default)
		for(let ieee of group.members) {
			if (!api.store.devices[ieee]?.lightState?.on) {
				api.send(ieee, "set", {scene_add: {ID: scene.id, group_id: groupId, name: scene.name, state: "OFF"}});
			}
		}
	}
	async function remove(e: Event): Promise<void> {
		e.stopPropagation();
		if (!await askConfirm(`Are you sure you want to delete the '${scene.name}' scene for group '${group.name}'?`)) return;
		api.send(group.name, "set", {scene_remove: scene.id});
	}
	$('div.item.link', icons.save, '#Save current state', 'click=', save);
	$('div.item.link', icons.remove, '#Delete scene', 'click=', remove);

    const newName = proxy('');
    lazySave(() => {
        const newSuffix = sceneState.triggers.map(trigger => {
            let out = trigger.type;
            // Click trigger
            if (trigger.startTime && trigger.endTime) {
                const startTime = formatTime(trigger.startTime);
                const endTime = formatTime(trigger.endTime);
                out += ` ${startTime}-${endTime}`;
            }
            return out;
        }).join(', ');

        newName.value = `${sceneState.shortName}${newSuffix ? ` (${newSuffix})` : ''}`;
        return function() {
            api.send(group.name, "set", {scene_rename: {ID: scene.id, name: newName.value}});
        }
    });

    $('div font-size:85% m:$3 text-align:center font-style:italic #', newName);
}

// Time range editor component
function drawTimeEditor(range: Time): void {
    // Start time
	$('input.hour type=number min=0 max=23 bind=', ref(range, 'hour'));
	$('b# : ');
	$('input.minute type=number min=0 max=59 value=', unproxy(range).minute.toString().padStart(2, '0'), 'input=', (event: any) => range.minute = parseInt(event.target.value));
	$('select.time-type bind=', ref(range, 'type'), () => {
		$('option value=wall #wall time');
		$('option value=br #before sunrise');
		$('option value=ar #after sunrise');
		$('option value=bs #before sunset');
		$('option value=as #after sunset');
	});
}
