import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apps, initialNotes, releases, copy } from './data.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
assert.deepEqual(Object.keys(copy.vi).sort(), Object.keys(copy.en).sort(), 'Locale keys must match');
for (const [, key] of source.matchAll(/\bt\('([^']+)'\)/g)) {
  assert.ok(copy.vi[key] && copy.en[key], `Missing translation: ${key}`);
}
assert.equal(new Set(apps.map(a => a.id)).size, apps.length, 'Unique app IDs');
for (const app of apps) {
  assert.equal(app.series.length, 28);
  assert.ok(app.installs > 0 && app.series.every(Number.isFinite));
  assert.ok(['USD', 'EUR'].includes(app.currency));
  if (app.platform === 'google') assert.equal(app.revenue, null, 'Missing revenue is null, never zero');
}
for (const item of [...initialNotes, ...releases]) assert.ok(apps.some(a => a.id === item.app));
assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|sendBeacon\s*\(/, 'No network APIs');
assert.doesNotMatch(source, /from\s+['"]\.\.\//, 'Do not import production UI');
const css = fs.readFileSync(path.join(root, 'prototype.css'), 'utf8');
assert.doesNotMatch(css, /(?:linear|radial|conic)-gradient\s*\(/i, 'No gradients');
assert.ok(css.includes('prefers-reduced-motion'));
assert.ok(css.includes(':focus-visible'));
for (const page of ['index', 'pulse', 'spectrum', 'focus']) {
  const html = fs.readFileSync(path.join(root, `${page}.html`), 'utf8');
  assert.ok(html.includes("connect-src 'none'"), `${page} must prevent external API requests`);
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\//, 'Self-hosted assets only');
}
const fontCss = fs.readFileSync(path.join(root, 'assets/fonts/fonts.css'), 'utf8');
assert.doesNotMatch(fontCss, /https?:\/\//);
for (const [, name] of fontCss.matchAll(/url\(([^)]+)\)/g)) assert.ok(fs.existsSync(path.join(root, 'assets/fonts', name)));
console.log(`PASS: ${Object.keys(copy.vi).length} bilingual keys; 8 consistent app fixtures; no production imports, network APIs, external fonts or gradients.`);
