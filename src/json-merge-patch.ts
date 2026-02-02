/** Recursively strips underscore-prefixed keys (preserves required/optional) */
export type StripUnderscores<T> =
    T extends any[] ? StripUnderscores<T[number]>[] :
    T extends object ? { [K in keyof T as K extends `_${string}` ? never : K]: StripUnderscores<T[K]> } : T;

/** Delta type: all keys optional, values can be null for deletion. Merges keys from both types. */
export type DeltaOf<TCurrent extends object, TOld extends object = TCurrent> = {
    [K in Exclude<keyof TCurrent | keyof TOld, `_${string}`>]?: 
        K extends keyof TCurrent 
            ? TCurrent[K] extends any[] ? TCurrent[K] | null 
            : Extract<TCurrent[K], object> extends never ? TCurrent[K] | null
            : DeltaOf<Extract<TCurrent[K], object>, K extends keyof TOld ? Extract<TOld[K], object> : Extract<TCurrent[K], object>> | null 
        : null;  // Key only in old: can only be null (deletion)
};

/** Deep clones an object, stripping underscore-prefixed keys. */
export function deepClone<T extends object>(obj: T): StripUnderscores<T>;
export function deepClone<T extends string | number | boolean | null | undefined>(obj: T): T;
export function deepClone(obj: unknown): unknown {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(deepClone);
    const result: Record<string, unknown> = {};
    for (const key in obj) {
        if (key[0] !== '_') result[key] = deepClone((obj as any)[key]);
    }
    return result;
}

function deepCompare(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        if (a.length !== (b as any[]).length) return false;
        return a.every((v, i) => deepCompare(v, (b as any[])[i]));
    }
    for (const key in a) {
        if (key[0] !== '_' && !deepCompare((a as any)[key], (b as any)[key])) return false;
    }
    for (const key in b) {
        if (key[0] !== '_' && !(key in a)) return false;
    }
    return true;
}

/** Creates a JSON merge patch (RFC 7386) between two objects. Skips underscore keys. */
export function createDelta<TCurrent extends object, TOld extends object>(current: TCurrent, old: TOld): DeltaOf<TCurrent, TOld> {
    const result: Record<string, unknown> = {};
    for (const key in current) {
        if (key[0] === '_') continue;
        const delta = deltaRecurse((current as any)[key], (old as any)[key]);
        if (delta !== undefined) result[key] = delta;
    }
    for (const key in old) {
        if (key[0] !== '_' && !(key in current)) result[key] = null;
    }
    return result as DeltaOf<TCurrent, TOld>;
}

function deltaRecurse(current: unknown, old: unknown): unknown {
    if (current === old) return undefined;
    if (current == null) return null;
    if (typeof current !== 'object' || typeof old !== 'object' || old === null) return current;
    if (Array.isArray(current) || Array.isArray(old)) {
        return deepCompare(current, old) ? undefined : current;
    }
    let result: Record<string, unknown> | undefined;
    for (const key in current) {
        if (key[0] === '_') continue;
        const delta = deltaRecurse((current as any)[key], (old as any)[key]);
        if (delta !== undefined) (result ??= {})[key] = delta;
    }
    for (const key in old) {
        if (key[0] !== '_' && !(key in current)) (result ??= {})[key] = null;
    }
    return result;
}

/** Applies a JSON merge patch (RFC 7386) to target in-place. */
export function applyDelta<T extends object>(target: T, delta: DeltaOf<T>): void {
    for (const key in delta) {
        if (key[0] === '_') continue;
        const val = (delta as any)[key];
        if (val === null) delete (target as any)[key];
        else if (typeof val !== 'object' || Array.isArray(val)) (target as any)[key] = val;
        else {
            if (typeof (target as any)[key] !== 'object' || (target as any)[key] === null) (target as any)[key] = {};
            applyDelta((target as any)[key], val);
        }
    }
}
