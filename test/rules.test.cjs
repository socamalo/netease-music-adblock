'use strict';

/**
 * Rule-engine and end-to-end tests.
 *
 * The integration tests drive the real run() entry point by installing fake
 * client globals ($request/$response/$done/$httpClient) and re-requiring the
 * module, so the whole pipeline -- sniff, decrypt, rewrite, re-encrypt, reply --
 * is exercised rather than just the pure helpers.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const zlib = require('node:zlib');

const MODULE_PATH = path.join(__dirname, '..', 'js', 'netease-adblock.js');
const M = require(MODULE_PATH);
const { AES } = M;

const fromHex = (hex) => new Uint8Array(Buffer.from(hex, 'hex'));

/**
 * Run the script's entry point against a synthetic response and return whatever
 * it passed to $done(). A null $utils simulates a client with no gzip helper.
 */
function runScript({ url, body, headers = {}, utils = undefined, quantumultx = false }) {
  const saved = {
    $request: globalThis.$request,
    $response: globalThis.$response,
    $done: globalThis.$done,
    $utils: globalThis.$utils,
    $httpClient: globalThis.$httpClient,
    $task: globalThis.$task,
  };

  let captured = null;
  globalThis.$request = { url, headers };
  globalThis.$response = { body };
  globalThis.$done = (arg) => { captured = arg; };
  if (quantumultx) globalThis.$task = {};
  else globalThis.$httpClient = {};

  if (utils === undefined) delete globalThis.$utils;
  else globalThis.$utils = utils;

  delete require.cache[require.resolve(MODULE_PATH)];
  try {
    require(MODULE_PATH);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
    delete require.cache[require.resolve(MODULE_PATH)];
  }
  require(MODULE_PATH); // restore a clean, global-free instance for later tests
  return captured;
}

const GZIP_UTILS = {
  gzip: (b) => new Uint8Array(zlib.gzipSync(Buffer.from(b))),
  ungzip: (b) => new Uint8Array(zlib.gunzipSync(Buffer.from(b))),
};

const decryptToJson = (bytes) => JSON.parse(Buffer.from(AES.decrypt(bytes)).toString('utf8'));

/* ---------------------------------------------------------------- path */

test('extractPath normalises api/eapi/weapi and drops the query', () => {
  assert.strictEqual(
    M.extractPath('https://interface3.music.163.com/eapi/link/home/framework/tab'),
    '/link/home/framework/tab');
  assert.strictEqual(
    M.extractPath('https://interface.music.163.com/api/ad/loading/get?foo=1'),
    '/ad/loading/get');
  assert.strictEqual(
    M.extractPath('https://music.163.com/weapi/search/suggest/keyword/get?csrf_token=x'),
    '/search/suggest/keyword/get');
  assert.strictEqual(M.extractPath('https://example.com/other/path'), null);
  assert.strictEqual(M.extractPath(''), null);
});

test('classify maps paths to the right action', () => {
  assert.deepStrictEqual(M.classify('/ad/loading/get'), { action: 'empty' });
  assert.deepStrictEqual(M.classify('/ad/get'), { action: 'empty' });
  assert.deepStrictEqual(M.classify('/ad/something/new'), { action: 'empty' });
  assert.deepStrictEqual(M.classify('/resource-exposure/config'), { action: 'empty' });
  assert.deepStrictEqual(M.classify('/link/home/framework/tab'), { action: 'script' });
  assert.deepStrictEqual(M.classify('/batch'), { action: 'script' });
  assert.strictEqual(M.classify('/song/enhance/player/url'), null);
  assert.strictEqual(M.classify(null), null);
});

/* ------------------------------------------------------------- handlers */

test('framework/tab drops the 漫游 and 笔记 tabs', () => {
  const body = {
    code: 200,
    data: { commonResourceList: [
      { title: '发现' }, { title: '漫游' }, { title: '我的' }, { title: '笔记' },
    ] },
  };
  const out = M.applyScript('/link/home/framework/tab', body);
  assert.deepStrictEqual(out.data.commonResourceList.map((r) => r.title), ['发现', '我的']);
});

