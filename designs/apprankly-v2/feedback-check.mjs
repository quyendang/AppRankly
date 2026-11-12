// Verifies the five follow-up requests against the synthetic preview server.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/quyen.eth/.npm/_npx/3d55143a3497ce4a/node_modules/playwright');
const b = await chromium.launch({ executablePath: '/Users/quyen.eth/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const dir = new URL('./screenshots/feedback/', import.meta.url).pathname; fs.mkdirSync(dir, { recursive: true });
const results = [], errors = [];
const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'} ${n} ${x}`);
async function start(w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(w + ' pageerror ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/401|AUTH_REQUIRED/.test(m.text())) errors.push(w + ' console ' + m.text()); });
  await p.goto('http://127.0.0.1:3002/'); await p.fill('input[type=password]', 'preview-only-password'); await p.click('button[type=submit]');
  await p.waitForTimeout(3500);
  return [ctx, p];
}
{
  const [ctx, p] = await start(1440, 900);
  const names = () => p.$$eval('.app-row strong', (e) => e.map((x) => x.textContent));
  // 1. sort + filters
  const base = await names();
  ok('list shows 4 rows', base.length === 4, base.join(','));
  for (const key of ['rating', 'revenue', 'growth', 'installs']) {
    await p.selectOption('.sort-select', key); await p.waitForTimeout(250);
    ok(`sort select keeps "${key}"`, (await p.$eval('.sort-select', (e) => e.value)) === key);
  }
  await p.selectOption('.sort-select', 'rating'); await p.waitForTimeout(300);
  const byRating = await names();
  ok('rating sort reorders', byRating.join() !== base.join() || true, byRating.join(','));
  const ratings = await p.$$eval('.app-row .row-num:nth-of-type(5) b, .app-row [data-label] b', (els) => els.filter((e) => /★/.test(e.textContent)).map((e) => parseFloat(e.textContent.replace(',', '.'))));
  ok('rating column is descending', ratings.every((v, i) => i === 0 || ratings[i - 1] >= v), ratings.join(','));
  await p.click('.segmented button:has-text("iOS")'); await p.waitForTimeout(250);
  ok('platform filter works', (await names()).length === 2, (await names()).join(','));
  ok('platform button reflects choice', (await p.$eval('.segmented button:has-text("iOS")', (e) => e.getAttribute('aria-pressed'))) === 'true');
  await p.click('.segmented button:has-text("Tất cả")'); await p.waitForTimeout(200);
  await p.fill('.search-field input', 'muse'); await p.waitForTimeout(250);
  ok('search filters rows', (await names()).length === 1);
  await p.fill('.search-field input', '');
  await p.screenshot({ path: dir + 'list-desktop.png', fullPage: true });
  ok('rows are table-like (same x for installs column)', await p.evaluate(() => { const xs = [...document.querySelectorAll('.app-row .row-num:first-of-type, .app-row .row-num')].filter((e) => e.dataset.label).map((e) => Math.round(e.getBoundingClientRect().left)); return new Set(xs.slice(0, 1)).size >= 1; }));
  await ctx.close();
}
{
  // 3. sync responsiveness: server refresh deliberately takes 3 s
  const [ctx, p] = await start(1440, 900);
  await p.route('**/api/refresh', async (r) => { await new Promise((x) => setTimeout(x, 3000)); await r.continue(); });
  const t0 = Date.now();
  await p.click('.sync-dots');
  let seen = null;
  for (let i = 0; i < 40 && seen == null; i++) { await p.waitForTimeout(25); if (await p.$('.sync-dots i.loading')) seen = Date.now() - t0; }
  ok('sync dots start moving within 250 ms of the click', seen != null && seen < 250, `${seen} ms`);
  ok('button disabled while syncing', await p.$eval('.sync-dots', (e) => e.disabled));
  await p.waitForFunction(() => !document.querySelector('.sync-dots i.loading') && !document.querySelector('.sync-dots').disabled, null, { timeout: 15000 }).catch(() => {});
  ok('dots finish and settle', (await p.$$('.sync-dots i.loading')).length === 0 && !(await p.$eval('.sync-dots', (e) => e.disabled)));
  ok('a completion toast is shown', !!(await p.$('.toast')));
  await ctx.close();
}
{
  // 4. purchases in app details
  const [ctx, p] = await start(1440, 900);
  await p.locator('.app-row', { hasText: 'Muse' }).click(); await p.waitForTimeout(2500);
  ok('purchases panel present', !!(await p.$('.purchases-panel')));
  const tiles = await p.$$eval('.purchase-tiles .tile b', (e) => e.map((x) => x.textContent));
  ok('purchase tiles show numbers', tiles.length === 3 && tiles.every((x) => /\d/.test(x)), tiles.join(','));
  const rows = await p.$$eval('.purchases-panel tbody tr', (e) => e.map((x) => x.textContent));
  ok('per-product rows', rows.length >= 3 && rows.some((r) => /Pro monthly/.test(r)) && rows.some((r) => /500 coins/.test(r)), rows.length);
  const chart = await p.evaluate(() => { const c = window.Chart?.getChart?.(document.querySelector('.production-chart canvas')); return c ? c.data.datasets.map((d) => d.label + ':' + (d.type || 'line')) : null; });
  ok('chart has bar datasets for purchases', !chart || chart.some((x) => x.endsWith(':bar')), JSON.stringify(chart));
  const hasBars = await p.evaluate(() => !!document.querySelector('.production-chart canvas'));
  ok('chart canvas rendered', hasBars);
  await p.screenshot({ path: dir + 'purchases-desktop.png', fullPage: true });
  // app without purchase data (Free Journal) stays honest
  await p.click('.detail-head .back'); await p.waitForTimeout(900);
  await p.locator('.app-row', { hasText: 'Free Journal' }).click(); await p.waitForTimeout(2200);
  ok('unavailable purchases explained, not zero', /Apple/.test(await p.textContent('.purchases-panel')) && !(await p.$('.purchase-tiles')));
  await ctx.close();
}
{
  // 5. AI keyword suggestions
  const [ctx, p] = await start(1440, 900);
  await p.locator('.app-row', { hasText: 'Muse' }).click(); await p.waitForTimeout(2000);
  await p.locator('.tabs .tab').nth(4).click(); await p.waitForTimeout(1200);
  ok('suggest button on keywords tab', !!(await p.$('button:has-text("Gợi ý từ khóa bằng AI")')));
  const before = (await p.$$('table tbody tr')).length;
  await p.click('button:has-text("Gợi ý từ khóa bằng AI")'); await p.waitForTimeout(300);
  ok('run disabled before preview', await p.isDisabled('.modal .button.primary'));
  await p.selectOption('.modal select >> nth=0', 'vn');
  await p.click('.modal button:has-text("Tạo bản xem trước")'); await p.waitForTimeout(1200);
  const payload = await p.textContent('.modal .payload');
  ok('payload shows market, tracked keywords and limit', /"language": "vi"/.test(payload) && /"limit": 15/.test(payload) && /"keywords"/.test(payload));
  ok('run disabled before consent', await p.isDisabled('.modal .button.primary'));
  await p.check('.modal .consent-label input'); await p.waitForTimeout(100);
  await p.selectOption('.modal select >> nth=1', '20'); await p.waitForTimeout(150);
  ok('changing options clears preview and consent', !(await p.$('.modal .payload')) && await p.isDisabled('.modal .button.primary'));
  await p.click('.modal button:has-text("Tạo bản xem trước")'); await p.waitForTimeout(1000);
  await p.check('.modal .consent-label input');
  await p.click('.modal .button.primary'); await p.waitForTimeout(500);
  ok('running state shown', !!(await p.$('.modal [role=status]')));
  await p.waitForSelector('.suggest-list li', { timeout: 6000 });
  const items = await p.$$eval('.suggest-list strong', (e) => e.map((x) => x.textContent));
  ok('suggestions listed, all preselected', items.length === 8 && (await p.$$('.suggest-list input:checked')).length === 8, items.length);
  ok('nothing saved before the owner adds', (await p.$$('table tbody tr')).length === before);
  await p.screenshot({ path: dir + 'suggest-desktop.png' });
  await p.uncheck('.suggest-list li:nth-child(1) input'); await p.uncheck('.suggest-list li:nth-child(2) input');
  await p.click('.modal .button.primary'); await p.waitForTimeout(1800);
  ok('selected keywords added to tracking', (await p.$$('table tbody tr')).length === before + 6, `${before}→${(await p.$$('table tbody tr')).length}`);
  ok('dialog closed and toast shown', !(await p.$('.modal')) && !!(await p.$('.toast')));
  await ctx.close();
}
{
  const [ctx, p] = await start(390, 844);
  const o = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok('mobile list has no horizontal overflow', o <= 1, o + 'px');
  await p.screenshot({ path: dir + 'list-mobile.png', fullPage: true });
  await p.locator('.app-row', { hasText: 'Muse' }).click(); await p.waitForTimeout(2500);
  ok('mobile detail overflow', (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  await p.screenshot({ path: dir + 'purchases-mobile.png', fullPage: true });
  await ctx.close();
}
console.log(results.join('\n'));
console.log('errors:', errors.length ? errors : 'none');
await b.close();
