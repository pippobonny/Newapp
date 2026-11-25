#!/usr/bin/env python3
"""Piccolo client per l'API di App Store Connect (da Linux, senza Mac).

Le chiavi NON stanno in questo file: si legge il .p8 da _store_apple/segreti-apple/
(cartella esclusa da git). Valori non segreti: Key ID e Issuer ID.

Uso:
  python3 asc.py GET /v1/bundleIds
  python3 asc.py POST /v1/certificates corpo.json
"""
import base64, json, os, sys, time, urllib.request, urllib.error
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

QUI = os.path.dirname(os.path.abspath(__file__))
SEGRETI = os.path.join(QUI, "..", "segreti-apple")
KEY_ID = os.environ.get("ASC_KEY_ID", "BT3WW6GW3H")
ISSUER = os.environ.get("ASC_ISSUER_ID", "16e228ca-84cb-4472-8ff0-89276eb57f5d")
BASE = "https://api.appstoreconnect.apple.com"


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def token():
    with open(os.path.join(SEGRETI, f"AuthKey_{KEY_ID}.p8"), "rb") as f:
        key = serialization.load_pem_private_key(f.read(), password=None)
    head = {"alg": "ES256", "kid": KEY_ID, "typ": "JWT"}
    now = int(time.time())
    body = {"iss": ISSUER, "iat": now, "exp": now + 1000, "aud": "appstoreconnect-v1"}
    msg = (b64u(json.dumps(head).encode()) + "." + b64u(json.dumps(body).encode())).encode()
    r, s = decode_dss_signature(key.sign(msg, ec.ECDSA(hashes.SHA256())))
    sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return msg.decode() + "." + b64u(sig)


def call(method, path, data=None):
    url = path if path.startswith("http") else BASE + path
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", "Bearer " + token())
    if data is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(data).encode()
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else {})
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, {"raw": txt}


if __name__ == "__main__":
    method, path = sys.argv[1], sys.argv[2]
    data = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else None
    st, out = call(method, path, data)
    print(st)
    print(json.dumps(out, indent=1, ensure_ascii=False))
