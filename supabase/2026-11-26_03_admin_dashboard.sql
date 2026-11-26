-- M11 (audit 26/11/2026) - Pannello admin: l'email si legge da auth.users (email di accesso,
-- confermata), non da accounts.email (che il profilo poteva modificare). APPLICATA il 26/11/2026.
-- Compatibile con la 1.0: stessa funzione, stessa risposta; admin.html non cambia.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.get_admin_dashboard()'::regprocedure);
  v_new := replace(v_def,
    'select email into v_caller_email from public.accounts where id = auth.uid();',
    'select u.email into v_caller_email from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;');
  if v_new = v_def then raise exception 'get_admin_dashboard: punto non trovato'; end if;
  execute v_new;
end $$;
revoke execute on function public.get_admin_dashboard() from anon;

-- ROLLBACK: stesso blocco con le due stringhe scambiate; grant execute on function public.get_admin_dashboard() to anon;
