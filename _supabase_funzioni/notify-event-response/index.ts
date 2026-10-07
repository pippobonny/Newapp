import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, langsOf, sendPushToAccounts } from "./i18n.ts";

/* Notifica push SOLO per l'organizzatore "qualcuno ha risposto al tuo
   evento" (Fil, 2026-07-20). Solo push, mai email.
   Si rilegge l'evento per trovare l'organizzatore vero, MAI ci si fida del client.
   body atteso: { eventId, responderName, available: boolean, maybe?: boolean }
   2026-10-03: risposta "Forse". 2026-10-07: lingua dell'organizzatore (accounts.lang).
   Fire and forget da data.js. */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const eventId = body.eventId;
    const responderName = (body.responderName || "").trim();
    const available = !!body.available;
    const maybe = !available && !!body.maybe;
    if (!eventId || !responderName) return json({ skipped: true, reason: "eventId o responderName mancante" });

    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: event, error: eventErr } = await admin.from("events").select("id, name, created_by, created_by_account_id").eq("id", eventId).maybeSingle();
    if (eventErr || !event) return json({ skipped: true, reason: "evento non trovato" });

    let organizerAccountId: string | null = event.created_by_account_id || null;
    if (!organizerAccountId && event.created_by) {
      const { data: organizerAcc } = await admin.from("accounts").select("id").ilike("username", event.created_by).maybeSingle();
      if (organizerAcc) organizerAccountId = organizerAcc.id;
    }
    if (!organizerAccountId) return json({ skipped: true, reason: "organizzatore senza account collegato" });

    const lang = (await langsOf(admin, [organizerAccountId])).get(organizerAccountId) || "it";
    const eventUrl = siteUrl + "/evento.html?id=" + encodeURIComponent(event.id);
    const icon = available ? "✅ " : maybe ? "🤔 " : "❌ ";
    const bodyText = lang === "en"
      ? responderName + (available ? " is in" : maybe ? " said maybe" : " is out") + ' for "' + event.name + '"'
      : responderName + " ha risposto: " + (available ? "ci sarà" : maybe ? "forse" : "non ci sarà") + ' per "' + event.name + '"';

    const sentPush = await sendPushToAccounts(admin, [organizerAccountId], {
      title: icon + L(lang, "Nuova risposta", "New reply"),
      body: bodyText,
      url: eventUrl,
      lang
    });
    return json({ sentPush });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
