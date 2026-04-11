// ─────────────────────────────────────────────────────────────────────────────
// SolarMind Designer Pro — Service Worker v5.0
// Estrategia: Cache-first para assets CDN, Network-first para la app principal
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME = 'solarmind-v5.0';

// Assets de CDN que se cachean en el install (críticos para modo offline)
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap'
];

// ── INSTALL: pre-cachear assets críticos ─────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Install — cache:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Pre-cachear la app principal (scope raíz)
      const appUrl = self.registration.scope;
      return cache.add(appUrl).then(() => {
        // Cachear CDN assets en segundo plano (no bloquea install)
        CDN_ASSETS.forEach(url => {
          cache.add(new Request(url, { mode: 'cors' })).catch(() => {
            console.log('[SW] CDN asset no disponible offline:', url);
          });
        });
      }).catch(err => {
        console.warn('[SW] Error pre-cacheando app:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar caches viejos ──────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activate — limpiando caches anteriores');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Eliminando cache obsoleto:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH: estrategia inteligente ────────────────────────────────────────────
self.addEventListener('fetch', event => {
  // Solo manejar GET
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Ignorar peticiones de Supabase y APIs externas (siempre red)
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('supabase.io') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('generativelanguage') ||
    url.hostname.includes('anthropic.com')
  ) {
    return; // Dejar pasar sin interceptar
  }

  // Para assets CDN (cdnjs, fonts): Cache-First
  if (url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('fonts.g')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => {
          // Asset CDN no disponible y no está en caché
          return new Response('', { status: 503, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  // Para la app principal (mismo origen): Network-First con fallback a caché
  if (url.origin === self.location.origin || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Guardar copia fresca en caché si la respuesta es válida
          if (response && response.status === 200 && response.type !== 'opaque') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Sin red: servir desde caché
          return caches.match(event.request).then(cached => {
            if (cached) return cached;
            // Último fallback: la raíz de la app
            return caches.match(self.registration.scope).then(root => {
              if (root) return root;
              return new Response(
                '<h1 style="font-family:sans-serif;padding:2rem;color:#f59e0b">SolarMind — Sin conexión</h1><p style="font-family:sans-serif;padding:0 2rem">La aplicación no está disponible offline todavía. Ábrela una vez con conexión a internet para activar el modo offline.</p>',
                { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 }
              );
            });
          });
        })
    );
    return;
  }
});

// ── MENSAJE: forzar actualización inmediata ───────────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    console.log('[SW] Actualizando service worker por solicitud del cliente');
    self.skipWaiting();
  }
});

console.log('[SW] SolarMind Service Worker v5.0 cargado');
