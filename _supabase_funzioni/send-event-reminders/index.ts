import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, Lang, langsOf, groupByLang, dayLabel, sendPushToAccounts } from "./i18n.ts";

/* Promemoria "domani c'è [evento]" (Fil, 2026-07-21): chiamata da pg_cron
   (verify_jwt true, il cron passa la chiave anon).
   2026-10-04: promemoria del giorno prima a TRE gruppi (ci sono / non hanno
   risposto, con pulsanti / forse, con pulsanti). Chi ha detto no: niente.
   2026-10-03: PRIMA dei promemoria, chiusura automatica del voto (scadenza
   = voteDeadline, regola 2026-10-05; cron "votes" ogni 10 minuti):
   leader unico con almeno un sì -> confermato + "✅ Si fa!"; pareggio o
   nessun sì -> push solo all'organizzatore, una volta. Mai annullato da solo.
   2026-10-07: ogni push nella lingua di chi la riceve (accounts.lang). */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function romeISO(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function tomorrowISOInRome(): string { return addDaysISO(romeISO(new Date()), 1); }

/* Ora locale di Roma -> istante vero (gestisce ora legale/solare). */
function romeOffsetMin(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d);
  const g = (t: string) => Number((parts.find((p) => p.type === t) || { value: "0" }).value);
  const asUTC = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return Math.round((asUTC - d.getTime()) / 60000);
}
function romeLocal(iso: string, hh: number, mm: number): Date {
  const guess = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), hh, mm);
  const off = romeOffsetMin(new Date(guess));
  return new Date(guess - off * 60000);
}
/* Scadenza del voto (Fil, 2026-10-05) — IDENTICA a computeVoteDeadline in data.js. */
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

function whenLabel(iso: string, eventTime: string | null, lang: Lang): string {
  return dayLabel(iso, lang) + (eventTime ? L(lang, " alle ", " at ") + String(eventTime).slice(0, 5) : "");
}

/* Push con testi per lingua: build(lang) -> payload. */
async function pushI18n(admin: any, ids: string[], build: (lang: Lang) => Record<string, unknown>): Promise<number> {
  if (!ids.length) return 0;
  const g = groupByLang(ids, await langsOf(admin, ids));
  let n = 0;
  for (const lang of ["it", "en"] as Lang[]) {
    if (g[lang].length) n += await sendPushToAccounts(admin, g[lang], { ...build(lang), lang });
  }
  return n;
}

