import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, Lang, langsOf, groupByLang, buildWhenText, isVoteText, shortDescription, resolveLocationText, sendPushToAccounts } from "./i18n.ts";

/* Solleciti AUTOMATICI (Fil, 2026-11-25): a chi è stato invitato e non ha
   ancora risposto, una push "manca la tua risposta" circa ogni 24 ore.
   Chiamata da pg_cron ogni ora (verify_jwt true). Paletti:
   - al massimo 3 solleciti per persona per evento (MAX_NUDGES), mai prima di
     24 ore dall'invito / dall'ultimo sollecito (claim_auto_nudge, atomico);
   - solo chi NON ha risposto (chi ha detto sì/forse/no non c'è tra i
     partecipanti o è già gestito dal sollecito "Forse"); non l'organizzatore;
   - mai eventi annullati; mai a evento passato o al giorno stesso; con più
     date si ferma alla scadenza del voto (stessa regola di send-event-reminders);
   - solo tra le 9 e le 20 ora di Roma; al massimo UN sollecito per persona per
     ogni passaggio (se ha più eventi in sospeso, gli altri arrivano all'ora dopo);
   - solo a inviti fatti negli ultimi 5 giorni (così all'attivazione non
     arrivano solleciti su eventi vecchi);
   - solo push (niente email), testo nella lingua dell'account (accounts.lang);
   - chi ha accounts.auto_nudges_off = true non li riceve; chi ha spento le
     push non riceve nulla.
   Prova senza inviare: body {"dry": true} -> elenca cosa manderebbe. */
