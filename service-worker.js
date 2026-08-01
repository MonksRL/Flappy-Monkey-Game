'use strict';

const CACHE_VERSION = 'flappy-monkey-mobile-v11';
const APP_SHELL = [
    './index.html', './manifest.json?v=11', './mobile.css?v=11', './multiplayer.css?v=11',
    './birthday-event.css?v=11', './game-dialog.css?v=11', './game-dialog.js?v=11', './birthday-event.js?v=11',
    './account-storage.js?v=11', './multiplayer-client-config.js?v=11', './monkey-world-renderer.js?v=11',
    './multiplayer.js?v=11', './pwa.js?v=11', './mobile-ui.js?v=11',
    './monkey-192.png', './monkey-512.png', './Default Monkey.png'
].map((path) => new URL(path, self.registration.scope).href);
const CRITICAL_ART = [
    ...['wonks','zombie','vampire','skeleton','mummy','frankenstein','ghost']
        .map((id) => `./defense-art/pests/${id}.webp?flappy-defense=mobile-v11-1`),
    ...['torn','soldier','attackhelicopter']
        .map((id) => `./defense-art/towers/${id}.webp?flappy-defense=mobile-v11-1`),
    './attack-helicopter-defender.webp?flappy-defense=mobile-v11-1'
].map((path) => new URL(path, self.registration.scope).href);
const OFFLINE_DOCUMENT = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(
        APP_SHELL.map((url) => new Request(url, { cache:'reload' }))
    )));
    self.skipWaiting();
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
    if (event.data?.type === 'WARM_CRITICAL_ART') {
        event.waitUntil((async () => {
            const cache = await caches.open(CACHE_VERSION);
            for (let index = 0; index < CRITICAL_ART.length; index += 3) {
                await Promise.allSettled(CRITICAL_ART.slice(index, index + 3).map(async (url) => {
                    if (await cache.match(url)) return;
                    const request = new Request(url, { cache:'reload' });
                    const response = await fetch(request);
                    if (response.ok) await cache.put(request, response);
                }));
            }
        })());
    }
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
        event.respondWith(fetch(request, { cache:'no-store' }).then((response) => {
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
