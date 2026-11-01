import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, Lang, langsOf, sendPushToAccounts } from "./i18n.ts";

/* Push "nuova spesa" (Fil, 2026-11-01): a chi è incluso nella spesa, tranne
   chi l'ha aggiunta. Body: { expenseId }. verify_jwt = false come
   notify-event-poll: i controlli sono qui (spesa creata da meno di 10
   minuti, notified_at preso con update atomico: mai due notifiche). */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function jsonRes(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function euro(n: number, lang: Lang): string {
  const v = Math.round(n * 100) / 100;
  return lang === "en" ? "€" + v.toFixed(2) : v.toFixed(2).replace(".", ",") + " €";
}
function shorten(s: string, n: number) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + "…" : t;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const expenseId = typeof body.expenseId === "string" ? body.expenseId : null;
    if (!expenseId) return jsonRes({ error: "expenseId mancante" }, 400);

    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { data: claimed, error } = await admin.from("event_expenses")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", expenseId).is("notified_at", null).gte("created_at", tenMinAgo)
      .select("id, event_id, description, amount, emoji, paid_by_name, created_by_account_id, split_all");
    if (error) return jsonRes({ error: error.message }, 500);
    if (!claimed || !claimed.length) return jsonRes({ notified: 0, skipped: true });
    const ex = claimed[0];

    const { data: event } = await admin.from("events").select("id, name, cancelled_at, confirmed_date_option_id").eq("id", ex.event_id).maybeSingle();
    if (!event || event.cancelled_at) return jsonRes({ notified: 0 });

    const { data: shares } = await admin.from("event_expense_shares").select("name, account_id").eq("expense_id", ex.id);
    const n = (shares || []).length;
    if (!n) return jsonRes({ notified: 0 });
    const recipients = Array.from(new Set((shares || []).map((s: any) => s.account_id).filter((id: any) => id && id !== ex.created_by_account_id))) as string[];
    if (!recipients.length) return jsonRes({ notified: 0 });

    const { data: author } = ex.created_by_account_id
      ? await admin.from("accounts").select("username").eq("id", ex.created_by_account_id).maybeSingle()
      : { data: null };
    const who = String((author && author.username) || ex.paid_by_name || "").trim();
    const amount = Number(ex.amount) || 0;
    const share = amount / n;
    const url = siteUrl + "/evento.html?id=" + encodeURIComponent(event.id) + "&spese=1";
    const langs = await langsOf(admin, recipients);
    let sent = 0;
    for (const lang of ["it", "en"] as Lang[]) {
      const ids = recipients.filter((id) => (langs.get(id) || "it") === lang);
      if (!ids.length) continue;
      const what = (ex.emoji ? ex.emoji + " " : "") + shorten(ex.description, 50);
      sent += await sendPushToAccounts(admin, ids, {
        title: "💶 " + event.name,
        body: (who || L(lang, "Qualcuno", "Someone")) + L(lang, " ha segnato una spesa: ", " added an expense: ") + what + " · " + euro(amount, lang)
          + "\n" + L(lang, "La tua parte: ", "Your share: ") + euro(share, lang) + (ex.split_all && !event.confirmed_date_option_id ? L(lang, " (per ora, tra " + n + ")", " (for now, split " + n + " ways)") : ""),
        url, lang, tag: "exp|" + event.id
      });
    }
    return jsonRes({ notified: recipients.length, sentPush: sent });
  } catch (err) {
    return jsonRes({ error: String(err) }, 500);
  }
});
