-- =====================================================================================
-- DA APPLICARE SOLO DOPO: (1) approvazione Apple della 1.0, (2) uscita della 1.0.1 sugli store,
-- (3) qualche giorno perche' la gente aggiorni. NON applicato il 26/11/2026.
-- Provato il 26/11/2026 sul database vero dentro una transazione annullata (dry run): password_problem,
-- reset (senza la riga delle sessioni), M1, M2, M3, M4, M5, M9, B4 si applicano e funzionano
-- (ospite col solo id = niente, col token = evento; spam fermato al 31esimo commento in un minuto...).
-- NON provati prima (lo strumento blocca DELETE/REVOKE anche in prova): riga "delete from auth.sessions",
-- prepare_account_deletion (M7) e i revoke B3: controllarli subito dopo averli applicati.
-- Ogni blocco e' indipendente: si puo' applicare anche un pezzo alla volta.
-- Dopo questo file: pubblicare create-account, request-password-reset, delete-account, native-push-relay
-- (cartella _supabase_funzioni, gia' aggiornate nel repo) e, se serve, 2026-11-26_11 + send-report-alerts.
-- Perche' aspettare: la 1.0 non conosce le nuove regole (password, lunghezze) e gli ospiti della
-- 1.0 leggono l'evento col solo id (M1): applicandolo ora vedrebbero errori o pagine vuote.
-- =====================================================================================

-- ---------- A3 / B7 / M6: password nuove + reset che chiude le sessioni vecchie ----------
-- Stesse regole di data.js (passwordProblem) e create-account. Restituisce null se va bene.
create or replace function public.password_problem(p_pw text, p_username text default null, p_email text default null)
returns text language plpgsql immutable set search_path to 'public' as $fn$
declare
  v_low text := lower(coalesce(p_pw, ''));
  v_base text;
  v_user text := lower(trim(coalesce(p_username, '')));
  v_mail text := split_part(lower(trim(coalesce(p_email, ''))), '@', 1);
  v_common text[] := string_to_array('00000000 0000000000 0123456789 0987654321 11111111 1111111111 11223344 12121212 123123123 12341234 1234554321 12345678 123456789 1234567890 147258369 159753 1q2w3e4r 1q2w3e4r5t 1qaz2wsx 9876543210 a1b2c3d4 abc123 abcd1234 abcdefgh abcdefghi abcdefghij acmilan admin admin123 administrator agosto alessandra alessandro amore amore123 amoremio amoremio1 andrea andrea123 anna antonio aperitivo apple aprile asdfasdf asdfghjkl atalanta autunno baseball basket batman bella bellissima bellissimo birra bologna caffe caffe123 calcio calcio123 cane cane123 cena changeme charlie chiara chitarra ciao ciao123 ciao1234 ciaobella ciaobello ciaociao ciaociao1 ciaociao123 ciaomondo cioccolato cisiamo computer contrasena cucciola cucciolo davide dicembre domenica dragon elena estate eventi evento facebook farfalla febbraio federica federico ferrari ferrari123 festa festa123 filippo fiorentina football football1 forzainter forzaitalia forzajuve forzajuventus forzalazio forzamilan forzanapoli forzaroma forzatoro francesca francesco freedom fuffy gatto gatto123 gelato gennaio genoa giovanni girasole giugno giulia giulia123 giuseppe google guitar hello hello123 hello1234 helloworld iloveyou iloveyou1 instagram inter inter123 internazionale internet inverno iphone italia italia123 juve juve123 juventus juventus1 juventus1897 lamborghini laura lazio lazio123 letmein login login123 lorenzo luca luca123 lucky luglio luna luna123 lunedi maggio marco marco123 mare mario mario123 martina marzo master master123 matteo michela micia micio milan milan123 minnie monkey montagna motdepasse motogp music musica napoli napoli123 natale nduma netflix novembre nutella ottobre p4ssw0rd pallavolo pallone paola paperino pasqua passw0rd password password1 password12 password123 password1234 passwort pasta pippo pizza pizza123 pluto pokemon primavera princess principe principessa prova prova123 prova1234 qazwsx qazwsxedc qwerty qwerty123 qwerty1234 qwertyuiop roberto rocky roma roma123 root rossi46 sabato sampdoria samsung sara sara123 secret secret123 seeva seeva123 seeva2026 seevaapp settembre shadow silvia simone soccer sole sole123 spaghetti spiderman starwars stefano stella stellina sunshine superman tennis tesoro tesoro123 test test123 test1234 tiamo tiamo123 tiamotanto tiktok toor topolino torino torino123 trustno1 user user123 vale46 valentina valentino venerdi vespa vino virginia volley welcome welcome1 whatever whatsapp zxcvbnm zxcvbnm123', ' ');
begin
  if char_length(coalesce(p_pw, '')) < 8 then return 'La password deve avere almeno 8 caratteri.'; end if;
  if char_length(p_pw) > 72 then return 'La password può avere al massimo 72 caratteri.'; end if;
  if p_pw !~ '[A-Za-zÀ-ÿ]' or regexp_replace(p_pw, '\s', '', 'g') !~ '[^A-Za-zÀ-ÿ]' then return 'Usa almeno una lettera e un numero.'; end if;
  v_base := regexp_replace(regexp_replace(v_low, '^[^a-zà-ÿ]+', ''), '[^a-zà-ÿ]+$', '');
  if v_low ~ '^(.)\1+$' or v_low = any(v_common) or v_base = any(v_common)
     or v_low ~ '^(0123456789|1234567890|abcdefghij|qwertyuiop)' then
    return 'Questa password è troppo comune: scegline un''altra.';
  end if;
  if (char_length(v_user) >= 3 and position(v_user in v_low) > 0) or (char_length(v_mail) >= 3 and position(v_mail in v_low) > 0) then
    return 'La password non può contenere il tuo nome utente o la tua email.';
  end if;
  return null;
end $fn$;
revoke all on function public.password_problem(text, text, text) from public, anon, authenticated;

do $do$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.reset_password_with_token(text,text)'::regprocedure);
  v_new := replace(v_def, E'  v_hash text;\nbegin', E'  v_hash text;\n  v_problem text;\nbegin');
  v_new := replace(v_new, E'  if length(trim(p_new_password)) < 8 then\n    raise exception ''La password deve avere almeno 8 caratteri'';\n  end if;\n', '');
  v_new := replace(v_new, E'  v_hash := extensions.crypt(',
    E'  v_problem := public.password_problem(p_new_password, v_account.username, v_account.email);\n  if v_problem is not null then\n    raise exception ''%'', v_problem;\n  end if;\n\n  v_hash := extensions.crypt(');
  v_new := replace(v_new, 'update auth.users set encrypted_password = v_hash, updated_at = now() where id = v_account.id;',
    E'update auth.users set encrypted_password = v_hash, updated_at = now() where id = v_account.id;\n  -- M6: dopo il reset si chiudono tutte le sessioni aperte (anche quelle di un telefono rubato)\n  delete from auth.sessions where user_id = v_account.id;');
  if v_new = v_def or position('password_problem' in v_new) = 0 or position('auth.sessions' in v_new) = 0 or position('almeno 8' in v_new) > 0 then
    raise exception 'reset_password_with_token: testo non riconosciuto';
  end if;
  execute v_new;
end $do$;

-- ---------- M1: evento letto col solo id solo da chi e' collegato e invitato ----------
-- (dalla 1.0.1 gli ospiti mandano sempre anche il token del link)
do $do$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.get_event_public(uuid,uuid)'::regprocedure);
  v_new := replace(v_def, E'  if v_event.id is null then\n    return null;\n  end if;\n',
    E'  if v_event.id is null then\n    return null;\n  end if;\n  if p_share_token is null and (auth.uid() is null or not public.can_see_event(v_event.id)) then\n    return null;\n  end if;\n');
  if v_new = v_def then raise exception 'get_event_public: testo non riconosciuto'; end if;
  execute v_new;
end $do$;

-- ---------- M2: limiti su commenti, risposte, invitati (anti-spam) ----------
create or replace function public.trg_limit_event_comments() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if char_length(coalesce(new.author_name, '')) > 60 then raise exception 'Il nome può avere al massimo 60 caratteri.'; end if;
  if (select count(*) from public.event_comments c where c.event_id = new.event_id and c.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Troppi commenti in poco tempo: riprova tra un minuto.';
  end if;
  if (select count(*) from public.event_comments c where c.event_id = new.event_id) >= 2000 then
    raise exception 'Questo evento ha raggiunto il numero massimo di commenti.';
  end if;
  return new;
end $fn$;
create trigger event_comments_limits before insert on public.event_comments
  for each row execute function public.trg_limit_event_comments();

create or replace function public.trg_limit_participants() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if (tg_op = 'INSERT' or new.name is distinct from old.name) and char_length(coalesce(new.name, '')) > 60 then
    raise exception 'Il nome può avere al massimo 60 caratteri.';
  end if;
  if (tg_op = 'INSERT' or new.note is distinct from old.note) and char_length(coalesce(new.note, '')) > 500 then
    raise exception 'La nota può avere al massimo 500 caratteri.';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.participants p where p.event_id = new.event_id) >= 300 then
    raise exception 'Questo evento ha raggiunto il numero massimo di risposte.';
  end if;
  return new;
end $fn$;
create trigger participants_limits before insert or update on public.participants
  for each row execute function public.trg_limit_participants();

create or replace function public.trg_limit_event_invitees() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if (tg_op = 'INSERT' or new.name is distinct from old.name) and char_length(coalesce(new.name, '')) > 60 then
    raise exception 'Il nome può avere al massimo 60 caratteri.';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.event_invitees i where i.event_id = new.event_id) >= 300 then
    raise exception 'Questo evento ha raggiunto il numero massimo di invitati.';
  end if;
  return new;
