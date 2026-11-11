// Static checks: locale parity, every used key translated, no network APIs, self-hosted assets, required features present.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { T } from './shared/locales.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
assert.deepEqual(Object.keys(T.vi).sort(), Object.keys(T.en).sort(), 'vi/en keys must match');

const js = ['shared/features.js', 'shared/core.js', 'leaderboard/app.js', 'today/app.js'].map((f) => [f, read(f)]);
for (const [f, src] of js) {
  for (const [, key] of src.matchAll(/\bt\('([A-Za-z_]+)'(?!\s*\+)/g)) if (!key.endsWith('_')) assert.ok(key in T.vi, `${f}: missing translation "${key}"`);
  assert.doesNotMatch(src, /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|sendBeacon/, `${f}: no network APIs`);
  assert.doesNotMatch(src, /from\s+['"]\.\.\/\.\.\//, `${f}: must not import production code`);
}
for (const p of ['index.html', 'leaderboard/index.html', 'today/index.html']) {
  const html = read(p);
  assert.ok(html.includes("connect-src 'none'"), `${p}: CSP blocks requests`);
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\//, `${p}: self-hosted assets only`);
}
const css = read('shared/base.css');
assert.ok(css.includes('prefers-reduced-motion') && css.includes(':focus-visible'));
const feat = read('shared/features.js');
for (const tab of ['overview', 'countries', 'versions', 'storeListing', 'keywords', 'competitors', 'reviews', 'campaigns']) assert.ok(feat.includes(`${tab}Tab`) || feat.includes(`${tab}: `), 'tab ' + tab);
for (const act of ["'ai-run'", "'publish'", "'bulk-publish'", "'ranks'", "'track'", "'del-kw'", "'del-camp'", "'del-event'", "'test-conn'", "'digest-preview'", "'read-notifs'", "kind === 'package'", "kind === 'settings'", 'exportCSV', 'exportJSON'])
  assert.ok(feat.includes(act), 'feature ' + act);
const core = read('shared/core.js');
assert.ok(/revenueStatus === 'unavailable' \? \{\}/.test(core), 'Google revenue without access is empty, never 0');
console.log('verify: ok');