/* Chiusura automatica del voto, vedi commento in testa. */
async function closeDueVotes(admin: any, siteUrl: string): Promise<{ confirmed: number; askedOrganizer: number }> {
  const today = romeISO(new Date());
  let confirmed = 0;
  let askedOrganizer = 0;

  const { data: openEvents } = await admin.from("events")
    .select("id, name, created_by, created_by_account_id, created_at, vote_opened_at, event_time, location_address, confirmed_location_option_id, vote_close_notified_at, manually_cancelled")
    .is("confirmed_date_option_id", null)
    .is("cancelled_at", null);

  for (const event of (openEvents || [])) {
    if (event.manually_cancelled) continue;
    const [{ data: dateOpts }, { data: invitees }, { data: participants }, { data: locOpts }] = await Promise.all([
      admin.from("date_options").select("id, date_iso").eq("event_id", event.id),
      admin.from("event_invitees").select("name, account_id").eq("event_id", event.id),
      admin.from("participants").select("name, account_id, available_date_option_ids, available_location_option_ids, maybe").eq("event_id", event.id),
      admin.from("location_options").select("id, address").eq("event_id", event.id)
    ]);

    const allOpts = (dateOpts || []).map((d: any) => ({ id: d.id, iso: String(d.date_iso) })).sort((a: any, b: any) => a.iso < b.iso ? -1 : 1);
    if (allOpts.length < 2) continue;
    // 2026-10-05: si salta solo se TUTTE le date sono passate.
    if (allOpts[allOpts.length - 1].iso < today) continue;
    const opts = allOpts.filter((o: any) => o.iso >= today);
    const deadline = voteDeadline(allOpts[0].iso, event.created_at, event.vote_opened_at, event.event_time || null);

    const organizerLower = String(event.created_by || "").trim().toLowerCase();
    const parts = (participants || []);
    const nonOrg = parts.filter((p: any) => String(p.name || "").trim().toLowerCase() !== organizerLower);
    const totalInvited = (invitees || []).length;
    const allResponded = totalInvited > 0 && nonOrg.length >= totalInvited;
    if (!allResponded && Date.now() < deadline.getTime()) continue;

    const optIds = opts.map((o: any) => o.id);
    const activeNonOrg = nonOrg.filter((p: any) => (p.available_date_option_ids || []).some((id: string) => optIds.indexOf(id) !== -1)).length;
    const counts = opts.map((o: any) => parts.filter((p: any) => (p.available_date_option_ids || []).indexOf(o.id) !== -1).length);
    const max = Math.max(...counts);
    const leaders = opts.filter((_o: any, i: number) => counts[i] === max);
    const eventUrl = siteUrl + "/evento.html?id=" + encodeURIComponent(event.id);

    if (activeNonOrg > 0 && leaders.length === 1) {
      const winner = leaders[0];
      const update: any = { confirmed_date_option_id: winner.id };
      let locationText = "";
      const lopts = locOpts || [];
      if (lopts.length > 1 && !event.confirmed_location_option_id) {
        const lcounts = lopts.map((l: any) => parts.filter((p: any) => (p.available_location_option_ids || []).indexOf(l.id) !== -1).length);
        const lmax = Math.max(...lcounts);
        const lleaders = lopts.filter((_l: any, i: number) => lcounts[i] === lmax);
        if (lmax > 0 && lleaders.length === 1) {
          update.confirmed_location_option_id = lleaders[0].id;
          locationText = String(lleaders[0].address || "");
        }
      } else if (lopts.length === 1) {
        locationText = String(lopts[0].address || "");
      } else if (lopts.length > 1 && event.confirmed_location_option_id) {
        const c = lopts.find((l: any) => l.id === event.confirmed_location_option_id);
        locationText = c ? String(c.address || "") : "";
      } else {
        locationText = event.location_address ? String(event.location_address) : "";
      }

      const { error: updErr } = await admin.from("events").update(update).eq("id", event.id).is("confirmed_date_option_id", null);
      if (updErr) continue;
      confirmed++;

      // Chi aveva votato SOLO altre date -> messaggio suo; chi aveva detto no a tutto -> niente.
      const notMineIds = new Set(parts
        .filter((p: any) => p.account_id && p.account_id !== event.created_by_account_id
          && (p.available_date_option_ids || []).length > 0
          && (p.available_date_option_ids || []).indexOf(winner.id) === -1)
        .map((p: any) => p.account_id));
      const saidNoIds = new Set(parts.filter((p: any) => p.account_id && !p.maybe && (p.available_date_option_ids || []).length === 0).map((p: any) => p.account_id));
      const accountIds: string[] = Array.from(new Set(
        (invitees || []).map((i: any) => i.account_id).filter(Boolean).concat(event.created_by_account_id ? [event.created_by_account_id] : [])
      )).filter((id: any) => !notMineIds.has(id) && !saidNoIds.has(id)) as string[];

      await pushI18n(admin, accountIds, (lang) => {
        const lines = ["📅 " + whenLabel(winner.iso, event.event_time || null, lang)];
        if (locationText) lines.push("📍 " + locationText);
        lines.push(L(lang, "👉 Apri per vedere chi viene", "👉 Open to see who's coming"));
        return { title: L(lang, "✅ Si fa! ", "✅ It's on! ") + event.name, body: lines.join("\n"), url: eventUrl };
      });
      if (notMineIds.size) {
        await pushI18n(admin, Array.from(notMineIds) as string[], (lang) => ({
          title: "📅 " + event.name + L(lang, ": scelta ", ": chosen date ") + whenLabel(winner.iso, null, lang),
          body: L(lang, "Quel giorno non c'eri: l'abbiamo messo tra i tuoi annullati.\n👉 Se invece riesci a esserci, apri e rispondi",
            "You weren't free that day: we've moved it to your cancelled events.\n👉 If you can make it after all, open it and reply"),
          url: eventUrl
        }));
      }
    } else if (!event.vote_close_notified_at && event.created_by_account_id) {
      const noVotes = activeNonOrg === 0;
      await pushI18n(admin, [event.created_by_account_id], (lang) => ({
        title: "🗳️ " + event.name + L(lang, " — scegli tu la data", " — you choose the date"),
        body: noVotes
          ? L(lang, "Nessun invitato ha indicato una data.\n👉 Scegline una tu, oppure annulla l'evento.", "No guest picked a date.\n👉 Choose one yourself, or cancel the event.")
          : L(lang, "Pareggio tra " + leaders.length + " date.\n👉 Scegli tu quella giusta.", "It's a tie between " + leaders.length + " dates.\n👉 You pick the right one."),
        url: eventUrl
      }));
      await admin.from("events").update({ vote_close_notified_at: new Date().toISOString() }).eq("id", event.id);
      askedOrganizer++;
    }
  }
  return { confirmed, askedOrganizer };
}

