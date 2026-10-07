import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/* Email "reimposta la tua password" (profilo.html/amico.html, "Password
   dimenticata?"). Non rivela mai se una email esiste: risponde sempre uguale.
   verify_jwt = false e CORS come le altre funzioni email.
   2026-10-07: lingua = quella dell'app di chi l'ha chiesta (body.lang). */
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
    const email = (body.email || "").trim();
    if (!email) return json({ error: "email mancante" }, 400);
    const en = body.lang === "en";

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromAddress = Deno.env.get("EMAIL_FROM") || "notifiche@mail.seeva.it";
    const siteUrl = Deno.env.get("SITE_URL") || "https://seeva.it";
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: result, error } = await admin.rpc("begin_password_reset", { p_email: email });
    if (error) return json({ error: error.message }, 500);
    // Risposta SEMPRE uguale, trovato o no.
    if (!result || !result.found || !resendKey) return json({ ok: true });

    const resetUrl = siteUrl + "/profilo.html?resetToken=" + encodeURIComponent(result.token);
    const html = '<div style="font-family:sans-serif; max-width:480px; margin:0 auto; color:#3D2244;">'
      + '<div style="text-align:center; margin-bottom:18px;"><img src="https://seeva.it/icon-192.png" width="44" height="44" alt="seeva" style="border-radius:13px; display:inline-block;"></div>'
      + (en
        ? '<h2>Reset your password</h2><p>Hi ' + result.username + ', you asked to reset the password for your seeva profile.</p>'
        : '<h2>Reimposta la tua password</h2><p>Ciao ' + result.username + ', hai chiesto di reimpostare la password del tuo profilo su seeva.</p>')
      + '<p><a href="' + resetUrl + '" style="display:inline-block; background:#FF7A29; color:#fff; padding:12px 20px; border-radius:10px; text-decoration:none; font-weight:600;">' + (en ? 'Choose a new password' : 'Scegli una nuova password') + ' &rarr;</a></p>'
      + '<p style="font-size:12px; color:#8C7C91;">' + (en ? 'The link expires in an hour. If you didn\'t ask for this, just ignore this email.' : 'Il link scade tra un\'ora. Se non sei stato tu a chiederlo, ignora pure questa email.') + '</p>'
      + '</div>';

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromAddress, to: [result.email], subject: en ? "Reset your seeva password" : "Reimposta la tua password su seeva", html })
    });
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
