const VERSION = 'peak-sw-v1';
const CORE = ['./','./index.html','./app.css','./app.js','./manifest.webmanifest','./icons/peak-192.png','./icons/peak-512.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k!==VERSION).map(k => caches.delete(k))))));
self.addEventListener('fetch', e => {
  if (e.request.method!=='GET') return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res;
  })));
});
