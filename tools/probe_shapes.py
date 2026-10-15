"""Fetch real ad-endpoint payloads and test whether e_r=true encrypts the response.

This answers the single most important design question for the rewrite script:
can we always treat the body as JSON, or must we branch on encryption?
"""

import hashlib
import json
import urllib.parse
import urllib.request

from Crypto.Cipher import AES

EAPI_KEY = b"e82ckenh8dichen8"
MAGIC = "-36cd479b6b5-"
HOST = "https://interface3.music.163.com"

HEADERS = {
    "User-Agent": "NME/8.10.0 (iPhone; iOS 15.0; Scale/3.00)",
    "Cookie": "os=ios; appver=8.10.0; channel=distribution",
    "Content-Type": "application/x-www-form-urlencoded",
}


def pkcs7_pad(raw: bytes) -> bytes:
    pad = 16 - len(raw) % 16
    return raw + bytes([pad]) * pad


def pkcs7_unpad(raw: bytes) -> bytes:
    if not raw:
        return raw
    pad = raw[-1]
    if 1 <= pad <= 16 and raw[-pad:] == bytes([pad]) * pad:
        return raw[:-pad]
    return raw


def encrypt_eapi(path, payload):
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    digest = hashlib.md5(f"nobody{path}use{text}md5forencrypt".encode()).hexdigest()
    plain = f"{path}{MAGIC}{text}{MAGIC}{digest}".encode()
    return AES.new(EAPI_KEY, AES.MODE_ECB).encrypt(pkcs7_pad(plain)).hex().upper()


def post(path, payload):
    data = f"params={encrypt_eapi(path, payload)}".encode()
    req = urllib.request.Request(HOST + path, data=data, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read(), dict(r.headers)
    except Exception as exc:  # noqa: BLE001
        return b"", {"err": str(exc)}


print("=" * 70)
print("TEST A: does  e_r=true  cause the RESPONSE to be encrypted?")
print("=" * 70)
for flag in (False, True):
    body, hdrs = post("/api/ad/loading/get", {"e_r": flag})
    looks_json = body[:1] == b"{"
    print(
        f"  request e_r={str(flag):5s} -> {len(body):6d}B  "
        f"starts_with_brace={looks_json}  ct={hdrs.get('Content-Type')!r}"
    )
    if not looks_json and len(body) % 16 == 0 and body:
        try:
            plain = pkcs7_unpad(AES.new(EAPI_KEY, AES.MODE_ECB).decrypt(body))
            print(f"       -> AES-ECB decrypt OK: {plain[:120]!r}")
        except Exception as exc:  # noqa: BLE001
            print(f"       -> decrypt failed: {exc}")

print()
print("=" * 70)
print("TEST B: real payload shapes for the ad endpoints")
print("=" * 70)
for path, payload in [
    ("/api/ad/loading/get", {}),
    ("/api/link/home/framework/tab", {}),
    ("/api/sp/flow/popup/query", {}),
]:
    body, _ = post(path, payload)
    print(f"\n--- {path}  ({len(body)} B) ---")
    try:
        obj = json.loads(body.decode("utf-8"))
        print(json.dumps(obj, ensure_ascii=False, indent=2)[:2500])
    except Exception as exc:  # noqa: BLE001
        print(f"not JSON: {exc}; raw={body[:200]!r}")
