-- GIÀ ESEGUITO il 2026-10-26 (copia di riferimento).
-- Notifiche nell'app vera (Fil, 2026-10-26). Da eseguire una volta su Supabase.
-- 1) funzione che salva il "token" del telefono come riga di push_subscriptions
create or replace function public.register_native_push(p_token text, p_platform text default 'android')
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_endpoint text; v_auth text;
begin
  if v_uid is null then raise exception 'Serve un account'; end if;
  if p_token is null or length(p_token) < 20 or length(p_token) > 4096 or p_token !~ '^[A-Za-z0-9:_\-]+$' then raise exception 'Token non valido'; end if;
  v_endpoint := 'https://kruphqdahghxuvutonae.supabase.co/functions/v1/native-push-relay?t=' || p_token;
  delete from public.push_subscriptions where endpoint = v_endpoint and account_id <> v_uid;
  if exists (select 1 from public.push_subscriptions where endpoint = v_endpoint and account_id = v_uid) then return; end if;
  v_auth := rtrim(translate(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/', '-_'), '=');
  insert into public.push_subscriptions (account_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, v_endpoint, 'BJ6Rt9_bAWOCtIoJ7W5bLoV7gN23n8VbtBWXoThZHli5cIrBZFTLNK3bjXeN8_dxoPxkNiD3yOn3B8KiUYKKtJE', v_auth, 'seeva-app-' || coalesce(p_platform, 'android'));
end $$;
-- 2) e quella che lo toglie
create or replace function public.unregister_native_push(p_token text)
returns void language sql security definer set search_path to 'public' as $$
  delete from public.push_subscriptions where account_id = auth.uid()
    and endpoint = 'https://kruphqdahghxuvutonae.supabase.co/functions/v1/native-push-relay?t=' || p_token;
$$;
