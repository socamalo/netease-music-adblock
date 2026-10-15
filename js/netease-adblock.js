/*!
 * NetEase Cloud Music AdBlock / 网易云音乐去广告
 * -------------------------------------------------------------
 * A dependency-free MITM rewrite script for Shadowrocket / Surge / Loon / Quantumult X.
 *
 * Targets the NetEase Cloud Music mobile app APIs on interface*.music.163.com
 * (and the web endpoints on music.163.com where applicable).
 *
 * Design notes
 *   - Ships its own AES-128-ECB. No CryptoJS, no CDN fetch, ~4 KB instead of ~120 KB.
 *   - Sniffs the response body: parses JSON directly, or AES-decrypts first when the
 *     body is ciphertext. Both are handled, so it survives server-side changes to
 *     which flavour an endpoint returns.
 *   - AD REMOVAL ONLY. This script deliberately does NOT unlock VIP/paid entitlements.
 *     Blocking ads is the same thing a browser ad-blocker does; forging a VIP expiry
 *     is circumventing payment, and is out of scope.
 *
 * @version   1.0.2
 * @license   MIT
 */

/*
 * NetEase builds its payloads with a custom AES mode it renames "nes" -- it is plain
 * AES-128-ECB with PKCS#7 padding. The key is the ASCII string below.
 */
var NES_KEY = 'e82ckenh8dichen8';

