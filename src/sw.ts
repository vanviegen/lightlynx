/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = 'lights-cache-v1';


// --- Lifecycle Events ---

sw.addEventListener('install', (event: ExtendableEvent) => {
    event.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
    event.waitUntil(sw.clients.claim());
});


// --- Fetch Event ---

sw.addEventListener('fetch', (event: FetchEvent) => {
    const url = new URL(event.request.url);
    if (event.request.method === 'GET' && url.origin === sw.location.origin) {
        event.respondWith(handleGetRequest(event));
    }
});


/**
 * Cache-first for same-origin GET requests.
 * On navigation requests, trigger a background update check.
 */
async function handleGetRequest(event: FetchEvent): Promise<Response> {
    // Normalize SPA navigation requests to / so query params don't fragment the cache
    let request = event.request;
    const isNavigation = request.mode === 'navigate';
    if (isNavigation) {
        request = new Request(new URL('/', request.url));
    }

    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);

    if (isNavigation) {
        event.waitUntil(checkForUpdates(cache));
    }

    if (cachedResponse) {
        return cachedResponse;
    }

    // Not in cache: fetch from network, cache it for next time
    try {
        const response = await fetch(request);
        if (response.status === 200) {
            await cache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('Network Error', { status: 504 });
    }
}


// --- Background Update Check ---

let updateInProgress = false;

/**
 * Checks if index.html has changed. If so, fetches files.txt and
 * pre-caches the entire new version, then purges stale entries.
 */
async function checkForUpdates(cache: Cache): Promise<void> {
    if (updateInProgress) return;
    updateInProgress = true;
    try {
        // Small delay so we don't compete with the initial page load
        await new Promise(r => setTimeout(r, 2000));

        // Conditional fetch for index.html (cached as '/')
        const cachedIndex = await cache.match('/');
        const headers = new Headers();
        if (cachedIndex) {
            const etag = cachedIndex.headers.get('ETag');
            if (etag) headers.set('If-None-Match', etag);
            const lastMod = cachedIndex.headers.get('Last-Modified');
            if (lastMod) headers.set('If-Modified-Since', lastMod);
        }

        const networkIndex = await fetch('/', { headers, cache: 'no-store' });
        if (networkIndex.status === 304) return; // Not modified
        if (networkIndex.status !== 200) return;

        // Double-check content actually changed (some servers don't support conditional requests)
        if (cachedIndex) {
            const newText = await networkIndex.clone().text();
            const oldText = await cachedIndex.text();
            if (newText === oldText) return;
        }

        // index.html changed — fetch the file manifest
        const filesResponse = await fetch('/files.txt', { cache: 'no-store' });
        if (filesResponse.status !== 200) return;

        const filesList = (await filesResponse.text()).trim().split('\n').filter(Boolean);

        // Build set of paths we want in cache (index.html is stored as '/')
        const validPaths = new Set(filesList.map(f => f === '/index.html' ? '/' : f));
        validPaths.add('/');

        // Cache index.html as '/'
        await cache.put(new Request('/'), networkIndex.clone());

        // Cache all other files (skip ones already in cache — hashed filenames don't change)
        await Promise.all(filesList.map(async (file) => {
            if (file === '/index.html') return;
            if (await cache.match(file)) return; // Already cached (hashed filename)
            try {
                const response = await fetch(file, { cache: 'no-store' });
                if (response.status === 200) {
                    await cache.put(new Request(file), response);
                }
            } catch {
                console.warn(`SW: Failed to cache ${file}`);
            }
        }));

        // Purge old entries no longer in the manifest
        const keys = await cache.keys();
        await Promise.all(keys.map(async (request) => {
            const path = new URL(request.url).pathname;
            if (!validPaths.has(path)) {
                await cache.delete(request);
            }
        }));

        console.log('SW: Update cached, notifying clients');
        const clients = await sw.clients.matchAll({ type: 'window' });
        for (const client of clients) {
            client.postMessage({ type: 'UPDATE_AVAILABLE' });
        }
    } catch (error) {
        console.debug('SW: Update check failed', error);
    } finally {
        updateInProgress = false;
    }
}
