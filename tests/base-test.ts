/**
 * LightLynx test helpers — re-exports shoTest + project-specific utilities.
 */

import { type Page } from 'shotest';

export { test, expect, screenshot, type Page } from 'shotest';

export async function connectToMockServer(page: Page, options: { manage?: boolean; userName?: string; password?: string } = {}, reset: boolean = true): Promise<void> {
    if (reset) fetch('http://localhost:43598/reset', { method: 'POST' }).catch(() => {});

    const { manage = true, userName = 'admin', password = '' } = options;
    const manageParam = manage ? '&manage=y' : '';
    const passwordParam = password ? `&secret=${encodeURIComponent(password)}` : '';
    await page.goto(`/?instanceId=localhost:43598&userName=${encodeURIComponent(userName)}${passwordParam}${manageParam}`);
}

export async function hashPassword(page: Page, password: string): Promise<string> {
    return page.evaluate(async (password: string) => {
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
    }, password);
}