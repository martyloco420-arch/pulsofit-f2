/* PulsoFit Web Push Service Worker (imported by Workbox SW and standalone fallback) */

const VALID_TABS = new Set([
  'dashboard',
  'salud',
  'entrenar',
  'nutricion',
  'hidratacion',
  'sueno',
  'progreso',
  'perfil',
]);

function sanitizeTab(rawTab) {
  if (typeof rawTab === 'string' && VALID_TABS.has(rawTab)) {
    return rawTab;
  }
  return 'dashboard';
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      try {
        payload = { body: event.data.text() };
      } catch {
        payload = {};
      }
    }
  }

  const title =
    typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : 'PulsoFit';
  const body =
    typeof payload.body === 'string' && payload.body.trim()
      ? payload.body.trim()
      : 'Tienes un recordatorio pendiente en PulsoFit.';
  const tab = sanitizeTab(payload.tab || (payload.data && payload.data.tab));
  const tag =
    typeof payload.tag === 'string' && payload.tag.trim()
      ? payload.tag.trim()
      : `pulsofit-${tab}`;
  const targetUrl = `/?tab=${encodeURIComponent(tab)}`;

  const options = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    vibrate: [200, 100, 200],
    tag,
    renotify: true,
    requireInteraction: false,
    data: {
      tab,
      url: targetUrl,
      sentAt: Date.now(),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawTab = event.notification && event.notification.data && event.notification.data.tab;
  const tab = sanitizeTab(rawTab);
  const targetUrl = new URL(`/?tab=${encodeURIComponent(tab)}`, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          if (client.url && client.url.startsWith(self.location.origin)) {
            try {
              await client.focus();
              client.postMessage({ type: 'NAVIGATE_TAB', tab });
              return client;
            } catch {
              // Fallback to opening a new window below if focus fails
            }
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      }),
  );
});
