import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/* Email "reimposta la tua password" (profilo.html/amico.html, "Password
   dimenticata?"). Non rivela mai se una email esiste: risponde sempre uguale.
   verify_jwt = false e CORS come le altre funzioni email.
   2026-10-07: lingua = quella dell'app di chi l'ha chiesta (body.lang).
   2026-10-14 (revisione sicurezza): begin_password_reset ora si può
   chiamare SOLO da qui (prima chiunque poteva chiamarla direttamente e
   ricevere il token = rubare l'account) e manda al massimo un'email ogni
   2 minuti per account. Username "ripulito" nell'HTML. */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// M6 (audit 26/11/2026): massimo 5 richieste ogni 15 minuti dallo stesso indirizzo IP
// (in memoria, vale per l'istanza della funzione: basta a fermare chi ne manda centinaia).
const ipHits = new Map<string, number[]>();
function tooManyFromIp(req: Request, max = 5, windowMs = 15 * 60 * 1000): boolean {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";
  const now = Date.now();
  const list = (ipHits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  ipHits.set(ip, list);
  if (ipHits.size > 5000) ipHits.clear();
  return list.length > max;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (tooManyFromIp(req)) return json({ ok: true }); // stessa risposta di sempre, ma niente email
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

    const uname = String(result.username || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const resetUrl = siteUrl + "/profilo.html?resetToken=" + encodeURIComponent(result.token);
    const html = '<div style="font-family:sans-serif; max-width:480px; margin:0 auto; color:#3D2244;">'
      + '<div style="text-align:center; margin-bottom:18px;"><img src="https://seeva.it/icon-192.png" width="44" height="44" alt="seeva" style="border-radius:13px; display:inline-block;"></div>'
      + (en
        ? '<h2>Reset your password</h2><p>Hi ' + uname + ', you asked to reset the password for your seeva profile.</p>'
        : '<h2>Reimposta la tua password</h2><p>Ciao ' + uname + ', hai chiesto di reimpostare la password del tuo profilo su seeva.</p>')
      + '<p><a href="' + resetUrl + '" style="display:inline-block; background:#FF7A29; color:#fff; padding:12px 20px; border-radius:10px; text-decoration:none; font-weight:600;">' + (en ? 'Choose a new password' : 'Scegli una nuova password') + ' &rarr;</a></p>'
      + '<p style="font-size:12px; color:#8C7C91;">' + (en ? 'The link expires in an hour. If you didn\'t ask for this, just ignore this email.' : 'Il link scade tra un\'ora. Se non sei stato tu a chiederlo, ignora pure questa email.') + '</p>'
      + '</div>';

    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromAddress, to: [result.email], subject: en ? "Reset your seeva password" : "Reimposta la tua password su seeva", html })
    });
    // M6 (audit 26/11/2026): se Resend rifiuta, almeno resta scritto nei log.
    // All'utente si risponde sempre "ok" (non si rivela se l'email esiste).
    if (!sent.ok) console.error("request-password-reset: Resend ha risposto", sent.status, (await sent.text().catch(() => "")).slice(0, 300));
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
