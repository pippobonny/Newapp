import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, langsOf, dayLabel, escHtml, buildEmailHtml, sendPushToAccounts, accountIdsWithPush, sendEmail } from "./i18n.ts";

/* Email + notifica push "una data che avevi confermato e' stata tolta
   dall'evento" (Fil, 2026-07-07). data.js -> updateEvent() passa chi ha
   perso quali date (il calcolo va fatto PRIMA della modifica).
   body atteso: { eventId, affected: [{ name, dateLabels: string[], dateISOs?: string[] }] }
   Fire and forget. Chi ha la push non riceve anche l'email.
   2026-10-07: testi e date nella lingua di chi riceve (accounts.lang).
   2026-10-14 (revisione sicurezza): verify_jwt = true e solo l'organizzatore
   dell'evento può chiamarla; nome evento letto dal DB; destinatari solo tra
   invitati/partecipanti dell'evento; le date si accettano solo come
   AAAA-MM-GG (o etichette brevi, sempre "ripulite" per l'email). */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const low = (s: unknown) => String(s || "").trim().toLowerCase();
const ISO = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const eventId = body.eventId || null;
    const affected: Array<{ name: string; dateLabels?: string[]; dateISOs?: string[] }> = Array.isArray(body.affected) ? body.affected : [];
    if (!eventId || !affected.length) return json({ skipped: true, reason: "eventId o affected mancante" });

    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes || !userRes.user) return json({ error: "Sessione non valida" }, 401);
    const { data: event } = await admin.from("events").select("id, name, created_by_account_id").eq("id", eventId).maybeSingle();
    if (!event) return json({ skipped: true, reason: "evento non trovato" });
    if (event.created_by_account_id !== userRes.user.id) return json({ error: "Solo chi organizza" }, 403);
    const eventName = String(event.name || "");
    const nameHtml = escHtml(eventName);

    const [{ data: inv }, { data: parts }] = await Promise.all([
      admin.from("event_invitees").select("name, account_id").eq("event_id", eventId),
      admin.from("participants").select("name, account_id").eq("event_id", eventId)
    ]);
    const members = new Map<string, string | null>();
    (inv || []).concat(parts || []).forEach((m: any) => {
      const k = low(m.name);
      if (k && (!members.has(k) || m.account_id)) members.set(k, m.account_id || null);
    });

    const valid = affected.filter((a) => a && members.has(low(a.name)));
    const unlinked = valid.filter((a) => !members.get(low(a.name))).map((a) => String(a.name));
    const byUsername = new Map<string, string>();
    if (unlinked.length) {
      const { data: byName } = await admin.rpc("accounts_by_usernames", { p_names: unlinked });
      (byName || []).forEach((a: any) => byUsername.set(low(a.username), a.id));
    }
    const resolved: Array<{ entry: any; id: string }> = [];
    valid.forEach((a) => {
      const id = members.get(low(a.name)) || byUsername.get(low(a.name));
      if (id && id !== userRes.user.id) resolved.push({ entry: a, id });
    });
    if (!resolved.length) return json({ sentEmails: 0, sentPush: 0, reason: "nessun destinatario valido" });

    const ids = Array.from(new Set(resolved.map((r) => r.id)));
    const { data: accs } = await admin.from("accounts").select("id, email").in("id", ids);
    const emailOf = new Map<string, string | null>((accs || []).map((a: any) => [a.id, a.email || null]));
    const eventUrl = siteUrl + "/evento.html?id=" + encodeURIComponent(eventId);
    const pushIds = await accountIdsWithPush(admin, ids);
    const langs = await langsOf(admin, ids);

    let sentEmails = 0, sentPush = 0;
    for (const r of resolved) {
      const lang = langs.get(r.id) || "it";
      const isos = (Array.isArray(r.entry.dateISOs) ? r.entry.dateISOs : []).map(String).filter((s: string) => ISO.test(s)).slice(0, 20);
      const labels = isos.length
        ? isos.map((iso: string) => dayLabel(iso, lang)).join(", ")
        : (Array.isArray(r.entry.dateLabels) ? r.entry.dateLabels : []).map((s: unknown) => String(s).slice(0, 30)).slice(0, 20).join(", ");
      const email = emailOf.get(r.id);
      if (!pushIds.has(r.id) && email) {
        const html = buildEmailHtml({
          lang, accent: "#FF7A29", emoji: "\u{1F5D3}\u{FE0F}",
          title: L(lang, "Una data è stata tolta", "A date has been removed"),
          preheader: L(lang, 'Per "' + nameHtml + '" è cambiata una data', 'A date has changed for "' + nameHtml + '"'),
          bodyHtml: L(lang,
            '<p>Per <b>"' + nameHtml + '"</b> l\'organizzatore ha tolto la data a cui avevi detto di esserci: <b>' + escHtml(labels) + '</b>.</p>',
            '<p>For <b>"' + nameHtml + '"</b> the organiser has removed the date you said you were in for: <b>' + escHtml(labels) + '</b>.</p>'),
          ctaText: L(lang, "Vedi le date rimaste", "See the remaining dates"),
          ctaUrl: eventUrl
        });
        if (await sendEmail(email, L(lang, 'Una data è stata tolta da "' + eventName + '"', 'A date has been removed from "' + eventName + '"'), html)) sentEmails++;
      }
      sentPush += await sendPushToAccounts(admin, [r.id], {
        title: L(lang, "Una data è stata tolta 🗓️", "A date has been removed 🗓️"),
        body: L(lang, 'Per "' + eventName + '" è stata tolta la data: ', 'For "' + eventName + '" this date has been removed: ') + labels,
        url: eventUrl,
        lang
      });
    }
    return json({ sentEmails, sentPush, total: affected.length });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
