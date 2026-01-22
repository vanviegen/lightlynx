import { insertGlobalCss, cssVars, setSpacingCssVars } from 'aberdeen';

// Initialize spacing scale (1rem = 16px by default)
setSpacingCssVars();

// Dark mode colors only - no light mode support
cssVars.primary = '#f4810e';
cssVars.primaryHover = '#ff9020';
cssVars.primaryLight = '#ffb060';
cssVars.primaryDark = '#d6690c';

cssVars.bg = '#0a0a0a';
cssVars.surface = '#161616';
cssVars.surfaceLight = '#1f1f1f';
cssVars.surfaceHover = '#252525';

cssVars.text = '#e8e8e8';
cssVars.textMuted = '#999999';
cssVars.textLight = '#cccccc';

cssVars.border = '#2a2a2a';
cssVars.borderLight = '#1f1f1f';

cssVars.danger = '#ff4444';
cssVars.dangerHover = '#ff6666';
cssVars.warning = '#ffaa00';
cssVars.success = '#00dd88';
cssVars.info = '#4a9eff';

// Minimal global CSS - foundational styles only
insertGlobalCss({
    // CSS Reset (Josh Comeau's minimal reset)
    '*': {
        boxSizing: 'border-box',
    },
    'html, body': {
        h: '100%',
        m: 0,
        p: 0,
    },
    body: {
        lineHeight: 1.5,
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        WebkitTapHighlightColor: 'transparent',
        
        // Base colors
        bg: '$bg',
        color: '$text',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        fontSize: '16px',
    },
    
    // Typography
    'h1, h2, h3, h4, h5, h6, p': {
        m: 0,
        overflowWrap: 'break-word',
    },
    h1: {
        fontSize: '1.5rem',
        fontWeight: 600,
        lineHeight: 1.2,
    },
    h2: {
        fontSize: '1.25rem',
        fontWeight: 500,
        lineHeight: 1.3,
    },
    h3: {
        fontSize: '1.125rem',
        fontWeight: 500,
    },
    
    // Links
    a: {
        color: '$primary',
        textDecoration: 'none',
        cursor: 'pointer',
        '&:hover': {
            color: '$primaryHover',
            textDecoration: 'underline',
        },
        '&:visited': {
            color: '$primaryDark',
        },
    },
    
    // Media defaults
    'img, picture, video, canvas': {
        display: 'block',
        maxWidth: '100%',
    },
    
    // Form elements baseline
    'input, textarea, button, select': {
        font: 'inherit',
        color: 'inherit',
        m: 0,
    },
    
    'input, textarea, select': {
        p: '$2',
        borderRadius: '4px',
        border: '2px solid $border',
        bg: '$surface',
        color: '$text',
        outline: 'none',
        transition: 'border-color 0.2s',
        '&:focus': {
            borderColor: '$primary',
        },
        '&:disabled': {
            opacity: 0.5,
            cursor: 'not-allowed',
        },
    },
    
    // Standard buttons
    button: {
        p: '$2 $3',
        borderRadius: '4px',
        border: 'none',
        bg: '$primary',
        color: '#000000',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'background-color 0.2s, transform 0.1s',
        '&:hover': {
            bg: '$primaryHover',
        },
        '&:active': {
            transform: 'scale(0.98)',
        },
        '&:disabled': {
            opacity: 0.5,
            cursor: 'not-allowed',
            pointerEvents: 'none',
        },
    },
    
    // Checkbox styling
    'input[type="checkbox"]': {
        appearance: 'none',
        w: '20px',
        h: '20px',
        minWidth: '20px',
        border: '2px solid $primary',
        borderRadius: '3px',
        bg: 'transparent',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background-color 0.2s',
        '&:checked': {
            bg: '$primary',
            '&::after': {
                content: '""',
                position: 'absolute',
                left: '4px',
                top: '1px',
                w: '4px',
                h: '8px',
                border: 'solid #000',
                borderWidth: '0 2px 2px 0',
                transform: 'rotate(45deg)',
            },
        },
    },
    
    // Labels
    label: {
        cursor: 'pointer',
        userSelect: 'none',
    },
    
    // Utility classes for common states
    '.busy': {
        pointerEvents: 'none',
        opacity: 0.5,
        filter: 'grayscale(0.5)',
    },
    
    '.disabled': {
        opacity: 0.5,
        pointerEvents: 'none',
    },
    
    '.muted': {
        color: '$textMuted',
        fontSize: '0.875rem',
    },
    
    '.warning': {
        color: '$warning',
    },
    
    '.danger, .critical': {
        color: '$danger',
    },
    
    '.success': {
        color: '$success',
    },
    
    // Scrollbar hiding (for specific containers)
    '.hide-scrollbar': {
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        '&::-webkit-scrollbar': {
            display: 'none',
        },
    },
    
    // List and item styles
    '.list': {
        display: 'flex',
        flexDirection: 'column',
        gap: '$2',
    },
    
    '.item': {
        display: 'flex',
        alignItems: 'center',
        gap: '$3',
        p: '$3',
        bg: '$surface',
        border: '1px solid $border',
        borderRadius: '8px',
        minHeight: '3rem',
        
        '&.link': {
            cursor: 'pointer',
            transition: 'background-color 0.2s, transform 0.1s',
            '&:hover': {
                bg: '$surfaceHover',
            },
            '&:active': {
                transform: 'scale(0.99)',
            },
        },
        
        '&.active-scene': {
            bg: 'rgba(244, 129, 14, 0.15)',
            borderLeft: '4px solid $primary',
            pl: 'calc($3 - 4px)',
        },
        
        'h2': {
            fontSize: '1rem',
            fontWeight: 500,
            flex: '1 0 auto',
            m: 0,
        },
        
        '.icon': {
            flex: 'none',
            w: '24px',
            h: '24px',
            
            '&:first-child': {
                w: '28px',
                h: '28px',
            },
        },
        
        'input[type="checkbox"]': {
            flex: 'none',
            m: 0,
        },
    },
});
