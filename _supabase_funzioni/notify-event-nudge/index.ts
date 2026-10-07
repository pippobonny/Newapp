import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, Lang, langsOf, groupByLang, buildWhenText, isVoteText, shortDescription, resolveLocationText, escHtml, buildEmailHtml, sendPushToAccounts, accountIdsWithPush, sendEmail, romeTodayISO } from "./i18n.ts";

/* Sollecito "Aspettiamo la tua risposta" (Fil, 2026-09-26): dal menu ⋮
   della pagina evento, solo per chi organizza: push (email a chi non ha le
   push) agli invitati con account che non hanno ancora risposto. Al massimo
   un sollecito ogni 15 minuti per evento (claim_event_nudge).
   verify_jwt = true: l'organizzatore si riconosce dal token.
   2026-10-03: push ricca; rsvp:true sugli eventi con una data sola.
   2026-10-07: testi nella lingua di chi riceve (accounts.lang). */
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
    if (!eventId) return jsonRes({ error: "eventId mancante" }, 400);

    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes || !userRes.user) return jsonRes({ error: "Sessione non valida" }, 401);
    const userId = userRes.user.id;

    const { data: event } = await admin.from("events")
      .select("id, name, created_by, created_by_account_id, event_time, confirmed_date_option_id, cancelled_at, confirmed_location_option_id, location_address, description")
      .eq("id", eventId).maybeSingle();
    if (!event) return jsonRes({ error: "Evento non trovato" }, 404);
    if (event.created_by_account_id !== userId) return jsonRes({ error: "Solo chi organizza può sollecitare" }, 403);
    if (event.cancelled_at) return jsonRes({ error: "L'evento è annullato" }, 400);

    const [{ data: invitees }, { data: participants }, { data: dateOpts }] = await Promise.all([
      admin.from("event_invitees").select("name, account_id").eq("event_id", eventId),
      admin.from("participants").select("name, account_id").eq("event_id", eventId),
      admin.from("date_options").select("id, date_iso").eq("event_id", eventId)
    ]);
    const confirmedOpt = event.confirmed_date_option_id ? (dateOpts || []).find((d: any) => d.id === event.confirmed_date_option_id) : null;
    const fixedOpt = confirmedOpt || ((dateOpts || []).length === 1 ? (dateOpts || [])[0] : null);
    if (fixedOpt && String(fixedOpt.date_iso) < romeTodayISO()) return jsonRes({ error: "L'evento è già passato" }, 400);

    const respondedAccounts = new Set((participants || []).map((p: any) => p.account_id).filter(Boolean));
    const respondedNames = new Set((participants || []).map((p: any) => String(p.name || "").trim().toLowerCase()).filter(Boolean));
    const organizerName = String(event.created_by || "").trim().toLowerCase();
    const pending = (invitees || []).filter((inv: any) => {
      const lower = String(inv.name || "").trim().toLowerCase();
      if (inv.account_id && inv.account_id === userId) return false;
      if (lower && lower === organizerName) return false;
      if (inv.account_id && respondedAccounts.has(inv.account_id)) return false;
      if (lower && respondedNames.has(lower)) return false;
      return true;
    });
    const reachable = pending.filter((inv: any) => !!inv.account_id);
    const unreachableNames: string[] = pending.filter((inv: any) => !inv.account_id).map((inv: any) => inv.name);
    const reachableIds: string[] = Array.from(new Set(reachable.map((inv: any) => inv.account_id)));
    if (!reachableIds.length) return jsonRes({ notified: 0, notifiedNames: [], unreachableNames });

    const { data: waitSeconds, error: claimErr } = await admin.rpc("claim_event_nudge", { p_event_id: eventId, p_cooldown_seconds: 900 });
    if (claimErr) return jsonRes({ error: claimErr.message }, 500);
    if (waitSeconds !== null && waitSeconds !== undefined) return jsonRes({ error: "cooldown", retryAfterSeconds: waitSeconds }, 429);

    const dateISOs: string[] = (dateOpts || []).map((d: any) => String(d.date_iso));
    const descText = shortDescription(event.description);
    const eventUrl = siteUrl + "/evento.html?id=" + encodeURIComponent(event.id);
    const pushIds = await accountIdsWithPush(admin, reachableIds);
    const { data: accounts } = await admin.from("accounts").select("id, email").in("id", reachableIds);
    const groups = groupByLang(reachableIds, await langsOf(admin, reachableIds));

    let sentEmails = 0, sentPush = 0;
    for (const lang of ["it", "en"] as Lang[]) {
      const ids = groups[lang];
      if (!ids.length) continue;
      const whenText = buildWhenText(dateISOs, confirmedOpt ? String(confirmedOpt.date_iso) : null, event.event_time || null, lang);
      const isVote = isVoteText(whenText);
      const whenSuffix = !whenText ? "" : (isVote ? " · " + whenText : " " + whenText);
      const locationText = await resolveLocationText(admin, event, lang);
      const organizer = event.created_by || L(lang, "Un amico", "A friend");

      const pushLines: string[] = [organizer + L(lang, " aspetta di sapere se ci sei", " is waiting to hear if you're in") + (whenText ? " · " + whenText : "")];
      if (locationText) pushLines.push("📍 " + locationText);
      if (descText) pushLines.push("📝 " + descText);
      pushLines.push(isVote ? L(lang, "👉 Vota la tua data", "👉 Vote for your date") : L(lang, "👉 Rispondi in un tap", "👉 Reply in one tap"));

      const emails: string[] = [];
      (accounts || []).forEach((a: any) => {
        if (ids.indexOf(a.id) === -1 || pushIds.has(a.id)) return;
        if (a.email && emails.indexOf(a.email) === -1) emails.push(a.email);
      });
      if (emails.length) {
        const extraHtml = [locationText ? '📍 ' + escHtml(locationText) : '', descText ? '<span style="color:#8C7C91;">' + escHtml(descText) + '</span>' : ''].filter(Boolean).join('<br>');
        const html = buildEmailHtml({
          lang, accent: "#FF7A29", emoji: "⏳",
          title: L(lang, "Aspettiamo la tua risposta", "We're waiting for your reply"),
          preheader: organizer + L(lang, ' ti ricorda l\'invito a "', ' is reminding you about "') + event.name + '"' + whenSuffix + L(lang, ": ci sei?", ": are you in?"),
          bodyHtml: '<p><b>' + organizer + '</b>' + L(lang, ' ti ricorda l\'invito a', ' is reminding you about') + '<br><b>"' + event.name + '"</b>'
            + (whenText ? '<br><span style="display:inline-block; margin-top:8px; font-size:17px; font-weight:600; color:#FF7A29;">' + whenText + '</span>' : '')
            + '</p>' + (extraHtml ? '<p style="margin-top:4px;">' + extraHtml + '</p>' : '')
            + '<p>' + (isVote ? L(lang, 'Vota la tua data, ci vuole un attimo.', 'Vote for your date, it only takes a moment.') : L(lang, 'Ci sei? Rispondi in un tap.', 'Are you in? Reply in one tap.')) + '</p>',
          ctaText: isVote ? L(lang, "Vota la tua data", "Vote for your date") : L(lang, "Rispondi", "Reply"),
          ctaUrl: eventUrl
        });
        for (const email of emails) {
          if (await sendEmail(email, L(lang, 'Aspettiamo la tua risposta per "', 'We\'re waiting for your reply about "') + event.name + '"' + whenSuffix, html)) sentEmails++;
        }
      }
      sentPush += await sendPushToAccounts(admin, ids, {
        title: "⏳ " + event.name + L(lang, " — manca la tua risposta", " — your reply is missing"),
        body: pushLines.join("\n"), url: eventUrl, rsvp: !!fixedOpt, lang
      });
    }
    return jsonRes({ notified: reachableIds.length, notifiedNames: reachable.map((inv: any) => inv.name), unreachableNames, sentPush, sentEmails });
  } catch (err) {
    return jsonRes({ error: String(err) }, 500);
  }
});
