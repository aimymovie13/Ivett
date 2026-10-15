'use strict';

// Bump this version whenever any file in FILES changes.
const VERSION = '2026-10-15-v1';
const SCOPE = new URL(self.registration.scope);
const PREFIX = 'ivett-offline-' + encodeURIComponent(SCOPE.pathname) + '-';
const CACHE_NAME = PREFIX + VERSION;
const FILES = [
  'index.html', 'pwa.js', 'pwa.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];
const URLS = FILES.map(file => new URL(file, SCOPE).href);
const INDEX = URLS[0];

async function saveOffline() {
  const cache = await caches.open(CACHE_NAME);
  // addAll is atomic: an incomplete download never becomes a ready install.
  await cache.addAll(URLS.map(url => new Request(url, {cache: 'reload'})));
}

async function offlineStatus() {
  const cache = await caches.open(CACHE_NAME);
  const entries = await Promise.all(URLS.map(url => cache.match(url)));
  return {type: 'OFFLINE_STATUS', ready: entries.every(Boolean), version: VERSION};
}

self.addEventListener('install', event => {
  // Updates wait for the existing app to close, or for an explicit update click.
  event.waitUntil(saveOffline());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
    const status = await offlineStatus();
    for (const client of await self.clients.matchAll({type: 'window', includeUncontrolled: true})) {
      if (client.url.startsWith(SCOPE.href)) client.postMessage(status);
    }
  })());
});

function notSavedResponse() {
  return new Response('<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ivett – Offline mentés szükséges</title><body style="background:#10142e;color:white;font:18px system-ui;padding:32px"><h1>Ivett még nincs letöltve</h1><p>Nyisd meg a játékot egyszer internetkapcsolattal, és várd meg az „Offline játékra kész” jelzést.</p><p>Az alkalmazás vagy a böngésző adatainak törlése után újra le kell tölteni a játékot.</p></body></html>', {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8'}});
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  url.search = '';
  url.hash = '';
  const isGame = request.mode === 'navigate' &&
    (url.pathname === SCOPE.pathname || url.href === INDEX);
  const key = isGame ? INDEX : url.href;
  if (!isGame && !URLS.includes(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(key);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(key, response.clone());
      return response;
    } catch (error) {
      if (isGame) return notSavedResponse();
      throw error;
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (!['GET_OFFLINE_STATUS', 'SAVE_OFFLINE'].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    try {
      if (event.data.type === 'SAVE_OFFLINE') await saveOffline();
      event.ports[0]?.postMessage(await offlineStatus());
    } catch (error) {
      event.ports[0]?.postMessage({type: 'OFFLINE_STATUS', ready: false, failed: true, version: VERSION});
    }
  })());
});
