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
    data: { url: data.url || 'index.html' },
    // Una notifica per evento/tipo invece di una pila (2026-10-04): la
    // nuova sostituisce la vecchia sullo stesso evento, ma suona lo stesso.
    tag: data.tag || ((data.url || 'seeva') + '|' + title),
    renotify: true
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

/* Tocco sulla notifica (2026-10-04, Fil: "ogni tanto premi sulle notifiche
   e non si aprono"). Prima: si prendeva la prima finestra dell'app (anche
   una non controllata da questo service worker), si provava navigate() --
   che in quei casi FALLISCE in silenzio (è una Promise rifiutata, il
   try/catch non la vedeva) -- e si portava l'app in primo piano sulla
   pagina vecchia: sembrava che la notifica "non si aprisse". Ora: finestra
   in primo piano + navigate atteso davvero; se fallisce, messaggio alla
   pagina (che cambia indirizzo da sola, vedi script.js); se non c'è nessuna
   finestra, se ne apre una nuova. */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || 'index.html';
  // Tocco su un pulsante di risposta: si apre l'evento con ?rsvp=yes|no e
  // la pagina salva la risposta da sola (vedi fondo di evento.html).
  if (event.action === 'rsvp-yes' || event.action === 'rsvp-no') {
    url += (url.indexOf('?') === -1 ? '?' : '&') + 'rsvp=' + (event.action === 'rsvp-yes' ? 'yes' : 'no');
  }
  var absUrl = new URL(url, self.registration.scope).href;

  event.waitUntil((async function () {
    var clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    var sameOrigin = clientList.filter(function (c) { return c.url && c.url.indexOf(self.location.origin) === 0; });
    // Preferisci la finestra già visibile.
    sameOrigin.sort(function (a, b) {
      return (a.visibilityState === 'visible' ? 0 : 1) - (b.visibilityState === 'visible' ? 0 : 1);
    });
    var client = sameOrigin[0];
    if (client) {
      try { client = (await client.focus()) || client; } catch (err) { /* ignora */ }
      if (client.url === absUrl) return;
      try {
        if ('navigate' in client) {
          var navigated = await client.navigate(absUrl);
          if (navigated) return;
        }
      } catch (err) { /* non controllata: si passa al messaggio */ }
      try {
        client.postMessage({ type: 'seeva-navigate', url: absUrl });
        return;
      } catch (err) { /* ultima spiaggia qui sotto */ }
    }
    if (self.clients.openWindow) return self.clients.openWindow(absUrl);
  })());
});
