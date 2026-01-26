import { $, proxy } from 'aberdeen';
import * as route from 'aberdeen/route';

interface PromptPageContext {
    routeState: { title: string };
    dialogResolvers: Record<number, (value: any) => void>;
}

export function drawPromptPage(context: PromptPageContext): void {
    const { routeState, dialogResolvers } = context;
    
    const state = route.current.state;
    const resolve = dialogResolvers[state.resolveId];
    if (!resolve) return route.back('/');
    
    const isConfirm = state.type === 'confirm';
    routeState.title = state.title || (isConfirm ? 'Confirm' : 'Question');
    const value = proxy(state.value || '');

    $('div p:8px display:flex flex-direction:column mt:$3 gap:$3', () => {
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
                $('button.secondary flex:1 #No', 'click=', () => {
                    resolve(false);
                    route.back();
                });
                $('button.primary flex:1 #Yes', 'click=', () => {
                    resolve(true);
                    route.back();
                });
            } else {
                $('button.secondary flex:1 #Cancel', 'click=', () => {
                    resolve(undefined);
                    route.back();
                });
                $('button.primary flex:1 #OK', 'click=', () => {
                    resolve(value.value);
                    route.back();
                });
            }
        });
    });
}
