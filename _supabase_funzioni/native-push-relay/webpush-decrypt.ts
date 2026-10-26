// Logica comune (testabile in Node e in Deno): decifra un messaggio Web Push
// (RFC 8291, aes128gcm) e verifica la firma VAPID (RFC 8292, ES256).
const enc = new TextEncoder();
export function b64uToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function concat(...arrs: Uint8Array[]): Uint8Array { const n = arrs.reduce((a, b) => a + b.length, 0); const o = new Uint8Array(n); let i = 0; for (const a of arrs) { o.set(a, i); i += a.length; } return o; }
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
export async function decryptWebPush(body: Uint8Array, privJwk: JsonWebKey, uaPublicB64u: string, authB64u: string): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const priv = await crypto.subtle.importKey('jwk', privJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, priv, 256));
  const uaPublic = b64uToBytes(uaPublicB64u);
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(b64uToBytes(authB64u), ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  if (plain[end] !== 2) throw new Error('padding');
  return new TextDecoder().decode(plain.slice(0, end));
}
export async function verifyVapid(authHeader: string, expectedPublicB64u: string): Promise<boolean> {
  const m = /vapid\s+t=([^,\s]+)\s*,\s*k=([^,\s]+)/i.exec(authHeader || '');
  if (!m) return false;
  const [, jwt, k] = m;
  if (k !== expectedPublicB64u) return false;
  const [h, p, s] = jwt.split('.');
  if (!s) return false;
  const pub = await crypto.subtle.importKey('raw', b64uToBytes(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64uToBytes(s), enc.encode(h + '.' + p));
  if (!ok) return false;
  try { const claims = JSON.parse(new TextDecoder().decode(b64uToBytes(p))); return claims.exp * 1000 > Date.now(); } catch (_e) { return false; }
}
