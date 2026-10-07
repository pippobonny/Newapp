import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, Lang, langsOf, groupByLang, buildWhenText, isVoteText, shortDescription, resolveLocationText, escHtml, buildEmailHtml, sendPushToAccounts, accountIdsWithPush, sendEmail } from "./i18n.ts";

/* Email + notifica push "sei stato invitato a questo evento" per gli
   invitati copiati su QUESTO evento (event_invitees).
   Fil, 2026-07-12: SOLO chi ha un account_id confermato sull'invitato
   riceve l'email/push. Chiamata "fire and forget" da data.js.
   verify_jwt = false (come notify-account-created).
   2026-07-20: chi ha la push non riceve anche l'email.
   2026-10-03: push ricca + rsvp:true sugli eventi a data fissa.
   2026-10-07: in italiano o inglese secondo accounts.lang di chi riceve. */
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
    if (!eventId) return json({ error: "eventId mancante" }, 400);

    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: event, error: eventErr } = await admin.from("events")
      .select("id, name, created_by, event_time, confirmed_date_option_id, confirmed_location_option_id, location_address, description")
      .eq("id", eventId).maybeSingle();
    if (eventErr || !event) return json({ skipped: true, reason: "evento non trovato" });

    const { data: invitees, error: inviteesErr } = await admin.from("event_invitees").select("name, account_id").eq("event_id", eventId);
    if (inviteesErr || !invitees || !invitees.length) return json({ skipped: true, reason: "nessun invitato per questo evento" });

    // onlyAccountIds (Fil, 2026-09-26): solo gli invitati aggiunti dopo.
    const onlyIds: string[] | null = Array.isArray(body.onlyAccountIds) ? body.onlyAccountIds.map(String) : null;
    const linkedIds: string[] = Array.from(new Set(invitees.map((f: any) => f.account_id).filter((id: any) => !!id && (!onlyIds || onlyIds.indexOf(id) !== -1))));
    if (!linkedIds.length) return json({ sentEmails: 0, sentPush: 0, reason: "nessun invitato ha un account collegato" });

    const { data: linkedAccounts } = await admin.from("accounts").select("id, email").in("id", linkedIds);
    const pushIds = await accountIdsWithPush(admin, linkedIds);
    const langs = await langsOf(admin, linkedIds);
    const groups = groupByLang(linkedIds, langs);

    const { data: dateOpts } = await admin.from("date_options").select("id, date_iso").eq("event_id", eventId);
    const dateISOs: string[] = (dateOpts || []).map((d: any) => String(d.date_iso));
    const confirmedOpt = event.confirmed_date_option_id ? (dateOpts || []).find((d: any) => d.id === event.confirmed_date_option_id) : null;
    const eventUrl = siteUrl + "/evento.html?id=" + encodeURIComponent(event.id);
    const descText = shortDescription(event.description);

    let sentEmails = 0, sentPush = 0, totalEmails = 0;
    for (const lang of ["it", "en"] as Lang[]) {
      const ids = groups[lang];
      if (!ids.length) continue;
      const whenText = buildWhenText(dateISOs, confirmedOpt ? String(confirmedOpt.date_iso) : null, event.event_time || null, lang);
      const isVote = isVoteText(whenText);
      const whenSuffix = !whenText ? "" : (isVote ? " · " + whenText : " " + whenText);
      const locationText = await resolveLocationText(admin, event, lang);
      const organizer = event.created_by || L(lang, "Un amico", "A friend");

      const pushLines: string[] = [organizer + L(lang, " ti ha invitato", " invited you") + (whenText ? " · " + whenText : "")];
      if (locationText) pushLines.push("📍 " + locationText);
      if (descText) pushLines.push("📝 " + descText);
      pushLines.push(isVote ? L(lang, "👉 Vota la tua data", "👉 Vote for your date") : L(lang, "👉 Ci sei? Rispondi in un tap", "👉 Are you in? Reply in one tap"));

      const emails: string[] = [];
      (linkedAccounts || []).forEach((a: any) => {
        if (ids.indexOf(a.id) === -1 || pushIds.has(a.id)) return;
        if (a.email && emails.indexOf(a.email) === -1) emails.push(a.email);
      });
      totalEmails += emails.length;
      if (emails.length) {
        const extraHtml = (locationText ? '<br>📍 ' + escHtml(locationText) : '') + (descText ? '<br><span style="color:#8C7C91;">' + escHtml(descText) + '</span>' : '');
        const html = buildEmailHtml({
          lang, accent: "#FF7A29", emoji: "\u{1F389}",
          title: L(lang, "Sei stato invitato!", "You're invited!"),
          preheader: organizer + L(lang, ' ti ha invitato a "', ' invited you to "') + event.name + '"' + whenSuffix,
          bodyHtml: '<p><b>' + organizer + '</b>' + L(lang, ' ti ha invitato a', ' invited you to') + '<br><b>"' + event.name + '"</b>' + (whenText ? '<br><span style="display:inline-block; margin-top:8px; font-size:17px; font-weight:600; color:#FF7A29;">' + whenText + '</span>' : '.') + '</p>'
            + (extraHtml ? '<p style="margin-top:4px;">' + extraHtml.replace(/^<br>/, '') + '</p>' : ''),
          ctaText: isVote ? L(lang, "Vota la tua data", "Vote for your date") : L(lang, "Rispondi", "Reply"),
          ctaUrl: eventUrl
        });
        for (const email of emails) {
          if (await sendEmail(email, L(lang, 'Sei stato invitato a "', 'You\'re invited to "') + event.name + '"' + whenSuffix, html)) sentEmails++;
        }
      }
      sentPush += await sendPushToAccounts(admin, ids, { title: "🎉 " + event.name, body: pushLines.join("\n"), url: eventUrl, rsvp: !!confirmedOpt && !isVote, lang });
    }
    return json({ sentEmails, totalEmails, sentPush });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
