import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, Lang, langsOf, groupByLang, sendPushToAccounts } from "./i18n.ts";

/* Notifica di un nuovo commento (Fil, 2026-10-26): a tutti gli invitati
   (e a chi organizza) tranne chi ha detto "Non ci sono" e tranne chi ha
   scritto il commento. Solo push, niente email.
   Chiamata da evento.html subito dopo post_event_comment, anche da chi
   risponde come ospite senza account: per questo verify_jwt = false e i
   controlli sono qui -- il commento deve esistere, essere di meno di 10
   minuti fa e non essere già stato notificato (event_comments.notified_at,
   preso con un update atomico: mai due notifiche per lo stesso commento). */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function jsonRes(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const commentId = body.commentId;
    if (!commentId || typeof commentId !== "string") return jsonRes({ error: "commentId mancante" }, 400);

    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: claimed, error: claimErr } = await admin.from("event_comments")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", commentId).is("notified_at", null).eq("is_from_response", false).gte("created_at", tenMinAgo)
      .select("id, event_id, account_id, author_name, message");
    if (claimErr) return jsonRes({ error: claimErr.message }, 500);
    if (!claimed || !claimed.length) return jsonRes({ notified: 0, skipped: true });
    const c = claimed[0];

    const { data: event } = await admin.from("events")
      .select("id, name, created_by_account_id, confirmed_date_option_id, cancelled_at")
      .eq("id", c.event_id).maybeSingle();
    if (!event || event.cancelled_at) return jsonRes({ notified: 0 });

    const [{ data: invitees }, { data: parts }] = await Promise.all([
      admin.from("event_invitees").select("account_id").eq("event_id", event.id),
      admin.from("participants").select("account_id, available_date_option_ids, maybe").eq("event_id", event.id)
    ]);

    // Chi ha detto "Non ci sono": nessuna data e non forse; su un evento
    // confermato anche chi non c'è nella data scelta (e non ha detto forse).
    const saidNo = new Set((parts || []).filter((p: any) => {
      if (!p.account_id || p.maybe) return false;
      const ids = p.available_date_option_ids || [];
      if (ids.length === 0) return true;
      return !!event.confirmed_date_option_id && ids.indexOf(event.confirmed_date_option_id) === -1;
    }).map((p: any) => p.account_id));

    const all = new Set<string>();
    (invitees || []).forEach((i: any) => { if (i.account_id) all.add(i.account_id); });
    (parts || []).forEach((p: any) => { if (p.account_id) all.add(p.account_id); });
    if (event.created_by_account_id) all.add(event.created_by_account_id);
    const recipients = Array.from(all).filter((id) => id !== c.account_id && !saidNo.has(id));
    if (!recipients.length) return jsonRes({ notified: 0 });

    const author = String(c.author_name || "").trim();
    const msg = String(c.message || "").replace(/\s+/g, " ").trim();
    const short = msg.length > 110 ? msg.slice(0, 110).replace(/\s+\S*$/, "") + "…" : msg;
    const url = siteUrl + "/evento.html?id=" + encodeURIComponent(event.id) + "&commenti=1";
    const groups = groupByLang(recipients, await langsOf(admin, recipients));
    let sent = 0;
    for (const lang of ["it", "en"] as Lang[]) {
      if (!groups[lang].length) continue;
      sent += await sendPushToAccounts(admin, groups[lang], {
        title: "💬 " + event.name,
        body: (author || L(lang, "Qualcuno", "Someone")) + ": " + short + "\n" + L(lang, "👉 Apri per rispondere", "👉 Open to reply"),
        url, lang, tag: "comment|" + event.id
      });
    }
    return jsonRes({ notified: recipients.length, sentPush: sent });
  } catch (err) {
    return jsonRes({ error: String(err) }, 500);
  }
});