async function resolveLocationText(admin: any, event: any): Promise<string> {
  const { data: locOpts } = await admin.from("location_options").select("id, address").eq("event_id", event.id);
  const opts = locOpts || [];
  if (opts.length > 1) {
    const conf = event.confirmed_location_option_id ? opts.find((o: any) => o.id === event.confirmed_location_option_id) : null;
    return conf && conf.address ? String(conf.address) : "";
  }
  if (opts.length === 1 && opts[0].address) return String(opts[0].address);
  return event.location_address ? String(event.location_address) : "";
}

/* Promemoria del giorno prima a presenti / chi non ha risposto / forse. */
async function sendDayBeforeReminders(admin: any, event: any, optionId: string, siteUrl: string): Promise<{ yes: number; pending: number; maybe: number }> {
  const [{ data: full }, { data: participants }, { data: invitees }] = await Promise.all([
    admin.from("events").select("id, name, created_by, created_by_account_id, event_time, location_address, confirmed_location_option_id").eq("id", event.id).maybeSingle(),
    admin.from("participants").select("name, account_id, available_date_option_ids, maybe").eq("event_id", event.id),
    admin.from("event_invitees").select("name, account_id").eq("event_id", event.id)
  ]);
  const ev = full || event;
  const parts = participants || [];
  const organizerLower = String(ev.created_by || "").trim().toLowerCase();

  const yesIds: string[] = Array.from(new Set(parts.filter((p: any) => p.account_id && (p.available_date_option_ids || []).indexOf(optionId) !== -1).map((p: any) => p.account_id)));
  const maybeIds: string[] = Array.from(new Set(parts.filter((p: any) => p.account_id && p.maybe && (p.available_date_option_ids || []).length === 0).map((p: any) => p.account_id)));
  const respondedAccounts = new Set(parts.map((p: any) => p.account_id).filter(Boolean));
  const respondedNames = new Set(parts.map((p: any) => String(p.name || "").trim().toLowerCase()).filter(Boolean));
  const pendingIds: string[] = Array.from(new Set((invitees || []).filter((inv: any) => {
    if (!inv.account_id) return false;
    if (inv.account_id === ev.created_by_account_id) return false;
    const lower = String(inv.name || "").trim().toLowerCase();
    if (lower && lower === organizerLower) return false;
    if (respondedAccounts.has(inv.account_id)) return false;
    if (lower && respondedNames.has(lower)) return false;
    return true;
  }).map((inv: any) => inv.account_id)));

  const url = siteUrl + "/evento.html?id=" + encodeURIComponent(ev.id);
  const time = ev.event_time ? String(ev.event_time).slice(0, 5) : "";
  const loc = await resolveLocationText(admin, ev);
  const whenLine = (lang: Lang) => L(lang, "Domani", "Tomorrow") + (time ? L(lang, " alle ", " at ") + time : "");
  const locLine = loc ? "📍 " + loc : "";

  await pushI18n(admin, yesIds, (lang) => ({
    title: L(lang, "📅 Domani: ", "📅 Tomorrow: ") + ev.name,
    body: [whenLine(lang) + L(lang, " · ci sei! 🎉", " · you're in! 🎉"), locLine, L(lang, "👉 Apri per vedere chi viene", "👉 Open to see who's coming")].filter(Boolean).join("\n"),
    url
  }));
  await pushI18n(admin, pendingIds, (lang) => ({
    title: L(lang, "⏳ Domani c'è ", "⏳ Tomorrow: ") + ev.name,
    body: [whenLine(lang) + L(lang, " · non hai ancora risposto", " · you haven't replied yet"), locLine, L(lang, "👉 Ci sei? Rispondi in un tap", "👉 Are you in? Reply in one tap")].filter(Boolean).join("\n"),
    url, rsvp: true
  }));
  await pushI18n(admin, maybeIds, (lang) => ({
    title: L(lang, "🤔 Domani c'è ", "🤔 Tomorrow: ") + ev.name,
    body: [whenLine(lang) + L(lang, " · avevi risposto forse", " · you said maybe"), locLine, L(lang, "👉 Hai deciso? Rispondi in un tap", "👉 Made up your mind? Reply in one tap")].filter(Boolean).join("\n"),
    url, rsvp: true
  }));
  return { yes: yesIds.length, pending: pendingIds.length, maybe: maybeIds.length };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 1) chiusura automatica del voto (prima dei promemoria)
    let voteResult = { confirmed: 0, askedOrganizer: 0 };
    try { voteResult = await closeDueVotes(admin, siteUrl); } catch (_err) { /* non deve bloccare i promemoria */ }

    // cron ogni 10 minuti con {"mode":"votes"}: solo chiusura voti.
    const reqBody = await req.json().catch(() => ({}));
    if (reqBody && reqBody.mode === "votes") return json({ votes: voteResult });

    // 2) promemoria "domani"
    const tomorrow = tomorrowISOInRome();
    const { data: tomorrowOptions, error: optionsErr } = await admin.from("date_options").select("id, event_id").eq("date_iso", tomorrow);
    if (optionsErr) return json({ error: optionsErr.message }, 500);
    const tomorrowOptionIds = (tomorrowOptions || []).map((o: any) => o.id);
    if (!tomorrowOptionIds.length) return json({ votes: voteResult, checked: 0, remindersSent: 0 });

    const { data: confirmedDue, error: eventsErr } = await admin.from("events")
      .select("id, name, confirmed_date_option_id")
      .in("confirmed_date_option_id", tomorrowOptionIds)
      .is("cancelled_at", null)
      .eq("manually_cancelled", false)
      .is("reminder_sent_at", null);
    if (eventsErr) return json({ error: eventsErr.message }, 500);

    // Eventi a data singola NON confermati (regole vecchie) con la data domani.
    const dueEvents: any[] = (confirmedDue || []).slice();
    const tomorrowEventIds = Array.from(new Set((tomorrowOptions || []).map((o: any) => o.event_id)));
    if (tomorrowEventIds.length) {
      const { data: openDue } = await admin.from("events")
        .select("id, name, manually_cancelled")
        .in("id", tomorrowEventIds)
        .is("confirmed_date_option_id", null)
        .is("cancelled_at", null)
        .is("reminder_sent_at", null);
      for (const ev of (openDue || [])) {
        if (ev.manually_cancelled) continue;
        const { data: allOpts } = await admin.from("date_options").select("id").eq("event_id", ev.id);
        if ((allOpts || []).length !== 1) continue;
        dueEvents.push({ id: ev.id, name: ev.name, confirmed_date_option_id: allOpts[0].id });
      }
    }

    let remindersSent = 0;
    const details: any[] = [];
    for (const event of dueEvents) {
      // Segna subito come avvisato: meglio un promemoria in meno che doppio.
      const { data: claimed } = await admin.from("events")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", event.id).is("reminder_sent_at", null).select("id");
      if (!claimed || !claimed.length) continue;
      try {
        const r = await sendDayBeforeReminders(admin, event, event.confirmed_date_option_id, siteUrl);
        details.push({ id: event.id, ...r });
        if (r.yes || r.pending || r.maybe) remindersSent++;
      } catch (_err) { /* passa al prossimo evento */ }
    }
    return json({ votes: voteResult, checked: dueEvents.length, remindersSent, details });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
