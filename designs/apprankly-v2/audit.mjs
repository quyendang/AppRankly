// DOM-level layout audit (no screenshots needed): clipped text, elements past their container, overlaps, contrast.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || '/Users/quyen.eth/.npm/_npx/3d55143a3497ce4a/node_modules/playwright');
const proto = process.argv[2] || 'leaderboard';
const PROD = proto === 'production';
const browser = await chromium.launch({ executablePath: '/Users/quyen.eth/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });

const audit = () => {
  const out = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const label = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' "' + (el.textContent || '').trim().slice(0, 30) + '"';
  // 1. Text overflowing its own box (not intentionally ellipsized)
  document.querySelectorAll('main *, header *, .modal *').forEach((el) => {
    if (!vis(el) || el.closest('svg,.chart,.table-wrap,.table-scroll,.tabbar,.tabs,.dh-switch,.metric-switch,code,.lane-spark,.fx-pop')) return;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' || cs.overflowX === 'auto' || cs.overflowX === 'scroll') return;
    if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && cs.overflow !== 'visible') out.push('clipped text: ' + label(el));
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth + 1 && !el.closest('.tray,.sim')) out.push(`past viewport (${Math.round(r.right - innerWidth)}px): ` + label(el));
  });
  // 2. Children escaping their parent card horizontally
  document.querySelectorAll('.app-row, .tile, .purchases-panel, .panel, .lane, .hero-app, .scoreboard, .task, .app-card, .today-hero, .detail-head, .inbox-item').forEach((card) => {
    const cr = card.getBoundingClientRect();
    card.querySelectorAll('*').forEach((c) => {
      if (!vis(c) || c.closest('.rev-detail,.how,.chart-tip,.table-wrap,.table-scroll,.tabbar,.tabs,.fx-pop,.dh-switch')) return;
      const r = c.getBoundingClientRect();
      if (r.right > cr.right + 1.5 || r.left < cr.left - 1.5) out.push(`escapes ${card.className.split(' ')[0]} by ${Math.round(Math.max(r.right - cr.right, cr.left - r.left))}px: ` + label(c));
    });
  });
  // 3. Overlapping siblings in flex/grid rows (text collisions)
  document.querySelectorAll('.row-id, .row-num, .app-row, .purchase-tiles, .tile, .panel-actions, .suggest-list label, .lane-name, .lane-val, .r-head, .ha-id, .task-acts, .card-top, .card-stats, .controls, .ctrl-right, .page-title, .dh-id, .dh-row, .ib-title, .sec-head, .filters, .top-end, .review > div').forEach((row) => {
    const kids = [...row.children].filter(vis);
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 2 && oy > 2) out.push('overlap in ' + row.className + ': ' + label(kids[i]) + ' × ' + label(kids[j]));
    }
  });
  // 4. Contrast for visible text leaves
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g2 = cv.getContext('2d', { willReadFrequently: true });
  const parse = (c) => { if (!c || c === 'transparent') return [0, 0, 0, 0]; g2.clearRect(0, 0, 1, 1); g2.fillStyle = '#000'; g2.fillStyle = c; g2.fillRect(0, 0, 1, 1); const d = g2.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { let e = el; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && (c[3] === undefined || c[3] > 0.6)) return c; e = e.parentElement; } return [255, 255, 255]; };
  const seen = new Set();
  document.querySelectorAll('main *, header *').forEach((el) => {
    if (!vis(el) || el.closest('svg,.skel,[disabled],.is-pending,.is-updating,.lane.skeleton,.metric-switch,.pillnav,.sr')) return;
    const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (!txt) return;
    const cs = getComputedStyle(el);
    if (parseFloat(cs.opacity) < 0.95) return;
    const fg = parse(cs.color), bg = bgOf(el);
    const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const big = parseFloat(cs.fontSize) >= 18.5 || (parseFloat(cs.fontSize) >= 14 && Number(cs.fontWeight) >= 700);
    if (ratio < (big ? 3 : 4.5)) { const k = cs.color + bg + txt.slice(0, 12); if (!seen.has(k)) { seen.add(k); out.push(`contrast ${ratio.toFixed(2)}: ` + label(el)); } }
  });
  return [...new Set(out)].slice(0, 40);
};

for (const [w, h] of [[1440, 900], [390, 844]]) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.addInitScript((th) => { localStorage.clear(); localStorage.setItem('apprankly-v2-theme', th); sessionStorage.setItem('lb-auth', '1'); sessionStorage.setItem('td-auth', '1'); }, theme);
    if (PROD) {
      await page.addInitScript((th) => localStorage.setItem('apprankly_theme', th), theme);
      await page.goto('http://127.0.0.1:3002/');
      await page.fill('input[type=password]', 'preview-only-password'); await page.click('button[type=submit]');
    } else await page.goto(`http://127.0.0.1:4320/${proto}/index.html#portfolio`);
    await page.waitForTimeout(4000);
    const res = { portfolio: await page.evaluate(audit) };
    const opener = proto === 'leaderboard' ? '.lane-hit' : proto === 'production' ? '.app-row' : '.app-card';
    await page.locator(opener).first().click();
    await page.waitForTimeout(2500);
    res.detail = await page.evaluate(audit);
    const tabSel = (name, i) => PROD ? page.locator('.tabs .tab').nth(i) : page.locator(`[data-tab="${name}"]`).first();
    for (const [name, i] of [['reviews', 6], ['keywords', 4], ['versions', 2], ['campaigns', 7], ['storeListing', 3]]) {
      await tabSel(name, i).click(); await page.waitForTimeout(1500);
      res[name] = await page.evaluate(audit);
    }
    if (PROD) { await page.evaluate(() => { location.hash = '#settings'; }); await page.waitForTimeout(1200); res.settings = await page.evaluate(audit); }
    console.log(`\n=== ${proto} ${w} ${theme}`);
    for (const [k, v] of Object.entries(res)) if (v.length) console.log(k + ':\n  ' + v.join('\n  '));
    await ctx.close();
  }
}
await browser.close();
