'use strict';

/**
 * Keeps the .sgmodule and the script in sync.
 *
 * The module decides which requests reach the script; the script decides what to
 * do with them. If an endpoint is added to the script but no module pattern
 * covers it, the rule is silently dead. These tests make that failure loud.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MODULE_FILE = path.join(ROOT, 'netease-music-adblock.sgmodule');
const source = fs.readFileSync(MODULE_FILE, 'utf8');

const M = require(path.join(ROOT, 'js', 'netease-adblock.js'));

/** All `pattern=` values from the [Script] section. */
function scriptPatterns() {
  const section = source.split('[Script]')[1].split('[MITM]')[0];
  const out = [];
  for (const line of section.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    for (const token of trimmed.split(',')) {
      if (token.startsWith('pattern=')) out.push(token.slice('pattern='.length));
    }
  }
  return out;
}

const PATTERNS = scriptPatterns();

test('module defines at least one script pattern', () => {
  assert.ok(PATTERNS.length > 0, 'no pattern= found in [Script]');
});

test('every pattern is a valid regular expression', () => {
  for (const p of PATTERNS) {
    assert.doesNotThrow(() => new RegExp(p), `invalid regex: ${p}`);
  }
});

/** The module matches against the full URL, so build one per API path. */
const urlFor = (apiPath) => `https://interface3.music.163.com/eapi${apiPath}`;

const covered = (url) => PATTERNS.some((p) => new RegExp(p).test(url));

test('every path the script blanks is reachable through a module pattern', () => {
  const uncovered = [];
  for (const apiPath of Object.keys(M.EXACT_EMPTY)) {
    if (!covered(urlFor(apiPath))) uncovered.push(apiPath);
  }
  assert.deepStrictEqual(uncovered, [],
    'these paths are handled by the script but no module pattern would ever route them to it');
});

test('every path the script rewrites is reachable through a module pattern', () => {
  const uncovered = [];
  for (const apiPath of Object.keys(M.SCRIPT_PATHS)) {
    if (!covered(urlFor(apiPath))) uncovered.push(apiPath);
  }
  assert.deepStrictEqual(uncovered, []);
});

test('patterns cover the /xeapi/ prefix a newer app build uses', () => {
  // Regression guard: the module previously only matched api/eapi/weapi, so the
  // whole script was dead for /xeapi/ traffic.
  for (const url of [
    'https://interface3.music.163.com/xeapi/ad/sniffing',
    'https://interface3.music.163.com/xeapi/ad',
    'https://interface.music.163.com/xeapi/batch',
    'https://interface3.music.163.com/xeapi/link/home/framework/tab',
  ]) {
    assert.ok(covered(url), `no module pattern matches: ${url}`);
  }
});

test('every ad URL from the real device log routes through the module', () => {
  // Same fixture the script-side test uses: if the module does not match these,
  // the script never runs and the rule is dead regardless of how correct it is.
  const urls = require('./fixtures/device-ad-urls.json').urls;
  const missed = urls.filter((u) => !covered(u));
  assert.deepStrictEqual(missed, [], 'these real ad URLs would never reach the script');
});

test('patterns cover the plaintext http:// scheme the app also uses', () => {
  // Observed on the device as http:// rather than https://, so ^https?: matters.
  assert.ok(covered('http://interface3.music.163.com/eapi/ad/loading/current'));
  assert.ok(covered('http://interface3.music.163.com/xeapi/ad/sniffing'));
});

test('patterns cover the web (weapi) host as well as the app host', () => {
  assert.ok(covered('https://music.163.com/weapi/ad/loading/get'));
  assert.ok(covered('https://interface.music.163.com/eapi/ad/loading/get'));
  assert.ok(covered('https://interface3.music.163.com/eapi/ad/loading/get'));
  assert.ok(covered('https://ipv4.music.163.com/api/ad/get'));
});

test('patterns do not accidentally swallow playback or login traffic', () => {
  const mustNotMatch = [
    'https://interface3.music.163.com/eapi/song/enhance/player/url/v1',
    'https://interface3.music.163.com/eapi/login/cellphone',
    'https://interface3.music.163.com/eapi/song/lyric',
    'https://music.163.com/weapi/song/enhance/player/url/v1',
  ];
  for (const url of mustNotMatch) {
    assert.ok(!covered(url), `pattern should not match core traffic: ${url}`);
  }
});

