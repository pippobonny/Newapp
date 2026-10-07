import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, Lang, langsOf, groupByLang, dayLabel, sendPushToAccounts } from "./i18n.ts";

/* Data scelta A MANO dall'organizzatore (pulsante "Conferma" in
   evento.html, Fil 2026-10-04). Stessi messaggi della chiusura automatica
   del voto in send-event-reminders:
   - a chi c'è / non ha ancora risposto / forse: "✅ Si fa! <evento>";
   - a chi aveva votato SOLO altre date: "quel giorno non c'eri";
   - a chi aveva detto di no a tutto: niente.
   verify_jwt true: l'organizzatore si riconosce dal token.
   2026-10-07: testi nella lingua di chi riceve (accounts.lang). */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function jsonRes(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function whenLabel(iso: string, eventTime: string | null, lang: Lang): string {
  return dayLabel(iso, lang) + (eventTime ? L(lang, " alle ", " at ") + String(eventTime).slice(0, 5) : "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonRes({ error: "Sessione mancante" }, 401);
    const body = await req.json().catch(() => ({}));
    const eventId = body.eventId;
    if (!eventId) return jsonRes({ error: "eventId mancante" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes || !userRes.user) return jsonRes({ error: "Sessione non valida" }, 401);

    const { data: event } = await admin.from("events")
      .select("id, name, created_by_account_id, confirmed_date_option_id, confirmed_location_option_id, location_address, event_time, cancelled_at")
      .eq("id", eventId).maybeSingle();
    if (!event) return jsonRes({ error: "Evento non trovato" }, 404);
    if (event.created_by_account_id !== userRes.user.id) return jsonRes({ error: "Solo chi organizza" }, 403);
    if (!event.confirmed_date_option_id || event.cancelled_at) return jsonRes({ error: "Evento non confermato" }, 400);

    const [{ data: opt }, { data: invitees }, { data: parts }, { data: locOpts }] = await Promise.all([
      admin.from("date_options").select("id, date_iso").eq("id", event.confirmed_date_option_id).maybeSingle(),
      admin.from("event_invitees").select("account_id").eq("event_id", eventId),
      admin.from("participants").select("account_id, available_date_option_ids, maybe").eq("event_id", eventId),
      admin.from("location_options").select("id, address").eq("event_id", eventId)
    ]);
    if (!opt) return jsonRes({ error: "Data non trovata" }, 400);
    const winnerId = opt.id;

    let locationText = event.location_address ? String(event.location_address) : "";
    const lopts = locOpts || [];
    if (lopts.length === 1) locationText = String(lopts[0].address || "");
    else if (lopts.length > 1) {
      const c = lopts.find((l: any) => l.id === event.confirmed_location_option_id);
      locationText = c ? String(c.address || "") : "";
    }

    const P = parts || [];
    const notMine = new Set(P.filter((p: any) => p.account_id && p.account_id !== event.created_by_account_id
      && (p.available_date_option_ids || []).length > 0 && (p.available_date_option_ids || []).indexOf(winnerId) === -1)
      .map((p: any) => p.account_id));
    const saidNo = new Set(P.filter((p: any) => p.account_id && !p.maybe && (p.available_date_option_ids || []).length === 0).map((p: any) => p.account_id));
    const others = Array.from(new Set((invitees || []).map((i: any) => i.account_id).filter(Boolean)))
      .filter((id: any) => id !== event.created_by_account_id && !notMine.has(id) && !saidNo.has(id)) as string[];
    const notMineIds = Array.from(notMine) as string[];

    const url = siteUrl + "/evento.html?id=" + encodeURIComponent(event.id);
    const langs = await langsOf(admin, others.concat(notMineIds));
    const gOthers = groupByLang(others, langs);
    const gNot = groupByLang(notMineIds, langs);
    let sent = 0;
    for (const lang of ["it", "en"] as Lang[]) {
      const lines = ["📅 " + whenLabel(String(opt.date_iso), event.event_time || null, lang)];
      if (locationText) lines.push("📍 " + locationText);
      lines.push(L(lang, "👉 Apri per vedere chi viene", "👉 Open to see who's coming"));
      sent += await sendPushToAccounts(admin, gOthers[lang], { title: L(lang, "✅ Si fa! ", "✅ It's on! ") + event.name, body: lines.join("\n"), url, lang });
      sent += await sendPushToAccounts(admin, gNot[lang], {
        title: "📅 " + event.name + L(lang, ": scelta ", ": chosen date ") + whenLabel(String(opt.date_iso), null, lang),
        body: L(lang, "Quel giorno non c'eri: l'abbiamo messo tra i tuoi annullati.\n👉 Se invece riesci a esserci, apri e rispondi",
          "You weren't free that day: we've moved it to your cancelled events.\n👉 If you can make it after all, open it and reply"),
        url, lang
      });
    }
    return jsonRes({ siFa: others.length, notMine: notMine.size, sentPush: sent });
  } catch (err) {
    return jsonRes({ error: String(err) }, 500);
  }
});