end $fn$;
create trigger event_invitees_limits before insert or update on public.event_invitees
  for each row execute function public.trg_limit_event_invitees();

-- ---------- M3: segnalazioni con limiti + tipo separato per i contenuti ----------
alter table public.problem_reports add column if not exists tipo text;
create or replace function public.trg_limit_problem_reports() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  new.message := left(coalesce(new.message, ''), 4000);
  new.page_url := left(new.page_url, 1000);
  new.username := left(new.username, 60);
  new.user_agent := left(new.user_agent, 500);
  if new.recent_errors is not null and char_length(new.recent_errors::text) > 20000 then new.recent_errors := '[]'::jsonb; end if;
  new.tipo := case when new.message like '[SEGNALA %' then 'contenuto' else 'problema' end;
  if new.account_id is not null and (select count(*) from public.problem_reports r where r.account_id = new.account_id and r.created_at > now() - interval '1 day') >= 30 then
    raise exception 'Hai mandato molte segnalazioni oggi: riprova domani.';
  end if;
  if new.account_id is null and (select count(*) from public.problem_reports r where r.account_id is null and r.created_at > now() - interval '1 hour') >= 100 then
    raise exception 'Troppe segnalazioni in questo momento: riprova più tardi.';
  end if;
  return new;
end $fn$;
create trigger problem_reports_limits before insert on public.problem_reports
  for each row execute function public.trg_limit_problem_reports();

