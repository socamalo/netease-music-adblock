"""Probe which NetEase endpoints exist and whether their bodies are eapi-encrypted.

Answers two questions empirically:
  1. Do the ad endpoints from the ddgksf2013 conf use /api/ or /eapi/ ?
  2. When a response comes back, is it AES-128-ECB with key e82ckenh8dichen8?
"""

import hashlib
import json
import urllib.error
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


def encrypt_eapi(path: str, payload: dict) -> str:
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    message = f"nobody{path}use{text}md5forencrypt"
    digest = hashlib.md5(message.encode()).hexdigest()
    plain = f"{path}{MAGIC}{text}{MAGIC}{digest}".encode()
    return AES.new(EAPI_KEY, AES.MODE_ECB).encrypt(pkcs7_pad(plain)).hex().upper()


def try_decrypt_eapi(body: bytes):
    if len(body) % 16 != 0:
        return None, "not a multiple of 16 bytes"
    try:
        plain = pkcs7_unpad(AES.new(EAPI_KEY, AES.MODE_ECB).decrypt(body))
        return json.loads(plain.decode("utf-8")), None
    except Exception as exc:  # noqa: BLE001
        return None, str(exc)


def request(path: str, payload: dict, style: str):
    """style: 'eapi' (encrypted params) or 'api' (plaintext json params)."""
    if style == "eapi":
        data = f"params={encrypt_eapi(path, payload)}".encode()
    else:
        text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        data = f"params={urllib.parse.quote(text)}".encode()
    req = urllib.request.Request(HOST + path, data=data, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.read(), None
    except urllib.error.HTTPError as exc:
        return exc.read(), f"HTTP {exc.code}"
    except Exception as exc:  # noqa: BLE001
        return b"", str(exc)


import urllib.parse  # noqa: E402

CANDIDATES = [
    ("/api/link/home/framework/tab", {}),
    ("/api/search/default/keyword/list", {"type": 1}),
    ("/api/ad/loading/get", {}),
    ("/api/link/page/discovery/resource/show", {}),
    ("/api/link/page/rcmd/resource/show", {}),
    ("/api/delivery/deliver", {}),
    ("/api/vip/cashier/tspopup/get", {}),
    ("/api/sp/flow/popup/query", {}),
    ("/api/link/position/show/resource", {}),
    ("/api/batch", {"e_r": True, "batch": []}),
    ("/eapi/link/home/framework/tab", {}),
    ("/eapi/ad/loading/get", {}),
    ("/eapi/delivery/deliver", {}),
    ("/eapi/link/page/discovery/resource/show", {}),
]

for path, payload in CANDIDATES:
    for style in ("api", "eapi"):
        body, err = request(path, payload, style)
        if not body:
            print(f"{path:55s} [{style:4s}] ERR {err}")
            continue
        parsed, derr = try_decrypt_eapi(body)
        if parsed is not None:
            verdict = f"*** eapi-ENCRYPTED, decrypted OK, code={parsed.get('code')} ***"
        else:
            try:
                plain = json.loads(body.decode("utf-8"))
                code = plain.get("code")
                msg = str(plain.get("message", ""))[:20]
                verdict = f"plain JSON code={code} msg={msg!r}"
            except Exception:  # noqa: BLE001
                verdict = f"opaque {len(body)}B first32={body[:32]!r}"
        print(f"{path:55s} [{style:4s}] {len(body):6d}B  {verdict}")
