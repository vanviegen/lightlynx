import { $, insertCss, onEach } from 'aberdeen';

// Toast styles
const toastsStyle = insertCss({
    '&': 'position:fixed bottom:$4 left:50% transform:translateX(-50%) z-index:1000 display:flex flex-direction:column gap:$2 pointer-events:none w:100% max-width:400px p: 0 $3;',
    '> div': {
        '&': 'bg:#333 fg:white position:relative p: $2 $4; r:8px border-bottom-left-radius:0 border-bottom-right-radius:0 box-shadow: 0 4px 12px rgba(0,0,0,0.5); font-size:0.875rem text-align:center transition: transform 0.3s ease-out, opacity 0.3s ease-out; pointer-events:none',
        '&.hidden': 'opacity:0 transform:translateY(100%)',
        
        '&.error': 'fg:$danger',
        '&.warning': 'fg:$warning',
        '&.info': 'fg:$info',
        
        '&:before': 'content: ""; position:absolute bottom:0 left:0 width:100% h:4px r:8px -top:2px transition: width 10s linear; bg:$primary',
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
}

export function drawToasts(toasts: Toast[]): void {
    $('div', toastsStyle, () => {
        onEach(toasts, (toast: Toast) => {
            $(`div create=hidden destroy=hidden .${toast.type} #${toast.message}`);
        });
    });
}
