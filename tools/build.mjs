/**
 * Generates js/content-filter.js from the shared crypto/encoding core plus
 * src/content-filter.main.js.
 *
 * Why generate instead of copy: both scripts need the AES-128-ECB core and the
 * body encode/decode helpers. A hand-copied second core would drift the first
 * time either side is edited -- the exact class of bug this project has already
 * been bitten by. Generating keeps one core and makes drift impossible; the test
 * suite fails if the committed output is stale.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Everything before the entry point is the reusable core. Locate it by the
// comment text and walk back to its opening /*, rather than matching an exact
// run of dashes that would break on any cosmetic edit.
export function build() {
  const core = readFileSync(join(ROOT, 'js', 'netease-adblock.js'), 'utf8');
  const at = core.indexOf(' * Entry point');
  const cut = at < 0 ? -1 : core.lastIndexOf('/*', at);
  if (cut < 0) throw new Error('entry-point marker not found in js/netease-adblock.js');

  const main = readFileSync(join(ROOT, 'src', 'content-filter.main.js'), 'utf8');
  return core.slice(0, cut) + main;
}

export const OUTPUT = join(ROOT, 'js', 'content-filter.js');

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build.mjs')) {
  const out = build();
  writeFileSync(OUTPUT, out, 'utf8');
  console.log(`built js/content-filter.js (${out.length} bytes)`);
}
