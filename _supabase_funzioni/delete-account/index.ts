import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { revokeAppleSignIn, userHasAppleIdentity } from "./apple-revoke.ts";

/* Cancella per sempre l'account di CHI CHIAMA (mai un id passato dal client:
   il chiamante è sempre e solo quello del token Authorization della sessione
   corrente — supabase.functions.invoke() lo manda già da solo).

   Perché non basta una DELETE su accounts: accounts.id -> auth.users.id è
   ON DELETE CASCADE (cancellare l'utente Auth cancella da solo la riga
   accounts), MA diverse tabelle che puntano a accounts.id sono apposta
   NO ACTION invece di CASCADE (event_expense_shares.account_id,
   event_expenses.paid_by_account_id/created_by_account_id,
   event_invitees.account_id, friend_lists.owner_account_id) — per non far
   sparire in un colpo solo, senza nessun controllo, dati che riguardano
   ANCHE altre persone (le spese di un evento condiviso, chi l'ha creato).
   Con NO ACTION, cancellare l'utente Auth mentre queste righe esistono
   ancora fallisce e basta.

   Quindi prima di cancellare davvero, "sganciamo" questo account da tutto
   quello che può restare orfano senza problemi (colonne nullable → NULL,
   stesso comportamento automatico che il DB già usa altrove per
   events.created_by_account_id/friends.account_id/ecc.). L'unica colonna
   bloccante NOT NULL è event_expenses.created_by_account_id (chi ha
   registrato la spesa): lì non si può mettere NULL, quindi la si riassegna
   a un account segnaposto fisso "Utente eliminato" — così il resoconto
   spese di un evento condiviso resta leggibile per gli altri partecipanti
   anche dopo che te ne sei andato/a.

   Diversa dalle altre function di quest'app: qui verify_jwt resta true
   (il gateway rifiuta da solo le chiamate senza sessione valida, a
   differenza di create-account/request-password-reset che devono per
   forza funzionare anche senza sessione). Il controllo qui sotto con la
   Admin API resta comunque, per leggere l'id vero del chiamante invece di
   fidarci di un id mandato dal client.

   2026-10-14: copia salvata in cartella (prima esisteva solo su Supabase),
   identica alla versione pubblicata (v1).

   2026-11-25 (v4, NON ANCORA PUBBLICATA): revoca di "Accedi con Apple"
   (requisito App Store). Se il body contiene appleAuthorizationCode (lo manda
   l'app iPhone) e l'utente è entrato con Apple, prima di cancellare si chiede
   ad Apple di revocare il collegamento (vedi apple-revoke.ts). Mai bloccante:
   senza segreti APPLE_* o se Apple non risponde, l'eliminazione prosegue.
   Da pubblicare INSIEME ad apple-revoke.ts, verify_jwt = true come prima. */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// Riga fissa in public.accounts (con un utente Auth "fantasma" abbinato,
// creato una volta sola a mano — vedi setup) che raccoglie l'attribuzione
// delle spese di chi ha cancellato l'account. Mai usabile per accedere:
// niente password reale, email inventata.
const DELETED_USER_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";

function errRes(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return errRes("Sessione mancante", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes || !userRes.user) return errRes("Sessione non valida", 401);
    const userId = userRes.user.id;

    if (userId === DELETED_USER_ACCOUNT_ID) return errRes("Operazione non permessa", 400);

    // Body facoltativo: { appleAuthorizationCode?: string } (solo app iPhone)
    let body: { appleAuthorizationCode?: string } = {};
    try { body = await req.json(); } catch (_e) { body = {}; }

    // Revoca Apple PRIMA di cancellare (dopo non sapremmo più chi era).
    // Non lancia mai errori: l'esito finisce solo nei log e nella risposta.
    const apple = await revokeAppleSignIn({
      authorizationCode: body && body.appleAuthorizationCode,
      userUsesApple: userHasAppleIdentity(userRes.user),
      getEnv: (name) => Deno.env.get(name)
    });
    if (apple.status !== "skipped" || userHasAppleIdentity(userRes.user)) {
      console.log("delete-account apple revoke:", JSON.stringify(apple));
    }

    const steps = await Promise.all([
      admin.from("event_expense_shares").update({ account_id: null }).eq("account_id", userId),
      admin.from("event_expenses").update({ paid_by_account_id: null }).eq("paid_by_account_id", userId),
      admin.from("event_expenses").update({ created_by_account_id: DELETED_USER_ACCOUNT_ID }).eq("created_by_account_id", userId),
      admin.from("event_invitees").update({ account_id: null }).eq("account_id", userId),
      admin.from("friend_lists").update({ owner_account_id: null }).eq("owner_account_id", userId)
    ]);
    for (const step of steps) {
      if (step.error) return errRes("Non sono riuscito a preparare la cancellazione (" + step.error.message + ")", 500);
    }

    const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
    if (deleteErr) return errRes(deleteErr.message, 500);

    return new Response(JSON.stringify({ ok: true, appleRevoke: apple.status }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    return errRes(String(err), 500);
  }
});
