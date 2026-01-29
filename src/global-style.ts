import { $, insertCss, insertGlobalCss, cssVars, setSpacingCssVars } from 'aberdeen';

// Slightly smaller spacing than default, for more density!
setSpacingCssVars(0.85);

const interactingElements = new Set<Element>();

/**
 * CSS :hover is a b**ch on touch device, as the hover will stick until another touch event.
 * So, we're not using :hover, but instead adding/removing an 'interacting' class on elements
 * that have either mouseover or an active touch that started on the element or one of its
 * descendants. So basically, you should use '.interacting' in your CSS instead of ':hover' and
 * ':active'.
 */

$(`mouseover=`, (e: Event) => {
	if (e.target instanceof Element) {
		e.target.classList.add('interacting');
		interactingElements.add(e.target);
	}
}, {passive:true, capture:true});

$('mouseout=', (e: Event) => {
	if (e.target instanceof Element) {
		e.target.classList.remove('interacting');
		interactingElements.delete(e.target);
	}
}, {passive:true, capture:true});

$('touchstart=', (e: Event) => {
    for(let el = e.target; el instanceof Element; el = el.parentElement) {
        el.classList.add('interacting');
        interactingElements.add(el);
    }
}, {passive:true, capture:true});

['touchend', 'touchcancel'].forEach(eventType => $(`${eventType}=`, () => {
	interactingElements.forEach(e => e.classList.remove('interacting'));
	interactingElements.clear();
}, {passive:true, capture:true}));


// Dark mode colors only - no light mode support
cssVars.primary = '#f4810e';
cssVars.primaryLight = '#ffb060';
cssVars.primaryHover = cssVars.primaryLight;
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
cssVars.info = cssVars.text; // '#4a9eff';
cssVars.link = cssVars.primary;

