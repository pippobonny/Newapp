-- GIA' APPLICATA su Supabase il 2026-11-25 (punti 1-3; il cron è stato creato copiando il comando del cron "send-event-reminders-daily", così la chiave non è in questo file).
-- Solleciti automatici (max 3, uno ogni 24 ore) a chi non ha risposto a un invito.

-- 1) Chi non vuole i solleciti automatici (da collegare a un interruttore nel Profilo, in seguito).
alter table public.accounts add column if not exists auto_nudges_off boolean not null default false;

-- 2) Registro dei solleciti già mandati: uno per (evento, persona).
create table if not exists public.event_auto_nudges (
  event_id uuid not null,
  account_id uuid not null,
  sent_count int not null default 0,
  last_sent_at timestamptz,
  primary key (event_id, account_id)
);
alter table public.event_auto_nudges enable row level security;  -- nessuna policy: lo usa solo la funzione (service role)

-- 3) "Prenota" un sollecito in modo atomico: true = puoi mandarlo, false = no.
--    p_since = da quando contare le 24 ore se non c'è ancora nessun sollecito (data dell'invito).
create or replace function public.claim_auto_nudge(p_event uuid, p_account uuid, p_since timestamptz, p_hours int, p_max int)
returns boolean language plpgsql security definer set search_path = public as $$
declare ok boolean := false;
begin
  insert into public.event_auto_nudges(event_id, account_id, sent_count, last_sent_at)
  values (p_event, p_account, 0, null) on conflict do nothing;
  update public.event_auto_nudges
     set sent_count = sent_count + 1, last_sent_at = now()
   where event_id = p_event and account_id = p_account
     and sent_count < p_max
     and coalesce(last_sent_at, p_since) <= now() - make_interval(hours => p_hours)
  returning true into ok;
  return coalesce(ok, false);
end $$;
revoke all on function public.claim_auto_nudge(uuid, uuid, timestamptz, int, int) from public, anon, authenticated;

-- 4) Cron: ogni ora al minuto 20 (la funzione manda solo tra le 9 e le 20 ora di Roma).
--    Stessa forma dei cron già esistenti (chiave anon pubblica di Seeva).
select cron.schedule('auto-nudges-hourly', '20 * * * *', $$
  select net.http_post(
    url := 'https://kruphqdahghxuvutonae.supabase.co/functions/v1/send-auto-nudges',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer <STESSA CHIAVE usata dai cron esistenti (vedi cron.job)>',
      'apikey','<STESSA CHIAVE>'),
    body := '{}'::jsonb
  );
$$);
