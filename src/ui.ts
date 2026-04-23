import A from 'aberdeen';
import * as route from 'aberdeen/route';
import { createToast } from './components/toasts';

export interface RouteState {
    title: string;
    subTitle: string;
    drawIcons?: () => void;
}

export const routeState = A.proxy<RouteState>({
    title: '',
    subTitle: '',
    drawIcons: undefined
});

export const manage = A.proxy(!!route.current.search.manage);

// Keep manage state in sync with URL
A(() => {
    route.current.search.manage; // subscribe to this, so we'll force-update it when it changes
    if (manage.value) route.current.search.manage = 'y';
    else delete route.current.search.manage;
});

export async function hashSecret(password: string): Promise<string> {
    if (!password) return '';

    // If it's already a 64-char hex secret, return as-is
    if (/^[0-9a-f]{64}$/i.test(password)) return password.toLowerCase();

    const saltString = "LightLynx-Salt-v2";
    const salt = new TextEncoder().encode(saltString);
    const pw = new TextEncoder().encode(password);
    
    const keyMaterial = await window.crypto.subtle.importKey("raw", pw, "PBKDF2", false, ["deriveBits"]);
    
    const derivedBits = await window.crypto.subtle.deriveBits({
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256"
    }, keyMaterial, 256);
    
    return Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function lazySave(getState: () => void | (() => void), delay: number = 1000): void {
    let timeoutId: any;
    let firstRun = true;
    A(() => {
        clearTimeout(timeoutId);
        let saveFunc = getState();
        if (firstRun) firstRun = false;
        else if (saveFunc) timeoutId = setTimeout(saveFunc, delay);
    });
}

export async function copyToClipboard(text: string, label: string = 'Text'): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        createToast('info', `${label} copied to clipboard`, 'clipboard');
    } catch (e: any) {
        createToast('error', `${label} failed to copy: ${text}`, 'clipboard');
    }
}

