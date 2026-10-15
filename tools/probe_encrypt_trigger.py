"""Try to find what actually makes NetEase encrypt a response body.

If we can pin the trigger, the rewrite script can be simpler. If not, the script
must handle both plain-text and ciphertext bodies (which is the safe design anyway).
"""

import hashlib
import json
import urllib.request

from Crypto.Cipher import AES

EAPI_KEY = b"e82ckenh8dichen8"
MAGIC = "-36cd479b6b5-"


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


def classify(body: bytes) -> str:
    if not body:
        return "EMPTY"
    if body[:1] == b"{":
        return "plain-JSON"
    if len(body) % 16 == 0:
        try:
            plain = pkcs7_unpad(AES.new(EAPI_KEY, AES.MODE_ECB).decrypt(body))
            json.loads(plain.decode("utf-8"))
            return "*** AES-ECB ENCRYPTED (key e82ckenh8dichen8) ***"
        except Exception:  # noqa: BLE001
            pass
    return f"opaque({len(body)}B)"


PATH = "/api/link/home/framework/tab"
HOSTS = [
    "https://interface3.music.163.com",
    "https://interface.music.163.com",
    "https://interface9.music.163.com",
    "https://ipv4.music.163.com",
]
COOKIES = [
    "os=ios; appver=8.10.0",
    "os=pc; appver=2.10.6",
    "os=android; appver=8.10.0",
]

print(f"{'host':32s} {'cookie':28s} {'e_r':6s} {'size':>7s}  verdict")
print("-" * 95)
for host in HOSTS:
    for cookie in COOKIES:
        for er in (False, True):
            payload = {"e_r": er}
            body = f"params={encrypt_eapi(PATH, payload)}".encode()
            headers = {
                "User-Agent": "NME/8.10.0 (iPhone; iOS 15.0; Scale/3.00)",
                "Cookie": cookie,
                "Content-Type": "application/x-www-form-urlencoded",
            }
            req = urllib.request.Request(host + PATH, data=body, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=12) as r:
                    raw = r.read()
            except Exception as exc:  # noqa: BLE001
                print(f"{host:32s} {cookie:28s} {str(er):6s} {'-':>7s}  ERR {exc}")
                continue
            print(f"{host:32s} {cookie:28s} {str(er):6s} {len(raw):7d}  {classify(raw)}")

print()
print("=" * 70)
print("ROUND-TRIP TEST: can we re-encrypt a modified body correctly?")
print("=" * 70)
sample = json.dumps({"code": 200, "data": {"adResource": None}}, ensure_ascii=False).encode()
ct = AES.new(EAPI_KEY, AES.MODE_ECB).encrypt(pkcs7_pad(sample))
back = pkcs7_unpad(AES.new(EAPI_KEY, AES.MODE_ECB).decrypt(ct))
print(f"  plaintext  -> ciphertext ({len(ct)}B) -> decrypt -> match: {back == sample}")