const MAX_NUDGES = 3;
const EVERY_HOURS = 24;
const HOUR_FROM = 9, HOUR_TO = 20;   // 9:00 - 19:59 ora di Roma
const INVITE_MAX_AGE_DAYS = 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function romeISO(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function romeHour(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hourCycle: "h23" }).format(date));
}
function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function romeOffsetMin(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d);
  const g = (t: string) => Number((parts.find((p) => p.type === t) || { value: "0" }).value);
  const asUTC = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return Math.round((asUTC - d.getTime()) / 60000);
}
function romeLocal(iso: string, hh: number, mm: number): Date {
  const guess = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), hh, mm);
  return new Date(guess - romeOffsetMin(new Date(guess)) * 60000);
}
/* Scadenza del voto — COPIA di voteDeadline in send-event-reminders (e data.js). */
function voteDeadline(firstISO: string, createdAt: string | null, voteOpenedAt: string | null, eventTime: string | null): Date {
  const normal = romeLocal(addDaysISO(firstISO, -2), 9, 0);
  const tc = createdAt ? new Date(createdAt).getTime() : NaN;
  const to = voteOpenedAt ? new Date(voteOpenedAt).getTime() : NaN;
  const refMs = isNaN(to) ? tc : (isNaN(tc) ? to : Math.max(tc, to));
  if (isNaN(refMs) || refMs < normal.getTime()) return normal;
  const refISO = romeISO(new Date(refMs));
  let deadline: Date;
  if (refISO >= firstISO) {
    deadline = romeLocal(addDaysISO(refISO, 1), 0, 0);
  } else {
    const t = eventTime ? String(eventTime).slice(0, 5) : "00:00";
    deadline = new Date(romeLocal(firstISO, +t.slice(0, 2), +t.slice(3, 5)).getTime() - 2 * 3600 * 1000);
  }
  const minimum = refMs + 2 * 3600 * 1000;
  return deadline.getTime() < minimum ? new Date(minimum) : deadline;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const dry = !!(body && body.dry);
    const now = new Date();
    const hour = romeHour(now);
    if (!dry && (hour < HOUR_FROM || hour >= HOUR_TO)) return json({ skipped: "fuori orario", hour });

    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const today = romeISO(now);
    const sinceISO = new Date(now.getTime() - INVITE_MAX_AGE_DAYS * 86400000).toISOString();

    // Inviti recenti con account (sono gli unici raggiungibili con una push).
    const { data: invs } = await admin.from("event_invitees")
      .select("event_id, name, account_id, created_at")
      .not("account_id", "is", null).gte("created_at", sinceISO);
    if (!invs || !invs.length) return json({ candidates: 0, sent: 0 });
    const eventIds: string[] = Array.from(new Set(invs.map((i: any) => i.event_id)));

    const { data: events } = await admin.from("events")
      .select("id, name, created_by, created_by_account_id, created_at, vote_opened_at, event_time, confirmed_date_option_id, confirmed_location_option_id, location_address, description, manually_cancelled")
      .in("id", eventIds).is("cancelled_at", null);

    const accIds: string[] = Array.from(new Set(invs.map((i: any) => i.account_id)));
    const { data: offRows } = await admin.from("accounts").select("id").in("id", accIds).eq("auto_nudges_off", true);
    const off = new Set((offRows || []).map((a: any) => a.id));
    const havePush = new Set(((await admin.from("push_subscriptions").select("account_id").in("account_id", accIds)).data || []).map((s: any) => s.account_id));

    const done = new Set<string>();      // un sollecito per persona per passaggio
    const report: any[] = [];
    let sent = 0;

    for (const ev of (events || [])) {
      if (ev.manually_cancelled) continue;
      const [{ data: dateOpts }, { data: parts }] = await Promise.all([
        admin.from("date_options").select("id, date_iso").eq("event_id", ev.id),
        admin.from("participants").select("name, account_id").eq("event_id", ev.id)
      ]);
      const dates = (dateOpts || []).map((d: any) => ({ id: d.id, iso: String(d.date_iso) })).sort((a: any, b: any) => a.iso < b.iso ? -1 : 1);
      if (!dates.length) continue;
      const confirmed = ev.confirmed_date_option_id ? dates.find((d: any) => d.id === ev.confirmed_date_option_id) : null;
      const fixed = confirmed || (dates.length === 1 ? dates[0] : null);
      if (fixed) {
        // data decisa: si ferma al giorno stesso (il giorno prima c'è già il promemoria)
        if (fixed.iso <= today) continue;
      } else {
        // voto aperto: si ferma alla scadenza del voto o se tutte le date sono passate
        if (dates[dates.length - 1].iso < today) continue;
        if (now.getTime() >= voteDeadline(dates[0].iso, ev.created_at, ev.vote_opened_at, ev.event_time || null).getTime()) continue;
      }

      const respondedAcc = new Set((parts || []).map((p: any) => p.account_id).filter(Boolean));
      const respondedNames = new Set((parts || []).map((p: any) => String(p.name || "").trim().toLowerCase()).filter(Boolean));
      const orgName = String(ev.created_by || "").trim().toLowerCase();
      const pending = invs.filter((i: any) => {
        if (i.event_id !== ev.id) return false;
        const lower = String(i.name || "").trim().toLowerCase();
        if (i.account_id === ev.created_by_account_id || (lower && lower === orgName)) return false;
        if (respondedAcc.has(i.account_id) || (lower && respondedNames.has(lower))) return false;
        if (off.has(i.account_id) || !havePush.has(i.account_id) || done.has(i.account_id)) return false;
        return true;
      });
      if (!pending.length) continue;

      const dateISOs = dates.map((d: any) => d.iso);
      const eventUrl = siteUrl + "/evento.html?id=" + encodeURIComponent(ev.id);
      const descText = shortDescription(ev.description);
      const targets: string[] = [];
      for (const inv of pending) {
        if (done.has(inv.account_id)) continue;
        const since = new Date(Math.max(new Date(inv.created_at).getTime(), new Date(ev.created_at).getTime())).toISOString();
        if (dry) { targets.push(inv.account_id); done.add(inv.account_id); continue; }
        const { data: ok } = await admin.rpc("claim_auto_nudge", { p_event: ev.id, p_account: inv.account_id, p_since: since, p_hours: EVERY_HOURS, p_max: MAX_NUDGES });
        if (ok) { targets.push(inv.account_id); done.add(inv.account_id); }
      }
      if (!targets.length) continue;
      report.push({ event: ev.name, to: targets.length });
      if (dry) continue;

      const groups = groupByLang(targets, await langsOf(admin, targets));
      for (const lang of ["it", "en"] as Lang[]) {
        if (!groups[lang].length) continue;
        const whenText = buildWhenText(dateISOs, confirmed ? confirmed.iso : null, ev.event_time || null, lang);
        const isVote = isVoteText(whenText);
        const locationText = await resolveLocationText(admin, ev, lang);
        const organizer = ev.created_by || L(lang, "Un amico", "A friend");
        const lines = [organizer + L(lang, " aspetta di sapere se ci sei", " is waiting to hear if you're in") + (whenText ? " · " + whenText : "")];
        if (locationText) lines.push("📍 " + locationText);
        if (descText) lines.push("📝 " + descText);
        lines.push(isVote ? L(lang, "👉 Vota la tua data", "👉 Vote for your date") : L(lang, "👉 Rispondi in un tap", "👉 Reply in one tap"));
        sent += await sendPushToAccounts(admin, groups[lang], {
          title: "⏳ " + ev.name + L(lang, " — manca la tua risposta", " — your reply is missing"),
          body: lines.join("\n"), url: eventUrl, rsvp: !!fixed, lang, tag: "autonudge|" + ev.id
        });
      }
    }
    return json({ dry, candidates: invs.length, events: report, sent });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
