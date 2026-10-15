'use strict';

/**
 * AES-128-ECB tests.
 *
 * Two independent checks:
 *   1. The NIST FIPS-197 published vector for raw AES-128.
 *   2. Fixtures encrypted by pycryptodome (a completely separate implementation),
 *      which the pure-JS code must decrypt back to the exact plaintext.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const M = require('../js/netease-adblock.js');
const { AES } = M;

const FIXTURES = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'eapi-samples.json'), 'utf8')
);

const fromHex = (hex) => new Uint8Array(Buffer.from(hex, 'hex'));
const toHex = (bytes) => Buffer.from(bytes).toString('hex');

test('AES key string is the documented NetEase key', () => {
  assert.strictEqual(M.NES_KEY, 'e82ckenh8dichen8');
  assert.strictEqual(M.NES_KEY.length, 16, 'AES-128 needs a 16-byte key');
});

test('NIST FIPS-197 C.1: AES-128 single block encrypt', () => {
  const key = fromHex('000102030405060708090a0b0c0d0e0f');
  const plain = fromHex('00112233445566778899aabbccddeeff');
  const expected = '69c4e0d86a7b0430d8cdb78070b4c55a';

  const rk = AES._internals.expandKey(key);
  const out = new Uint8Array(16);
  AES._internals.encryptBlock(rk, plain, 0, out, 0);

  assert.strictEqual(toHex(out), expected);
});

test('NIST FIPS-197 C.1: AES-128 single block decrypt', () => {
  const key = fromHex('000102030405060708090a0b0c0d0e0f');
  const cipher = fromHex('69c4e0d86a7b0430d8cdb78070b4c55a');
  const expected = '00112233445566778899aabbccddeeff';

  const rk = AES._internals.expandKey(key);
  const out = new Uint8Array(16);
  AES._internals.decryptBlock(rk, cipher, 0, out, 0);

  assert.strictEqual(toHex(out), expected);
});

test('key expansion matches the published FIPS-197 round key 1', () => {
  const rk = AES._internals.expandKey(fromHex('000102030405060708090a0b0c0d0e0f'));
  assert.strictEqual(toHex(rk.slice(16, 32)), 'd6aa74fdd2af72fadaa678f1d6ab76fe');
});

/**
 * The strongest test here: encrypt with 200 random keys and compare against
 * OpenSSL. This covers the key schedule and all ten rounds, not just one vector.
 * (It caught an earlier draft of this very test file, which asserted a
 * misremembered final round key from the FIPS appendix.)
 */
test('matches OpenSSL for 200 random keys', () => {
  const crypto = require('node:crypto');

  const openssl = (keyHex, ptHex) => {
    const c = crypto.createCipheriv('aes-128-ecb', Buffer.from(keyHex, 'hex'), null);
    c.setAutoPadding(false);
    return Buffer.concat([c.update(Buffer.from(ptHex, 'hex')), c.final()]).toString('hex');
  };
  const mine = (keyHex, ptHex) => {
    const rk = AES._internals.expandKey(fromHex(keyHex));
    const out = new Uint8Array(16);
    AES._internals.encryptBlock(rk, fromHex(ptHex), 0, out, 0);
    return toHex(out);
  };

  for (let i = 0; i < 200; i++) {
    const key = crypto.randomBytes(16).toString('hex');
    const pt = crypto.randomBytes(16).toString('hex');
    assert.strictEqual(mine(key, pt), openssl(key, pt), `key=${key} pt=${pt}`);
  }
});

test('decryptBlock inverts encryptBlock for random keys', () => {
  const crypto = require('node:crypto');
  for (let i = 0; i < 50; i++) {
    const rk = AES._internals.expandKey(new Uint8Array(crypto.randomBytes(16)));
    const pt = new Uint8Array(crypto.randomBytes(16));
    const ct = new Uint8Array(16);
    AES._internals.encryptBlock(rk, pt, 0, ct, 0);
    const back = new Uint8Array(16);
    AES._internals.decryptBlock(rk, ct, 0, back, 0);
    assert.deepStrictEqual(Array.from(back), Array.from(pt));
  }
});

test('round-trips arbitrary payloads through encrypt then decrypt', () => {
  for (const size of [1, 15, 16, 17, 31, 32, 255, 1024]) {
    const plain = new Uint8Array(size);
    for (let i = 0; i < size; i++) plain[i] = (i * 37 + 11) & 0xff;

    const cipher = AES.encrypt(plain);
    assert.strictEqual(cipher.length % 16, 0, `size ${size} must be block-aligned`);
    assert.ok(cipher.length > size, `size ${size} must gain a padding block`);

    const back = AES.decrypt(cipher);
    assert.deepStrictEqual(Array.from(back), Array.from(plain), `size ${size}`);
  }
});

test('decrypts every pycryptodome-generated fixture byte-for-byte', () => {
  for (const [name, fx] of Object.entries(FIXTURES)) {
    if (fx.gzipped) continue; // covered by the integration tests
    const plain = AES.decrypt(fromHex(fx.cipher_hex));
    assert.ok(plain, `${name}: decrypt returned null`);
    assert.strictEqual(
      Buffer.from(plain).toString('utf8'),
      fx.plaintext,
      `${name}: plaintext mismatch`
    );
  }
});

test('an already block-aligned plaintext gains a full pad block', () => {
  const fx = FIXTURES.block_aligned;
  assert.strictEqual(Buffer.from(fx.plaintext, 'utf8').length, 16);
  assert.strictEqual(fx.cipher_hex.length / 2, 32, 'should be two AES blocks');

  const plain = AES.decrypt(fromHex(fx.cipher_hex));
  assert.strictEqual(Buffer.from(plain).toString('utf8'), fx.plaintext);
});

test('decrypt rejects input that is not block-aligned', () => {
  assert.strictEqual(AES.decrypt(new Uint8Array(15)), null);
  assert.strictEqual(AES.decrypt(new Uint8Array(0)), null);
  assert.strictEqual(AES.decrypt(null), null);
});

test('non-UTF8 binary payloads survive the round trip', () => {
  const plain = new Uint8Array([0x00, 0xff, 0xfe, 0x80, 0x01, 0xc3, 0x28, 0xa0, 0x9f]);
  const back = AES.decrypt(AES.encrypt(plain));
  assert.deepStrictEqual(Array.from(back), Array.from(plain));
});

test('gzip fixtures decrypt to gzip streams that inflate correctly', () => {
  const fx = FIXTURES.gzipped;
  const inner = AES.decrypt(fromHex(fx.cipher_hex));
  assert.strictEqual(zlib.gunzipSync(Buffer.from(inner)).toString('utf8'), fx.plaintext);
});
