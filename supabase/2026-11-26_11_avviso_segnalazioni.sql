-- A4.6 (audit 26/11/2026) - Avviso email a Filippo per le segnalazioni (Apple: reazione entro 24 ore).
-- NON applicato. Ordine: 1) questo SQL (colonna), 2) pubblicare la funzione
-- _supabase_funzioni/send-report-alerts (NON ancora pubblicata) (verify_jwt = true), 3) il cron qui sotto.
-- Compatibile con la 1.0 (aggiunge solo una colonna e un cron).
alter table public.problem_reports add column if not exists alert_sent_at timestamptz;
-- le segnalazioni vecchie non devono partire tutte insieme:
update public.problem_reports set alert_sent_at = now() where alert_sent_at is null;

-- Cron ogni 15 minuti: copia indirizzo e intestazioni dal cron gia' esistente "auto-nudges-hourly"
-- (cosi' nessuna chiave finisce scritta in questo file).
select cron.schedule('report-alerts-15min', '*/15 * * * *',
  (select replace(command, '/functions/v1/send-auto-nudges', '/functions/v1/send-report-alerts') from cron.job where jobname = 'auto-nudges-hourly'));

-- Per spegnerlo: select cron.unschedule('report-alerts-15min');
