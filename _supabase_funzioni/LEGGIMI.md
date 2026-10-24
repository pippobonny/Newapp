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
