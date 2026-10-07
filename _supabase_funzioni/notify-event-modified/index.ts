import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, Lang, langsOf, groupByLang, buildEmailHtml, sendPushToAccounts, accountIdsWithPush, sendEmail } from "./i18n.ts";

/* Email + notifica push "l'evento e' stato modificato" (Fil, 2026-07-19)
   per i cambi che NON sono "ti hanno tolto una data" (vedi
   notify-date-removed). I dati arrivano pronti da data.js -> updateEvent().
   Chi ha già ricevuto "data tolta" per lo stesso salvataggio NON è in
   recipientNames (deduplicazione lato client).
   body atteso: { eventId?: string, eventName: string, recipientNames: string[] }
   Fire and forget. Chi ha la push non riceve anche l'email.
   2026-10-07: testi in italiano o inglese secondo accounts.lang. */
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
    const eventId = body.eventId || null;
    const eventName = (body.eventName || "").trim();
    const recipientNames: string[] = Array.isArray(body.recipientNames) ? body.recipientNames : [];
    if (!eventName || !recipientNames.length) return json({ skipped: true, reason: "eventName o recipientNames mancante" });

    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: accounts, error: accountsErr } = await admin.from("accounts").select("id, email, username");
    if (accountsErr || !accounts) return json({ skipped: true, reason: "impossibile leggere gli account" });

    const namesLower = recipientNames.map((n) => (n || "").trim().toLowerCase()).filter((n) => !!n);
    const matched: Array<{ id: string; email: string | null }> = [];
    accounts.forEach((a: any) => {
      const uname = (a.username || "").trim().toLowerCase();
      if (uname && namesLower.indexOf(uname) !== -1) matched.push({ id: a.id, email: a.email || null });
    });
    const accountIds = Array.from(new Set(matched.map((m) => m.id)));
    if (!accountIds.length) return json({ sentEmails: 0, sentPush: 0, reason: "nessun destinatario ha un account collegato" });

    const eventUrl = eventId ? (siteUrl + "/evento.html?id=" + encodeURIComponent(eventId)) : null;
    const pushIds = await accountIdsWithPush(admin, accountIds);
    const groups = groupByLang(accountIds, await langsOf(admin, accountIds));

    let sentEmails = 0, sentPush = 0, totalEmails = 0;
    for (const lang of ["it", "en"] as Lang[]) {
      const ids = groups[lang];
      if (!ids.length) continue;
      const emails: string[] = [];
      matched.forEach((m) => {
        if (ids.indexOf(m.id) === -1 || pushIds.has(m.id)) return;
        if (m.email && emails.indexOf(m.email) === -1) emails.push(m.email);
      });
      totalEmails += emails.length;
      if (emails.length) {
        const html = buildEmailHtml({
          lang, accent: "#FF7A29", emoji: "✏\u{FE0F}",
          title: L(lang, "Evento modificato", "Event updated"),
          preheader: L(lang, '"' + eventName + '" è stato modificato dall\'organizzatore', '"' + eventName + '" has been updated by the organiser'),
          bodyHtml: L(lang,
            '<p>L\'organizzatore ha modificato <b>"' + eventName + '"</b> (nome, luogo, descrizione o altri dettagli).</p>',
            '<p>The organiser has updated <b>"' + eventName + '"</b> (name, place, description or other details).</p>'),
          ctaText: eventUrl ? L(lang, "Vedi cosa è cambiato", "See what's changed") : undefined,
          ctaUrl: eventUrl || undefined
        });
        for (const email of emails) {
          if (await sendEmail(email, L(lang, '"' + eventName + '" è stato modificato', '"' + eventName + '" has been updated'), html)) sentEmails++;
        }
      }
      sentPush += await sendPushToAccounts(admin, ids, {
        title: L(lang, "Evento modificato ✏️", "Event updated ✏️"),
        body: L(lang, 'L\'organizzatore ha modificato "' + eventName + '"', 'The organiser has updated "' + eventName + '"'),
        url: eventUrl || (siteUrl + "/index.html"),
        lang
      });
    }
    return json({ sentEmails, totalEmails, sentPush });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
