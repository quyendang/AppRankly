// Behaviour checks for the loading/motion promises.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/quyen.eth/.npm/_npx/3d55143a3497ce4a/node_modules/playwright');
const browser = await chromium.launch({ executablePath: '/Users/quyen.eth/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const results = [];
const ok = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => { if (!sessionStorage.getItem('init')) { localStorage.clear(); sessionStorage.setItem('init', 1); } sessionStorage.setItem('lb-auth', '1'); sessionStorage.setItem('td-auth', '1'); });

// --- A
await page.goto('http://127.0.0.1:4320/leaderboard/index.html#portfolio');
await page.waitForTimeout(400);
const early = await page.evaluate(() => ({ lanes: document.querySelectorAll('.lane:not(.skeleton)').length, skel: document.querySelectorAll('.lane.skeleton').length, srcLoading: document.querySelectorAll('.src.loading').length }));
ok('A first paint shows skeleton lanes', early.skel > 0, JSON.stringify(early));
await page.waitForTimeout(900);
const mid = await page.evaluate(() => ({ lanes: document.querySelectorAll('.lane:not(.skeleton)').length, pending: document.querySelectorAll('.src.loading').length }));
await page.waitForTimeout(3000);
const order1 = await page.$$eval('.lane[data-flip]', (els) => els.map((e) => e.dataset.flip));
ok('A all 8 lanes', order1.length === 8, order1.length);
ok('A sources stream separately', mid.lanes > 0 && mid.lanes < 8 || mid.pending > 0, JSON.stringify(mid));
await page.click('[data-act="metric"][data-v="growth"]');
await page.waitForTimeout(80);
const anims = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.matches?.('.lane')).length);
await page.waitForTimeout(800);
const order2 = await page.$$eval('.lane[data-flip]', (els) => els.map((e) => e.dataset.flip));
ok('A re-sort changes order', order1.join() !== order2.join());
ok('A re-sort animates lanes (FLIP)', anims > 0, 'anims=' + anims);
ok('A movement badges shown', (await page.$$('.move')).length > 0);
// period switch keeps numbers
await page.click('[data-act="metric"][data-v="installs"]');
await page.waitForTimeout(700);
const before = await page.textContent('.sb-cell b');
await page.click('[data-act="period"][data-v="90"]');
await page.waitForTimeout(150);
const during = await page.evaluate(() => ({ text: document.querySelector('.sb-cell b').textContent, skel: document.querySelectorAll('.lane.skeleton').length, updating: document.querySelectorAll('.lane.is-updating').length }));
ok('A period switch keeps old numbers (no skeleton flash)', during.skel === 0 && during.text.trim() !== '' , JSON.stringify(during) + ' before=' + before);
await page.waitForTimeout(3500);
const after = await page.textContent('.sb-cell b');
ok('A totals updated for 90d', after !== before, before + ' → ' + after);
// cached revisit is instant
await page.click('[data-act="period"][data-v="30"]');
await page.waitForTimeout(60);
ok('A cached period is instant', (await page.$$('.lane.is-updating')).length === 0);
// optimistic keyword add + undo delete
await page.click('.lane-hit');
await page.waitForTimeout(2500);
await page.click('[data-tab="keywords"]'); await page.waitForTimeout(600);
const kw0 = (await page.$$('table.kw tbody tr')).length;
await page.fill('[data-form="keyword"] input', 'offline notes');
await page.press('[data-form="keyword"] input', 'Enter');
await page.waitForTimeout(60);
const kw1 = (await page.$$('table.kw tbody tr')).length;
ok('A keyword appears instantly (optimistic)', kw1 === kw0 + 1, `${kw0}→${kw1}`);
await page.waitForTimeout(1500);
await page.click('table.kw tbody tr:last-child [data-act="del-kw"]');
await page.waitForTimeout(60);
ok('A keyword delete is instant', (await page.$$('table.kw tbody tr')).length === kw0);
await page.waitForTimeout(900);
const undo = await page.$('.toast button');
ok('A delete offers undo', !!undo);
if (undo) { await undo.click(); await page.waitForTimeout(1500); ok('A undo restores keyword', (await page.$$('table.kw tbody tr')).length === kw0 + 1); }
// AI flow consent
await page.click('[data-act="ai"]'); await page.waitForTimeout(200);
ok('A AI run disabled before preview', await page.isDisabled('[data-act="ai-run"]'));
await page.click('[data-act="ai-preview"]'); await page.waitForTimeout(2000);
ok('A AI run disabled before consent', await page.isDisabled('[data-act="ai-run"]'));
await page.check('[data-bind="modal.confirmed"]'); await page.waitForTimeout(100);
ok('A AI run enabled after consent', !(await page.isDisabled('[data-act="ai-run"]')));
await page.fill('[data-bind="modal.question"]', 'x'); await page.waitForTimeout(100);
ok('A editing payload clears consent', await page.isDisabled('[data-act="ai-run"]'));
await page.keyboard.press('Escape');

// --- B
const p2 = await ctx.newPage(); p2.on('pageerror', (e) => errs.push('B ' + e.message));
await p2.goto('http://127.0.0.1:4320/today/index.html#portfolio');
await p2.waitForTimeout(4500);
const n0 = (await p2.$$('.inbox-item:not(.ghost)')).length;
ok('B inbox has tasks', n0 > 0, n0);
const k0 = await p2.$eval('.inbox-item [data-act="done"]', (e) => e.dataset.k);
await p2.click('.inbox-item [data-act="done"]');
await p2.waitForTimeout(900);
ok('B done removes task', !(await p2.$(`[data-act="done"][data-k="${k0}"]`)));
const hasVT = await p2.evaluate(() => typeof document.startViewTransition === 'function');
let vtFired = false;
await p2.exposeFunction('vtSeen', () => { vtFired = true; });
await p2.evaluate(() => { const o = document.startViewTransition.bind(document); document.startViewTransition = (f) => { window.vtSeen(); return o(f); }; });
await p2.click('.app-card');
await p2.waitForTimeout(800);
ok('B card→detail uses view transition', !hasVT || vtFired, 'supported=' + hasVT);
const shared = await p2.evaluate(() => getComputedStyle(document.querySelector('.detail-head')).viewTransitionName);
ok('B detail head shares card transition name', /^card-/.test(shared), shared);
await p2.keyboard.press('Meta+k'); await p2.waitForTimeout(200);
ok('B ⌘K opens palette', !!(await p2.$('.cmd')));
await p2.keyboard.type('pocket'); await p2.waitForTimeout(150);
await p2.keyboard.press('Enter'); await p2.waitForTimeout(1200);
ok('B palette opens app', (await p2.textContent('.dh-id h1')).includes('Pocket'));
// reply streaming
await p2.click('[data-tab="reviews"]'); await p2.waitForTimeout(1600);
await p2.click('[data-act="reply"]'); await p2.waitForTimeout(200);
await p2.click('[data-act="ai-draft"]');
let lens = [];
for (let i = 0; i < 40; i++) { await p2.waitForTimeout(100); lens.push(await p2.$eval('textarea[data-bind="modal.text"]', (e) => e.value.length)); }
const distinct = new Set(lens.filter((x) => x > 0)).size;
ok('B AI draft streams in', distinct > 3, 'steps=' + distinct);
ok('B publish needs confirmation', await p2.isDisabled('[data-act="publish"]'));
console.log(results.join('\n'));
console.log('page errors:', errs.length ? errs : 'none');
await browser.close();
