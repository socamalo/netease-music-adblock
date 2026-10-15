
/* ================================================================== *
 * UNIVERSAL CONTENT KILL-FILTER
 * ==================================================================
 * 思路：不看接口、不看 JSON 结构，只按「内容」判断。
 *
 *   解密后的正文 → 递归遍历 → 任何数组元素里出现禁用字符串 → 整条删掉
 *
 * 为什么这样做：那张「云贝免费领取现金红包」卡片换过一次接口，写死接口或
 * JSON 路径的方案会跟着坏。按内容删，接口怎么换都不影响。
 *
 * 安全性：
 *   - 只用完整字符串匹配（如「云贝免费领取现金红包」），不用短词，避免误伤
 *   - 只删「小条目」（< MAX_ENTRY 字节），不整体删掉大容器
 *   - 没删到东西时原样返回，不重新编码，零副作用
 * ================================================================== */

var BANNED = (typeof $argument !== 'undefined' && $argument)
  ? String($argument).split('|').map(function (s) { return s.trim(); }).filter(Boolean)
  : ['云贝免费领取现金红包'];

var MAX_ENTRY = 4096;   // 大于此字节数的对象不整体删除，防止误删大容器
var MAX_DEPTH = 14;

/**
 * 核心链路：无论如何都不碰。
 *
 * 这个过滤器是「路由所有接口」的，覆盖越广风险越大 —— 万一登录或取歌曲地址的
 * 响应里恰好出现禁用串，改动它们会让 App 登不上或放不出歌。
 * 所以这里列一条白名单，命中就直接原样放行。
 *
 * Core paths the filter must never touch, even if they somehow carry a banned
 * string. Routing every API call is powerful but puts login and playback in the
 * blast radius; this is the guard that keeps them out of it.
 */
var NEVER_TOUCH = ['/login/', '/register/', '/song/enhance/player/url', '/song/lyric'];

function isProtected(url) {
  for (var i = 0; i < NEVER_TOUCH.length; i++) {
    if (url.indexOf(NEVER_TOUCH[i]) !== -1) return true;
  }
  return false;
}

var removedCount = 0;

function isBannedText(s) {
  if (typeof s !== 'string' || !s) return false;
  for (var i = 0; i < BANNED.length; i++) {
    if (BANNED[i] && s.indexOf(BANNED[i]) !== -1) return true;
  }
  return false;
}

/** 整个子树里是否含禁用字符串（只看小条目，大容器直接跳过以省时间）。 */
function subtreeHasBanned(node, budget) {
  if (budget <= 0) return false;
  if (typeof node === 'string') return isBannedText(node);
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length; i++) {
      if (subtreeHasBanned(node[i], budget - 1)) return true;
    }
    return false;
  }
  for (var k in node) {
    if (Object.prototype.hasOwnProperty.call(node, k)) {
      if (subtreeHasBanned(node[k], budget - 1)) return true;
    }
  }
  return false;
}

function smallEnough(node) {
  try {
    var s = JSON.stringify(node);
    return typeof s === 'string' && s.length <= MAX_ENTRY;
  } catch (e) {
    return false;   // 序列化失败（循环引用等）→ 不删，保守
  }
}

function prune(node, depth) {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return node;

  if (Array.isArray(node)) {
    // Bottom-up on purpose: recurse into children FIRST, then decide.
    // Deciding first would drop the outermost container that merely contains
    // the string (the whole feed block) instead of the one card we want gone.
    // After the children are cleaned, a parent no longer contains the string
    // and survives.
    var recursed = [];
    for (var j = 0; j < node.length; j++) recursed.push(prune(node[j], depth + 1));

    var kept = [];
    for (var i = 0; i < recursed.length; i++) {
      var el = recursed[i];
      // Drop only a small entry that still carries the banned string.
      if (el && typeof el === 'object' && smallEnough(el) &&
          subtreeHasBanned(el, 60)) {
        removedCount++;
        continue;
      }
      kept.push(el);
    }
    return kept;
  }

  for (var k in node) {
    if (Object.prototype.hasOwnProperty.call(node, k)) {
      node[k] = prune(node[k], depth + 1);
    }
  }
  return node;
}

function main() {
  try {
    var req = typeof $request !== 'undefined' ? $request : null;
    var res = typeof $response !== 'undefined' ? $response : null;
    if (!res) { $done({}); return; }

    // Bail out before touching anything on login / playback paths.
    if (isProtected((req && req.url) || '')) { $done({}); return; }

    var ctx = readBody(res, req);
    if (!ctx) { $done({}); return; }

    // 快速判断：正文里根本没有禁用串就直接放行，不做任何解析
    var hit = false;
    for (var i = 0; i < BANNED.length; i++) {
      if (BANNED[i] && ctx.text.indexOf(BANNED[i]) !== -1) { hit = true; break; }
    }
    if (!hit) { $done({}); return; }

    var obj;
    try { obj = JSON.parse(ctx.text); } catch (e) { $done({}); return; }
    if (!obj || typeof obj !== 'object') { $done({}); return; }

    obj = prune(obj, 0);

    if (removedCount === 0) { $done({}); return; }

    if (typeof console !== 'undefined' && console.log) {
      console.log('[content-filter] removed ' + removedCount + ' item(s) from ' +
                  ((req && req.url) || '').split('?')[0]);
    }

    var payload = writeBody(ctx, obj);
    $done(payload || {});
  } catch (e) {
    if (typeof console !== 'undefined' && console.log) {
      console.log('[content-filter] error: ' + e);
    }
    $done({});
  }
}

// Only run inside the rewrite client; Node just loads this for tests.
if (typeof $response !== 'undefined' || typeof $request !== 'undefined') {
  main();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { prune: prune, isBannedText: isBannedText, BANNED: BANNED,
                     reset: function () { removedCount = 0; },
                     getRemoved: function () { return removedCount; } };
}
