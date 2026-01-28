import { $, proxy } from 'aberdeen';
import * as route from 'aberdeen/route';
import type { Toast } from './components/toasts';

export interface RouteState {
    title: string;
    subTitle: string;
    drawIcons?: () => void;
}

export const routeState = proxy<RouteState>({
    title: '',
    subTitle: '',
    drawIcons: undefined
});

export const admin = proxy(!!route.current.search.admin);

// Keep admin state in sync with URL
$(() => {
    route.current.search.admin; // subscribe to this, so we'll force-update it when it changes
    if (admin.value) route.current.search.admin = 'y';
    else delete route.current.search.admin;
});

export const toasts = proxy([] as Toast[]);

export function notify(type: 'error' | 'info' | 'warning', message: string): void {
    const id = Math.random();
    toasts.push({ id, type, message });
    setTimeout(() => {
        const index = toasts.findIndex(t => t.id === id);
        if (index !== -1) toasts.splice(index, 1);
    }, 10000);
}

export const dialogResolvers: Record<number, (value: any) => void> = {};

function askDialog(type: 'confirm' | 'prompt', message: string, options: {defaultValue?: string, title?: string} = {}): Promise<any> {
    const resolveId = 0 | (Math.random() * 1000000);
    const result = new Promise(resolve => {
        dialogResolvers[resolveId] = resolve;
        route.push({state: {prompt: {type, message, resolveId, value: options.defaultValue, title: options.title}}});
    });
    delete dialogResolvers[resolveId];
    return result as any;
}

export async function askConfirm(message: string, title?: string): Promise<boolean> {
    return askDialog('confirm', message, {title});
}

export async function askPrompt(message: string, defaultValue = '', title?: string): Promise<string | undefined> {
    return askDialog('prompt', message, {defaultValue, title});
}

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
    $(() => {
        clearTimeout(timeoutId);
        let saveFunc = getState();
        if (firstRun) firstRun = false;
        else if (saveFunc) timeoutId = setTimeout(saveFunc, delay);
    });
}

