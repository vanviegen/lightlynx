// These function may be good candidates for inclusion in Aberdeen itself?

import { $, clean, proxy, unproxy } from "aberdeen";

export function isEqual(a: any, b: any): boolean {
    const result = proxy(false);
    $(() => {
        result.value = (unproxy(a)===a ? a : a.value) === (unproxy(b)===b ? b : b.value);
    });
    return result.value;
}

export function runDelayed(delay: number, callback: () => void): void {
    const timeoutId = setTimeout(callback, delay);
    clean(() => clearTimeout(timeoutId));
}
