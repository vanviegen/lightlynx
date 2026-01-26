import { $, insertCss, onEach } from 'aberdeen';

// Toast styles
const toastsStyle = insertCss('position:fixed bottom:$4 left:50% transform:translateX(-50%) z-index:1000 display:flex flex-direction:column gap:$2 pointer-events:none w:100% max-width:400px p: 0 $3;');

const toastStyle = insertCss({
	'&': 'bg:#333 fg:white p: $2 $4; r:8px box-shadow: 0 4px 12px rgba(0,0,0,0.5); font-size:0.875rem text-align:center border-left: 4px solid $primary; animation: toast-in 0.3s ease-out;',
	'&.error': 'border-left-color:$danger',
	'&.warning': 'border-left-color:$warning',
	'&.info': 'border-left-color:$info',
	'@keyframes toast-in': {
		from: 'transform:translateY(100%) opacity:0',
		to: 'transform:translateY(0) opacity:1'
	}
});

export interface Toast {
    id: number;
    type: 'error' | 'info' | 'warning';
    message: string;
}

export function drawToasts(toasts: Toast[]): void {
    $('div', toastsStyle, () => {
        onEach(toasts, (toast: Toast) => {
            $('div', toastStyle, `.${toast.type}#${toast.message}`);
        });
    });
}
