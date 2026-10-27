import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, Lang, langsOf, groupByLang, sendPushToAccounts } from "./i18n.ts";

/* Notifiche dei sondaggi dentro l'evento (Fil, 2026-10-27).
   - { pollId }: nuovo sondaggio -> push a tutti gli invitati tranne chi ha
     detto "Non ci sono" e tranne chi organizza (che l'ha creato).
   - { optionId }: qualcuno ha aggiunto un'opzione -> push solo a chi
     organizza (se non è lui stesso ad averla aggiunta).
   Chiamata da evento.html anche da ospiti senza account: verify_jwt = false,
   i controlli sono qui (riga creata da meno di 10 minuti, notified_at preso
   con update atomico: mai due notifiche per la stessa cosa). Solo push. */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function jsonRes(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function shorten(s: string, n: number) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + "…" : t;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const pollId = typeof body.pollId === "string" ? body.pollId : null;
    const optionId = typeof body.optionId === "string" ? body.optionId : null;
    if (!pollId && !optionId) return jsonRes({ error: "pollId o optionId mancante" }, 400);

    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    if (pollId) {
      const { data: claimed, error } = await admin.from("event_polls")
        .update({ notified_at: now })
        .eq("id", pollId).is("notified_at", null).gte("created_at", tenMinAgo)
        .select("id, event_id, question");
      if (error) return jsonRes({ error: error.message }, 500);
      if (!claimed || !claimed.length) return jsonRes({ notified: 0, skipped: true });
      const poll = claimed[0];

      const { data: event } = await admin.from("events")
        .select("id, name, created_by, created_by_account_id, confirmed_date_option_id, cancelled_at")
        .eq("id", poll.event_id).maybeSingle();
      if (!event || event.cancelled_at) return jsonRes({ notified: 0 });

      const [{ data: invitees }, { data: parts }] = await Promise.all([
        admin.from("event_invitees").select("account_id").eq("event_id", event.id),
        admin.from("participants").select("account_id, available_date_option_ids, maybe").eq("event_id", event.id)
      ]);
      // "Non ci sono": stessa regola di notify-event-comment.
      const saidNo = new Set((parts || []).filter((p: any) => {
        if (!p.account_id || p.maybe) return false;
        const ids = p.available_date_option_ids || [];
        if (ids.length === 0) return true;
        return !!event.confirmed_date_option_id && ids.indexOf(event.confirmed_date_option_id) === -1;
      }).map((p: any) => p.account_id));
      const all = new Set<string>();
      (invitees || []).forEach((i: any) => { if (i.account_id) all.add(i.account_id); });
      (parts || []).forEach((p: any) => { if (p.account_id) all.add(p.account_id); });
      const recipients = Array.from(all).filter((id) => id !== event.created_by_account_id && !saidNo.has(id));
      if (!recipients.length) return jsonRes({ notified: 0 });

      const org = String(event.created_by || "").trim();
      const q = shorten(poll.question, 110);
      const url = siteUrl + "/evento.html?id=" + encodeURIComponent(event.id) + "&sondaggio=1";
      const groups = groupByLang(recipients, await langsOf(admin, recipients));
      let sent = 0;
      for (const lang of ["it", "en"] as Lang[]) {
        if (!groups[lang].length) continue;
        sent += await sendPushToAccounts(admin, groups[lang], {
          title: "📊 " + event.name,
          body: (org || L(lang, "Chi organizza", "The organiser")) + L(lang, " ha aperto un sondaggio: ", " started a poll: ") + q
            + "\n" + L(lang, "👉 Apri per votare", "👉 Open to vote"),
          url, lang, tag: "poll|" + poll.id
        });
      }
      return jsonRes({ notified: recipients.length, sentPush: sent });
    }

    // Nuova opzione -> solo all'organizzatore
    const { data: claimedOpt, error: optErr } = await admin.from("event_poll_options")
      .update({ notified_at: now })
      .eq("id", optionId!).is("notified_at", null).gte("created_at", tenMinAgo)
      .select("id, poll_id, text, added_by_name, added_by_account_id");
    if (optErr) return jsonRes({ error: optErr.message }, 500);
    if (!claimedOpt || !claimedOpt.length) return jsonRes({ notified: 0, skipped: true });
    const opt = claimedOpt[0];
    const { data: poll } = await admin.from("event_polls").select("id, event_id, question, closed_at").eq("id", opt.poll_id).maybeSingle();
    if (!poll || poll.closed_at) return jsonRes({ notified: 0 });
    const { data: event } = await admin.from("events")
      .select("id, name, created_by, created_by_account_id, cancelled_at").eq("id", poll.event_id).maybeSingle();
    if (!event || event.cancelled_at || !event.created_by_account_id) return jsonRes({ notified: 0 });
    if (opt.added_by_account_id === event.created_by_account_id) return jsonRes({ notified: 0 });
    if (!opt.added_by_account_id && String(opt.added_by_name || "").trim().toLowerCase() === String(event.created_by || "").trim().toLowerCase()) return jsonRes({ notified: 0 });

    const langs = await langsOf(admin, [event.created_by_account_id]);
    const lang = langs.get(event.created_by_account_id) || "it";
    const who = String(opt.added_by_name || "").trim() || L(lang, "Qualcuno", "Someone");
    const sent = await sendPushToAccounts(admin, [event.created_by_account_id], {
      title: "📊 " + event.name,
      body: who + L(lang, " ha aggiunto «", " added “") + shorten(opt.text, 60) + L(lang, "» al sondaggio «", "” to the poll “") + shorten(poll.question, 60) + L(lang, "»", "”"),
      url: siteUrl + "/evento.html?id=" + encodeURIComponent(event.id) + "&sondaggio=1",
      lang, tag: "pollopt|" + poll.id
    });
    return jsonRes({ notified: 1, sentPush: sent });
  } catch (err) {
    return jsonRes({ error: String(err) }, 500);
  }
});
