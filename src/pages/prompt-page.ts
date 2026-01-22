import { $, proxy } from 'aberdeen';
import * as route from 'aberdeen/route';

interface PromptPageContext {
    routeState: { title: string };
    dialogResolvers: Record<number, (value: any) => void>;
    DEBUG_route_back: (path?: string) => void;
}

export function drawPromptPage(context: PromptPageContext): void {
    const { routeState, dialogResolvers, DEBUG_route_back } = context;
    
    const state = route.current.state;
    const resolve = dialogResolvers[state.resolveId];
    if (!resolve) return DEBUG_route_back('/');
    
    const isConfirm = state.type === 'confirm';
    routeState.title = state.title || (isConfirm ? 'Confirm' : 'Question');
    const value = proxy(state.value || '');

    $('div padding:8px display:flex flex-direction:column mt:@3 gap:@3', () => {
        $('p font-size:1.2em #', state.message);
        
        $(() => {
            if (!isConfirm) {
                $('input type=text width:100% bind=', value, 'keydown=', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                        resolve(value.value);
                        DEBUG_route_back();
                    }
                });
            }
        });

        $('div.row gap:1em', () => {
            if (isConfirm) {
                $('button.secondary flex:1 #No', 'click=', () => {
                    resolve(false);
                    DEBUG_route_back();
                });
                $('button.primary flex:1 #Yes', 'click=', () => {
                    resolve(true);
                    DEBUG_route_back();
                });
            } else {
                $('button.secondary flex:1 #Cancel', 'click=', () => {
                    resolve(undefined);
                    DEBUG_route_back();
                });
                $('button.primary flex:1 #OK', 'click=', () => {
                    resolve(value.value);
                    DEBUG_route_back();
                });
            }
        });
    });
}