test('rcmd page keeps only allow-listed blocks and filters the order list', () => {
  const body = {
    code: 200,
    data: {
      blocks: [
        { bizCode: 'PAGE_RECOMMEND_DAILY_RECOMMEND' },
        { bizCode: 'PAGE_RECOMMEND_AD_BANNER' },
        { bizCode: 'PAGE_RECOMMEND_RADAR' },
      ],
      blockCodeOrderList:
        '["PAGE_RECOMMEND_DAILY_RECOMMEND","PAGE_RECOMMEND_AD_BANNER","PAGE_RECOMMEND_RADAR"]',
    },
  };
  const out = M.applyScript('/link/page/rcmd/resource/show', body);
  assert.deepStrictEqual(
    out.data.blocks.map((b) => b.bizCode),
    ['PAGE_RECOMMEND_DAILY_RECOMMEND', 'PAGE_RECOMMEND_RADAR']);
  assert.deepStrictEqual(
    JSON.parse(out.data.blockCodeOrderList),
    ['PAGE_RECOMMEND_DAILY_RECOMMEND', 'PAGE_RECOMMEND_RADAR']);
});

test('discovery page drops PAGE_DISCOVERY_BANNER', () => {
  const body = {
    code: 200,
    data: {
      blocks: [{ bizCode: 'PAGE_DISCOVERY_BANNER' }, { bizCode: 'PAGE_DISCOVERY_SOMETHING' }],
      blockCodeOrderList: '["PAGE_DISCOVERY_BANNER","PAGE_DISCOVERY_SOMETHING"]',
    },
  };
  const out = M.applyScript('/link/page/discovery/resource/show', body);
  assert.deepStrictEqual(out.data.blocks.map((b) => b.bizCode), ['PAGE_DISCOVERY_SOMETHING']);
  assert.deepStrictEqual(JSON.parse(out.data.blockCodeOrderList), ['PAGE_DISCOVERY_SOMETHING']);
});

test('a malformed blockCodeOrderList is left alone rather than thrown', () => {
  const body = { data: { blockCodeOrderList: 'not json{' } };
  assert.doesNotThrow(() => M.applyScript('/link/page/discovery/resource/show', body));
  assert.strictEqual(body.data.blockCodeOrderList, 'not json{');
});

test('batch blanks ad sub-responses but preserves real ones', () => {
  const body = {
    '/api/ad/get': { code: 200, data: { ads: [{ id: 1 }] } },
    '/api/comment/feed/inserted/resources': { code: 200, data: { resources: [1, 2] } },
    '/api/song/detail': { code: 200, data: { songs: [{ id: 42 }] } },
  };
  const out = M.handleBatch(body);
  assert.deepStrictEqual(out['/api/ad/get'].data.ads, {});
  assert.deepStrictEqual(out['/api/comment/feed/inserted/resources'].data, {});
  assert.deepStrictEqual(out['/api/song/detail'].data.songs, [{ id: 42 }], 'songs must survive');
});

test('homepage banner strip drops 活动 and 广告 only', () => {
  const body = { data: { blocks: [{ showType: 'BANNER', extInfo: { banners: [
    { typeTitle: '活动' }, { typeTitle: '广告' }, { typeTitle: '新歌' },
  ] } }] } };
  const out = M.applyScript('/homepage/block/page', body);
  assert.deepStrictEqual(out.data.blocks[0].extInfo.banners.map((b) => b.typeTitle), ['新歌']);
});

test('comment list strips VIP chrome and promoted comments', () => {
  const container = { comments: [
    { user: { followed: false, vipRights: { a: 1 } }, tag: { extDatas: [1] }, content: 'keep' },
    { user: { followed: true }, content: 'ad', promoted: true },
  ] };
  M.handleCommentList(container);
  assert.strictEqual(container.comments.length, 1, 'promoted comment removed');
  const c = container.comments[0];
  assert.strictEqual(c.user.followed, true);
  assert.strictEqual(c.user.vipRights, null);
  assert.deepStrictEqual(c.tag.extDatas, []);
});

/* ---------------------------------------------------------- end to end */

const URL_BASE = 'https://interface3.music.163.com/eapi';

test('e2e: plain JSON ad response is replaced with {}', () => {
  const out = runScript({
    url: `${URL_BASE}/ad/loading/get`,
    body: JSON.stringify({ code: 200, ads: [{ id: 1 }] }),
  });
  assert.strictEqual(out.body, '{}');
});

test('e2e: encrypted ad response is replaced with ciphertext of {}', () => {
  const cipher = AES.encrypt(new Uint8Array(Buffer.from(JSON.stringify({ code: 200, ads: [1] }))));
  const out = runScript({ url: `${URL_BASE}/ad/loading/get`, body: cipher });

  assert.ok(out.body instanceof Uint8Array, 'must reply with bytes, not a string');
  assert.deepStrictEqual(decryptToJson(out.body), {});
});

