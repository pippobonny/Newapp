-- Revisione sicurezza 2026-10-14 — GIÀ APPLICATO sul database (solo archivio).

-- 1) URGENTE: begin_password_reset restituiva il token di reset a chiunque
--    la chiamasse con la chiave pubblica (= furto di qualsiasi account).
--    Ora solo la Edge Function request-password-reset (service_role) può usarla,
--    e manda al massimo un'email ogni 2 minuti per account.
revoke execute on function public.begin_password_reset(text) from public, anon, authenticated;
grant execute on function public.begin_password_reset(text) to service_role;
-- (corpo della funzione aggiornato con il limite "58 minutes" sul token ancora fresco)

-- 2) Funzione di servizio per le Edge Function (trova account per username, senza scaricarli tutti)
-- accounts_by_usernames(p_names text[]) -> id, email, username  (solo service_role)

-- 3) event_notices: prima leggibile da tutti (anche senza login) e scrivibile
--    da qualsiasi utente loggato con un testo qualsiasi.
alter table public.event_notices add column if not exists event_id uuid;
-- my_username(), is_registered_username(text): funzioni di supporto (security definer)
-- lettura: solo i propri avvisi (username) + quelli intestati a ospiti senza account
-- scrittura dal client: solo con event_id di un evento di cui sei organizzatore
-- (policy rinominate: event_notices_select_own, event_notices_insert_organizer)
-- anon: solo select; tolti insert/update/delete/truncate.

-- 4) search_accounts: solo utenti loggati (prima anche anonimi).
revoke execute on function public.search_accounts(text) from public, anon;

-- 5) Velocità: 20 indici sulle chiavi esterne + regole RLS con (select auth.uid())
--    invece di auth.uid() (calcolato una volta per query, non per ogni riga).
