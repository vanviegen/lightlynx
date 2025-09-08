/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = 'lights-cache-v1';

// --- Types ---

interface RevalidationResult {
    updated: boolean;
    error: boolean;
    response?: Response;
}

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
    if (event.request.method === 'GET') {
        event.respondWith(handleGetRequest(event));
    }
});

// --- Caching and Revalidation Logic ---

let revalidationPromises: Promise<RevalidationResult>[] = [];
let reloadDebounceTimeout: number | null = null;

/**
 * Handles a GET request by serving from cache first, then revalidating.
 */
async function handleGetRequest(event: FetchEvent): Promise<Response> {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(event.request);
    
    // Start revalidation in the background.
    const networkPromise = revalidate(event.request, cachedResponse?.clone(), cache);
    revalidationPromises.push(networkPromise);
    
    // Wait 500ms after the last fetch event to check for updates.
    if (reloadDebounceTimeout) clearTimeout(reloadDebounceTimeout);
    reloadDebounceTimeout = setTimeout(checkRevalidations, 500);
    
    // Return cached response if available, otherwise wait for the network fetch from revalidate.
    return cachedResponse || (await networkPromise).response || new Response('Not Found', { status: 404 });
}

/**
 * Checks all completed revalidation promises and reloads clients if needed.
 */
async function checkRevalidations(): Promise<void> {
    const results = await Promise.all(revalidationPromises);
    revalidationPromises = []; // Clear the queue
    
    const shouldReload = results.some(result => result.updated || result.error);
    
    if (shouldReload) {
        console.log('Service Worker: Changes detected, reloading clients.');
        await reloadAllClients();
    } else {
        console.log('Service Worker: All resources up-to-date.');
    }
}

/**
 * Revalidates a request against the network with a timeout.
 */
async function revalidate(
    request: Request, 
    cachedResponseCopy: Response | undefined,
    cache: Cache
): Promise<RevalidationResult> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        const headers = new Headers(request.headers);
        if (cachedResponseCopy) {
            if (cachedResponseCopy.headers.has('ETag')) {
                headers.set('If-None-Match', cachedResponseCopy.headers.get('ETag')!);
            }
            if (cachedResponseCopy.headers.has('Last-Modified')) {
                headers.set('If-Modified-Since', cachedResponseCopy.headers.get('Last-Modified')!);
            }
        }
        
        const networkResponse = await fetch(request.url, {
            signal: controller.signal,
            headers,
            cache: 'no-store',
        });
        
        clearTimeout(timeoutId);
        
        if (networkResponse.status === 200) {
            // Check if the response content is actually different from cached version
            let isActuallyUpdated = false;
            
            if (cachedResponseCopy) {
                const networkText = await networkResponse.clone().text();
                const cachedText = await cachedResponseCopy.text();
                isActuallyUpdated = networkText !== cachedText;
            }
            
            // Cache the new response
            await cache.put(request, networkResponse.clone());

            if (isActuallyUpdated) {
                console.log(`Service Worker: Resource updated: ${request.url}`);
            }
            
            return { updated: isActuallyUpdated, error: false, response: networkResponse };
        }
        
        if (cachedResponseCopy && networkResponse.status === 304) {
            // Not modified.
            return { updated: false, error: false, response: cachedResponseCopy };
        }
        
        if (networkResponse.status >= 400 && networkResponse.status < 500) {
            // Client error.
            console.log(`Service Worker: Resource failed with ${networkResponse.status}: ${request.url}`);
            return { updated: false, error: true, response: networkResponse };
        }
        
        // Other statuses (e.g., 5xx), serve stale content if available.
        return { updated: false, error: false, response: networkResponse };
        
    } catch (error) {
        console.error(`Service Worker: Network error for ${request.url}:`, error);
        // On error, we don't trigger a reload and serve stale content if we have it.
        return { updated: false, error: false, response: cachedResponseCopy };
    }
}

/**
 * Reloads all window clients controlled by this service worker.
 */
async function reloadAllClients(): Promise<void> {
    const clients = await sw.clients.matchAll({ type: 'window' });
    for (const client of clients) {
        if ('navigate' in client) {
            (client as WindowClient).navigate(client.url);
        }
    }
}
