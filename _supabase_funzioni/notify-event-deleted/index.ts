import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, Lang, langsOf, groupByLang, escHtml, buildEmailHtml, sendPushToAccounts, accountIdsWithPush, sendEmail } from "./i18n.ts";

/* Elimina un evento + avvisa chi aveva detto "ci sono" (Fil, 2026-07-07).

   2026-10-14 (revisione sicurezza): prima la funzione era aperta a tutti e
   prendeva nome evento e destinatari dal client, quindi chiunque poteva far
   partire email/push "evento eliminato" con un testo qualsiasi a qualsiasi
   utente. Ora:
   - verify_jwt = true + controllo che chi chiama sia l'organizzatore;
   - body atteso: { eventId } e basta: nome e destinatari si leggono dal DB;
   - la cancellazione la fa la funzione stessa (prima legge, poi cancella,
     poi avvisa), così l'evento esiste ancora quando servono i suoi dati e
     un secondo tentativo (retry) trova "evento non trovato" invece di
     mandare un doppione;
   - anche gli avvisi in-app (event_notices) li scrive qui il server.
   Chi ha la push non riceve anche l'email. Testi secondo accounts.lang. */
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
    if (!eventId) return json({ error: "eventId mancante" }, 400);

    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes || !userRes.user) return json({ error: "Sessione non valida" }, 401);

    const { data: event } = await admin.from("events").select("id, name, created_by, created_by_account_id").eq("id", eventId).maybeSingle();
    if (!event) return json({ ok: true, alreadyDeleted: true });
    if (event.created_by_account_id !== userRes.user.id) return json({ error: "Solo chi organizza può eliminare l'evento" }, 403);

    // Destinatari: chi aveva detto "ci sono" per almeno una data, tranne l'organizzatore.
    const { data: parts } = await admin.from("participants").select("name, account_id, available_date_option_ids").eq("event_id", eventId);
    const organizerLower = String(event.created_by || "").trim().toLowerCase();
    const recipients = (parts || []).filter((p: any) =>
      (p.available_date_option_ids || []).length > 0
      && String(p.name || "").trim().toLowerCase() !== organizerLower
      && p.account_id !== event.created_by_account_id);

    const { error: delErr } = await admin.from("events").delete().eq("id", eventId);
    if (delErr) return json({ error: delErr.message }, 500);

    const eventName = String(event.name || "");
    if (!recipients.length) return json({ ok: true, sentEmails: 0, sentPush: 0 });

    // Avviso in-app "congelato" (l'evento non esiste più)
    await admin.from("event_notices").insert(recipients.map((p: any) => ({
      recipient_name: p.name,
      event_name: eventName,
      event_id: eventId,
      message: '"' + eventName + '" è stato eliminato dall\'organizzatore.',
      emoji: "🗑️"
    })));

    // Account dei destinatari: per id se collegato, altrimenti per username
    const ids = new Set<string>(recipients.map((p: any) => p.account_id).filter(Boolean));
    const unlinkedNames = recipients.filter((p: any) => !p.account_id).map((p: any) => p.name);
    if (unlinkedNames.length) {
      const { data: byName } = await admin.rpc("accounts_by_usernames", { p_names: unlinkedNames });
      (byName || []).forEach((a: any) => ids.add(a.id));
    }
    const accountIds = Array.from(ids);
    if (!accountIds.length) return json({ ok: true, sentEmails: 0, sentPush: 0 });
    const { data: accs } = await admin.from("accounts").select("id, email").in("id", accountIds);
    const emailOf = new Map<string, string | null>((accs || []).map((a: any) => [a.id, a.email || null]));

    const pushIds = await accountIdsWithPush(admin, accountIds);
    const groups = groupByLang(accountIds, await langsOf(admin, accountIds));
    const nameHtml = escHtml(eventName);

    let sentEmails = 0, sentPush = 0;
    for (const lang of ["it", "en"] as Lang[]) {
      const gids = groups[lang];
      if (!gids.length) continue;
      const emails: string[] = [];
      gids.forEach((id) => {
        const e = emailOf.get(id);
        if (!pushIds.has(id) && e && emails.indexOf(e) === -1) emails.push(e);
      });
      if (emails.length) {
        const html = buildEmailHtml({
          lang, accent: "#B8654A", emoji: "\u{1F5D1}\u{FE0F}",
          title: L(lang, "Evento eliminato", "Event deleted"),
          preheader: L(lang, '"' + nameHtml + '" e\' stato eliminato dall\'organizzatore', '"' + nameHtml + '" has been deleted by the organiser'),
          bodyHtml: L(lang,
            '<p><b>"' + nameHtml + '"</b> e\' stato eliminato dall\'organizzatore.</p><p>Non c\'e\' piu\' nulla da confermare per questo evento.</p>',
            '<p><b>"' + nameHtml + '"</b> has been deleted by the organiser.</p><p>There\'s nothing left to confirm for this event.</p>'),
          ctaText: L(lang, "Apri seeva", "Open seeva"),
          ctaUrl: siteUrl + "/index.html"
        });
        for (const email of emails) {
          if (await sendEmail(email, L(lang, '"' + eventName + '" e\' stato eliminato', '"' + eventName + '" has been deleted'), html)) sentEmails++;
        }
      }
      sentPush += await sendPushToAccounts(admin, gids, {
        title: L(lang, "Evento eliminato 🗑️", "Event deleted 🗑️"),
        body: L(lang, '"' + eventName + '" è stato eliminato dall\'organizzatore', '"' + eventName + '" has been deleted by the organiser'),
        url: siteUrl + "/index.html",
        lang
      });
    }
    return json({ ok: true, sentEmails, sentPush });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
