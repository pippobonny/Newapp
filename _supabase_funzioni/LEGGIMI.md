# Edge Functions Supabase — copia dei sorgenti (2026-10-07)

Già pubblicate su Supabase da Claude il 2026-10-07: questa cartella è solo
una copia di riferimento (non serve fare niente).

Novità: push ed email in italiano o inglese secondo `accounts.lang`
(aggiornata dall'app: lingua del telefono o scelta nel Profilo).
`i18n.ts` è il modulo comune, copiato dentro ogni funzione.

## 2026-10-14 — revisione sicurezza (già pubblicato su Supabase da Claude)

- notify-event-deleted: ora **cancella lei l'evento** (dopo aver controllato che
  chi chiama sia l'organizzatore) e manda gli avvisi. Body: `{ eventId }`.
- notify-event-modified / notify-date-removed / notify-event-invite /
  notify-friend-request: login obbligatorio + solo l'organizzatore (o il
  proprietario della lista); nome evento letto dal DB, non dal client.
- notify-account-created: solo il nuovo utente stesso, entro 15 minuti.
- request-password-reset: max 1 email ogni 2 minuti; vedi SQL.
- create-account e delete-account: prima esistevano solo su Supabase, ora
  c'è la copia qui. create-account: `_` e `%` non fanno più da jolly.
- notify-test-push: disattivata (si può cancellare dal pannello Supabase).
- Dettagli SQL in `2026-10-14_revisione_sicurezza.sql`.

## 2026-10-24 — auguri di compleanno automatici (già pubblicato su Supabase da Claude)

- Nuova funzione `send-birthday-greetings`: alle 9 (ora di Roma) manda una push
  di auguri a chi compie gli anni (accounts.data_nascita), in italiano o
  inglese. Toccandola si apre `index.html?auguri=AAAA-MM-GG` → schermata con i
  coriandoli (initBirthdayGreeting in script.js).
- Cron `send-birthday-greetings-9am` = `0 7,8 * * *` UTC; la funzione parte solo
  se a Roma sono le 9 o più (ora legale/solare gestita da sola).
- Tabella `birthday_greetings_sent` (account_id, year): niente doppioni.
- 29 febbraio: auguri il 28 negli anni non bisestili.
- Da cancellare a mano dal pannello Supabase (Edge Functions): `birthday-virginia`
  (usa-e-getta, scaduta il 25/10).

## 2026-10-26 — Forse, "È andata?", notifica commenti (già pubblicato su Supabase da Claude)

- DB: `events.took_place` (true = svolto, false = no → annullato), `events.outcome_asked_at`,
  `events.maybe_reminder_sent_at`, `event_comments.notified_at`; `get_event_public` restituisce `tookPlace`.
- `send-event-reminders` v8: chi ha detto Forse riceve un sollecito 2 giorni prima (con pulsanti);
  nuovo `{"mode":"outcome"}` = "Com'è andata?" all'organizzatore il giorno dopo (pulsanti Sì/No).
  Nuovo cron `ask-event-outcome` alle 9 UTC.
- `notify-event-nudge` v6: Sollecita arriva anche a chi ha detto Forse.
- Nuova `notify-event-comment` (verify_jwt false, controlli dentro): push del commento a tutti
  gli invitati + organizzatore, tranne chi ha detto Non ci sono e chi ha scritto.
  Il suo i18n.ts pubblicato contiene solo le funzioni che usa.

## 2026-10-26 — notifiche nell'app vera (Firebase)

- Nuova funzione `native-push-relay` (verify_jwt false, controlla la firma VAPID):
  l'app registra in push_subscriptions un indirizzo che punta lì
  (RPC `register_native_push`); la relay decifra il Web Push e lo gira a Firebase (FCM).
  Così tutte le funzioni che mandano notifiche funzionano anche per l'app senza toccarle.
- Segreto `FCM_SERVICE_ACCOUNT` (messo da Fil dal pannello). Chiave della relay in
  tabella `app_secrets` (RLS senza policy: invisibile dall'app).
- Progetto Firebase: seeva-23403, app Android it.seeva.app.

## 2026-10-27 — sondaggi dentro l'evento (già pubblicato su Supabase da Claude)

- Tabelle `event_polls`, `event_poll_options`, `event_poll_votes` (RLS: lettura solo a chi vede l'evento;
  scrittura solo tramite le funzioni qui sotto). Un solo sondaggio aperto per evento (indice unico).
- RPC: `create_event_poll`, `close_event_poll`, `delete_event_poll` (solo organizzatore con account);
  `set_poll_votes`, `add_poll_option` (tutti, anche ospiti col nome). `get_event_public` restituisce `polls`.
- Nuova funzione `notify-event-poll` (verify_jwt false, controlli dentro): `{pollId}` = nuovo sondaggio a tutti
  gli invitati tranne chi ha detto Non ci sono; `{optionId}` = nuova opzione, avvisa solo l'organizzatore.
  Il clic sulla notifica apre `evento.html?id=...&sondaggio=1` (porta al sondaggio).

## 2026-10-29 — notifiche sull'iPhone (DA PUBBLICARE, non ancora su Supabase)

- `native-push-relay`: se il token è quello di Apple (64 caratteri esadecimali, app iPhone)
  la notifica va direttamente ad APNs (server Apple), senza Firebase. Android invariato.
- Prima prova il server "production" (TestFlight/App Store), se Apple risponde BadDeviceToken
  riprova su "sandbox" (app installata da Xcode). Unregistered/410 → riga cancellata come prima.
- Segreti nuovi da mettere su Supabase (Edge Functions → Secrets) quando Virgi ha creato la
  chiave APNs: `APNS_KEY_P8` (contenuto del file .p8), `APNS_KEY_ID`, `APNS_TEAM_ID`.
- L'app iPhone registra il token con `register_native_push(p_platform => 'ios')` (data.js,
  nativePlatform()): nessuna modifica SQL necessaria.
- Da pubblicare (verify_jwt false come prima) insieme ai segreti: finché i segreti mancano,
  le notifiche agli iPhone rispondono 503 e quelle Android funzionano come sempre.
