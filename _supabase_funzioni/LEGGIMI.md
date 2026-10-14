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
