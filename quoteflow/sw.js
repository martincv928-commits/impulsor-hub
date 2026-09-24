/* Service worker de QuoteFlow: hace posible instalar la app y que funcione
 * sin conexión (excepto el dictado por voz, que usa el servicio del sistema).
 * Estrategia: se sirve del caché al instante y, si hay red, se actualiza el
 * caché en segundo plano para la próxima vez ("stale-while-revalidate").
 * Sube CACHE_NAME cuando cambie esta lista para forzar limpieza del caché viejo. */
const CACHE_NAME = 'quoteflow-v0.2.1';
const STATIC_ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/styles.css',
  'vendor/jspdf.umd.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // fuentes de Google u otros orígenes: comportamiento normal del navegador

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        network; // refresca el caché en segundo plano, sin bloquear la respuesta
        return cached;
      }
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') return cache.match('index.html');
      return new Response('', { status: 504, statusText: 'Sin conexión' });
    })
  );
});
