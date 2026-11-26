-- A4 (audit 26/11/2026) - "Blocca utente" anche lato server. APPLICATA il 26/11/2026.
-- Compatibile con l'app 1.0: stesse funzioni, stessi parametri, stessi formati di risposta.
-- Tabella user_blocks e RPC block_user/unblock_user/get_my_blocks erano gia' attive.

-- 1) Funzione di aiuto: c'e' un blocco tra due account (in un verso o nell'altro)?
create or replace function public.is_block_between(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = p_a and ub.blocked_id = p_b) or (ub.blocker_id = p_b and ub.blocked_id = p_a));
$$;
revoke all on function public.is_block_between(uuid, uuid) from public, anon, authenticated;
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

-- 2) get_event_public: i commenti di chi ho bloccato (o di chi mi ha bloccato) non arrivano piu'
--    al telefono, per nessuno (anche organizzatori). Modifica fatta con replace sul testo attuale
--    della funzione, cosi' tutto il resto resta identico.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.get_event_public(uuid,uuid)'::regprocedure);
  v_new := replace(v_def,
    'from public.event_comments c where c.event_id = v_event.id), ''[]''::json)',
    'from public.event_comments c where c.event_id = v_event.id and not public.is_block_between(auth.uid(), c.account_id)), ''[]''::json)');
  if v_new = v_def then raise exception 'get_event_public: punto dei commenti non trovato'; end if;
  execute v_new;
end $$;

-- 3) Richieste di amicizia: chi e' bloccato non puo' mandarne (messaggio generico, non dice del blocco)
--    e quelle gia' arrivate da un utente bloccato non si vedono piu'.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.request_friend_link(uuid,uuid)'::regprocedure);
  v_new := replace(v_def,
    'if not exists (select 1 from public.accounts where id = p_target_account_id) then',
    'if not exists (select 1 from public.accounts where id = p_target_account_id) or public.is_block_between(auth.uid(), p_target_account_id) then');
  if v_new = v_def then raise exception 'request_friend_link: punto non trovato'; end if;
  execute v_new;
end $$;

create or replace function public.get_my_pending_friend_requests()
 returns table(friend_id uuid, friend_list_name text, owner_username text, requested_at timestamp with time zone)
 language sql security definer set search_path to 'public' as $function$
  select f.id, fl.name, a.username, f.requested_at
  from public.friends f
  join public.friend_lists fl on fl.id = f.friend_list_id
  join public.accounts a on a.id = fl.owner_account_id
  where f.account_id = auth.uid() and f.link_status = 'pending'
    and not public.is_block_between(auth.uid(), fl.owner_account_id)
  order by f.requested_at desc;
$function$;

-- 4) Inviti agli eventi: se l'invitato ha bloccato l'organizzatore, l'invito resta solo come nome
--    (senza account collegato): l'evento non compare nella sua home e non gli arriva nessuna push/email.
create or replace function public.trg_event_invitees_block() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  if new.account_id is null then return new; end if;
  select created_by_account_id into v_org from public.events where id = new.event_id;
  if v_org is not null and new.account_id <> v_org and exists (
       select 1 from public.user_blocks where blocker_id = new.account_id and blocked_id = v_org) then
    new.account_id := null;
  end if;
  return new;
end $$;
revoke all on function public.trg_event_invitees_block() from public, anon, authenticated;
create trigger event_invitees_block_check before insert or update of account_id on public.event_invitees
  for each row execute function public.trg_event_invitees_block();

-- 5) Push dei commenti: la funzione Edge notify-event-comment (v10) salta chi ha un blocco con l'autore.

-- ROLLBACK:
-- drop trigger event_invitees_block_check on public.event_invitees; drop function public.trg_event_invitees_block();
-- rieseguire le versioni precedenti di get_event_public / request_friend_link / get_my_pending_friend_requests
-- (togliere le condizioni "is_block_between"), poi drop function public.is_block_between(uuid,uuid).
