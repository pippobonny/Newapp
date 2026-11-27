import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/* Avviso email a Filippo per ogni nuova SEGNALAZIONE di contenuti (audit
   26/11/2026, A4.6 - Apple 1.2 chiede di reagire entro 24 ore).
   Chiamata da pg_cron ogni 15 minuti (vedi supabase/2026-11-26_11_avviso_segnalazioni.sql).
   Prende le righe di problem_reports che iniziano con "[SEGNALA" e non hanno
   ancora alert_sent_at, le segna (update atomico) e manda UNA email riassuntiva.
   Idempotente: se la chiama qualcun altro, al massimo arriva prima l'email a Filippo.
   Pubblicata il 27/11/2026 (verify_jwt = true). */
const TO = Deno.env.get("REPORT_ALERT_TO") || "pippo.bonino@gmail.com";
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (_req: Request) => {
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: rows, error } = await admin.from("problem_reports")
      .update({ alert_sent_at: new Date().toISOString() })
      .is("alert_sent_at", null).like("message", "[SEGNALA%")
      .select("id, created_at, message, username, account_id, page_url");
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    if (!rows || !rows.length) return new Response(JSON.stringify({ sent: 0 }));

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return new Response(JSON.stringify({ sent: 0, reason: "RESEND_API_KEY mancante" }));
    const html = '<div style="font-family:sans-serif; color:#3D2244;"><h2>seeva: ' + rows.length + ' nuove segnalazioni</h2>'
      + '<p>Apple chiede di controllarle entro 24 ore (togliere il contenuto e, se serve, bloccare l\'utente).</p><ol>'
      + rows.map((r: any) => '<li style="margin-bottom:10px;"><b>' + esc(new Date(r.created_at).toLocaleString("it-IT", { timeZone: "Europe/Rome" })) + '</b> - da '
        + esc(r.username || r.account_id || "ospite") + '<br>' + esc(String(r.message).slice(0, 800)) + '</li>').join("")
      + '</ol><p style="font-size:12px; color:#8C7C91;">Le trovi nel pannello Supabase, tabella problem_reports.</p></div>';
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM") || "notifiche@mail.seeva.it", to: [TO], subject: "seeva: " + rows.length + " nuove segnalazioni da controllare", html })
    });
    if (!res.ok) {
      console.error("send-report-alerts: Resend", res.status, (await res.text().catch(() => "")).slice(0, 300));
      // si rimettono "da mandare", cosi' il prossimo giro riprova
      await admin.from("problem_reports").update({ alert_sent_at: null }).in("id", rows.map((r: any) => r.id));
      return new Response(JSON.stringify({ sent: 0, error: "resend" }), { status: 502 });
    }
    return new Response(JSON.stringify({ sent: rows.length }));
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
