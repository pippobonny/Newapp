/* Solo le funzioni di i18n.ts (comune alle notify-*) usate qui. */
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