insertGlobalCss({
    // CSS Reset (Josh Comeau's minimal reset)
    '*': 'box-sizing:border-box',
    'html, body': 'h:100% m:0 p:0',
    body: 'line-height:1.5 -webkit-font-smoothing:antialiased -moz-osx-font-smoothing:grayscale user-select:none -webkit-user-select:none -webkit-touch-callout:none -webkit-tap-highlight-color:transparent bg:$bg fg:$text font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size:16px',
    
    // Typography
    'h1, h2, h3, h4, h5, h6, p': {
        '&': 'm:0 overflow-wrap:break-word',
        '.icon': 'fg:$text',
    },
    
    h1: 'font-size:1.125rem font-weight:600 line-height:1.2 mt:$4 mb:$2 text-transform:uppercase letter-spacing:0.05em fg:$textMuted',
    h2: 'font-size:1.25rem font-weight:500 line-height:1.3',
    h3: 'font-size:1.125rem font-weight:500',
    
    // Links
    a: {
        '&': 'fg:$link text-decoration:none cursor:pointer',
        '&.interacting': 'fg:$primaryHover text-decoration:underline',
        '&:visited': 'fg:$primaryDark'
    },

    // Media defaults
    'img, picture, video, canvas': 'display:block max-width:100%',
    
    // Form elements baseline
    'input, textarea, button, select': 'font:inherit bg:$bg fg:$text m:0',
    
    'input, textarea, select': {
        '&': 'p:$2 r:4px border: 2px solid $border; bg:$surface fg:$text outline:none transition:border-color',
        '&:focus': 'border-color:$primary',
        '&:disabled': 'opacity:0.5 cursor:not-allowed'
    },
    
    // Standard buttons
    button: {
        '&': 'p: $2 $3; r:4px border:none bg:$primary fg:#000 font-weight:600 cursor:pointer transition: background-color 0.2s, transform 0.1s;',
        '&.interacting': 'bg:$primaryHover',
        '&:active': 'transform:scale(0.98)',
        '&:disabled': 'opacity:0.5 cursor:not-allowed pointer-events:none'
    },
    
    // Checkbox styling
    'input[type="checkbox"]': {
        '&': 'appearance:none w:20px h:20px min-width:20px border: 2px solid $primary; r:3px bg:transparent cursor:pointer position:relative transition:background-color',
        '&:checked': {
            '&': 'bg:$primary',
            '&::after': 'content:""; position:absolute left:4px top:1px w:4px h:8px border: solid #000; border-width: 0 2px 2px 0; transform:rotate(45deg)'
        }
    },
    
    // Labels
    label: 'cursor:pointer user-select:none',
    
    // Utility classes for common states
    '.busy': 'pointer-events:none opacity:0.5 filter:grayscale(0.5)',
    '.disabled': 'opacity:0.5 pointer-events:none',
    '.muted': 'fg:$textMuted font-size:0.875rem',
    '.warning': 'fg:$warning',
    '.danger, .critical': 'fg:$danger',
    '.success': 'fg:$success',
    
    // Scrollbar hiding (for specific containers)
    '.hide-scrollbar': {
        '&': 'scrollbar-width:none -ms-overflow-style:none',
        '&::-webkit-scrollbar': 'display:none'
    },

    // List and item styles
    '.list': 'display:flex flex-direction:column gap:$2',

    '.link': {
        '&': 'cursor:pointer fg:$link',
        '&.item, svg&, .item &': 'fg:unset',
        '&.interacting, &.interacting *': 'fg: $primaryHover !important; text-shadow: 0 0 5px $primaryHover !important;',
        'svg&.interacting, &.interacting svg': 'filter: drop-shadow(0 0 5px var(--primaryHover));',
    },
    
    '.item': {
        '&': 'display:flex align-items:center gap:$3 p:$2 bg:$surface border: 1px solid $border; r:6px',
        
        '&.link': {
            '&': 'cursor:pointer transition: background-color 0.2s, transform 0.1s;',
            '&.interacting': 'bg:$surfaceHover',
            '&:active': 'transform:scale(0.99)'
		},
		
		'&.active-scene': 'bg: rgba(244, 129, 14, 0.15); border-left: 4px solid $primary; pl: calc($3 - 4px);',
		
		h2: 'font-size:1rem font-weight:500 flex: 1 0 auto; m:0',
		
		'.icon': {
			'&': 'flex:none w:24px h:24px  background-color:#0000',
			'&:first-child': 'w:28px h:28px'
		},
		'& > input': 'flex:2 min-width:2rem',
		'& > input[type="checkbox"]': 'flex:none m:0 min-width:initial'
	},

    'main > .list > .item': 'border-width: 1px 0; r:0',
	
	// Form styling
	form: {
		'&': 'display:flex flex-direction:column gap:$3 p:$3',
		'.field': {
			'&': 'display:flex flex-direction:column gap:$1',
			'label': 'fg:$textLight font-weight:500 font-size:0.875rem',
			'input, textarea, select': 'w:100%'
		},
		'.row': 'display:flex gap:$2 justify-content:flex-end'
	},
	
	'button.primary': {
		'&': 'bg:$primary fg:#000 font-weight:600',
		'&.interacting': 'bg:$primaryHover',
		'&.busy': 'opacity:0.7 pointer-events:none'
	},
	
	'button.secondary': {
		'&': 'bg:transparent fg:$link font-weight:600',
		'&.interacting': 'bg:$surfaceHover border-color:$textMuted'
	},
	
	'button.danger': {
		'&': 'bg:transparent fg:$danger font-weight:600',
		'&.interacting': 'bg: rgba(255, 68, 68, 0.1);'
	}
});

export const errorMessageStyle = insertCss({
    '&': 'fg:$danger bg:#3a1111 p:$3',
    '& > svg': 'w:24px h:24px float:left margin-right:$3 margin-bottom:$2'
});

export const infoMessageStyle = insertCss({
    '&': 'fg:$info bg:#113a5a p:$3',
    '& > svg': 'w:24px h:24px float:left margin-right:$3 margin-bottom:$2'
});
