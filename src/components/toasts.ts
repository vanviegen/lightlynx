import { $, insertCss, onEach } from 'aberdeen';

// Toast styles
const toastsStyle = insertCss({
    position: 'fixed',
    bottom: '$4',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    gap: '$2',
    pointerEvents: 'none',
    w: '100%',
    maxWidth: '400px',
    p: '0 $3',
});

const toastStyle = insertCss({
    bg: '#333',
    color: 'white',
    p: '$3 $4',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    fontSize: '0.875rem',
    textAlign: 'center',
    borderLeft: '4px solid $primary',
    animation: 'toast-in 0.3s ease-out',
    
    '&.error': {
        borderLeftColor: '$danger',
    },
    
    '&.warning': {
        borderLeftColor: '$warning',
    },
    
    '&.info': {
        borderLeftColor: '$info',
    },
    
    '@keyframes toast-in': {
        from: { transform: 'translateY(100%)', opacity: 0 },
        to: { transform: 'translateY(0)', opacity: 1 },
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
            $('div', toastStyle, `.${toast.type}#${toast.message}`);
        });
    });
}
