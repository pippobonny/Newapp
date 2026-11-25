/* Revoca di "Accedi con Apple" quando qualcuno elimina l'account
   (requisito Apple, linea guida 5.1.1(v): chi ha usato Sign in with Apple
   deve vedersi revocato anche il collegamento lato Apple).

   Come funziona (documentazione Apple "Revoke tokens"):
   1. l'app iPhone, subito prima di eliminare, riapre il riquadro Apple e
      riceve un "authorization code" usa-e-getta (vale 5 minuti);
   2. qui lo scambiamo con Apple (POST /auth/token) e otteniamo il
      refresh_token (o l'access_token);
   3. lo mandiamo a POST /auth/revoke: Apple scollega seeva dall'ID Apple.
   Per parlare con Apple serve un "client_secret": un JWT ES256 firmato con
   la chiave .p8 di Sign in with Apple (Team ID + Key ID).

   Segreti (Supabase > Edge Functions > Secrets), da mettere quando l'account
   Apple Developer è attivo:
     APPLE_TEAM_ID    Team ID (10 caratteri)
     APPLE_KEY_ID     Key ID della chiave "Sign in with Apple"
     APPLE_KEY_P8     contenuto del file AuthKey_XXXX.p8 (anche con \n scritti)
     APPLE_CLIENT_ID  facoltativo, di base "it.seeva.app" (bundle id dell'app)

   REGOLA: questa funzione non lancia MAI errori. Se mancano i segreti, il
   codice, o Apple non risponde, restituisce un esito e basta: l'eliminazione
   dell'account deve andare avanti comunque. (Filippo, 2026-11-25) */

export type AppleRevokeResult =
  | { status: "revoked" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export interface AppleRevokeConfig {
  teamId: string;
  keyId: string;
  keyP8: string;
  clientId: string;
}

type EnvGetter = (name: string) => string | undefined;

export function readAppleConfig(getEnv: EnvGetter): AppleRevokeConfig | null {
  const teamId = (getEnv("APPLE_TEAM_ID") || "").trim();
  const keyId = (getEnv("APPLE_KEY_ID") || "").trim();
  const keyP8 = (getEnv("APPLE_KEY_P8") || "").trim();
  const clientId = (getEnv("APPLE_CLIENT_ID") || "it.seeva.app").trim();
  if (!teamId || !keyId || !keyP8) return null;
  return { teamId, keyId, keyP8, clientId };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlJson(obj: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

/* Il .p8 è una chiave PKCS#8 in formato PEM. Nei segreti a volte gli "a capo"
   arrivano come "\n" scritti: li sistemiamo prima di leggerla. */
function p8ToDer(p8: string): Uint8Array {
  const clean = p8
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* client_secret per Apple: JWT ES256, valido 5 minuti (Apple accetta fino a 6 mesi). */
export async function makeAppleClientSecret(cfg: AppleRevokeConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    p8ToDer(cfg.keyP8),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const header = { alg: "ES256", kid: cfg.keyId, typ: "JWT" };
  const payload = {
    iss: cfg.teamId,
    iat: nowSeconds,
    exp: nowSeconds + 300,
    aud: "https://appleid.apple.com",
    sub: cfg.clientId
  };
  const signingInput = base64UrlJson(header) + "." + base64UrlJson(payload);
  // WebCrypto restituisce già la firma "r||s" (64 byte), il formato che vuole JWS ES256.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput)));
  return signingInput + "." + base64UrlEncode(sig);
}

async function postForm(fetchFn: typeof fetch, url: string, form: Record<string, string>, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

export interface RevokeOptions {
  authorizationCode?: string | null;
  userUsesApple: boolean;
  getEnv: EnvGetter;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export async function revokeAppleSignIn(opts: RevokeOptions): Promise<AppleRevokeResult> {
  try {
    if (!opts.userUsesApple) return { status: "skipped", reason: "utente non entrato con Apple" };
    const code = String(opts.authorizationCode || "").trim();
    if (!code) return { status: "skipped", reason: "nessun authorization code dall'app" };
    const cfg = readAppleConfig(opts.getEnv);
    if (!cfg) return { status: "skipped", reason: "segreti Apple non configurati" };

    const fetchFn = opts.fetchFn || fetch;
    const timeoutMs = opts.timeoutMs ?? 8000;
    const clientSecret = await makeAppleClientSecret(cfg);

    const tokenRes = await postForm(fetchFn, "https://appleid.apple.com/auth/token", {
      client_id: cfg.clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code"
    }, timeoutMs);
    if (!tokenRes.ok) {
      const txt = await tokenRes.text().catch(() => "");
      return { status: "failed", reason: "auth/token " + tokenRes.status + " " + txt.slice(0, 200) };
    }
    const tokens = await tokenRes.json().catch(() => ({})) as { refresh_token?: string; access_token?: string };
    const token = tokens.refresh_token || tokens.access_token;
    const hint = tokens.refresh_token ? "refresh_token" : "access_token";
    if (!token) return { status: "failed", reason: "Apple non ha restituito token" };

    const revokeRes = await postForm(fetchFn, "https://appleid.apple.com/auth/revoke", {
      client_id: cfg.clientId,
      client_secret: clientSecret,
      token,
      token_type_hint: hint
    }, timeoutMs);
    if (!revokeRes.ok) {
      const txt = await revokeRes.text().catch(() => "");
      return { status: "failed", reason: "auth/revoke " + revokeRes.status + " " + txt.slice(0, 200) };
    }
    return { status: "revoked" };
  } catch (err) {
    return { status: "failed", reason: String(err && (err as Error).message || err) };
  }
}

/* L'utente Supabase è entrato (anche) con Apple? */
export function userHasAppleIdentity(user: { identities?: Array<{ provider?: string }> | null; app_metadata?: Record<string, unknown> } | null | undefined): boolean {
  if (!user) return false;
  if (Array.isArray(user.identities) && user.identities.some((i) => i && i.provider === "apple")) return true;
  const am = user.app_metadata || {};
  if (am.provider === "apple") return true;
  const providers = am.providers;
  return Array.isArray(providers) && providers.includes("apple");
}
