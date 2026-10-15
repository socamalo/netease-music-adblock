
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

/**
 * 独立版本线。
 *
 * 这个文件独立于主脚本演进，所以版本号也独立 —— 主模块是 1.0.5 的时候，
 * 过滤器可能就是 1.0.3，两者没有可比性，不要混着看。
 * 每次改这个文件都要 +1，且必须与 netease-content-filter.sgmodule 里的
 * #!version 一致（有测试守着，不一致会直接报错）。
 *
 * Independent version line: this file evolves separately from the main script,
 * so its version is not comparable to the main module's. Bumped whenever this
 * file changes, and asserted to match the module's #!version by the test suite.
 */
var FILTER_VERSION = '1.0.2';

// ------------------------------------------------------------------ //
// 临时存活探测 / TEMPORARY liveness probe
//
// 目的：在排查「过滤器到底有没有执行」时给一个无条件的信号 —— 不依赖任何
// 匹配结果，只要脚本被执行到，就会弹一条通知。
//
// 只挂在首页信息流这一个接口上，所以打开一次首页弹一次，不会刷屏。
// 问题确认后删掉。
//
// Unconditional: proves the script body executed, independent of whether
// anything matched. Pinned to one homepage endpoint so it is one notification
// per homepage open. Removed once the question is settled.
// ------------------------------------------------------------------ //
var LIVENESS_PROBE = true;
var LIVENESS_PATH = '/link/page/rcmd/resource/show';

// 禁用字符串。模块的「禁用字符串」参数可以覆盖（用 | 分隔多个）。
// Full-string matches only: 「云贝」 on its own is a feature name and appears in
// legitimate content, so a short word here would remove things it should not.
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

/**
 * Reports on the phone when something is actually removed.
 *
 * This is not decoration. Shadowrocket's request log records routing decisions
 * only -- it never shows whether a script ran -- so without this there is no way
 * to tell "the filter ran and the card still shows" apart from "the filter never
 * ran at all". Fires only on a real removal, so it stays quiet in normal use.
 */
function notify(title, subtitle, body) {
  try {
    if (typeof $notification !== 'undefined' && $notification.post) {
      $notification.post(title, subtitle, body || '');
    } else if (typeof $notify !== 'undefined') {
      $notify(title, subtitle, body || '');
    }
  } catch (e) { /* never let reporting break the response */ }
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

    // Liveness probe -- placed before every guard so it still fires even if the
    // rest of the pipeline would bail. If this never shows, the script is not
    // running at all and no amount of matching logic can help.
    if (LIVENESS_PROBE && ((req && req.url) || '').indexOf(LIVENESS_PATH) !== -1) {
      notify('★ 过滤器存活 v' + FILTER_VERSION, '脚本确实被执行了', '临时调试信息');
    }

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

    var where = ((req && req.url) || '').split('?')[0];
    if (typeof console !== 'undefined' && console.log) {
      console.log('[content-filter] removed ' + removedCount + ' item(s) from ' + where);
    }
    // Version goes in the title so the running build is identifiable on sight.
    notify('内容过滤器 v' + FILTER_VERSION + ' 已生效',
           '删除 ' + removedCount + ' 条',
           where.split('/').slice(-3).join('/'));

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
