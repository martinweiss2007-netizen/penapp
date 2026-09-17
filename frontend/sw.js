// Service worker de PenApp: muestra notificaciones push aunque
// la pestaña o el navegador estén cerrados.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'PenApp', body: '¡Tanda de penales!' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    // payload no era JSON, usamos el default
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'PenApp', {
      body: data.body || '',
      tag: data.tag || 'penapp',
      icon: undefined,
      badge: undefined,
      requireInteraction: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow('/');
    })
  );
});
