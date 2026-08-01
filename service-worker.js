'use strict';

const CACHE_VERSION = 'flappy-monkey-mobile-v4';
const APP_SHELL = [
    './', './index.html', './manifest.json', './mobile.css', './multiplayer.css',
    './birthday-event.css', './game-dialog.css', './game-dialog.js', './birthday-event.js',
    './account-storage.js', './multiplayer-client-config.js', './monkey-world-renderer.js',
    './multiplayer.js', './pwa.js', './monkey-192.png', './monkey-512.png',
    './Default Monkey.png', './sock-monkey.png', './Mobile Monkey.png'
].map((path) => new URL(path, self.registration.scope).href);
const OFFLINE_DOCUMENT = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('flappy-monkey-') && key !== CACHE_VERSION).map((key) => caches.delete(key))
    )));
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    const networkFirst = request.mode === 'navigate' || ['script', 'style', 'worker'].includes(request.destination);

    if (networkFirst) {
        event.respondWith(fetch(request).then((response) => {
            if (response.ok) caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()));
            return response;
        }).catch(async () => (await caches.match(request)) || (request.mode === 'navigate' ? caches.match(OFFLINE_DOCUMENT) : Response.error())));
        return;
    }

    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()));
        return response;
    })));
});