test('e2e: encrypted rcmd response keeps allow-listed blocks through a full round trip', () => {
  const payload = {
    code: 200,
    data: {
      blocks: [
        { bizCode: 'PAGE_RECOMMEND_DAILY_RECOMMEND' },
        { bizCode: 'ADVERT' },
      ],
      blockCodeOrderList: '["PAGE_RECOMMEND_DAILY_RECOMMEND","ADVERT"]',
    },
  };
  const cipher = AES.encrypt(new Uint8Array(Buffer.from(JSON.stringify(payload), 'utf8')));
  const out = runScript({ url: `${URL_BASE}/link/page/rcmd/resource/show`, body: cipher });

  const back = decryptToJson(out.body);
  assert.deepStrictEqual(back.data.blocks.map((b) => b.bizCode), ['PAGE_RECOMMEND_DAILY_RECOMMEND']);
  assert.deepStrictEqual(JSON.parse(back.data.blockCodeOrderList), ['PAGE_RECOMMEND_DAILY_RECOMMEND']);
});

test('e2e: gzipped + encrypted response round-trips when the client has $utils', () => {
  const payload = { code: 200, data: { commonResourceList: [{ title: '发现' }, { title: '漫游' }] } };
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  const cipher = AES.encrypt(new Uint8Array(gz));

  const out = runScript({
    url: `${URL_BASE}/link/home/framework/tab`,
    body: cipher,
    headers: { 'x-aeapi': 'true' },
    utils: GZIP_UTILS,
  });

  const plain = zlib.gunzipSync(Buffer.from(AES.decrypt(out.body))).toString('utf8');
  assert.deepStrictEqual(
    JSON.parse(plain).data.commonResourceList.map((r) => r.title),
    ['发现']);
});

test('e2e: gzipped body with no gzip helper is passed through untouched', () => {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ code: 200 }), 'utf8'));
  const cipher = AES.encrypt(new Uint8Array(gz));

  const out = runScript({
    url: `${URL_BASE}/link/home/framework/tab`,
    body: cipher,
    headers: { 'x-aeapi': 'true' },
    utils: null,
  });

  assert.deepStrictEqual(out, {}, 'must not corrupt a body it cannot read');
});

test('e2e: unrelated endpoints are left alone', () => {
  const out = runScript({
    url: `${URL_BASE}/song/enhance/player/url/v1`,
    body: JSON.stringify({ code: 200, data: [{ url: 'http://x' }] }),
  });
  assert.deepStrictEqual(out, {});
});

test('e2e: malformed JSON is passed through, not thrown', () => {
  const out = runScript({ url: `${URL_BASE}/ad/loading/get`, body: '{ this is not json' });
  assert.deepStrictEqual(out, {});
});

test('e2e: undecryptable binary is passed through', () => {
  const junk = new Uint8Array(32);
  for (let i = 0; i < 32; i++) junk[i] = i + 1;
  const out = runScript({ url: `${URL_BASE}/ad/loading/get`, body: junk });
  assert.deepStrictEqual(out, {});
});

test('e2e: binary-body-mode delivers plain JSON as UTF-8 bytes', () => {
  const bytes = new Uint8Array(Buffer.from(JSON.stringify({ code: 200, ads: [1] }), 'utf8'));
  const out = runScript({ url: `${URL_BASE}/ad/loading/get`, body: bytes });

  assert.ok(out.body instanceof Uint8Array);
  assert.strictEqual(Buffer.from(out.body).toString('utf8'), '{}');
});

test('e2e: Quantumult X receives bodyBytes', () => {
  const cipher = AES.encrypt(new Uint8Array(Buffer.from('{"code":200,"ads":[1]}', 'utf8')));
  const out = runScript({
    url: `${URL_BASE}/ad/loading/get`,
    body: cipher,
    quantumultx: true,
  });

  assert.ok(out.bodyBytes instanceof ArrayBuffer, 'QuanX wants bodyBytes');
  assert.deepStrictEqual(JSON.parse(Buffer.from(AES.decrypt(new Uint8Array(out.bodyBytes))).toString('utf8')), {});
});

test('e2e: unicode content survives the encrypted round trip', () => {
  const payload = { code: 200, data: { title: '网易云音乐 🎵 广告', blocks: [{ bizCode: 'ADVERT' }] } };
  const cipher = AES.encrypt(new Uint8Array(Buffer.from(JSON.stringify(payload), 'utf8')));
  const out = runScript({ url: `${URL_BASE}/link/page/rcmd/resource/show`, body: cipher });

  const back = decryptToJson(out.body);
  assert.strictEqual(back.data.title, '网易云音乐 🎵 广告');
  assert.deepStrictEqual(back.data.blocks, []);
});
