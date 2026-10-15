"""Verify the x-aeapi trigger: header -> AES-ECB encrypted, gzip-compressed response.

Decoded from Keywos/wyres.js:
    ne = $request.headers['x-aeapi'] == 'true'
    if ne: json = ungzip(AES_ECB_decrypt(body))
    else:  json = AES_ECB_decrypt(body)

and the hardcoded AES key WordArray decodes to 'e82ckenh8dichen8'.
"""

import gzip
import hashlib
import json
import urllib.request

from Crypto.Cipher import AES

EAPI_KEY = b"e82ckenh8dichen8"
MAGIC = "-36cd479b6b5-"
HOST = "https://interface3.music.163.com"


def decrypt_nes(data: bytes) -> bytes:
    """AES-128-ECB with the custom 'kos' padding used by NetEase (PKCS7-like)."""
    if not data or len(data) % 16:
        raise ValueError(f"not block-aligned: {len(data)}B")
    out = AES.new(EAPI_KEY, AES.MODE_ECB).decrypt(data)
    pad = out[-1]
    if 1 <= pad <= 16 and out[-pad:] == bytes([pad]) * pad:
        return out[:-pad]
    return out


def encrypt_eapi_request(path, payload):
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    digest = hashlib.md5(f"nobody{path}use{text}md5forencrypt".encode()).hexdigest()
    plain = f"{path}{MAGIC}{text}{MAGIC}{digest}".encode()
    pad = 16 - len(plain) % 16
    return AES.new(EAPI_KEY, AES.MODE_ECB).encrypt(plain + bytes([pad]) * pad).hex().upper()


CANDIDATES = [
    ("/api/link/home/framework/tab", {}),
    ("/api/sp/flow/popup/query", {}),
    ("/api/ad/loading/get", {}),
]

print("Probing: does the  x-aeapi: true  request header turn the response into")
print("AES-128-ECB ciphertext (optionally gzipped)?")
print("=" * 78)
print(f"{'path':42s} {'header':16s} {'size':>7s}  verdict")
print("-" * 78)

for path, payload in CANDIDATES:
    for hdr_value in (None, "true"):
        headers = {
            "User-Agent": "NME/9.1.0 (iPhone; iOS 17.0; Scale/3.00)",
            "Cookie": "os=ios; appver=9.1.0; channel=distribution",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        if hdr_value:
            headers["x-aeapi"] = hdr_value
        body = f"params={encrypt_eapi_request(path, payload)}".encode()
        req = urllib.request.Request(HOST + path, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                raw = r.read()
                ct = r.headers.get("Content-Type", "")
        except Exception as exc:  # noqa: BLE001
            print(f"{path:42s} {str(hdr_value):16s} {'-':>7s}  ERR {exc}")
            continue

        label = f"x-aeapi={hdr_value}" if hdr_value else "(none)"
        verdict = None
        if raw[:1] == b"{":
            verdict = f"plain JSON ct={ct!r}"
        else:
            try:
                dec = decrypt_nes(raw)
                try:
                    obj = json.loads(gzip.decompress(dec).decode("utf-8"))
                    verdict = f"*** AES-ECB + GZIP OK *** code={obj.get('code')} keys={list(obj)[:4]}"
                except Exception:  # noqa: BLE001
                    try:
                        obj = json.loads(dec.decode("utf-8"))
                        verdict = f"*** AES-ECB (no gzip) OK *** code={obj.get('code')}"
                    except Exception as exc2:  # noqa: BLE001
                        verdict = f"AES-ECB decrypt gave non-JSON: {dec[:60]!r} ({exc2})"
            except Exception as exc:  # noqa: BLE001
                verdict = f"not decryptable: {exc}"
        print(f"{path:42s} {label:16s} {len(raw):7d}  {verdict}")
