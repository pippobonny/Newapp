/* =========================================================
   Ci siamo — service worker.
   Serve solo a ricevere/mostrare le notifiche push quando l'app non è in
   primo piano (o è chiusa): niente cache offline qui, non è il suo scopo.
   Fil, 2026-07-19.
   ========================================================= */

self.addEventListener('install', function () {
  // Non aspettare che le vecchie schede si chiudano: un service worker per
  // le notifiche push deve diventare attivo subito.
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    // Se il payload non è JSON valido, mostriamo comunque qualcosa invece
    // di far sparire silenziosamente la notifica.
    data = { title: 'Ci siamo', body: (event.data && event.data.text()) || '' };
  }

  var title = data.title || 'Ci siamo';
  var options = {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: data.url || 'index.html' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || 'index.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      // Se l'app è già aperta in una scheda, la porta in primo piano e la
      // naviga lì invece di aprirne una nuova.
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if ('focus' in client) {
          if ('navigate' in client) {
            try { client.navigate(url); } catch (err) { /* alcuni browser non supportano navigate() da qui */ }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
