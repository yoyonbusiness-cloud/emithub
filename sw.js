const CACHE_NAME = 'emithub-shell-v1';
const APP_SHELL = [
    '/',
    '/index.html',
    '/drop.html',
    '/patch-notes.html',
    '/styles.css',
    '/app.js',
    '/shared.js',
    '/webrtc.js',
    '/hosted-drop.js',
    '/encrypt-worker.js',
    '/activity-tracker.js',
    '/lofi-radio.js',
    '/manifest.json',
    '/favicon.png'
];

function isDynamicRequest(pathname) {
    return pathname.startsWith('/socket.io/') ||
        pathname.startsWith('/api/') ||
        pathname.startsWith('/upload') ||
        pathname.startsWith('/drop-') ||
        pathname.startsWith('/download') ||
        pathname.startsWith('/h/');
}

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin || isDynamicRequest(url.pathname)) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached || caches.match('/index.html')))
        );
        return;
    }

    event.respondWith(
        caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request).then((response) => {
            if (response.ok) {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
        }))
    );
});
