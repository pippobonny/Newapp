/* Lingua di push/email (Fil, 2026-10-07): ogni account ha accounts.lang
   ('it' | 'en'), aggiornata dall'app (lingua del telefono o scelta nel
   Profilo). Qui le funzioni condivise da tutte le notify-*: si raggruppano i
   destinatari per lingua e si costruiscono i testi in quella lingua.
   Inglese britannico. Stesso file copiato in ogni Edge Function. */
import webpush from "npm:web-push@3.6.7";
export type Lang = "it" | "en";
export const L = (lang: Lang, it: string, en: string) => (lang === "en" ? en : it);

export async function langsOf(admin: any, accountIds: string[]): Promise<Map<string, Lang>> {
  const m = new Map<string, Lang>();
  if (!accountIds.length) return m;
  const { data } = await admin.from("accounts").select("id, lang").in("id", accountIds);
  (data || []).forEach((a: any) => m.set(a.id, a.lang === "en" ? "en" : "it"));
  accountIds.forEach((id) => { if (!m.has(id)) m.set(id, "it"); });
  return m;
}
export function groupByLang(ids: string[], langs: Map<string, Lang>): Record<Lang, string[]> {
  const g: Record<Lang, string[]> = { it: [], en: [] };
  ids.forEach((id) => g[langs.get(id) || "it"].push(id));
  return g;
}

function locale(lang: Lang) { return lang === "en" ? "en-GB" : "it-IT"; }
export function romeTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function isoToUTCDate(iso: string): Date { return new Date(iso + "T00:00:00Z"); }
export function dayMonth(iso: string, lang: Lang): { day: number; month: string } {
  const d = isoToUTCDate(iso);
  return { day: d.getUTCDate(), month: d.toLocaleDateString(locale(lang), { timeZone: "UTC", month: "long" }) };
}
// "sab 10 ottobre" / "Sat 10 October"
export function dayLabel(iso: string, lang: Lang): string {
  const d = isoToUTCDate(iso);
  const dow = d.toLocaleDateString(locale(lang), { timeZone: "UTC", weekday: "short" }).replace(".", "");
  const dm = dayMonth(iso, lang);
  return dow + " " + dm.day + " " + dm.month;
}
export function buildWhenText(dateISOs: string[], confirmedISO: string | null, eventTime: string | null, lang: Lang): string {
  const time = eventTime ? String(eventTime).slice(0, 5) : null;
  const dates = Array.from(new Set(dateISOs.filter(Boolean))).sort();
  const single = confirmedISO || (dates.length === 1 ? dates[0] : null);
  if (single) {
    const diff = Math.round((isoToUTCDate(single).getTime() - isoToUTCDate(romeTodayISO()).getTime()) / 86400000);
    let dayText: string;
    if (diff === 0) dayText = L(lang, "OGGI", "TODAY");
    else if (diff === 1) dayText = L(lang, "DOMANI", "TOMORROW");
    else dayText = dayLabel(single, lang);
    return dayText + (time ? L(lang, " alle ", " at ") + time : "");
  }
  if (dates.length > 1) {
    const a = dayMonth(dates[0], lang);
    const b = dayMonth(dates[dates.length - 1], lang);
    const range = lang === "en"
      ? (a.month === b.month ? "from " + a.day + " to " + b.day + " " + b.month : "from " + a.day + " " + a.month + " to " + b.day + " " + b.month)
      : (a.month === b.month ? "dal " + a.day + " al " + b.day + " " + b.month : "dal " + a.day + " " + a.month + " al " + b.day + " " + b.month);
    return dates.length + L(lang, " date proposte ", " dates suggested ") + range + (time ? L(lang, ", alle ", ", at ") + time : "");
  }
  return "";
}
export function isVoteText(whenText: string): boolean { return /date proposte|dates suggested/.test(whenText); }

