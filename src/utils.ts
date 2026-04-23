// These function may be good candidates for inclusion in Aberdeen itself?

import A from "aberdeen";

export function isEqual(a: any, b: any): boolean {
    const result = A.proxy(false);
    A(() => {
        result.value = (A.unproxy(a)===a ? a : a.value) === (A.unproxy(b)===b ? b : b.value);
    });
    return result.value;
}

export function runDelayed(delay: number, callback: () => void): void {
    const timeoutId = setTimeout(callback, delay);
    A.clean(() => clearTimeout(timeoutId));
}

export function preventFormNavigation(): void {
    document.addEventListener('submit', (e: Event) => {
        e.preventDefault();
    }, true);
}
