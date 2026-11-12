// Notification dialog against the synthetic preview server.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/quyen.eth/.npm/_npx/3d55143a3497ce4a/node_modules/playwright');
const b = await chromium.launch({ executablePath: '/Users/quyen.eth/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const dir = new URL('./screenshots/notifications/', import.meta.url).pathname; fs.mkdirSync(dir, { recursive: true });
const results = [], errors = [];
const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'} ${n} ${x}`);
const only = process.argv[2];
for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']].filter(([, , t]) => !only || t === only)) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(tag + ' pageerror ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/401|AUTH_REQUIRED/.test(m.text())) errors.push(tag + ' console ' + m.text()); });
  await p.goto('http://127.0.0.1:3002/'); await p.fill('input[type=password]', 'preview-only-password'); await p.click('button[type=submit]');
  await p.waitForTimeout(3500);
  await p.click('.top-end [aria-label="Thông báo"]'); await p.waitForTimeout(500);
  const o = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(tag + ' no page overflow', o <= 1, o + 'px');
  ok(tag + ' groups by day', (await p.$$eval('.notif-groups h4', (e) => e.map((x) => x.textContent))).join() === 'Hôm nay,Hôm qua,Trước đó' || (await p.$$('.notif-groups h4')).length >= 2, (await p.$$eval('.notif-groups h4', (e) => e.map((x) => x.textContent))).join());
  ok(tag + ' structured items render rows', (await p.$$('.n-row')).length >= 6, (await p.$$('.n-row')).length);
  const downs = await p.$$eval('.n-change.down', (e) => e.map((x) => x.textContent.trim())), ups = await p.$$eval('.n-change.up', (e) => e.map((x) => x.textContent.trim()));
  ok(tag + ' drops shown red with −', downs.length >= 3 && downs.every((x) => x.startsWith('−')), downs.join(' '));
  ok(tag + ' gains shown green with +', ups.length >= 2 && ups.every((x) => x.startsWith('+')), ups.join(' '));
  const colors = await p.evaluate(() => { const c = (s) => getComputedStyle(document.querySelector(s)).color; return [c('.n-change.down'), c('.n-change.up')]; });
  ok(tag + ' red and green differ', colors[0] !== colors[1], colors.join(' | '));
  const multi = await p.$$eval('.n-text', (els) => els.filter((e) => /\n/.test(e.textContent)).map((e) => getComputedStyle(e).whiteSpace));
  ok(tag + ' old multi-line text keeps its line breaks', multi.length >= 1 && multi.every((w) => w === 'pre-line'), multi.join());
  ok(tag + ' hints offered', (await p.$$('.n-hint')).length >= 3);
  ok(tag + ' unread dots', (await p.$$('.notif.unread')).length >= 3);
  await p.screenshot({ path: dir + `dialog-${tag}.png` });
  // filter
  await p.click('.notif-bar button:has-text("Đánh giá")'); await p.waitForTimeout(250);
  ok(tag + ' filter to reviews', (await p.$$('.notif')).length === 1 && /Đánh giá thấp/.test(await p.textContent('.notif h3')));
  await p.click('.notif-bar button:has-text("Hệ thống")'); await p.waitForTimeout(250);
  ok(tag + ' system group holds only old plain items', (await p.$$('.notif')).length >= 1 && (await p.$$('.n-row')).length === 0, (await p.$$('.notif')).length);
  await p.click('.notif-bar button:has-text("Tất cả")'); await p.waitForTimeout(250);
  // read one
  const unread0 = (await p.$$('.notif.unread')).length;
  await p.click('.notif.unread .n-actions button[aria-label="Đánh dấu đã đọc"]'); await p.waitForTimeout(400);
  ok(tag + ' mark one read', (await p.$$('.notif.unread')).length === unread0 - 1);
  // delete one with persistence
  const n0 = (await p.$$('.notif')).length;
  await p.click('.notif .n-actions button[aria-label="Xóa"] >> nth=0'); await p.waitForTimeout(500);
  ok(tag + ' delete one', (await p.$$('.notif')).length === n0 - 1);
  const server = await p.evaluate(async () => (await (await fetch('/api/notifications')).json()).notifications.length);
  ok(tag + ' delete persisted on server', server === n0 - 1, server);
  // deep link from a hint
  await p.click('.n-hint >> nth=0'); await p.waitForTimeout(1500);
  ok(tag + ' hint opens app detail on the right tab', !!(await p.$('.detail-head')) && (await p.$eval('.tabs [aria-selected="true"]', (e) => e.textContent)).length > 0, await p.$eval('.tabs [aria-selected="true"]', (e) => e.textContent));
  ok(tag + ' dialog closed after navigating', !(await p.$('.notif-groups')));
  // mark all
  await p.click('.top-end [aria-label="Thông báo"]'); await p.waitForTimeout(400);
  await p.click('.notif-bar >> button:has-text("Đánh dấu đã đọc")'); await p.waitForTimeout(500);
  ok(tag + ' mark all read', (await p.$$('.notif.unread')).length === 0);
  ok(tag + ' header badge cleared', !(await p.$('.top-end .notification-dot')));
  await ctx.close();
}
console.log(results.join('\n'));
console.log('errors:', errors.length ? errors : 'none');
await b.close();
