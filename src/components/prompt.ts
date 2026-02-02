import { $, proxy, insertCss } from 'aberdeen';
import * as route from 'aberdeen/route';
import { routeState } from '../ui';

const dialogResolvers: Record<number, (value: any) => void> = {};

function askDialog(type: 'confirm' | 'prompt', message: string, options: {defaultValue?: string, title?: string} = {}): Promise<any> {
    const resolveId = 0 | (Math.random() * 1000000);
    const result = new Promise(resolve => {
        dialogResolvers[resolveId] = resolve;
        route.push({state: {prompt: {type, message, resolveId, value: options.defaultValue, title: options.title}}});
    });
    // Remove resolver after dialog closes to avoid leaks
    result.finally(() => { delete dialogResolvers[resolveId]; });
    return result as any;
}

export async function askConfirm(message: string, title?: string): Promise<boolean | undefined> {
    return askDialog('confirm', message, {title});
}

export async function askPrompt(message: string, defaultValue = '', title?: string): Promise<string | undefined> {
    return askDialog('prompt', message, {defaultValue, title});
}

const backdropClass = insertCss({
    "&": "position:fixed top:0 left:0 width:100vw height:100vh background-color:rgba(0,0,0,0.5) display:flex align-items:center justify-content:center z-index:1000 transition: opacity 0.3s ease-out, visibility 0.3s ease-out;",
    "&.hidden": "opacity:0 pointer-events:none visibility:hidden",
    form: "background-color:$surface p:$3 r:8px min-width:300px max-width:90vw box-shadow: 0 4px 12px rgba(0,0,0,0.3) display:flex flex-direction:column gap:$2",
});

export function drawPromptPage(state: {resolveId: number, type: string, message: string, title?: string, value?: string}): void {
    
    let resolve = dialogResolvers[state.resolveId];
    if (!resolve) return route.back('/');
    
    // Hide main content from the accessibility tree while dialog is visible
    const mains = Array.from(document.querySelectorAll('main')) as HTMLElement[];
    mains.forEach(m => m.setAttribute('aria-hidden', 'true'));

    const isConfirm = state.type === 'confirm';
    routeState.title = state.title || (isConfirm ? 'Confirm' : 'Question');
    const value = proxy(state.value || '');

    function cleanupAndResolve(result: any) {
        if (!resolve) return;
        mains.forEach(m => m.removeAttribute('aria-hidden'));
        resolve(result);
        route.back();
    }

    $('div', backdropClass, 'create=hidden destroy=hidden click=', () => cleanupAndResolve(undefined), () => {
        $('form click=', (e: Event) => e.stopPropagation(), () => {
            $('p font-size:1.2em #', state.message);
            
            $(() => {
                if (!isConfirm) {
                    $('input type=text w:100% bind=', value, 'keydown=', (e: KeyboardEvent) => {
                        if (e.key === 'Enter') {
                            cleanupAndResolve(value.value);
                        }
                    });
                }
            });

            $('div.button-row gap:1em', () => {
                if (isConfirm) {
                    $('button.secondary #No', 'click=', () => cleanupAndResolve(false));
                    $('button.primary #Yes', 'click=', () => cleanupAndResolve(true));
                } else {
                    $('button.secondary #Cancel', 'click=', () => cleanupAndResolve(undefined));
                    $('button.primary #OK', 'click=', () => cleanupAndResolve(value.value));
                }
            });
        });
    });
}
