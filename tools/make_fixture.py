"""Generate cross-implementation fixtures for the JS test suite.

Encrypts realistic NetEase payloads with pycryptodome. If the pure-JS AES in
js/netease-adblock.js decrypts these back to the exact plaintext, the two
independent implementations agree -- which is the strongest check available
short of a live captures file.
"""

import binascii
import gzip
import json
import pathlib

from Crypto.Cipher import AES

KEY = b"e82ckenh8dichen8"


def pkcs7_pad(raw: bytes) -> bytes:
    n = 16 - len(raw) % 16
    return raw + bytes([n]) * n


def encrypt(data: bytes) -> bytes:
    return AES.new(KEY, AES.MODE_ECB).encrypt(pkcs7_pad(data))


SAMPLES = {
    "ad_loading_get": {"ads": [], "code": 200, "ext": {"expInterval": -1}},
    "rcmd_page": {
        "code": 200,
        "data": {
            "blocks": [
                {"bizCode": "PAGE_RECOMMEND_DAILY_RECOMMEND", "showType": "BLOCK"},
                {"bizCode": "PAGE_RECOMMEND_AD_BANNER", "showType": "BANNER"},
                {"bizCode": "PAGE_RECOMMEND_RADAR", "showType": "BLOCK"},
            ],
            "blockCodeOrderList": '["PAGE_RECOMMEND_DAILY_RECOMMEND","PAGE_RECOMMEND_AD_BANNER"]',
        },
    },
    "framework_tab": {
        "code": 200,
        "data": {
            "commonResourceList": [
                {"title": "发现", "showType": "WHITE_RED_TEXT"},
                {"title": "漫游", "showType": "WHITE_RED_TEXT"},
                {"title": "我的", "showType": "WHITE_RED_TEXT"},
                {"title": "笔记", "showType": "WHITE_RED_TEXT"},
            ]
        },
    },
    "batch": {
        "/api/ad/get": {"code": 200, "data": {"ads": [{"id": 1, "title": "BUY NOW"}]}},
        "/api/comment/feed/inserted/resources": {"code": 200, "data": {"resources": [1, 2]}},
        "/api/v2/resource/comments": {"code": 200, "data": {"comments": [{"content": "hi"}]}},
        "/api/song/detail": {"code": 200, "data": {"songs": [{"id": 42}]}},
    },
    "unicode": {"code": 200, "data": {"title": "网易云音乐 🎵 广告", "note": "测试"}},
}

out = pathlib.Path(__file__).resolve().parent.parent / "test" / "fixtures"
out.mkdir(parents=True, exist_ok=True)

fixtures = {}
for name, obj in SAMPLES.items():
    plain = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    fixtures[name] = {
        "plaintext": plain.decode("utf-8"),
        "cipher_hex": binascii.hexlify(encrypt(plain)).decode().upper(),
    }

# Gzipped variant, mirroring the x-aeapi path.
plain = json.dumps(SAMPLES["ad_loading_get"], ensure_ascii=False).encode("utf-8")
fixtures["gzipped"] = {
    "plaintext": plain.decode("utf-8"),
    "cipher_hex": binascii.hexlify(encrypt(gzip.compress(plain, mtime=0))).decode().upper(),
    "gzipped": True,
}

# A 16-byte boundary case. When the plaintext is already block-aligned, PKCS#7
# must append a whole extra block of 0x10 -- getting this wrong is a classic bug.
aligned = b'{"code":200}' + b" " * 4   # exactly 16 bytes of valid JSON
assert len(aligned) == 16 and len(aligned) % 16 == 0
ct = encrypt(aligned)
assert len(ct) == 32, "aligned plaintext must produce a second, full pad block"
fixtures["block_aligned"] = {
    "plaintext": aligned.decode("utf-8"),
    "cipher_hex": binascii.hexlify(ct).decode().upper(),
    "blocks": 2,
}

(out / "eapi-samples.json").write_text(
    json.dumps(fixtures, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(f"wrote {out / 'eapi-samples.json'}")
for k, v in fixtures.items():
    print(f"  {k:16s} {len(v['cipher_hex']) // 2:5d} B ciphertext")
