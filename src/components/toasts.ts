import { $, proxy, insertCss, onEach } from 'aberdeen';
import { grow, shrink } from 'aberdeen/transitions';

const TOAST_TIME = 7;

const toasts = proxy({} as Record<number,Toast>);
let toastCount = 0;

export function createToast(type: 'error' | 'info' | 'warning', message: string, channel?: string): void {
    // If channel specified, remove any existing toast on that channel
    if (channel) {
        for (const [index, toast] of Object.entries(toasts)) {
            if (toast.channel === channel) {
                delete toasts[parseInt(index)];
            }
        }
    }
    
    const id = Math.random();
    const index = toastCount++;
    toasts[index] = { id, type, message, channel };
    setTimeout(() => {
        delete toasts[index];
    }, TOAST_TIME * 1000);
}

// Toast styles
const toastsStyle = insertCss({
    '&': 'position:fixed bottom:$4 left:50% transform:translateX(-50%) z-index:1000 display:flex flex-direction:column gap:$2 pointer-events:none w:100% max-width:400px p: 0 $3;',
    '> div': {
        '&': 'bg:#333 fg:white position:relative p: $2 $4; r:8px border-bottom-left-radius:0 border-bottom-right-radius:0 box-shadow: 0 4px 12px rgba(0,0,0,0.5); font-size:0.875rem text-align:center transition: transform 0.3s ease-out, opacity 0.3s ease-out; pointer-events:none',
        
        '&.error': 'fg:$danger',
        '&.warning': 'fg:$warning',
        '&.info': 'fg:$info',
        
        '&:before': `content: ""; position:absolute bottom:0 left:0 width:100% h:4px r:8px -top:2px transition: width ${TOAST_TIME}s linear; bg:$primary`,
        '&.hidden:before': 'width:0%',

        '&.error:before': 'bg:$danger',
        '&.warning:before': 'bg:$warning',
        '&.info:before': 'bg:$info',
    },
});

export interface Toast {
    id: number;
    type: 'error' | 'info' | 'warning';
    message: string;
    channel?: string;
}

export function drawToasts(): void {
    $('div', toastsStyle, () => {
        onEach(toasts, (toast: Toast) => {
            $(`div create=hidden create=`, grow, `destroy=`, shrink, ` .${toast.type} #${toast.message}`);
        });
    });
}
