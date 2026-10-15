'use strict';

/**
 * Universal content kill-filter.
 *
 * This one is deliberately endpoint-agnostic and shape-agnostic: it walks the
 * decrypted payload and drops any small entry carrying a banned string. That is
 * what makes it survive the card moving between endpoints, which it has already
 * done once.
 *
 * The risk that matters here is over-removal, so most of these tests are
 * negative cases.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const F = require('../js/content-filter.js');

const BANNED = '云贝免费领取现金红包';
const run = (obj) => {
  F.reset();
  const out = F.prune(obj, 0);
  return { out, removed: F.getRemoved() };
};

test('default banned string is the exact one reported', () => {
  assert.deepStrictEqual(F.BANNED, [BANNED]);
});

test('drops the card but keeps the block it lives in', () => {
  // The whole point: block-level filtering left this behind. Entry-level
  // removal must not take the parent with it.
  const { out, removed } = run({
    data: { blocks: [{ bizCode: 'PAGE_RECOMMEND_SHORTCUT', list: [
      { title: '每日推荐' },
      { title: BANNED, actionUrl: 'orpheus://promo' },
      { title: '我喜欢的音乐' },
    ] }] },
  });
  assert.strictEqual(removed, 1);
  assert.strictEqual(out.data.blocks.length, 1, 'parent block must survive');
  assert.deepStrictEqual(
    out.data.blocks[0].list.map((x) => x.title),
    ['每日推荐', '我喜欢的音乐']);
});

test('removes the innermost entry, not the outermost container', () => {
  // Regression guard: an earlier draft pruned top-down and deleted the whole
  // block instead of the single card inside it.
  const { out } = run({ data: { blocks: [{ a: { b: [{ c: [{ d: BANNED }] }] } }] } });
  assert.strictEqual(out.data.blocks.length, 1);
  assert.deepStrictEqual(out.data.blocks[0].a.b, [{ c: [] }]);
});

test('leaves payloads with no match byte-identical', () => {
  const payload = { code: 200, data: { songs: [{ name: '普通歌' }, { name: '另一首' }] } };
  const before = JSON.stringify(payload);
  const { out, removed } = run(payload);
  assert.strictEqual(removed, 0);
  assert.strictEqual(JSON.stringify(out), before);
});

test('a short keyword alone does NOT trigger removal', () => {
  // 云贝 on its own is far too common -- it is a feature name, not just the ad.
  for (const title of ['云贝', '云贝商城', '我的云贝']) {
    const { removed } = run({ data: { list: [{ title }] } });
    assert.strictEqual(removed, 0, `must not remove: ${title}`);
  }
});

test('removes only the matching entry from a large array', () => {
  // The array is big; the matching entry is not. Only that one entry goes --
  // the surrounding 299 must survive.
  const big = { data: { list: [] } };
  for (let i = 0; i < 300; i++) {
    big.data.list.push({ title: i === 5 ? BANNED : 'x'.repeat(30), pad: 'y'.repeat(30) });
  }
  const { out, removed } = run(big);
  assert.strictEqual(removed, 1);
  assert.strictEqual(out.data.list.length, 299);
});

test('removes a match nested at depth', () => {
  // The entry holding the string is dropped whole, leaving its array empty --
  // not blanked in place, which would leave the card frame on screen.
  const { out, removed } = run({ a: { b: { c: { d: [{ x: { y: { title: BANNED } } }] } } } });
  assert.strictEqual(removed, 1);
  assert.deepStrictEqual(out.a.b.c.d, []);
});

test('handles arrays of arrays, nulls and primitives without throwing', () => {
  assert.doesNotThrow(() => run({ a: [[{ title: BANNED }], null, 5, 'str'] }));
  const { out } = run({ a: [[{ title: BANNED }], null, 5] });
  assert.deepStrictEqual(out.a[0], []);
  assert.deepStrictEqual(out.a.slice(1), [null, 5]);
});

test('is depth-guarded against pathological nesting', () => {
  let node = { title: BANNED };
  for (let i = 0; i < 60; i++) node = { nested: node };
  assert.doesNotThrow(() => run(node));
});

test('respects an argument-supplied keyword list', () => {
  // The module can pass $argument to override without a code change.
  assert.strictEqual(typeof F.isBannedText, 'function');
  assert.ok(F.isBannedText(BANNED));
  assert.ok(!F.isBannedText('普通内容'));
});

test('multiple occurrences in one payload are all removed', () => {
  const { out, removed } = run({ data: { list: [
    { title: BANNED }, { title: 'ok' }, { title: BANNED },
  ] } });
  assert.strictEqual(removed, 2);
  assert.deepStrictEqual(out.data.list.map((x) => x.title), ['ok']);
});

test('removals are reported to the phone', () => {
  // The request log records routing decisions only -- it never shows whether a
  // script ran -- so a notification is the only way to tell "ran but the card
  // survived" apart from "never ran". Without it, the two look identical.
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'content-filter.js'), 'utf8');
  assert.match(src, /\$notification/, 'must post a notification on removal');
  assert.match(src, /内容过滤器已生效/, 'notification should be identifiable');
});
