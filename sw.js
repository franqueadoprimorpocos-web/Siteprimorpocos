const CACHE_VERSION = "primor-v1.0.1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;
const IMAGE_CACHE_LIMIT = 70;

const STATIC_ASSETS = [
    "/",
    "/index.html",
    "/admin.html",
    "/assets/css/style.css",
    "/assets/css/admin.css",
    "/assets/js/script.js",
    "/assets/js/env.js"
];

function isSupabaseRequest(request) {
    try {
        return new URL(request.url).hostname.endsWith(".supabase.co");
    } catch (error) {
        return false;
    }
}

async function trimCache(cacheName, limit) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();

    while (keys.length > limit) {
        await cache.delete(keys.shift());
    }
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    if (cached) return cached;

    const response = await fetch(request);
    if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone());
    }

    return response;
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    const fresh = fetch(request)
        .then(response => {
            if (response && (response.ok || response.type === "opaque")) {
                cache.put(request, response.clone()).then(() => {
                    if (cacheName === IMAGE_CACHE) trimCache(IMAGE_CACHE, IMAGE_CACHE_LIMIT);
                });
            }
            return response;
        })
        .catch(() => cached);

    return cached || fresh;
}

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => Promise.allSettled(STATIC_ASSETS.map(asset => cache.add(asset))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key.startsWith("primor-") && !key.startsWith(CACHE_VERSION))
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== "GET" || isSupabaseRequest(request)) return;
    if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;

    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(STATIC_CACHE).then(cache => cache.put(url.pathname || "/index.html", copy));
                    return response;
                })
                .catch(() => caches.match(url.pathname).then(cached => cached || caches.match("/index.html")))
        );
        return;
    }

    if (request.destination === "image") {
        event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
        return;
    }

    if (["style", "script", "font"].includes(request.destination)) {
        event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
    }
});
