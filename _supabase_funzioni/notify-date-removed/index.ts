import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, langsOf, dayLabel, buildEmailHtml, sendPushToAccounts, accountIdsWithPush, sendEmail } from "./i18n.ts";

/* Email + notifica push "una data che avevi confermato e' stata tolta
   dall'evento" (Fil, 2026-07-07). Non si rilegge l'evento: data.js ->
   updateEvent() passa tutto (il calcolo va fatto PRIMA della modifica).
   Matching per username (case-insensitive).
   body atteso: { eventId?, eventName, affected: [{ name, dateLabels: string[], dateISOs?: string[] }] }
   Fire and forget. Chi ha la push non riceve anche l'email.
   2026-10-07: testi e date nella lingua di chi riceve (accounts.lang); le
   date si riscrivono da dateISOs quando ci sono (le dateLabels arrivano
   nella lingua di chi ha modificato l'evento). */
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
    const affected: Array<{ name: string; dateLabels: string[]; dateISOs?: string[] }> = Array.isArray(body.affected) ? body.affected : [];
    if (!eventName || !affected.length) return json({ skipped: true, reason: "eventName o affected mancante" });

    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: accounts, error: accountsErr } = await admin.from("accounts").select("id, email, username");
    if (accountsErr || !accounts) return json({ skipped: true, reason: "impossibile leggere gli account" });
    const byUsername = new Map<string, { id: string; email: string | null }>();
    accounts.forEach((a: any) => {
      const uname = (a.username || "").trim().toLowerCase();
      if (uname) byUsername.set(uname, { id: a.id, email: a.email || null });
    });

    const eventUrl = eventId ? (siteUrl + "/evento.html?id=" + encodeURIComponent(eventId)) : null;
    const resolved: Array<{ name: string; entry: any; acc: { id: string; email: string | null } }> = [];
    for (const entry of affected) {
      const name = (entry.name || "").trim();
      if (!name) continue;
      const acc = byUsername.get(name.toLowerCase());
      if (!acc) continue;
      resolved.push({ name, entry, acc });
    }
    const ids = resolved.map((r) => r.acc.id);
    const pushIds = await accountIdsWithPush(admin, ids);
    const langs = await langsOf(admin, ids);

    let sentEmails = 0, sentPush = 0;
    for (const r of resolved) {
      const lang = langs.get(r.acc.id) || "it";
      const labels = (Array.isArray(r.entry.dateISOs) && r.entry.dateISOs.length)
        ? r.entry.dateISOs.map((iso: string) => dayLabel(String(iso), lang)).join(", ")
        : (r.entry.dateLabels || []).join(", ");
      if (!pushIds.has(r.acc.id) && r.acc.email) {
        const html = buildEmailHtml({
          lang, accent: "#FF7A29", emoji: "\u{1F5D3}\u{FE0F}",
          title: L(lang, "Una data è stata tolta", "A date has been removed"),
          preheader: L(lang, 'Per "' + eventName + '" è cambiata una data', 'A date has changed for "' + eventName + '"'),
          bodyHtml: L(lang,
            '<p>Per <b>"' + eventName + '"</b> l\'organizzatore ha tolto la data a cui avevi detto di esserci: <b>' + labels + '</b>.</p>',
            '<p>For <b>"' + eventName + '"</b> the organiser has removed the date you said you were in for: <b>' + labels + '</b>.</p>'),
          ctaText: eventUrl ? L(lang, "Vedi le date rimaste", "See the remaining dates") : undefined,
          ctaUrl: eventUrl || undefined
        });
        if (await sendEmail(r.acc.email, L(lang, 'Una data è stata tolta da "' + eventName + '"', 'A date has been removed from "' + eventName + '"'), html)) sentEmails++;
      }
      sentPush += await sendPushToAccounts(admin, [r.acc.id], {
        title: L(lang, "Una data è stata tolta 🗓️", "A date has been removed 🗓️"),
        body: L(lang, 'Per "' + eventName + '" è stata tolta la data: ', 'For "' + eventName + '" this date has been removed: ') + labels,
        url: eventUrl || (siteUrl + "/index.html"),
        lang
      });
    }
    return json({ sentEmails, sentPush, total: affected.length });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
