import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { L, langsOf, buildEmailHtml, sendPushToAccounts, accountIdsWithPush, sendEmail } from "./i18n.ts";

/* Email + notifica push "qualcuno vuole aggiungerti come amico vero" (Fil,
   2026-07-19). Parte quando una riga 'friends' passa in link_status='pending'.
   La funzione rilegge destinatario e mittente dall'id della riga.
   body atteso: { friendId: string }. Fire and forget.
   Chi ha la push non riceve anche l'email.
   2026-10-07: testi nella lingua di chi riceve (accounts.lang). */
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
    const friendId = body.friendId;
    if (!friendId) return json({ error: "friendId mancante" }, 400);

    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: friend, error: friendErr } = await admin.from("friends").select("id, name, account_id, friend_list_id, link_status").eq("id", friendId).maybeSingle();
    if (friendErr || !friend || !friend.account_id || friend.link_status !== "pending") return json({ skipped: true, reason: "riga non trovata o non piu' in attesa" });

    const { data: recipientAccount } = await admin.from("accounts").select("email, username").eq("id", friend.account_id).maybeSingle();
    const { data: list } = await admin.from("friend_lists").select("name, owner_account_id, owner_name").eq("id", friend.friend_list_id).maybeSingle();
    const lang = (await langsOf(admin, [friend.account_id])).get(friend.account_id) || "it";

    let ownerName = (list && list.owner_name) || L(lang, "Un amico", "A friend");
    if (list && list.owner_account_id) {
      const { data: ownerAcc } = await admin.from("accounts").select("username").eq("id", list.owner_account_id).maybeSingle();
      if (ownerAcc && ownerAcc.username) ownerName = ownerAcc.username;
    }
    const listName = (list && list.name) || L(lang, "una sua lista", "one of their lists");

    const pushIds = await accountIdsWithPush(admin, [friend.account_id]);
    let sentEmail = false;
    if (!pushIds.has(friend.account_id) && recipientAccount && recipientAccount.email) {
      const html = buildEmailHtml({
        lang, accent: "#6B3F73", emoji: "\u{1F44B}",
        title: L(lang, "Richiesta di amicizia", "Friend request"),
        preheader: ownerName + L(lang, " vuole aggiungerti come amico vero", " wants to add you as a real friend"),
        bodyHtml: L(lang,
          '<p><b>' + ownerName + '</b> vuole aggiungerti come amico vero nella sua lista <b>"' + listName + '"</b>.</p><p>Puoi accettare o rifiutare dalla sezione Notifiche dell\'app.</p>',
          '<p><b>' + ownerName + '</b> wants to add you as a real friend on their list <b>"' + listName + '"</b>.</p><p>You can accept or decline from the Notifications section of the app.</p>'),
        ctaText: L(lang, "Apri le notifiche", "Open notifications"),
        ctaUrl: siteUrl + "/notifiche.html"
      });
      sentEmail = await sendEmail(recipientAccount.email, ownerName + L(lang, " vuole aggiungerti come amico", " wants to add you as a friend"), html);
    }
    const sentPush = await sendPushToAccounts(admin, [friend.account_id], {
      title: L(lang, "Richiesta di amicizia 👋", "Friend request 👋"),
      body: ownerName + L(lang, ' vuole aggiungerti come amico nella sua lista "', ' wants to add you as a friend on their list "') + listName + '"',
      url: siteUrl + "/notifiche.html",
      lang
    });
    return json({ sentEmail, sentPush });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
