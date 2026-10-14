import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, Lang, langsOf, groupByLang, escHtml, buildEmailHtml, sendPushToAccounts, accountIdsWithPush, sendEmail } from "./i18n.ts";

/* Email + notifica push "l'evento e' stato modificato" (Fil, 2026-07-19)
   per i cambi che NON sono "ti hanno tolto una data" (vedi
   notify-date-removed). Chi ha già ricevuto "data tolta" per lo stesso
   salvataggio NON è in recipientNames (deduplicazione lato client).
   body atteso: { eventId: string, recipientNames: string[] }
   Fire and forget. Chi ha la push non riceve anche l'email.
   2026-10-07: testi in italiano o inglese secondo accounts.lang.
   2026-10-14 (revisione sicurezza): verify_jwt = true, solo l'organizzatore
   dell'evento può chiamarla; il nome evento si legge dal DB (non più dal
   client) e i destinatari devono essere davvero invitati/partecipanti di
   quell'evento. Prima chiunque poteva mandare un testo qualsiasi a
   qualsiasi utente. */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const low = (s: unknown) => String(s || "").trim().toLowerCase();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const eventId = body.eventId || null;
    const recipientNames: string[] = Array.isArray(body.recipientNames) ? body.recipientNames.map(String) : [];
    if (!eventId || !recipientNames.length) return json({ skipped: true, reason: "eventId o recipientNames mancante" });

    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes || !userRes.user) return json({ error: "Sessione non valida" }, 401);
    const { data: event } = await admin.from("events").select("id, name, created_by_account_id").eq("id", eventId).maybeSingle();
    if (!event) return json({ skipped: true, reason: "evento non trovato" });
    if (event.created_by_account_id !== userRes.user.id) return json({ error: "Solo chi organizza" }, 403);
    const eventName = String(event.name || "");

    // Solo persone che fanno davvero parte dell'evento
    const [{ data: inv }, { data: parts }] = await Promise.all([
      admin.from("event_invitees").select("name, account_id").eq("event_id", eventId),
      admin.from("participants").select("name, account_id").eq("event_id", eventId)
    ]);
    const members = new Map<string, string | null>();
    (inv || []).concat(parts || []).forEach((m: any) => {
      const k = low(m.name);
      if (k && (!members.has(k) || m.account_id)) members.set(k, m.account_id || null);
    });
    const wanted = Array.from(new Set(recipientNames.map(low))).filter((n) => members.has(n));
    if (!wanted.length) return json({ sentEmails: 0, sentPush: 0, reason: "nessun destinatario valido" });

    const ids = new Set<string>();
    const unlinked: string[] = [];
    wanted.forEach((n) => { const id = members.get(n); if (id) ids.add(id); else unlinked.push(n); });
    if (unlinked.length) {
      const { data: byName } = await admin.rpc("accounts_by_usernames", { p_names: unlinked });
      (byName || []).forEach((a: any) => ids.add(a.id));
    }
    ids.delete(userRes.user.id);
    const accountIds = Array.from(ids);
    if (!accountIds.length) return json({ sentEmails: 0, sentPush: 0, reason: "nessun destinatario ha un account collegato" });
    const { data: accs } = await admin.from("accounts").select("id, email").in("id", accountIds);
    const emailOf = new Map<string, string | null>((accs || []).map((a: any) => [a.id, a.email || null]));

    const eventUrl = siteUrl + "/evento.html?id=" + encodeURIComponent(eventId);
    const pushIds = await accountIdsWithPush(admin, accountIds);
    const groups = groupByLang(accountIds, await langsOf(admin, accountIds));
    const nameHtml = escHtml(eventName);

    let sentEmails = 0, sentPush = 0, totalEmails = 0;
    for (const lang of ["it", "en"] as Lang[]) {
      const gids = groups[lang];
      if (!gids.length) continue;
      const emails: string[] = [];
      gids.forEach((id) => {
        const e = emailOf.get(id);
        if (!pushIds.has(id) && e && emails.indexOf(e) === -1) emails.push(e);
      });
      totalEmails += emails.length;
      if (emails.length) {
        const html = buildEmailHtml({
          lang, accent: "#FF7A29", emoji: "✏\u{FE0F}",
          title: L(lang, "Evento modificato", "Event updated"),
          preheader: L(lang, '"' + nameHtml + '" è stato modificato dall\'organizzatore', '"' + nameHtml + '" has been updated by the organiser'),
          bodyHtml: L(lang,
            '<p>L\'organizzatore ha modificato <b>"' + nameHtml + '"</b> (nome, luogo, descrizione o altri dettagli).</p>',
            '<p>The organiser has updated <b>"' + nameHtml + '"</b> (name, place, description or other details).</p>'),
          ctaText: L(lang, "Vedi cosa è cambiato", "See what's changed"),
          ctaUrl: eventUrl
        });
        for (const email of emails) {
          if (await sendEmail(email, L(lang, '"' + eventName + '" è stato modificato', '"' + eventName + '" has been updated'), html)) sentEmails++;
        }
      }
      sentPush += await sendPushToAccounts(admin, gids, {
        title: L(lang, "Evento modificato ✏️", "Event updated ✏️"),
        body: L(lang, 'L\'organizzatore ha modificato "' + eventName + '"', 'The organiser has updated "' + eventName + '"'),
        url: eventUrl,
        lang
      });
    }
    return json({ sentEmails, totalEmails, sentPush });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
