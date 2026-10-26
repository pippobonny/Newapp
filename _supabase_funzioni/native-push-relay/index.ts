import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { decryptWebPush, verifyVapid } from "./webpush-decrypt.ts";

/* Notifiche nell'app vera (Android, poi iPhone) — Fil, 2026-10-26.
   Tutte le funzioni che mandano notifiche usano già il Web Push (web-push +
   tabella push_subscriptions). Per non doverle cambiare una per una, il
   telefono con l'app registra in push_subscriptions un "indirizzo" che punta
   QUI (…/native-push-relay?t=<token Firebase>) con una chiave nostra: il
   messaggio arriva cifrato come a un browser qualsiasi, questa funzione lo
   decifra e lo gira a Firebase Cloud Messaging, che lo consegna al telefono.
   - verify_jwt = false (chi chiama è la libreria web-push, non un utente):
     al suo posto si controlla la firma VAPID, che solo il nostro server ha.
   - Token non più valido (app disinstallata) -> risposta 410: chi ha mandato
     la notifica cancella da solo la riga da push_subscriptions.
   Segreti: chiave della relay in app_secrets (o NATIVE_PUSH_PRIVATE_JWK), FCM_SERVICE_ACCOUNT
   (JSON dell'account di servizio Firebase), VAPID_PUBLIC_KEY (già presente). */
const RELAY_PUBLIC_KEY = "BJ6Rt9_bAWOCtIoJ7W5bLoV7gN23n8VbtBWXoThZHli5cIrBZFTLNK3bjXeN8_dxoPxkNiD3yOn3B8KiUYKKtJE";
const RELAY_BASE = "https://kruphqdahghxuvutonae.supabase.co/functions/v1/native-push-relay?t=";

const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let cachedToken: { value: string; exp: number } | null = null;

async function fcmAccessToken(sa: any): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header = b64u(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64u(enc.encode(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600
  })));
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(header + "." + claims)));
  const r = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + header + "." + claims + "." + b64u(sig)
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("oauth " + r.status + " " + JSON.stringify(j));
  cachedToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok");
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("t") || "";
    if (!token) return new Response("missing token", { status: 400 });
    if (!(await verifyVapid(req.headers.get("Authorization") || "", Deno.env.get("VAPID_PUBLIC_KEY") || ""))) {
      return new Response("forbidden", { status: 403 });
    }
    const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT");
    if (!saRaw) return new Response("not configured", { status: 503 });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let jwkRaw = Deno.env.get("NATIVE_PUSH_PRIVATE_JWK") || "";
    if (!jwkRaw) {
      const { data: sec } = await admin.from("app_secrets").select("value").eq("name", "native_push_private_jwk").maybeSingle();
      jwkRaw = (sec && sec.value) || "";
    }
    if (!jwkRaw) return new Response("not configured", { status: 503 });
    const { data: sub } = await admin.from("push_subscriptions").select("auth").eq("endpoint", RELAY_BASE + token).limit(1).maybeSingle();
    if (!sub || !sub.auth) return new Response("gone", { status: 410 });

    const body = new Uint8Array(await req.arrayBuffer());
    const payload = JSON.parse(await decryptWebPush(body, JSON.parse(jwkRaw), RELAY_PUBLIC_KEY, sub.auth));
    const sa = JSON.parse(saRaw);
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(payload)) if (v !== undefined && v !== null && k !== "title" && k !== "body") data[k] = typeof v === "string" ? v : JSON.stringify(v);
    const tag = typeof payload.tag === "string" ? payload.tag.slice(0, 100) : undefined;
    const message = {
      token,
      notification: { title: String(payload.title || "seeva"), body: String(payload.body || "") },
      data,
      android: { priority: "HIGH", notification: { channel_id: "seeva", icon: "ic_stat_seeva", color: "#6B3F73", sound: "default", ...(tag ? { tag } : {}) } },
      apns: { payload: { aps: { sound: "default" } } }
    };
    const access = await fcmAccessToken(sa);
    const r = await fetch("https://fcm.googleapis.com/v1/projects/" + sa.project_id + "/messages:send", {
      method: "POST", headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });
    if (r.ok) return new Response("sent", { status: 201 });
    const errText = await r.text();
    if (r.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(errText)) return new Response("gone", { status: 410 });
    return new Response("fcm " + r.status + " " + errText.slice(0, 300), { status: 502 });
  } catch (err) {
    return new Response("error " + String(err), { status: 500 });
  }
});