export function shortDescription(desc: string | null): string {
  const d = String(desc || "").replace(/\s+/g, " ").trim();
  if (!d) return "";
  return d.length > 80 ? d.slice(0, 80).replace(/\s+\S*$/, "") + "…" : d;
}
export async function resolveLocationText(admin: any, event: any, lang: Lang): Promise<string> {
  const { data: locOpts } = await admin.from("location_options").select("id, address").eq("event_id", event.id);
  const opts = locOpts || [];
  if (opts.length > 1) {
    const conf = event.confirmed_location_option_id ? opts.find((o: any) => o.id === event.confirmed_location_option_id) : null;
    if (conf && conf.address) return String(conf.address);
    return opts.length + L(lang, " posti proposti", " places suggested");
  }
  if (opts.length === 1 && opts[0].address) return String(opts[0].address);
  return event.location_address ? String(event.location_address) : "";
}
export function escHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildEmailHtml(opts: { emoji?: string; title: string; bodyHtml: string; ctaText?: string; ctaUrl?: string; accent?: string; preheader?: string; lang?: Lang }): string {
  const lang: Lang = opts.lang || "it";
  const accent = opts.accent || "#FF7A29";
  const preheader = opts.preheader || "";
  const ctaBlock = opts.ctaUrl
    ? '<tr><td style="padding:16px 32px 32px 32px; text-align:center;">'
      + '<a href="' + opts.ctaUrl + '" style="display:inline-block; background:' + accent + '; color:#FFFFFF; font-family:\'Inter\',-apple-system,Helvetica,Arial,sans-serif; font-weight:600; font-size:15px; padding:13px 26px; border-radius:12px; text-decoration:none;">' + (opts.ctaText || L(lang, "Apri seeva", "Open seeva")) + ' &rarr;</a>'
      + '</td></tr>'
    : '<tr><td style="height:12px;"></td></tr>';
  return '<!DOCTYPE html><html lang="' + lang + '"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
    + '<title>seeva</title>'
    + '<link rel="preconnect" href="https://fonts.googleapis.com">'
    + '<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">'
    + '</head><body style="margin:0; padding:0; background:#FDF8F4;">'
    + '<div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">' + preheader + '</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FDF8F4;"><tr><td align="center" style="padding:32px 16px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background:#FFFFFF; border-radius:20px; overflow:hidden; box-shadow:0 20px 60px rgba(58,50,90,0.10);">'
    + '<tr><td style="padding:28px 32px 0 32px; text-align:center;"><img src="https://seeva.it/icon-192.png" width="40" height="40" alt="seeva" style="border-radius:12px; display:block; margin:0 auto 8px auto;"><span style="font-family:\'Fraunces\',Georgia,serif; font-weight:700; font-size:13px; letter-spacing:0.06em; color:' + accent + '; text-transform:uppercase;">seeva</span></td></tr>'
    + '<tr><td style="padding:14px 32px 0 32px; text-align:center; font-size:40px; line-height:1;">' + (opts.emoji || "") + '</td></tr>'
    + '<tr><td style="padding:14px 32px 4px 32px; text-align:center;"><h1 style="font-family:\'Fraunces\',Georgia,serif; font-weight:600; font-size:22px; color:#3D2244; margin:0;">' + opts.title + '</h1></td></tr>'
    + '<tr><td style="padding:10px 32px 4px 32px; font-family:\'Inter\',-apple-system,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.6; color:#3D2244; text-align:center;">' + opts.bodyHtml + '</td></tr>'
    + ctaBlock
    + '</table>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;"><tr><td style="padding:18px 12px 0 12px; text-align:center; font-family:\'Inter\',-apple-system,Helvetica,Arial,sans-serif; font-size:12px; color:#8C7C91;">' + L(lang, "seeva &mdash; organizza i tuoi eventi con gli amici.", "seeva &mdash; plan your events with friends.") + '</td></tr></table>'
    + '</td></tr></table></body></html>';
}

export async function sendPushToAccounts(admin: any, accountIds: string[], payload: Record<string, unknown>): Promise<number> {
  if (!accountIds.length) return 0;
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!vapidPublic || !vapidPrivate) return 0;
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:pippo.bonino@gmail.com", vapidPublic, vapidPrivate);
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("account_id", accountIds);
  if (!subs || !subs.length) return 0;
  const payloadStr = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(subs.map(async (sub: any) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payloadStr);
      sent++;
    } catch (err: any) {
      if (err && (err.statusCode === 410 || err.statusCode === 404)) await admin.from("push_subscriptions").delete().eq("id", sub.id);
    }
  }));
  return sent;
}
export async function accountIdsWithPush(admin: any, accountIds: string[]): Promise<Set<string>> {
  if (!Deno.env.get("VAPID_PUBLIC_KEY") || !Deno.env.get("VAPID_PRIVATE_KEY") || !accountIds.length) return new Set();
  const { data: subs } = await admin.from("push_subscriptions").select("account_id").in("account_id", accountIds);
  return new Set((subs || []).map((s: any) => s.account_id));
}
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM") || "notifiche@mail.seeva.it", to: [to], subject, html })
  });
  return r.ok;
}
