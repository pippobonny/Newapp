-- Già applicata su Supabase il 2026-11-02 (migrazione events_confirmed_at_2026_11_02).
-- Momento esatto in cui l'evento è stato confermato: la notifica "è confermato"
-- non deve risalire in cima a ogni nuova risposta.
alter table public.events add column if not exists confirmed_at timestamptz;
update public.events e set confirmed_at = coalesce(
  (select max(p.created_at) from public.participants p where p.event_id = e.id), e.created_at)
where e.confirmed_date_option_id is not null and e.confirmed_at is null;
create or replace function public.trg_events_confirmed_at() returns trigger language plpgsql as $$
begin
  if new.confirmed_date_option_id is null then new.confirmed_at := null;
  elsif tg_op = 'INSERT' or old.confirmed_date_option_id is null then new.confirmed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists events_confirmed_at on public.events;
create trigger events_confirmed_at before insert or update of confirmed_date_option_id on public.events
for each row execute function public.trg_events_confirmed_at();
