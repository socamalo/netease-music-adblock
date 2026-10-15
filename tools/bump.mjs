/**
 * Set the filter version in every place that carries it, atomically.
 *
 * Hand-editing the three spots has now gone wrong twice, both times the same
 * way: a search for `v1.0.2` silently misses `#!version = 1.0.2`, because that
 * line has no `v` before the number. The name then advertises one version while
 * the version field says another. `node tools/bump.mjs <version>` removes the
 * chance of that.
 *
 * The test suite already fails on a mismatch; this stops the mismatch existing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('usage: node tools/bump.mjs <major.minor.patch>');
  process.exit(1);
}

const edits = [
  [
    'netease-content-filter.sgmodule',
    [
      [/#!version\s*=\s*[\d.]+/, `#!version = ${version}`],
      [/#!name(\s*=\s*[^\n]*?)v[\d.]+/, `#!name$1v${version}`],
      [/\[v[\d.]+\s*·/, `[v${version} ·`],
    ],
  ],
  [
    'src/content-filter.main.js',
    [[/var FILTER_VERSION = '[\d.]+'/, `var FILTER_VERSION = '${version}'`]],
  ],
];

for (const [rel, subs] of edits) {
  const path = join(ROOT, rel);
  let text = readFileSync(path, 'utf8');
  for (const [re, to] of subs) {
    if (!re.test(text)) throw new Error(`${rel}: pattern not found: ${re}`);
    text = text.replace(re, to);
  }
  writeFileSync(path, text, 'utf8');
  console.log(`  ${rel}`);
}

execFileSync(process.execPath, [join(ROOT, 'tools', 'build.mjs')], { stdio: 'inherit' });
console.log(`version -> ${version}`);
