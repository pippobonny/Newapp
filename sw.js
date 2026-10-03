/* =========================================================
   seeva — service worker.
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
    data = { title: 'seeva', body: (event.data && event.data.text()) || '' };
  }

  var title = data.title || 'seeva';
  var options = {
    body: data.body || '',
    // "icon" e' l'immagine grande mostrata quando la notifica e' espansa
    // (a tutti gli effetti va bene anche a colori): il logo vero "sv",
    // sfondo scuro (Fil, 2026-07-19; logo/sfondo aggiornati 2026-08-24 col
    // rebranding a seeva, vedi icon-192.png).
    icon: 'icon-192.png',
    // "badge" invece e' la sagoma piccola nella barra di stato (Android):
    // il sistema la trasforma SEMPRE in una silhouette monocroma usando il
    // canale alpha del file. icon-192.png e' un PNG opaco (nessuna
    // trasparenza), per cui Android non trova nessuna sagoma da ritagliare
    // e mostra un quadratino bianco pieno. badge-96.png e' un file dedicato,
    // con sfondo trasparente e la sagoma bianca del segno "sv" ritagliata
    // dal logo vero: quella sì che Android riesce a mostrare come icona
    // nella barra di stato (Fil, 2026-07-19).
    badge: 'badge-96.png',
    data: { url: data.url || 'index.html' }
  };

  // Pulsanti di risposta (Fil, 2026-10-03): solo se il server li chiede
  // (data.rsvp, inviti/solleciti di eventi confermati a data fissa). Chrome
  // su Android ne mostra al massimo 2, quindi Ci sono / Non ci sono; il
  // "Forse" si dà aprendo l'evento. Su iPhone i pulsanti non compaiono e
  // la notifica funziona come prima.
  if (data.rsvp) {
    options.actions = [
      { action: 'rsvp-yes', title: '✅ Ci sono' },
      { action: 'rsvp-no', title: '❌ Non ci sono' }
    ];
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || 'index.html';
  // Tocco su un pulsante di risposta: si apre l'evento con ?rsvp=yes|no e
  // la pagina salva la risposta da sola (vedi fondo di evento.html).
  if (event.action === 'rsvp-yes' || event.action === 'rsvp-no') {
    url += (url.indexOf('?') === -1 ? '?' : '&') + 'rsvp=' + (event.action === 'rsvp-yes' ? 'yes' : 'no');
  }

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