-- ---------- M4: ricerca persone da 3 lettere, cognome solo come iniziale ----------
do $do$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.search_people(text)'::regprocedure);
  v_new := replace(v_def, 'length(v_query) < 2', 'length(v_query) < 3');
  v_new := replace(v_new, E'nullif(trim(coalesce(a.nome, \'\') || \' \' || coalesce(a.cognome, \'\')), \'\') as full_name',
    E'nullif(trim(coalesce(a.nome, \'\') || \' \' || coalesce(left(a.cognome, 1) || \'.\', \'\')), \'\') as full_name');
  if v_new = v_def or position('left(a.cognome, 1)' in v_new) = 0 then raise exception 'search_people: testo non riconosciuto'; end if;
  execute v_new;
end $do$;

-- ---------- M5: update_account non cambia piu' l'email (quella di accesso resta l'unica) ----------
do $do$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.update_account(text,text,text,date,text)'::regprocedure);
  v_new := replace(v_def, E'    email = coalesce(nullif(trim(p_email), \'\'), email),\n', '');
  if v_new = v_def then raise exception 'update_account: testo non riconosciuto'; end if;
  execute v_new;
end $do$;

-- ---------- M7: eliminazione account tutta in una volta (la chiama delete-account v5) ----------
-- ATTENZIONE: scelta da far confermare a Filippo prima di applicare (cancellare o lasciare anonimi gli eventi).
-- Scelta proposta: eventi creati da chi si elimina SENZA altri account dentro = cancellati; con altre
-- persone = restano, organizzatore "Utente eliminato". Commenti: autore "Utente eliminato".
-- Liste amici: cancellate (con i nomi dentro).
create or replace function public.prepare_account_deletion(p_user uuid) returns json
language plpgsql security definer set search_path to 'public' as $fn$
declare v_deleted_events int := 0; v_kept_events int := 0;
begin
  if p_user is null then raise exception 'utente mancante'; end if;
  update public.event_expense_shares set account_id = null where account_id = p_user;
  update public.event_expenses set paid_by_account_id = null where paid_by_account_id = p_user;
  update public.event_expenses set created_by_account_id = '00000000-0000-0000-0000-000000000001' where created_by_account_id = p_user;
  update public.event_invitees set account_id = null where account_id = p_user;
  update public.event_comments set author_name = 'Utente eliminato' where account_id = p_user;
  with mine as (
    select e.id from public.events e
    where e.created_by_account_id = p_user
      and not exists (select 1 from public.participants p where p.event_id = e.id and p.account_id is not null and p.account_id <> p_user)
      and not exists (select 1 from public.event_invitees i where i.event_id = e.id and i.account_id is not null and i.account_id <> p_user)
  ), del as (delete from public.events e using mine where e.id = mine.id returning 1)
  select count(*) into v_deleted_events from del;
  update public.events set created_by = 'Utente eliminato' where created_by_account_id = p_user;
  get diagnostics v_kept_events = row_count;
  delete from public.friend_lists where owner_account_id = p_user; -- friends: on delete cascade
  return json_build_object('deletedEvents', v_deleted_events, 'anonymizedEvents', v_kept_events);
end $fn$;
revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

-- ---------- M9: regole per i NUOVI account e limiti sugli eventi ----------
create or replace function public.trg_check_new_account() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if char_length(coalesce(new.username, '')) < 3 or char_length(new.username) > 24
     or new.username !~ '^[A-Za-z0-9._À-ÖØ-öø-ÿ-]+( [A-Za-z0-9._À-ÖØ-öø-ÿ-]+)*$' then
    raise exception 'Il nome utente deve avere da 3 a 24 caratteri (lettere, numeri, spazi e . _ -).';
  end if;
  if lower(regexp_replace(new.username, '[\s._-]', '', 'g')) = any (array['admin','administrator','amministratore','seeva','supporto','support','staff','moderatore','moderator','root','sistema','system','ospite','guest']) then
    raise exception 'Questo nome utente non è disponibile: scegline un altro.';
  end if;
  if char_length(coalesce(new.nome, '')) > 50 or char_length(coalesce(new.cognome, '')) > 50 then
    raise exception 'Nome e cognome possono avere al massimo 50 caratteri.';
  end if;
  if new.data_nascita is not null and (new.data_nascita < date '1900-01-01' or new.data_nascita > current_date) then
    raise exception 'Controlla la data di nascita.';
  end if;
  return new;
end $fn$;
create trigger accounts_check_new before insert on public.accounts
  for each row execute function public.trg_check_new_account();

create or replace function public.trg_limit_events() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if (tg_op = 'INSERT' or new.name is distinct from old.name) and char_length(coalesce(new.name, '')) > 80 then
    raise exception 'Il nome dell''evento può avere al massimo 80 caratteri.';
  end if;
  if (tg_op = 'INSERT' or new.description is distinct from old.description) and char_length(coalesce(new.description, '')) > 1000 then
    raise exception 'La descrizione può avere al massimo 1000 caratteri.';
  end if;
  if (tg_op = 'INSERT' or new.location_address is distinct from old.location_address) and char_length(coalesce(new.location_address, '')) > 200 then
    raise exception 'Il luogo può avere al massimo 200 caratteri.';
  end if;
  return new;
end $fn$;
create trigger events_limits before insert or update on public.events
  for each row execute function public.trg_limit_events();

-- ---------- B3: funzioni che richiedono l'account chiuse a chi non e' collegato ----------
-- (per chi non e' collegato davano gia' errore: cambia solo il messaggio)
revoke execute on function public.update_account(text,text,text,date,text) from public, anon;
revoke execute on function public.complete_google_profile(text,text,text,date,text) from public, anon;
revoke execute on function public.request_friend_link(uuid,uuid) from public, anon;
revoke execute on function public.respond_friend_request(uuid,boolean) from public, anon;
revoke execute on function public.remove_event_from_home(uuid) from public, anon;
revoke execute on function public.register_native_push(text,text) from public, anon;
revoke execute on function public.add_event_expense(uuid,text,numeric,text,text[],text,boolean) from public, anon;
revoke execute on function public.update_event_expense(uuid,text,numeric,text,text[],text,boolean) from public, anon;
revoke execute on function public.delete_event_expense(uuid) from public, anon;
revoke execute on function public.toggle_event_expenses(uuid,boolean) from public, anon;
revoke execute on function public.toggle_event_items(uuid,boolean) from public, anon;
revoke execute on function public.get_admin_dashboard() from public, anon;
grant execute on function public.update_account(text,text,text,date,text), public.complete_google_profile(text,text,text,date,text),
  public.request_friend_link(uuid,uuid), public.respond_friend_request(uuid,boolean), public.remove_event_from_home(uuid),
  public.register_native_push(text,text), public.add_event_expense(uuid,text,numeric,text,text[],text,boolean),
  public.update_event_expense(uuid,text,numeric,text,text[],text,boolean), public.delete_event_expense(uuid),
  public.toggle_event_expenses(uuid,boolean), public.toggle_event_items(uuid,boolean), public.get_admin_dashboard() to authenticated, service_role;
-- funzioni dei trigger: nessuno deve chiamarle a mano (i trigger funzionano lo stesso)
revoke execute on function public.refresh_event_last_date(), public.touch_event_vote_opened(), public.trg_events_confirmed_at(),
  public.trg_resync_shares_events(), public.trg_resync_shares_participants() from public, anon, authenticated;
-- (search_path di expense_emoji_ok e trg_events_confirmed_at: gia' APPLICATO il 27/11/2026, ripeterlo non fa danni)
alter function public.expense_emoji_ok(text) set search_path to 'public';
alter function public.trg_events_confirmed_at() set search_path to 'public';

-- ---------- B4: avvisi leggibili solo dal destinatario collegato ----------
alter policy event_notices_select_own on public.event_notices
  using ((( select auth.uid() ) is not null) and (lower(trim(recipient_name)) = lower(trim(( select public.my_username() )))));
