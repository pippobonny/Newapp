import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/* Email di benvenuto quando si crea un nuovo account. Fire and forget da
   data.js -> createAccount(): non deve mai bloccare la registrazione.
   verify_jwt = false, CORS per la richiesta OPTIONS del browser.
   2026-10-07: lingua dell'email = quella dell'app al momento della
   registrazione (body.lang), altrimenti accounts.lang. */
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
    const accountId = body.accountId;
    if (!accountId) return json({ error: "accountId mancante" }, 400);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromAddress = Deno.env.get("EMAIL_FROM") || "notifiche@mail.seeva.it";
    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    if (!resendKey) return json({ skipped: true, reason: "RESEND_API_KEY non configurata" });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: account, error } = await admin.from("accounts").select("username, email, lang").eq("id", accountId).maybeSingle();
    if (error || !account || !account.email) return json({ skipped: true, reason: "account senza email" });

    const en = body.lang === "en" || (body.lang !== "it" && account.lang === "en");
    const html = '<div style="font-family:sans-serif; max-width:480px; margin:0 auto; color:#3D2244;">'
      + '<div style="text-align:center; margin-bottom:18px;"><img src="https://seeva.it/icon-192.png" width="44" height="44" alt="seeva" style="border-radius:13px; display:inline-block;"></div>'
      + (en
        ? '<h2>Welcome to seeva, ' + account.username + '! \u{1F389}</h2>'
          + '<p>Your profile is ready. From here you can create events, manage your friends lists and reply to the invites you get.</p>'
        : '<h2>Benvenuto su seeva, ' + account.username + '! \u{1F389}</h2>'
          + '<p>Il tuo profilo &egrave; pronto. Da qui puoi creare eventi, gestire le tue liste amici e rispondere agli inviti che ricevi.</p>')
      + '<p><a href="' + siteUrl + '/index.html" style="display:inline-block; background:#FF7A29; color:#fff; padding:12px 20px; border-radius:10px; text-decoration:none; font-weight:600;">' + (en ? 'Open seeva' : 'Apri seeva') + ' &rarr;</a></p>'
      + '</div>';

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromAddress, to: [account.email], subject: en ? "Welcome to seeva!" : "Benvenuto su seeva!", html })
    });
    if (!resendRes.ok) return json({ sent: false, error: "Resend error", detail: await resendRes.text() });
    return json({ sent: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
