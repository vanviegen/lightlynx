/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = 'lights-cache-v1';


// --- Lifecycle Events ---

sw.addEventListener('install', (event: ExtendableEvent) => {
    // Activate the new service worker as soon as it's installed.
    event.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
    // Take control of all open clients.
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
 * Handles a GET request by serving from cache first, then revalidating.
 */
async function handleGetRequest(event: FetchEvent): Promise<Response> {
    // Normalize SPA navigation requests to / so query params don't fragment the cache
    let request = event.request;
    if (request.mode === 'navigate') {
        request = new Request(new URL('/', request.url));
    }
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    
    // Start revalidation in the background.
    const responsePromise = revalidate(request, cachedResponse?.clone(), cache);
    
    // Return cached response if available, otherwise wait for the network fetch from revalidate.
    return cachedResponse || await responsePromise;
}


/**
 * Revalidates a request against the network with a timeout.
 */
async function revalidate(
    request: Request, 
    cachedResponseCopy: Response | undefined,
    cache: Cache
): Promise<Response> {
    try {
        const headers = new Headers(request.headers);
        if (cachedResponseCopy) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Give the page some time to load before revalidating
            if (cachedResponseCopy.headers.has('ETag')) {
                headers.set('If-None-Match', cachedResponseCopy.headers.get('ETag')!);
            }
            if (cachedResponseCopy.headers.has('Last-Modified')) {
                headers.set('If-Modified-Since', cachedResponseCopy.headers.get('Last-Modified')!);
            }
        }
        
        const networkResponse = await fetch(request.url, {headers, cache: 'no-store' });
        
        if (networkResponse.status === 200) {
            // Check if the response content is actually different from cached version
            let isActuallyUpdated = false;
            
            if (cachedResponseCopy) {
                const networkText = await networkResponse.clone().text();
                const cachedText = await cachedResponseCopy.text();
                isActuallyUpdated = networkText !== cachedText;
            }
            
            if (isActuallyUpdated || !cachedResponseCopy) {
                // Cache the new response
                await cache.put(request, networkResponse.clone());
            }

            if (isActuallyUpdated) {
                console.log(`Service Worker: Resource updated: ${request.url}`);
                notifyUpdateAvailable();
            }

            return networkResponse;
        }
        
        if (cachedResponseCopy && networkResponse.status === 304) {
            // Not modified.
            return cachedResponseCopy;
        }
        
        if (networkResponse.status >= 400 && networkResponse.status < 500) {
            // Client error.
            console.log(`Service Worker: Resource failed with ${networkResponse.status}: ${request.url}`);
            return networkResponse;
        }
        
        // Other statuses (e.g., 5xx), serve stale content if available.
        return cachedResponseCopy || networkResponse;

    } catch (error) {
        if (cachedResponseCopy) {
            // Network error during background revalidation is expected (offline, server down).
            console.debug(`Service Worker: Revalidation failed for ${request.url} (serving from cache)`);
        } else {
            console.warn(`Service Worker: Network error for ${request.url} (no cache fallback):`, error);
        }
        return cachedResponseCopy || new Response('Network Error', { status: 504 });
    }
}

/**
 * Notifies all window clients that an update is available.
 */
let notified = false;
async function notifyUpdateAvailable(): Promise<void> {
    if (notified) return;
    notified = true;
    const clients = await sw.clients.matchAll({ type: 'window' });
    for (const client of clients) {
        client.postMessage({ type: 'UPDATE_AVAILABLE' });
    }
}
