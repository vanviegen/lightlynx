import { $, proxy, insertCss } from 'aberdeen';
import * as route from 'aberdeen/route';
import { routeState } from '../ui';

const dialogResolvers: Record<number, (value: any) => void> = {};
const dialogContents: Record<number, () => void> = {};

function askDialog(type: 'confirm' | 'prompt' | 'info', message: string, options: {defaultValue?: string, title?: string, content?: () => void} = {}): Promise<any> {
    const resolveId = 0 | (Math.random() * 1000000);
    const result = new Promise(resolve => {
        dialogResolvers[resolveId] = resolve;
        if (options.content) dialogContents[resolveId] = options.content;
        route.push({state: {prompt: {type, message, resolveId, value: options.defaultValue, title: options.title, hasContent: !!options.content}}});
    });
    // Remove resolver after dialog closes to avoid leaks
    result.finally(() => { 
        delete dialogResolvers[resolveId];
        delete dialogContents[resolveId];
    });
    return result as any;
}

export async function askConfirm(message: string, title?: string): Promise<boolean | undefined> {
    return askDialog('confirm', message, {title});
}

export async function askPrompt(message: string, defaultValue = '', title?: string): Promise<string | undefined> {
    return askDialog('prompt', message, {defaultValue, title});
}

export async function showInfo(title: string, content: () => void): Promise<void> {
    return askDialog('info', '', {title, content});
}

const backdropClass = insertCss({
    "&": "position:fixed top:0 left:0 width:100vw height:100vh background-color:rgba(0,0,0,0.5) display:flex align-items:center justify-content:center z-index:1000 transition: opacity 0.3s ease-out, visibility 0.3s ease-out;",
    "&.hidden": "opacity:0 pointer-events:none visibility:hidden",
    form: "background-color:$surface p:$3 r:8px min-width:300px max-width:90vw box-shadow: 0 4px 12px rgba(0,0,0,0.3) display:flex flex-direction:column gap:$2",
});

export function drawPromptPage(state: {resolveId: number, type: string, message: string, title?: string, value?: string, hasContent?: boolean}): void {
    
    let resolve = dialogResolvers[state.resolveId];
    if (!resolve) return route.back('/');
    
    const content = dialogContents[state.resolveId];
    
    // Hide main content from the accessibility tree while dialog is visible
    const mains = Array.from(document.querySelectorAll('main')) as HTMLElement[];
    mains.forEach(m => m.setAttribute('aria-hidden', 'true'));

    const isConfirm = state.type === 'confirm';
    const isInfo = state.type === 'info';
    routeState.title = state.title || (isConfirm ? 'Confirm' : isInfo ? 'Info' : 'Question');
    const value = proxy(state.value || '');

    function cleanupAndResolve(result: any) {
        if (!resolve) return;
        mains.forEach(m => m.removeAttribute('aria-hidden'));
        resolve(result);
        route.back();
    }

    $('div', backdropClass, 'create=hidden destroy=hidden click=', () => cleanupAndResolve(undefined), () => {
        $('form click=', (e: Event) => e.stopPropagation(), () => {
            if (state.message) {
                $('p font-size:1.2em #', state.message);
            }
            
            $(() => {
                if (isInfo && content) {
                    $('div line-height:1.6 fg:$textLight', content);
                } else if (!isConfirm && !isInfo) {
                    const el = $('input type=text w:100% bind=', value, 'keydown=', (e: KeyboardEvent) => {
                        if (e.key === 'Enter') {
                            cleanupAndResolve(value.value);
                        }
                    });
                    setTimeout(() => (el as HTMLElement).focus(), 100);
                }
            });

            $('div.button-row gap:1em', () => {
                if (isInfo) {
                    $('button.primary w:100% #Got it', 'click=', () => cleanupAndResolve(undefined));
                } else if (isConfirm) {
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