var AES = (function () {
  'use strict';

  var SBOX = new Uint8Array([
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16
  ]);

  // Derived once at load rather than hardcoded, so the two tables cannot drift apart.
  var INV_SBOX = new Uint8Array(256);
  for (var i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;

  // GF(2^8) multiply-by-constant tables for MixColumns / InvMixColumns.
  var MUL2 = new Uint8Array(256);
  var MUL3 = new Uint8Array(256);
  var MUL9 = new Uint8Array(256);
  var MUL11 = new Uint8Array(256);
  var MUL13 = new Uint8Array(256);
  var MUL14 = new Uint8Array(256);
  (function () {
    function xt(a) { return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; }
    for (var i = 0; i < 256; i++) {
      var x2 = xt(i), x4 = xt(x2), x8 = xt(x4);
      MUL2[i] = x2;
      MUL3[i] = x2 ^ i;
      MUL9[i] = x8 ^ i;          // 9  = 8 + 1
      MUL11[i] = x8 ^ x2 ^ i;    // 11 = 8 + 2 + 1
      MUL13[i] = x8 ^ x4 ^ i;    // 13 = 8 + 4 + 1
      MUL14[i] = x8 ^ x4 ^ x2;   // 14 = 8 + 4 + 2
    }
  }());

  var RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

  function expandKey(key) {
    var w = new Uint8Array(176);
    w.set(key, 0);
    for (var i = 16; i < 176; i += 4) {
      var t0 = w[i - 4], t1 = w[i - 3], t2 = w[i - 2], t3 = w[i - 1];
      if (i % 16 === 0) {
        var tmp = t0;
        t0 = SBOX[t1] ^ RCON[(i / 16) - 1];
        t1 = SBOX[t2];
        t2 = SBOX[t3];
        t3 = SBOX[tmp];
      }
      w[i] = w[i - 16] ^ t0;
      w[i + 1] = w[i - 15] ^ t1;
      w[i + 2] = w[i - 14] ^ t2;
      w[i + 3] = w[i - 13] ^ t3;
    }
    return w;
  }

  // AES state is column-major: byte r of column c lives at s[r + 4c].
  function shiftRows(s) {
    var t;
    t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
    t = s[2]; s[2] = s[10]; s[10] = t;
    t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
  }

  function invShiftRows(s) {
    var t;
    t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
    t = s[2]; s[2] = s[10]; s[10] = t;
    t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
  }

  function mixColumns(s) {
    for (var c = 0; c < 4; c++) {
      var i = c * 4;
      var a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
      s[i] = MUL2[a0] ^ MUL3[a1] ^ a2 ^ a3;
      s[i + 1] = a0 ^ MUL2[a1] ^ MUL3[a2] ^ a3;
      s[i + 2] = a0 ^ a1 ^ MUL2[a2] ^ MUL3[a3];
      s[i + 3] = MUL3[a0] ^ a1 ^ a2 ^ MUL2[a3];
    }
  }

  function invMixColumns(s) {
    for (var c = 0; c < 4; c++) {
      var i = c * 4;
      var a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
      s[i] = MUL14[a0] ^ MUL11[a1] ^ MUL13[a2] ^ MUL9[a3];
      s[i + 1] = MUL9[a0] ^ MUL14[a1] ^ MUL11[a2] ^ MUL13[a3];
      s[i + 2] = MUL13[a0] ^ MUL9[a1] ^ MUL14[a2] ^ MUL11[a3];
      s[i + 3] = MUL11[a0] ^ MUL13[a1] ^ MUL9[a2] ^ MUL14[a3];
    }
  }

  function encryptBlock(rk, input, off, output, outOff) {
    var s = new Uint8Array(16);
    for (var i = 0; i < 16; i++) s[i] = input[off + i] ^ rk[i];
    for (var round = 1; round < 10; round++) {
      for (i = 0; i < 16; i++) s[i] = SBOX[s[i]];
      shiftRows(s);
      mixColumns(s);
      for (i = 0; i < 16; i++) s[i] ^= rk[round * 16 + i];
    }
    for (i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    shiftRows(s);
    for (i = 0; i < 16; i++) s[i] ^= rk[160 + i];
    for (i = 0; i < 16; i++) output[outOff + i] = s[i];
  }

  function decryptBlock(rk, input, off, output, outOff) {
    var s = new Uint8Array(16);
    for (var i = 0; i < 16; i++) s[i] = input[off + i] ^ rk[160 + i];
    for (var round = 9; round > 0; round--) {
      invShiftRows(s);
      for (i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
      for (i = 0; i < 16; i++) s[i] ^= rk[round * 16 + i];
      invMixColumns(s);
    }
    invShiftRows(s);
    for (i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
    for (i = 0; i < 16; i++) output[outOff + i] = s[i] ^ rk[i];
  }

  var keySchedule = null;

  function schedule() {
    if (!keySchedule) {
      var k = new Uint8Array(16);
      for (var i = 0; i < 16; i++) k[i] = NES_KEY.charCodeAt(i) & 0xff;
      keySchedule = expandKey(k);
    }
    return keySchedule;
  }

  function pad(data) {
    var n = 16 - (data.length % 16);
    var out = new Uint8Array(data.length + n);
    out.set(data, 0);
    for (var i = 0; i < n; i++) out[data.length + i] = n;
    return out;
  }

  function unpad(data) {
    if (!data.length) return data;
    var n = data[data.length - 1];
    if (n < 1 || n > 16 || n > data.length) return data; // not valid PKCS#7; leave as-is
    for (var i = data.length - n; i < data.length; i++) {
      if (data[i] !== n) return data;
    }
    return data.subarray(0, data.length - n);
  }

  return {
    encrypt: function (bytes) {
      var rk = schedule();
      var data = pad(bytes);
      var out = new Uint8Array(data.length);
      for (var i = 0; i < data.length; i += 16) encryptBlock(rk, data, i, out, i);
      return out;
    },
    decrypt: function (bytes) {
      if (!bytes || bytes.length === 0 || bytes.length % 16 !== 0) return null;
      var rk = schedule();
      var out = new Uint8Array(bytes.length);
      for (var i = 0; i < bytes.length; i += 16) decryptBlock(rk, bytes, i, out, i);
      return unpad(out);
    },
    _internals: { encryptBlock: encryptBlock, decryptBlock: decryptBlock, expandKey: expandKey }
  };
}());

/* ------------------------------------------------------------------ *
 * Encoding helpers
 * ------------------------------------------------------------------ */

function toBytes(body) {
  if (body == null) return null;
  if (body instanceof Uint8Array) return body;
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (Array.isArray(body)) return new Uint8Array(body);
  if (typeof body === 'string') {
    // A binary body handed to us as a JS string: one char per byte (latin1).
    var out = new Uint8Array(body.length);
    for (var i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff;
    return out;
  }
  return null;
}

function latin1Bytes(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function utf8ToBytes(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      var c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        i++;
      } else out.push(0xef, 0xbf, 0xbd);
    } else if (c >= 0xd800 && c <= 0xdfff) out.push(0xef, 0xbf, 0xbd);
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

function bytesToUtf8(bytes) {
  var out = '';
  var i = 0;
  while (i < bytes.length) {
    var c = bytes[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (c < 0xf0) out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      var cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Rule table
 *
 * Every rule is matched against the API path with the query string removed,
 * e.g. '/link/home/framework/tab'. Rules are evaluated top to bottom.
 *
 *   empty      -> answer with {}                  (cheapest; server never sees a hit)
 *   emptyArray -> answer with []
 *   script     -> hand the parsed body to a handler below
 * ------------------------------------------------------------------ */

var EXACT_EMPTY = {
  '/ad': 1,
  '/ad/get': 1,
  '/ad/loading/get': 1,
  '/ad/loading/current': 1,

  // Home / discovery feed promotions
  '/link/scene/show/resource': 1,
  '/link/position/show/strategy': 1,
  '/link/scene/show': 1,
  '/content/activity/music/jar/template/list': 1,
  '/activity/bonus/playpage/time/query': 1,
  '/mlivestream/entrance/playpage': 1,

  // Popups / upsells
  '/vip/cashier/tspopup/get': 1,
  '/sp/flow/popup/query': 1,
  '/vipmall/couponcfg/get': 1,
  '/vipnewcenter/app/resource/newaccountpage': 1,
  '/delivery/deliver': 1,
  '/delivery/batch-deliver': 1,

  // Sidebar / entry-point clutter
  '/side-bar/mini-program/music-service/account': 1,
  '/yunbei/account/entrance/get': 1,
  '/mine/applet/redpoint': 1,
  '/creator/musician/reminder/message/get': 1,
  '/moment/tab/info/get': 1,
  '/user/sub/artist': 1,
  '/resniche/position/play/new/get': 1,

  // Search-page promos
  '/search/chart/list': 1,
  '/search/chart/detail': 1,
  '/search/rcmd/keyword/get': 1,
  '/search/specialkeyword/get': 1,
  '/search/default/keyword/list': 1,
  '/search/suggest/keyword/get': 1,

  // Comment-area injections
  '/comment/feed/inserted/resources': 1,
  '/resource-exposure/config': 1,
  '/resource/comments/musiciansaid': 1,
  '/music/songshare/text/recommend/get': 1,
  '/community/friends/fans-group/artist/group/get': 1,
  '/v1/content/exposure/comment/banner': 1,

  // Update nag
  '/ios/version': 1,
  '/ios/upgrade/get': 1
};

// Prefix matches: anything under these paths is promotional.
var PREFIX_EMPTY = [
  '/ad/',
  '/resource-exposure/',
  '/v1/content/exposure/',
  '/mlivestream/entrance/'
];

// Paths that need real surgery on the JSON rather than a blanket empty answer.
var SCRIPT_PATHS = {
  '/batch': 1,
  '/link/home/framework/tab': 1,
  '/link/page/discovery/resource/show': 1,
  '/link/page/rcmd/resource/show': 1,
  '/link/page/rcmd/block/resource/multi/refresh': 1,
  '/link/position/show/resource': 1,
  '/homepage/block/page': 1,
  '/v2/banner/get': 1,
  '/v2/resource/comment/floor/get': 1,
  '/v1/resource/comment/floor/get': 1,
  '/v2/resource/comment/floor/get/v2': 1,
  '/song/play/more/list/v2': 1,
  '/song/play/more/list/v1': 1
};

/* ------------------------------------------------------------------ *
 * Handlers
 * ------------------------------------------------------------------ */

// Recommendation blocks worth keeping. Everything else on the rcmd page is a promo.
var KEEP_RCMD_BLOCKS = [
  'PAGE_RECOMMEND_DAILY_RECOMMEND',
  'PAGE_RECOMMEND_SPECIAL_CLOUD_VILLAGE_PLAYLIST',
  'PAGE_RECOMMEND_SHORTCUT',
  'HOMEPAGE_MUSIC_PARTNER',
  'PAGE_RECOMMEND_RADAR',
  'PAGE_RECOMMEND_RANK',
  'PAGE_RECOMMEND_GREETING',
  'PAGE_RECOMMEND_MY_SHEET',
  'PAGE_RECOMMEND_COMBINATION'
];

function isKeptBlock(code) {
  for (var i = 0; i < KEEP_RCMD_BLOCKS.length; i++) {
    if (KEEP_RCMD_BLOCKS[i] === code) return true;
  }
  return false;
}

function filterArrayBy(arr, keep) {
  return arr.filter(function (item) { return keep(item); });
}

/**
 * Banner carousels mix genuine editorial content with sold ad slots. The sold
 * ones are labelled, so filter by label rather than dropping the whole carousel
 * -- that keeps new-album and event banners the user actually wants.
 */
var PROMO_BANNER_TITLES = ['活动', '广告'];

function isPromoBanner(banner) {
  return !!banner && PROMO_BANNER_TITLES.indexOf(banner.typeTitle) !== -1;
}

function filterBanners(list) {
  return filterArrayBy(list, function (b) { return !isPromoBanner(b); });
}

/**
 * Null out the merchandising fields on a home-feed resource so the card renders
 * bare instead of as a promo, without removing the user's own content.
 */
function scrubResource(res) {
  if (!res || typeof res !== 'object') return res;
  res.summary = '';
  res.extraMap = {};
  res.icon = '';
  res.actionUrl = '';
  res.s_ctrp = '';
  res.trp_id = '';
  res.log = {};
  return res;
}

/**
 * /batch packs several sub-API responses into one payload, keyed by the
 * sub-request path. We can blank individual sub-responses without touching
 * the others, which is far cheaper than blocking the whole batch call.
 */
function handleBatch(body) {
  var empty = function (key, value) {
    if (body[key] && typeof body[key] === 'object') {
      body[key].data = value === undefined ? {} : value;
    }
  };
  empty('/api/comment/tips/v2/get', { count: 0, offset: 0, records: [] });
  empty('/api/social/event/bff/ad/resources');
  empty('/api/ad/get', { code: 200, ads: {} });
  empty('/api/comment/feed/inserted/resources');
  empty('/api/content/activity/music/jar/template/list');
  empty('/api/event/rcmd/topic/list');
  empty('/api/platform/song/bff/grading/song/order/entrance');

  // Banner strips occasionally ride along in the batch.
  if (body['/api/link/position/show/resource'] && body['/api/link/position/show/resource'].data) {
    var d = body['/api/link/position/show/resource'].data;
    if (d.crossPlatformResource && d.crossPlatformResource.positionCode === 'MyPageBar') {
      d.crossPlatformResource = {};
    }
  }
  if (body['/api/v2/banner/get']) {
    body['/api/v2/banner/get'] = applyScript('/v2/banner/get', body['/api/v2/banner/get']);
  }
  return body;
}

function handleCommentList(container) {
  if (container === undefined) return;
  var list = container.comments;
  if (!list || !list.length) return;
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (!c || typeof c !== 'object') continue;
    if (c.user) {
      if (c.user.followed === false) c.user.followed = true;
      c.user.vipRights = null;
      c.user.avatarDetail = null;
      c.user.userBizLevels = null;
    }
    c.pendantData = null;
    if (c.tag) {
      c.tag.extDatas = [];
      c.tag.contentPicDatas = null;
    }
  }
  container.comments = list.filter(function (c) {
    // Drop the "promoted comment" cards that carry an ad id.
    return !(c && (c.adInfo || c.isAd || c.promoted));
  });
}

/* ------------------------------------------------------------------ *
 * Core dispatch
 * ------------------------------------------------------------------ */

function extractPath(url) {
  if (!url) return null;
  var q = url.indexOf('?');
  if (q >= 0) url = url.slice(0, q);
  var m = /\/w?e?api\/(.*)$/.exec(url);
  if (!m) return null;
  return '/' + m[1];
}

/**
 * A bare `{}` leaves any field the client indexes into as undefined. Where the
 * real response shape has actually been captured, answer with a faithful empty
 * instead, so the client never dereferences undefined and silently falls back.
 *
 * Live capture of /ad/loading/get returns { ads: [], code: 200, ext: {...} }.
 */
function emptyPayload(path) {
  if (path.indexOf('/ad') === 0) return { code: 200, ads: [] };
  return {};
}

function classify(path) {
  if (!path) return null;
  if (EXACT_EMPTY[path]) return { action: 'empty' };
  for (var i = 0; i < PREFIX_EMPTY.length; i++) {
    if (path.indexOf(PREFIX_EMPTY[i]) === 0) return { action: 'empty' };
  }
  if (SCRIPT_PATHS[path]) return { action: 'script' };
  return null;
}

/**
 * Apply the path-specific surgery. Returns the (mutated) body object.
 */
function applyScript(path, body) {
  switch (path) {
    case '/batch':
      return handleBatch(body);

    case '/link/home/framework/tab':
      if (body.data && body.data.commonResourceList) {
        body.data.commonResourceList = filterArrayBy(body.data.commonResourceList, function (r) {
          return r && r.title !== '漫游' && r.title !== '笔记';
        });
      }
      return body;

    case '/link/page/discovery/resource/show':
      if (body.data) {
        if (body.data.blockCodeOrderList) {
          try {
            var order = JSON.parse(body.data.blockCodeOrderList);
            body.data.blockCodeOrderList = JSON.stringify(filterArrayBy(order, function (c) {
              return c !== 'PAGE_DISCOVERY_BANNER';
            }));
          } catch (e) { /* leave malformed order untouched */ }
        }
        if (body.data.blocks) {
          body.data.blocks = filterArrayBy(body.data.blocks, function (b) {
            return b && b.bizCode !== 'PAGE_DISCOVERY_BANNER';
          });
        }
      }
      return body;

    case '/link/page/rcmd/resource/show':
      if (body.data) {
        if (body.data.blocks) {
          body.data.blocks = filterArrayBy(body.data.blocks, function (b) {
            return b && isKeptBlock(b.bizCode);
          });
          for (var i = 0; i < body.data.blocks.length; i++) {
            if (body.data.blocks[i].bizCode === 'PAGE_RECOMMEND_GREETING') {
              var dsl = body.data.blocks[i].dslData || {};
              Object.keys(dsl).forEach(function (k) {
                if (dsl[k].commonResourceList) {
                  dsl[k].commonResourceList.forEach(scrubResource);
                }
              });
            }
          }
        }
        if (body.data.blockCodeOrderList) {
          try {
            var o = JSON.parse(body.data.blockCodeOrderList);
            body.data.blockCodeOrderList = JSON.stringify(filterArrayBy(o, isKeptBlock));
          } catch (e) { /* ignore */ }
        }
      }
      return body;

    case '/link/page/rcmd/block/resource/multi/refresh':
      if (Array.isArray(body.data)) {
        body.data = filterArrayBy(body.data, function (b) {
          return b && isKeptBlock(b.blockCode);
        });
      }
      return body;

    case '/link/position/show/resource':
      if (body.data && body.data.crossPlatformResource &&
          body.data.crossPlatformResource.positionCode === 'MyPageBar') {
        body.data.crossPlatformResource = {};
      }
      return body;

    case '/homepage/block/page':
      if (body.data && body.data.blocks) {
        for (var j = 0; j < body.data.blocks.length; j++) {
          var blk = body.data.blocks[j];
          if (blk.showType === 'BANNER' && blk.extInfo && blk.extInfo.banners) {
            blk.extInfo.banners = filterBanners(blk.extInfo.banners);
            break;
          }
        }
      }
      return body;

    // Reached both directly and as a /batch sub-request. Its shape has not been
    // captured live, so filter defensively: accept either a top-level or a
    // data-nested `banners` array, and no-op if neither is present.
    case '/v2/banner/get':
      if (Array.isArray(body.banners)) body.banners = filterBanners(body.banners);
      if (body.data && Array.isArray(body.data.banners)) {
        body.data.banners = filterBanners(body.data.banners);
      }
      return body;

    case '/v2/resource/comment/floor/get':
    case '/v1/resource/comment/floor/get':
      if (body.data) {
        if (body.data.ownerComment) {
          var oc = body.data.ownerComment;
          if (oc.user) { oc.user.vipRights = null; oc.user.avatarDetail = {}; }
          oc.pendantData = null;
        }
        handleCommentList(body.data);
      }
      return body;

    case '/song/play/more/list/v1':
    case '/song/play/more/list/v2':
      if (body.data && body.data.bottomItem && body.data.bottomItem.itemNodeList) {
        var nodes = body.data.bottomItem.itemNodeList[0];
        if (Array.isArray(nodes)) {
          var idx = -1;
          for (var n = 0; n < nodes.length; n++) {
            if (nodes[n] && nodes[n].type === 'effect') { idx = n; break; }
          }
          if (idx > 0) nodes.unshift(nodes.splice(idx, 1)[0]);
        }
      }
      return body;

    default:
      return body;
  }
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

function clientInfo() {
  var g = typeof globalThis !== 'undefined' ? globalThis :
    (typeof self !== 'undefined' ? self : this);
  var has = function (n) { return typeof g[n] !== 'undefined'; };
  if (has('$task')) return { name: 'quantumultx' };
  if (has('$loon')) return { name: 'loon' };
  if (has('$rocket')) return { name: 'shadowrocket' };
  if (has('$httpClient')) return { name: 'surge' };
  return { name: 'unknown' };
}

function isAeapi(req) {
  // Some builds gzip the payload before AES; the app flags it on the request.
  if (!req || !req.headers) return false;
  for (var k in req.headers) {
    if (k.toLowerCase() === 'x-aeapi') return String(req.headers[k]).toLowerCase() === 'true';
  }
  return false;
}

// Leading whitespace (and an optional UTF-8 BOM) then `{` or `[`.
function looksLikeJson(bytes) {
  var i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  for (; i < bytes.length; i++) {
    var b = bytes[i];
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue;
    return b === 0x7b || b === 0x5b;
  }
  return false;
}

function decodeCiphertext(bytes, req) {
  var plain = AES.decrypt(bytes);
  if (!plain || !plain.length) return null;

  var gz = isAeapi(req);
  if (gz) {
    var inflated = ungzip(plain);
    if (!inflated) return null;          // cannot read it -> leave the response alone
    plain = inflated;
  }
  if (!looksLikeJson(plain)) return null;
  return { text: bytesToUtf8(plain), mode: 'bytes', encrypted: true, gzipped: gz };
}

/**
 * Return {text, mode, encrypted, gzipped} or null when the body should be passed
 * through untouched.
 *
 * `mode` records how the client handed us the body, because we must reply in the
 * same shape: a string body goes back as a string, a binary body goes back as bytes.
 * With `binary-body-mode=1` every body arrives as bytes, including plain JSON, so
 * the text case has to be detected from the bytes themselves.
 */
function readBody(res, req) {
  var body = res.body;
  if (body == null) return null;

  if (typeof body === 'string') {
    var t = body.replace(/^\s+/, '');
    if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      return { text: body, mode: 'text', encrypted: false, gzipped: false };
    }
    var fromString = toBytes(body);
    if (!fromString || !fromString.length) return null;
    return decodeCiphertext(fromString, req);
  }

  var bytes = toBytes(body);
  if (!bytes || !bytes.length) return null;

  // Binary-body-mode hands us plain JSON as UTF-8 bytes; that is not ciphertext.
  if (looksLikeJson(bytes)) {
    return { text: bytesToUtf8(bytes), mode: 'bytes', encrypted: false, gzipped: false };
  }
  return decodeCiphertext(bytes, req);
}

function writeBody(ctx, obj) {
  var text = JSON.stringify(obj);
  if (ctx.mode === 'text') return { body: text };

  var payload = utf8ToBytes(text);
  if (ctx.encrypted) {
    if (ctx.gzipped) {
      payload = gzip(payload);
      if (!payload) return null;         // symmetric with decodeCiphertext
    }
    payload = AES.encrypt(payload);
  }
  return { body: payload };
}

function gzip() { return null; }   // overridden below when the client provides gzip
function ungzip() { return null; }

(function wireGzip() {
  var g = typeof globalThis !== 'undefined' ? globalThis : {};
  var u = g.$utils;
  if (!u) return;
  if (typeof u.gzip === 'function') {
    gzip = function (bytes) {
      try { return toBytes(u.gzip(bytes)); } catch (e) { return null; }
    };
  }
  if (typeof u.ungzip === 'function') {
    ungzip = function (bytes) {
      try { return toBytes(u.ungzip(bytes)); } catch (e) { return null; }
    };
  }
}());

function finish(client, payload) {
  if (!payload) { $done({}); return; }
  if (client === 'quantumultx') {
    var b = payload.body;
    $done(b instanceof Uint8Array ? { bodyBytes: b.buffer } : payload);
    return;
  }
  $done(payload);
}

function run() {
  var req = typeof $request !== 'undefined' ? $request : null;
  var res = typeof $response !== 'undefined' ? $response : null;
  if (!res) { $done({}); return; }

  var url = (req && req.url) || (res && res.url) || '';
  var path = extractPath(url);
  var rule = classify(path);
  if (!rule) { $done({}); return; }

  var client = clientInfo().name;

  var ctx = readBody(res, req);
  if (!ctx) { $done({}); return; }

  var obj;
  try { obj = JSON.parse(ctx.text); } catch (e) { $done({}); return; }
  if (!obj || typeof obj !== 'object') { $done({}); return; }

  // Reply through writeBody even for the blanket rules: if the response arrived
  // encrypted, the replacement has to be encrypted the same way.
  if (rule.action === 'empty') {
    finish(client, writeBody(ctx, emptyPayload(path)));
    return;
  }

  finish(client, writeBody(ctx, applyScript(path, obj)));
}

if (typeof $response !== 'undefined' || typeof $request !== 'undefined') {
  try { run(); } catch (e) {
    if (typeof console !== 'undefined' && console.log) console.log('[ncm-adblock] ' + e);
    $done({});
  }
}

/* Exported for the test suite; ignored by the rewrite clients. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AES: AES,
    extractPath: extractPath,
    classify: classify,
    emptyPayload: emptyPayload,
    applyScript: applyScript,
    handleBatch: handleBatch,
    handleCommentList: handleCommentList,
    utf8ToBytes: utf8ToBytes,
    bytesToUtf8: bytesToUtf8,
    toBytes: toBytes,
    latin1Bytes: latin1Bytes,
    NES_KEY: NES_KEY,
    EXACT_EMPTY: EXACT_EMPTY,
    SCRIPT_PATHS: SCRIPT_PATHS
  };
}
