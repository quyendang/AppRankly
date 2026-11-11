// Browser check for both prototypes: console errors, overflow, every page/tab, and screenshots.
// Run: node shot.mjs  (expects `python3 -m http.server 4320` serving this folder)
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT || '/Users/quyen.eth/.npm/_npx/3d55143a3497ce4a/node_modules/playwright';
const { chromium } = require(pwPath);
const BASE = 'http://127.0.0.1:4320/';
const only = process.argv[2];
fs.mkdirSync(new URL('./screenshots/', import.meta.url), { recursive: true });
const out = (n) => new URL('./screenshots/' + n, import.meta.url).pathname;

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/Users/quyen.eth/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const report = [];
for (const proto of ['leaderboard', 'today'].filter((p) => !only || p === only)) {
  for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'mobile']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: tag === 'mobile' ? 2 : 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.addInitScript(() => { localStorage.clear(); sessionStorage.setItem('lb-auth', '1'); sessionStorage.setItem('td-auth', '1'); });
    await page.goto(BASE + proto + '/index.html#portfolio');
    await page.waitForTimeout(500);
    await page.screenshot({ path: out(`${proto}-loading-${tag}.png`) });
    await page.waitForTimeout(3500);
    const overflow = async (label) => {
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (o > 1) errors.push(`overflow ${o}px at ${label}`);
    };
    await overflow('portfolio');
    await page.screenshot({ path: out(`${proto}-portfolio-${tag}.png`), fullPage: true });
    // open first app
    const opener = proto === 'leaderboard' ? '.lane-hit' : '.app-card';
    await page.locator(opener).first().click();
    await page.waitForTimeout(2200);
    await overflow('detail');
    await page.screenshot({ path: out(`${proto}-detail-${tag}.png`), fullPage: true });
    for (const tab of ['countries', 'versions', 'storeListing', 'keywords', 'competitors', 'reviews', 'campaigns']) {
      await page.locator(`[data-tab="${tab}"]`).first().click();
      await page.waitForTimeout(1700);
      await overflow(tab);
      if (tag === 'desktop' || ['reviews', 'keywords'].includes(tab)) await page.screenshot({ path: out(`${proto}-tab-${tab}-${tag}.png`), fullPage: tag === 'desktop' });
    }
    // reply dialog
    const reply = page.locator('[data-act="reply"]').first();
    if (await reply.count()) {
      await reply.click(); await page.waitForTimeout(300);
      await page.locator('[data-act="ai-draft"]').click(); await page.waitForTimeout(3500);
      await page.screenshot({ path: out(`${proto}-reply-${tag}.png`) });
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    }
    await page.evaluate(() => { location.hash = 'settings'; });
    await page.waitForTimeout(200);
    await page.locator('[data-act="go"][data-page="settings"]').first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await overflow('settings');
    await page.screenshot({ path: out(`${proto}-settings-${tag}.png`), fullPage: true });
    // dark
    await page.locator('[data-act="theme"][data-v="dark"]').first().click();
    await page.locator('[data-act="go"][data-page="portfolio"]').first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: out(`${proto}-dark-${tag}.png`), fullPage: false });
    report.push({ proto, tag, errors });
    await ctx.close();
  }
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
