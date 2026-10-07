import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, Lang, langsOf, groupByLang, escHtml, buildEmailHtml, sendPushToAccounts, accountIdsWithPush, sendEmail } from "./i18n.ts";

/* Avviso a tutti gli invitati (Fil, 2026-10-07). Dal menu ⋮ della pagina
   evento, solo chi organizza.
   1) salva l'avviso in event_announcements (fisso in cima alla pagina);
   2) push a tutti gli invitati/partecipanti con account (tranne chi
      organizza e chi ha detto "non ci sono"); email a chi non ha le push.
   verify_jwt = true. Anti doppio tap: niente secondo avviso entro 30s.
   Testi nella lingua di chi riceve (accounts.lang); il messaggio resta
   com'è stato scritto. */
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
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return jsonRes({ error: "Sessione mancante" }, 401);
    const body = await req.json().catch(() => ({}));
    const eventId = body.eventId;
    const message = String(body.message || "").replace(/\r\n/g, "\n").trim();
    const en = body.lang === "en"; // lingua di chi scrive, per i messaggi d'errore
    if (!eventId) return jsonRes({ error: "eventId mancante" }, 400);
    if (!message) return jsonRes({ error: en ? "Write your message" : "Scrivi il messaggio" }, 400);
    if (message.length > 1000) return jsonRes({ error: en ? "Message too long (1000 characters max)" : "Messaggio troppo lungo (max 1000 caratteri)" }, 400);

    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes || !userRes.user) return jsonRes({ error: "Sessione non valida" }, 401);
    const userId = userRes.user.id;

    const { data: event } = await admin.from("events")
      .select("id, name, created_by, created_by_account_id, cancelled_at, confirmed_date_option_id")
      .eq("id", eventId).maybeSingle();
    if (!event) return jsonRes({ error: en ? "Event not found" : "Evento non trovato" }, 404);
    if (event.created_by_account_id !== userId) return jsonRes({ error: en ? "Only the organiser can send a message" : "Solo chi organizza può mandare un avviso" }, 403);
    if (event.cancelled_at) return jsonRes({ error: en ? "The event has been cancelled" : "L'evento è annullato" }, 400);

    const since = new Date(Date.now() - 30000).toISOString();
    const { data: recent } = await admin.from("event_announcements").select("id").eq("event_id", eventId).gte("created_at", since).limit(1);
    if (recent && recent.length) return jsonRes({ error: en ? "You've just sent a message, wait a few seconds" : "Hai appena mandato un avviso, aspetta qualche secondo" }, 429);

    const { data: inserted, error: insErr } = await admin.from("event_announcements")
      .insert({ event_id: eventId, author_account_id: userId, author_name: event.created_by || null, message })
      .select("id, created_at").single();
    if (insErr) return jsonRes({ error: insErr.message }, 500);

    const [{ data: invitees }, { data: participants }] = await Promise.all([
      admin.from("event_invitees").select("name, account_id").eq("event_id", eventId),
      admin.from("participants").select("name, account_id, available_date_option_ids, maybe").eq("event_id", eventId)
    ]);
    const organizerLower = String(event.created_by || "").trim().toLowerCase();
    // Niente avviso a chi ha detto "non ci sono"; "Forse" lo riceve.
    const saidNo = (participants || []).filter((p: any) => {
      if (p.maybe) return false;
      const ids: string[] = p.available_date_option_ids || [];
      return event.confirmed_date_option_id ? ids.indexOf(event.confirmed_date_option_id) === -1 : ids.length === 0;
    });
    const noIds = new Set(saidNo.map((p: any) => p.account_id).filter(Boolean));
    const noNames = new Set(saidNo.map((p: any) => String(p.name || "").trim().toLowerCase()).filter(Boolean));
    const people = [...(invitees || []), ...(participants || [])].filter((p: any) => {
      if (p.account_id && noIds.has(p.account_id)) return false;
      if (noNames.has(String(p.name || "").trim().toLowerCase())) return false;
      if (p.account_id && p.account_id === userId) return false;
      if (String(p.name || "").trim().toLowerCase() === organizerLower) return false;
      return true;
    });
    const recipientIds: string[] = Array.from(new Set(people.map((p: any) => p.account_id).filter(Boolean)));
    const reachableNamesLower = new Set(people.filter((p: any) => !!p.account_id).map((p: any) => String(p.name || "").trim().toLowerCase()));
    const unreachableNames: string[] = Array.from(new Set(people
      .filter((p: any) => !p.account_id && !reachableNamesLower.has(String(p.name || "").trim().toLowerCase()))
      .map((p: any) => String(p.name || "").trim()).filter(Boolean)));

    const eventUrl = siteUrl + "/evento.html?id=" + encodeURIComponent(event.id);
    const shortMsg = message.length > 180 ? message.slice(0, 180).replace(/\s+\S*$/, "") + "…" : message;

    let sentPush = 0, sentEmails = 0;
    if (recipientIds.length) {
      const pushIds = await accountIdsWithPush(admin, recipientIds);
      const { data: accounts } = await admin.from("accounts").select("id, email").in("id", recipientIds);
      const groups = groupByLang(recipientIds, await langsOf(admin, recipientIds));
      for (const lang of ["it", "en"] as Lang[]) {
        const ids = groups[lang];
        if (!ids.length) continue;
        const organizer = event.created_by || L(lang, "L'organizzatore", "The organiser");
        sentPush += await sendPushToAccounts(admin, ids, { title: "📣 " + event.name + L(lang, " — avviso da ", " — message from ") + organizer, body: shortMsg, url: eventUrl, lang });
        const emails: string[] = [];
        (accounts || []).forEach((a: any) => { if (ids.indexOf(a.id) !== -1 && !pushIds.has(a.id) && a.email && emails.indexOf(a.email) === -1) emails.push(a.email); });
        if (emails.length) {
          const html = buildEmailHtml({
            lang, emoji: "📣",
            title: L(lang, "Avviso per \"", "Message about \"") + escHtml(event.name) + "\"",
            preheader: escHtml(organizer + ": " + shortMsg),
            bodyHtml: '<p><b>' + escHtml(organizer) + '</b>' + L(lang, ' ha scritto a tutti gli invitati:', ' wrote to all the guests:') + '</p>'
              + '<p style="background:#FFF4EC; border-radius:12px; padding:12px 14px; text-align:left; white-space:pre-wrap;">' + escHtml(message) + '</p>',
            ctaText: L(lang, "Apri l'evento", "Open the event"),
            ctaUrl: eventUrl
          });
          for (const email of emails) {
            if (await sendEmail(email, L(lang, '📣 Avviso per "', '📣 Message about "') + event.name + '"', html)) sentEmails++;
          }
        }
      }
    }
    return jsonRes({ id: inserted.id, notified: recipientIds.length, unreachableNames, sentPush, sentEmails });
  } catch (err) {
    return jsonRes({ error: String(err) }, 500);
  }
});
