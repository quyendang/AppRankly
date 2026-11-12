import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/quyen.eth/.npm/_npx/3d55143a3497ce4a/node_modules/playwright');
const b = await chromium.launch({ executablePath: '/Users/quyen.eth/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
for (const m of ['notif', 'ai', 'reply']) {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await p.goto('http://127.0.0.1:3002/'); await p.fill('input[type=password]', 'preview-only-password'); await p.click('button[type=submit]');
  await p.waitForTimeout(3000);
  if (m === 'notif') await p.click('.top-end [aria-label="Thông báo"]');
  else { await p.locator('.app-row', { hasText: 'Muse' }).click(); await p.waitForTimeout(1500); if (m === 'ai') await p.click('.dh-id .button.primary'); else { await p.locator('.tabs .tab').nth(6).click(); await p.waitForTimeout(1500); await p.click('.review .button >> nth=0'); } }
  await p.waitForTimeout(500);
  console.log(m, await p.evaluate(() => { const e = document.querySelector('.modal'); return `modal w=${Math.round(e.getBoundingClientRect().width)} sw=${e.scrollWidth} overflow=${e.scrollWidth - e.clientWidth}`; }));
}
await b.close();
