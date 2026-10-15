"""Empirically verify the NetEase Cloud Music eapi AES scheme against the live API.

If this script prints a decrypted JSON with a `code` field, the key/mode/padding
used here are confirmed correct -- not merely copied from a blog post.
"""

import hashlib
import json
import sys

from Crypto.Cipher import AES

EAPI_KEY = b"e82ckenh8dichen8"
MAGIC = "-36cd479b6b5-"

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
    """Build the `params` hex for an eapi request."""
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    message = f"nobody{path}use{text}md5forencrypt"
    digest = hashlib.md5(message.encode()).hexdigest()
    plain = f"{path}{MAGIC}{text}{MAGIC}{digest}".encode()
    cipher = AES.new(EAPI_KEY, AES.MODE_ECB)
    return cipher.encrypt(pkcs7_pad(plain)).hex().upper()


def decrypt_eapi(body: bytes) -> bytes:
    """Decrypt an eapi response body."""
    cipher = AES.new(EAPI_KEY, AES.MODE_ECB)
    return pkcs7_unpad(cipher.decrypt(body))


def probe(path: str, payload: dict) -> None:
    import urllib.request

    params = encrypt_eapi(path, payload)
    url = f"https://interface3.music.163.com{path}"
    req = urllib.request.Request(
        url,
        data=f"params={params}".encode(),
        headers=HEADERS,
        method="POST",
    )
    print(f"\n=== {path} ===")
    print(f"params (first 80): {params[:80]}...")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
    except Exception as exc:  # noqa: BLE001
        print(f"REQUEST FAILED: {exc}")
        return

    print(f"HTTP body: {len(raw)} bytes, first 48 raw: {raw[:48]!r}")

    # Try decryption first; fall back to treating it as plain JSON.
    decrypted = None
    try:
        decrypted = decrypt_eapi(raw)
        json.loads(decrypted.decode("utf-8"))
        print("RESULT: *** ENCRYPTED (eapi) -- decrypt SUCCEEDED ***")
    except Exception as exc:  # noqa: BLE001
        print(f"eapi decrypt did not yield JSON: {exc}")

    if decrypted is not None:
        try:
            print("decrypted preview:")
            print(decrypted.decode("utf-8", "replace")[:600])
        except Exception:  # noqa: BLE001
            print(f"decrypted raw preview: {decrypted[:200]!r}")

    # Also report if it is just plain JSON (some hosts return plaintext).
    try:
        plain = json.loads(raw.decode("utf-8"))
        print("RESULT: *** PLAIN JSON (not encrypted) ***")
        print(json.dumps(plain, ensure_ascii=False)[:400])
    except Exception:  # noqa: BLE001
        print("(body is not plain JSON)")


if __name__ == "__main__":
    probes = [
        ("/eapi/search/default/keyword/list", {"type": 1}),
        ("/eapi/link/home/framework/tab", {}),
    ]
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for path, payload in probes:
        if only and only not in path:
            continue
        probe(path, payload)
