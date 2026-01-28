import { $, proxy, insertCss } from 'aberdeen';
import * as route from 'aberdeen/route';
import { routeState, dialogResolvers } from '../ui';

const backdropClass = insertCss({
    "&": "position:fixed top:0 left:0 width:100vw height:100vh background-color:rgba(0,0,0,0.5) display:flex align-items:center justify-content:center z-index:1000",
    form: "background-color:$surface p:$3 r:8px min-width:300px max-width:90vw box-shadow: 0 4px 12px rgba(0,0,0,0.3) display:flex flex-direction:column gap:$2",
});

export function drawPromptPage(state: {resolveId: number, type: string, message: string, title?: string, value?: string}): void {
    
    const resolve = dialogResolvers[state.resolveId];
    if (!resolve) return route.back('/');
    
    const isConfirm = state.type === 'confirm';
    routeState.title = state.title || (isConfirm ? 'Confirm' : 'Question');
    const value = proxy(state.value || '');

    $('div', backdropClass, 'click=', () => {
        $('form', () => {
            $('p font-size:1.2em #', state.message);
            
            $(() => {
                if (!isConfirm) {
                    $('input type=text w:100% bind=', value, 'keydown=', (e: KeyboardEvent) => {
                        if (e.key === 'Enter') {
                            resolve(value.value);
                            route.back();
                        }
                    });
                }
            });

            $('div.row gap:1em', () => {
                if (isConfirm) {
                    $('button.secondary #No', 'click=', () => {
                        resolve(false);
                        route.back();
                    });
                    $('button.primary #Yes', 'click=', () => {
                        resolve(true);
                        route.back();
                    });
                } else {
                    $('button.secondary #Cancel', 'click=', () => {
                        resolve(undefined);
                        route.back();
                    });
                    $('button.primary #OK', 'click=', () => {
                        resolve(value.value);
                        route.back();
                    });
                }
            });
        });
    });
}