/**
 * The script entry is comma-delimited (type=...,pattern=...,requires-body=1,...).
 * A comma inside a pattern silently splits it and breaks the module, so a
 * quantifier like {0,3} is not safe here -- use [a-z]* instead.
 */
test('no pattern contains a comma, which would split the config line', () => {
  const section = source.split('[Script]')[1].split('[MITM]')[0];
  for (const line of section.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/pattern=([^,]*)/);
    if (!m) continue;
    assert.ok(!/\{\d+,\d+\}/.test(m[1]),
      `pattern uses a comma-bearing quantifier and will be split by the parser: ${m[1]}`);
  }
});

test('every [Script] entry carries the flags the script needs', () => {
  const section = source.split('[Script]')[1].split('[MITM]')[0];
  const entries = section.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='));

  assert.ok(entries.length > 0, 'no script entries found');
  for (const entry of entries) {
    assert.ok(entry.includes('requires-body=1'), `missing requires-body=1: ${entry.slice(0, 60)}`);
    assert.ok(entry.includes('binary-body-mode=1'),
      `missing binary-body-mode=1 (encrypted bodies would be corrupted): ${entry.slice(0, 60)}`);
    assert.ok(entry.includes('max-size=-1'), `missing max-size=-1: ${entry.slice(0, 60)}`);
    assert.ok(entry.includes('type=http-response'), `wrong script type: ${entry.slice(0, 60)}`);
  }
});

test('[Script] keys are unique', () => {
  const section = source.split('[Script]')[1].split('[MITM]')[0];
  const keys = section.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => l.split('=')[0].trim());
  assert.strictEqual(new Set(keys).size, keys.length, `duplicate script keys: ${keys}`);
});

test('script-path points at a file that exists in this repo', () => {
  const section = source.split('[Script]')[1].split('[MITM]')[0];
  const paths = [...section.matchAll(/script-path=(\S+?)(?:,|$)/g)].map((m) => m[1]);
  assert.ok(paths.length > 0, 'no script-path found');

  for (const p of paths) {
    const marker = '/netease-music-adblock/main/';
    const idx = p.indexOf(marker);
    assert.ok(idx >= 0, `script-path is not a raw URL on this repo: ${p}`);
    const repoRelative = p.slice(idx + marker.length);
    assert.ok(fs.existsSync(path.join(ROOT, repoRelative)),
      `script-path references a missing file: ${repoRelative}`);
  }
});

test('[MITM] uses %APPEND% so it cannot clobber the user\'s hostname list', () => {
  const mitm = source.split('[MITM]')[1];
  assert.ok(mitm.includes('%APPEND%'), '[MITM] must use %APPEND%');
  assert.ok(/hostname\s*=/.test(mitm), '[MITM] needs a hostname line');
});

test('metadata block is present and well-formed', () => {
  for (const key of ['#!name', '#!desc', '#!author', '#!homepage', '#!url', '#!icon']) {
    assert.ok(source.includes(key), `missing ${key}`);
  }
  assert.match(source.split('\n')[0], /^#!name\s*=/);
});

test('the [Rule] section rejects the ad-creative CDNs', () => {
  const rules = source.split('[Rule]')[1].split('[Script]')[0];
  for (const domain of ['iadmusicmat.music.126.net', 'iadmat.nosdn.127.net', 'httpdns.music.163.com']) {
    assert.ok(rules.includes(domain), `missing ad-domain rule: ${domain}`);
  }
});

/**
 * Regression guard. These two were missing and were why a Tmall 双11 splash
 * ad survived: `iadmusicmatvideo` holds splash animated/video creative, and its
 * hostname does NOT end with `iadmusicmat.music.126.net`, so the neighbouring
 * suffix rule never covered it. `admusicpic` holds ad stills.
 */
test('the splash video/image CDNs are rejected explicitly', () => {
  const rules = source.split('[Rule]')[1].split('[Script]')[0];
  for (const domain of ['iadmusicmatvideo.music.126.net', 'admusicpic.music.126.net']) {
    assert.ok(rules.includes(domain), `missing ad-creative rule: ${domain}`);
  }
});

test('an iadmusicmat keyword catch-all covers future ad-host renames', () => {
  const rules = source.split('[Rule]')[1].split('[Script]')[0];
  assert.ok(/DOMAIN-KEYWORD,\s*iadmusicmat,\s*REJECT/.test(rules),
    'expected a DOMAIN-KEYWORD catch-all for iadmusicmat');
});
