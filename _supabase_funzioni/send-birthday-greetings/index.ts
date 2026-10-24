import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

/* Auguri di compleanno automatici (Fil, 2026-10-24).
   Chiamata da pg_cron alle 7 e alle 8 UTC (verify_jwt true, il cron passa la
   chiave publishable). Manda gli auguri solo se a Roma sono già le 9 o più:
   così d'estate parte alle 9 (7 UTC) e d'inverno alle 9 (8 UTC). La tabella
   birthday_greetings_sent impedisce doppi invii (uno per account per anno).
   Chi è nato il 29 febbraio li riceve il 28 negli anni non bisestili.
   Solo una push: toccandola si apre index.html?auguri=<data di oggi>, che
   mostra la schermata con i coriandoli (initBirthdayGreeting in script.js).
   Test: body { test: "<account id>", key: <secret BIRTHDAY_TEST_KEY> } manda
   la push a quell'account subito, senza segnarla come inviata. */
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

function romeParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(d);
  const g = (t: string) => (parts.find((p) => p.type === t) || { value: "0" }).value;
  return { year: +g("year"), mmdd: g("month") + "-" + g("day"), iso: g("year") + "-" + g("month") + "-" + g("day"), hour: +g("hour") };
}
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

function payloadFor(acc: any, siteUrl: string, todayISO: string) {
  const en = acc.lang === "en";
  const name = String(acc.nome || acc.username || "").trim();
  return JSON.stringify({
    title: en ? "🎂 Happy birthday" + (name ? ", " + name : "") + "!" : "🎂 Tanti auguri" + (name ? ", " + name : "") + "!",
    body: en ? "The whole seeva team wishes you a happy birthday 🧡\n👉 Open it, there's a surprise for you 🎁"
             : "Tutto il team di seeva ti fa gli auguri 🧡\n👉 Aprila, c'è una sorpresa per te 🎁",
    url: siteUrl + "/index.html?auguri=" + todayISO,
    lang: en ? "en" : "it"
  });
}

async function sendTo(admin: any, accountId: string, payload: string): Promise<number> {
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("account_id", accountId);
  let sent = 0;
  for (const sub of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      sent++;
    } catch (err: any) {
      if (err && (err.statusCode === 410 || err.statusCode === 404)) await admin.from("push_subscriptions").delete().eq("id", sub.id);
    }
  }
  return sent;
}

Deno.serve(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!vapidPublic || !vapidPrivate) return json({ error: "VAPID mancanti" }, 500);
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:pippo.bonino@gmail.com", vapidPublic, vapidPrivate);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
  const now = romeParts(new Date());

  // Modalità prova
  if (body && body.test) {
    const testKey = Deno.env.get("BIRTHDAY_TEST_KEY");
    if (!testKey || body.key !== testKey) return json({ error: "no" }, 403);
    const { data: acc } = await admin.from("accounts").select("id, nome, username, lang").eq("id", String(body.test)).maybeSingle();
    if (!acc) return json({ error: "account non trovato" }, 404);
    return json({ test: true, sent: await sendTo(admin, acc.id, payloadFor(acc, siteUrl, now.iso)) });
  }

  if (now.hour < 9) return json({ skipped: "prima delle 9 a Roma", hour: now.hour });

  const days = [now.mmdd];
  if (now.mmdd === "02-28" && !isLeap(now.year)) days.push("02-29");

  const { data: accounts, error } = await admin.from("accounts").select("id, nome, username, lang, data_nascita").not("data_nascita", "is", null);
  if (error) return json({ error: error.message }, 500);
  const todays = (accounts || []).filter((a: any) => days.indexOf(String(a.data_nascita).slice(5, 10)) !== -1);
  if (!todays.length) return json({ birthdays: 0 });

  const { data: already } = await admin.from("birthday_greetings_sent").select("account_id").eq("year", now.year).in("account_id", todays.map((a: any) => a.id));
  const done = new Set((already || []).map((r: any) => r.account_id));

  let greeted = 0, pushes = 0;
  for (const acc of todays) {
    if (done.has(acc.id)) continue;
    // prima si segna (la chiave primaria blocca un secondo giro in parallelo), poi si manda
    const ins = await admin.from("birthday_greetings_sent").insert({ account_id: acc.id, year: now.year });
    if (ins.error) continue;
    pushes += await sendTo(admin, acc.id, payloadFor(acc, siteUrl, now.iso));
    greeted++;
  }
  return json({ birthdays: todays.length, greeted, pushes });
});
