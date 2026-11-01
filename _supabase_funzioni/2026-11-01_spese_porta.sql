-- Rifacimento Divisione spese + Chi porta cosa (Fil, 2026-11-01)
-- GIÀ APPLICATO su Supabase da Claude (migrazioni spese_porta_2026_11_01 e
-- get_event_public_spese_porta). Copia di riferimento, non serve rilanciarlo.

alter table public.event_expenses add column if not exists split_all boolean not null default false; -- "tra tutti", segue il gruppo da solo
alter table public.event_expenses add column if not exists notified_at timestamptz;                  -- push "nuova spesa" già mandata
alter table public.event_items add column if not exists expense_id uuid references public.event_expenses(id) on delete set null; -- costo della voce
alter table public.events add column if not exists expense_summary_sent_at timestamptz;              -- riepilogo conti mattina dopo
alter table public.events add column if not exists items_reminder_sent_at timestamptz;               -- promemoria cosa portare

-- Nuove funzioni (definizioni complete sul DB):
--  expense_group(event)            chi è "tutti": confermati dopo la conferma, chi ha detto sì prima
--  resync_split_all_shares(event)  riallinea le quote delle spese split_all
--  trigger resync_shares_on_participants (participants) e resync_shares_on_confirm (events.confirmed_date_option_id)
--  can_be_in_expense(event, name)  chi può pagare/essere incluso (anche prima della conferma)
--  expense_emoji_ok(emoji)         emoji ammesse (più di prima: 🥩🍰🍺🍷⛽🎟️🧊🍝☕🥖🎁🏨🚗✈️🚆)
--  set_event_item_cost(item, amount)  "+ €" su una voce: crea/aggiorna/toglie la spesa collegata
-- Cambiate: add_event_expense / update_event_expense (nuovo p_split_all, valgono anche prima della
--  conferma), release_event_item / delete_event_item (tolgono la spesa collegata),
--  get_event_public (expenses.splitAll, items.expenseId, items.cost).
