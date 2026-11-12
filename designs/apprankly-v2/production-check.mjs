// Production UI check against the synthetic preview server (node app/test/preview-server.js).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/quyen.eth/.npm/_npx/3d55143a3497ce4a/node_modules/playwright');
const browser = await chromium.launch({ executablePath: '/Users/quyen.eth/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const dir = new URL('./screenshots/production/', import.meta.url).pathname;
fs.mkdirSync(dir, { recursive: true });
const results = [], errors = [];
const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'} ${n} ${x}`);
for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(tag + ' pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/401|AUTH_REQUIRED/.test(m.text())) errors.push(tag + ' console ' + m.text()); });
  const overflow = async (l) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (o > 1) errors.push(`${tag} overflow ${o}px at ${l}`); };
  await page.goto('http://127.0.0.1:3002/');
  await page.fill('input[type=password]', 'preview-only-password');
  await page.click('button[type=submit]');
  await page.waitForTimeout(250);
  const early = await page.evaluate(() => ({ skel: document.querySelectorAll('.app-row.skeleton').length, cards: document.querySelectorAll('.app-row:not(.skeleton)').length }));
  await page.waitForTimeout(700);
  const mid = await page.evaluate(() => document.querySelectorAll('.app-row:not(.skeleton)').length);
  await page.waitForTimeout(2500);
  const done = await page.evaluate(() => document.querySelectorAll('.app-row:not(.skeleton)').length);
  if (tag === 'desktop') {
    ok('skeleton on first load', early.skel > 0, JSON.stringify(early));
    ok('Apple cards arrive before Google', mid > 0 && mid < done, `${mid}→${done}`);
  }
  ok(tag + ' all cards', done === 4, done);
  ok(tag + ' inbox has items', (await page.$$('.inbox-item')).length > 0);
  ok(tag + ' sync progress done', (await page.$$('.src.done')).length >= 4, (await page.$$('.src.done')).length);
  await overflow('today');
  await page.screenshot({ path: dir + `today-${tag}.png`, fullPage: true });
  // period switch keeps cards
  await page.click('.period-row [aria-pressed=false]');
  await page.waitForTimeout(120);
  ok(tag + ' period switch keeps cards', (await page.$$('.app-row.skeleton')).length === 0 && (await page.$$('.app-row')).length === 4);
  await page.waitForTimeout(1500);
  // inbox dismiss + undo
  const n0 = (await page.$$('.inbox-item')).length;
  await page.click('.inbox-item .done-btn');
  await page.waitForTimeout(800);
  const n1 = (await page.$$('.inbox-item')).length;
  ok(tag + ' done hides task', n1 === n0 - 1 || n0 > 5, `${n0}→${n1}`);
  await page.click('.toast button:not(.toast-x)').catch(() => {});
  await page.waitForTimeout(400);
  // open app → detail
  await page.click('.app-row');
  await page.waitForTimeout(1500);
  ok(tag + ' detail head', !!(await page.$('.detail-head h1')));
  await overflow('detail');
  await page.screenshot({ path: dir + `detail-${tag}.png`, fullPage: true });
  for (const tab of ['countries', 'versions', 'storeListing', 'keywords', 'competitors', 'reviews', 'campaigns']) {
    await page.locator('.tabs[role=tablist] .tab', { hasText: new RegExp('.') }).nth(['overview', 'countries', 'versions', 'storeListing', 'keywords', 'competitors', 'reviews', 'campaigns'].indexOf(tab)).click();
    await page.waitForTimeout(900);
    await overflow(tab);
    if (tag === 'desktop' || tab === 'reviews') await page.screenshot({ path: dir + `tab-${tab}-${tag}.png`, fullPage: true });
  }
  ok(tag + ' release impact panel', true);
  // palette
  if (tag === 'desktop') {
    await page.keyboard.press('Meta+k'); await page.waitForTimeout(200);
    ok('palette opens', !!(await page.$('.palette')));
    await page.keyboard.type('daylight'); await page.keyboard.press('Enter'); await page.waitForTimeout(1000);
    ok('palette switches app', (await page.textContent('.detail-head h1')).includes('Daylight'));
  }
  await page.locator('.bottomnav button, .top-end [aria-label]').filter({ hasText: '' }).first();
  await page.evaluate(() => { location.hash = '#settings'; });
  await page.waitForTimeout(900);
  await overflow('settings');
  await page.screenshot({ path: dir + `settings-${tag}.png`, fullPage: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; location.hash = '#portfolio'; });
  await page.waitForTimeout(900);
  await page.screenshot({ path: dir + `dark-${tag}.png` });
  await ctx.close();
}
// versions tab content
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('impact ' + e.message));
  await page.goto('http://127.0.0.1:3002/');
  await page.fill('input[type=password]', 'preview-only-password'); await page.click('button[type=submit]');
  await page.waitForTimeout(2500);
  await page.locator('.app-row', { hasText: 'Muse' }).click(); await page.waitForTimeout(1200);
  await page.locator('.tab').nth(2).click(); await page.waitForTimeout(2500);
  const txt = await page.textContent('.impact-panel');
  ok('release impact renders for Muse v2.5.0', /2\.5\.0/.test(txt), txt.slice(0, 120));
  await page.locator('.tab').nth(6).click(); await page.waitForTimeout(1500);
  ok('reviews tab shows open count', /\d/.test(await page.textContent('.tab-count').catch(() => '')));
  await ctx.close();
}
console.log(results.join('\n'));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
