// Prototype engine: mock API with simulated latency, state store, derived metrics.
// Mirrors AppRankly's real endpoints so every flow can be exercised without a backend.
import { APPS, TIMELINE, RATES, RATES_DATE, LAST, TODAY, addDays, freshDB, DEFAULT_SETTINGS, INTEGRATIONS, NOTIFICATIONS } from './data.js';
import { setLang } from './util.js';

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- simulation controls ----------
export const sim = { speed: 'normal', fail: false, scenario: 'normal' };
const SPEED = { fast: [90, 200], normal: [450, 1000], slow: [1700, 3000] };
const latency = (mult = 1) => { const [a, b] = SPEED[sim.speed]; return (a + Math.random() * (b - a)) * mult; };
function fail(code) { const e = new Error(code); e.code = code; throw e; }

// ---------- persistence ----------
const KEY = 'apprankly-v2-db';
let db;
function loadDB() {
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db || db.v !== 3) db = { v: 3, ...freshDB(), settings: clone(DEFAULT_SETTINGS), notifications: clone(NOTIFICATIONS), dismissed: [] };
}
const saveDB = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
loadDB();
export function resetDB() { localStorage.removeItem(KEY); loadDB(); }

// ---------- data shaping ----------
export function rangeFor(days, offset = 0) {
  const end = addDays(LAST, -offset);
  return { startDate: addDays(end, -(days - 1)), endDate: end, days };
}
function splitCurrency(usd, mix) {
  const out = {};
  for (const [c, share] of Object.entries(mix)) out[c] = Math.round((usd * share) / RATES[c] * 100) / 100;
  return out;
}
function appFor(meta, range) {
  const stale = sim.scenario === 'stale' ? 3 : 0;
  const last = addDays(range.endDate, -(meta.lag + stale));
  const rows = TIMELINE[meta.id].filter((r) => r.date >= range.startDate && r.date <= range.endDate);
  const dailyTrends = rows.map((r) => ({ date: r.date, installs: r.date <= last ? r.installs : null }));
  const counted = rows.filter((r) => r.date <= last);
  const installs = meta.sourceError ? null : counted.reduce((s, r) => s + r.installs, 0);
  const usd = counted.reduce((s, r) => s + r.usd, 0);
  const base = {
    id: meta.id, name: meta.name, platform: meta.platform, color: meta.color, glyph: meta.glyph, category: meta.category, store: meta.store,
    installs, rating: meta.rating, ratings: meta.ratings, dailyTrends: meta.sourceError ? dailyTrends.map((d) => ({ ...d, installs: null })) : dailyTrends,
    lastDate: meta.sourceError ? null : last, activeDevices: meta.platform === 'google' && !meta.sourceError ? Math.round(installs * 3.4) : null,
    error: meta.sourceError ? 'SOURCE_FAILED' : null, sourceStatus: meta.sourceError ? 403 : null,
  };
  if (meta.platform === 'apple') base.revenueByCurrency = splitCurrency(usd, meta.mix);
  else {
    base.revenueStatus = meta.revenueStatus;
    base.revenueAvailable = meta.revenueStatus !== 'unavailable';
    base.grossRevenueByCurrency = meta.revenueStatus === 'unavailable' ? {} : splitCurrency(usd * (meta.revenueStatus === 'partial' ? 0.6 : 1), meta.mix);
  }
  return base;
}

// ---------- mock API ----------
export const api = {
  async me() { await wait(latency(0.4)); return { ok: true }; },
  async login(password) { await wait(latency(0.8)); if (!password || password.length < 4) fail('INVALID_CREDENTIALS'); return { ok: true }; },
  async logout() { await wait(latency(0.3)); return { ok: true }; },
  // Streams one platform at a time, like the real per-source report downloads.
  portfolioSource(platform, range) {
    const mult = platform === 'apple' ? 1 : 1.7;
    return wait(latency(mult)).then(() => {
      if (sim.scenario === 'error') fail('SOURCE_FAILED');
      if (sim.scenario === 'empty') return [];
      return APPS.filter((a) => a.platform === platform).map((m) => appFor(m, range));
    });
  },
  async anomalies() {
    await wait(latency(1.2));
    if (sim.scenario === 'empty') return { anomalies: [] };
    const list = [];
    for (const m of APPS) {
      const rows = TIMELINE[m.id];
      const latest = rows.at(-1).installs, avg = rows.slice(-8, -1).reduce((s, r) => s + r.installs, 0) / 7;
      const change = (latest / avg - 1) * 100;
      if (Math.abs(change) >= db.settings.anomalyThreshold) list.push({ key: m.id + ':installs', appId: m.id, name: m.name, kind: 'installs', direction: change > 0 ? 'up' : 'down', change, latest, avg, date: LAST });
    }
    for (const r of db.ranks) {
      const h = r.history; if (h.length < 8) continue;
      const from = h.at(-8).rank, to = h.at(-1).rank;
      if (from && to && to - from >= 6) {
        const k = db.keywords.find((x) => x.id === r.keywordId), m = APPS.find((a) => a.id === k?.appId);
        if (m) list.push({ key: r.keywordId + r.country, appId: m.id, name: m.name, kind: 'rank', term: k.term, country: r.country, from, to, direction: 'down', date: LAST });
      }
    }
    return { anomalies: list };
  },
  async aso(appId) {
    await wait(latency(1.1));
    if (sim.fail) fail('NETWORK_ERROR');
    const keywords = db.keywords.filter((k) => k.appId === appId);
    const ranks = db.ranks.filter((r) => keywords.some((k) => k.id === r.keywordId));
    return clone({
      listing: db.listings[appId],
      keywords, ranks: ranks.map(({ history, ...r }) => r),
      rankHistory: ranks.map((r) => ({ keywordId: r.keywordId, country: r.country, term: keywords.find((k) => k.id === r.keywordId).term, points: r.history })),
      competitors: db.competitors.filter((c) => c.appId === appId),
      reviews: db.reviews[appId] || [], reviewSourceStatus: APPS.find((a) => a.id === appId)?.sourceError ? 'unavailable' : 'ok',
      campaigns: db.campaigns.filter((c) => c.appId === appId).map((c) => ({ ...c, universal_url: 'https://apprankly.example/l/' + c.slug })),
      events: db.events.filter((e) => e.appId === appId).sort((a, b) => a.date.localeCompare(b.date)),
      aiResult: db.ai?.[appId] || null,
    });
  },
  async dimension(appId, dimension, range) {
    await wait(latency(0.9));
    const m = APPS.find((a) => a.id === appId);
    const total = appFor(m, range).installs || 0;
    if (dimension === 'country') return m.countries.map(([label, share]) => ({ label, totalInstalls: Math.round((total * share) / 100) }));
    // Versions: share shifts toward the newest release.
    const vs = m.versions.map(([v]) => v), n = vs.length;
    const weights = vs.map((_, i) => Math.pow(2.2, i));
    const sum = weights.reduce((s, w) => s + w, 0);
    return vs.map((label, i) => ({ label, totalInstalls: Math.round((total * weights[i]) / sum) })).reverse().slice(0, n);
  },
  async countryRevenue(appId, range) {
    await wait(latency(1.3));
    const m = APPS.find((a) => a.id === appId);
    const app = appFor(m, range);
    const rev = app.revenueByCurrency || app.grossRevenueByCurrency || {};
    const usd = Object.entries(rev).reduce((s, [c, v]) => s + v * RATES[c], 0);
    return { rows: m.countries.map(([country, share], i) => {
      const k = 1 + ((i * 37) % 9 - 4) / 10;
      return { country, installs: Math.round(((app.installs || 0) * share) / 100), revenueByCurrency: usd ? { USD: Math.round(((usd * share) / 100) * k * 100) / 100 } : {} };
    }) };
  },
  async exchange() { await wait(latency(0.6)); return { status: 'ok', rates: Object.fromEntries(Object.entries(RATES).filter(([c]) => c !== 'USD').map(([c, rate]) => [c, { rate, date: RATES_DATE }])) }; },
  async settings() { await wait(latency(0.5)); return clone(db.settings); },
  async saveSettings(patch) { await wait(latency(0.7)); Object.assign(db.settings, patch); saveDB(); return clone(db.settings); },
  async integrations() { await wait(latency(0.5)); return clone(INTEGRATIONS); },
  async testConnection(key) { await wait(latency(1.6)); if (sim.fail) fail('CONNECTION_FAILED'); return { ok: true, key }; },
  async notifications() { await wait(latency(0.5)); return { notifications: clone(db.notifications) }; },
  async readNotifications() { await wait(latency(0.4)); db.notifications.forEach((n) => (n.read = true)); saveDB(); return { ok: true }; },
  async notificationTest() { await wait(latency(1)); return { ok: true }; },
  async digestPreview(period) {
    await wait(latency(1));
    const r = rangeFor(period === 'weekly' ? 7 : 1);
    const lines = APPS.filter((a) => !a.sourceError).map((m) => { const a = appFor(m, r); return `• ${a.name}: ${a.installs} installs`; });
    return { message: `AppRankly · ${period === 'weekly' ? 'Weekly' : 'Daily'} digest (${r.startDate} → ${r.endDate})\n${lines.join('\n')}` };
  },
  async digestSend() { await wait(latency(1.2)); return { ok: true }; },
  async addGooglePackage(pkg) {
    await wait(latency(1));
    if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(pkg)) fail('INVALID_PACKAGE');
    if (!db.settings.googlePackages.includes(pkg)) db.settings.googlePackages.push(pkg);
    saveDB(); return clone(db.settings);
  },
  async removeGooglePackage(pkg) { await wait(latency(0.6)); db.settings.googlePackages = db.settings.googlePackages.filter((p) => p !== pkg); saveDB(); return clone(db.settings); },

  async addKeyword(appId, term) {
    await wait(latency(0.8));
    if (sim.fail) fail('NETWORK_ERROR');
    const k = { id: appId + ':k' + db.seq++, appId, term: term.trim() };
    db.keywords.push(k); saveDB(); return clone(k);
  },
  async deleteKeyword(id) { await wait(latency(0.6)); if (sim.fail) fail('NETWORK_ERROR'); db.keywords = db.keywords.filter((k) => k.id !== id); db.ranks = db.ranks.filter((r) => r.keywordId !== id); saveDB(); return { ok: true }; },
  async restoreKeyword(k, ranks) { await wait(latency(0.4)); db.keywords.push(k); (ranks || []).forEach((r) => db.ranks.push(r)); saveDB(); return { ok: true }; },
  async checkRanks(appId, country) {
    await wait(latency(2.4));
    if (sim.fail) fail('NETWORK_ERROR');
    const now = LAST + 'T' + new Date().toISOString().slice(11, 19) + 'Z';
    db.keywords.filter((k) => k.appId === appId).forEach((k) => {
      let r = db.ranks.find((x) => x.keywordId === k.id && x.country === country);
      if (!r) { r = { keywordId: k.id, country, rank: null, top_n: 100, checked_at: now, history: [] }; db.ranks.push(r); }
      const next = r.rank == null ? (Math.random() < 0.5 ? null : 30 + Math.round(Math.random() * 60)) : Math.max(1, r.rank + Math.round((Math.random() - 0.5) * 6));
      r.rank = next; r.checked_at = now;
      const last = r.history.at(-1);
      if (last && last.date === LAST) last.rank = next; else r.history.push({ date: LAST, rank: next });
    });
    saveDB(); return { ok: true };
  },
  async searchCompetitors(appId, term) {
    await wait(latency(1.5));
    const base = term.trim().split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
    return { competitors: [base + ' Pro', base + 'ly', 'My ' + term.trim(), base + ' Lite'].map((title, i) => ({ id: 'search:' + appId + ':' + title, appId: 'x' + i, title, score: Math.round((3.9 + Math.random()) * 10) / 10 })) };
  },
  async trackCompetitor(appId, comp) { await wait(latency(0.8)); db.competitors.push({ ...comp, id: appId + ':c' + db.seq++, appId, competitor_key: 'trk' }); saveDB(); return { ok: true }; },
  async refreshReviews(appId) {
    await wait(latency(2));
    const list = db.reviews[appId];
    if (list && Math.random() < 0.7) list.unshift({ id: appId + ':r' + db.seq++, author: 'Ngọc Hân', rating: 4, text: 'Mới cập nhật, chạy nhanh hơn hẳn. Cảm ơn team!', lang: 'vi', date: LAST, replyText: '', canReply: true });
    saveDB(); return clone({ reviews: list || [], sourceStatus: 'ok' });
  },
  async reply(appId, reviewId, text) {
    await wait(latency(1.4));
    if (sim.fail) fail('REPLY_FAILED');
    const r = db.reviews[appId].find((x) => x.id === reviewId);
    r.replyText = text; r.replyDate = LAST; r.responseState = APPS.find((a) => a.id === appId).platform === 'apple' ? 'PENDING_PUBLISH' : undefined;
    saveDB(); return clone({ review: r });
  },
  async bulkReply(appId, items) {
    await wait(latency(2.2));
    const results = items.map(({ reviewId, text }, i) => {
      const ok = !(sim.fail && i % 3 === 0);
      if (ok) { const r = db.reviews[appId].find((x) => x.id === reviewId); r.replyText = text; r.replyDate = LAST; }
      return { reviewId, ok };
    });
    saveDB(); return { results };
  },
  async templates() { await wait(latency(0.3)); return { templates: clone(db.templates) }; },
  async saveTemplate(name, body) { await wait(latency(0.6)); const ex = db.templates.find((t) => t.name === name); if (ex) ex.body = body; else db.templates.push({ id: db.seq++, name, body }); saveDB(); return { ok: true }; },
  async deleteTemplate(id) { await wait(latency(0.5)); db.templates = db.templates.filter((t) => t.id !== id); saveDB(); return { ok: true }; },
  async createCampaign(appId, name, source) {
    await wait(latency(0.9));
    if (sim.fail) fail('NETWORK_ERROR');
    const slug = 'c' + db.seq++;
    const c = { id: db.seq++, appId, name, source, slug, clicks: 0 };
    db.campaigns.push(c);
    db.events.push({ id: db.seq++, appId, date: LAST, type: 'campaign', label: name, source: 'auto' });
    saveDB(); return clone({ ...c, universal_url: 'https://apprankly.example/l/' + slug });
  },
  async deleteCampaign(id) { await wait(latency(0.6)); db.campaigns = db.campaigns.filter((c) => c.id !== id); saveDB(); return { ok: true }; },
  async addEvent(appId, date, label) { await wait(latency(0.7)); if (sim.fail) fail('NETWORK_ERROR'); const e = { id: db.seq++, appId, date, type: 'manual', label, source: 'manual' }; db.events.push(e); saveDB(); return clone(e); },
  async deleteEvent(id) { await wait(latency(0.5)); db.events = db.events.filter((e) => e.id !== id); saveDB(); return { ok: true }; },
  async aiPreview(body) {
    await wait(latency(1.1));
    const app = APPS.find((a) => a.id === body.appId);
    const payload = { kind: body.kind, locale: body.locale, app: { name: app.name, platform: app.platform, category: app.category }, listing: body.kind === 'reviewReply' ? undefined : db.listings[app.id] };
    if (body.kind === 'reviewReply') payload.review = (({ rating, text, lang }) => ({ rating, text, lang }))(db.reviews[app.id].find((r) => r.id === body.reviewId));
    if (body.question) payload.question = body.question;
    if (body.includeMetrics) payload.metrics = { range: body.range, installs: appFor(app, body.range).installs, rating: app.rating };
    db.preview = { id: 'pv' + db.seq++, body, payload };
    return clone({ previewId: db.preview.id, payload, destination: { provider: 'openai-compatible', origin: 'https://ai-proxy.example', model: 'gpt-4.1-mini' } });
  },
  async aiRun(previewId) {
    await wait(latency(3));
    if (sim.fail) fail('AI_INVALID_RESPONSE');
    if (db.preview?.id !== previewId) fail('PREVIEW_EXPIRED');
    const { body } = db.preview;
    if (body.kind === 'reviewReply') {
      const r = db.reviews[body.appId].find((x) => x.id === body.reviewId);
      const text = r.lang === 'vi' ? `Chào ${r.author}, cảm ơn bạn đã dành thời gian đánh giá! ${r.rating >= 4 ? 'Rất vui vì ứng dụng hữu ích với bạn.' : 'Chúng tôi xin lỗi vì trải nghiệm này và đã ghi nhận để sửa trong bản cập nhật tới.'}`
        : r.lang === 'ja' ? `${r.author}様、レビューありがとうございます。${r.rating >= 4 ? '今後もよろしくお願いします。' : 'ご不便をおかけして申し訳ありません。次のアップデートで改善します。'}`
        : `Hi ${r.author}, thanks for taking the time to review! ${r.rating >= 4 ? 'We are glad it helps.' : 'Sorry about this — we have logged it and are fixing it in the next update.'}`;
      return { result: { candidates: [text] } };
    }
    const result = {
      summary: { audit: 'Title and subtitle repeat “notes”; the subtitle could carry a second high-intent keyword instead.', variants: 'Three title variants that keep the brand first and add one ranking keyword each.', reviews: 'Recent low ratings cluster around sync after the latest release; praise centers on widgets.', ask: 'Answer based on the approved payload only.' }[body.kind],
      recommendations: ['Move “journal” into the subtitle and drop the duplicate word.', 'Mention offline search in the first 170 characters of the description.', 'Reply to the 1–2★ reviews about sync before the next release.'],
      candidates: body.kind === 'variants' ? ['Luma Notes: Journal & Lists', 'Luma — Quick Notes Journal', 'Luma Notes · Daily Journal'] : [],
    };
    db.ai = { ...(db.ai || {}), [body.appId]: result }; saveDB();
    return { result };
  },
  dismiss(key) { if (!db.dismissed.includes(key)) db.dismissed.push(key); saveDB(); },
  undismiss(key) { db.dismissed = db.dismissed.filter((k) => k !== key); saveDB(); },
  dismissed: () => db.dismissed,
  allReviews: () => clone(db.reviews),
  allRanks: () => db.ranks.map((r) => ({ ...r, term: db.keywords.find((k) => k.id === r.keywordId)?.term, appId: db.keywords.find((k) => k.id === r.keywordId)?.appId })),
  allEvents: () => clone(db.events),
};

// ---------- derived metrics ----------
export function usdTotal(list, exchange) {
  let total = 0, any = false; const missing = new Set();
  for (const a of list) {
    const rev = a.platform === 'google' ? a.grossRevenueByCurrency : a.revenueByCurrency;
    for (const [c, v] of Object.entries(rev || {})) {
      if (!v) continue; any = true;
      const rate = c === 'USD' ? 1 : exchange?.rates?.[c]?.rate;
      if (rate) total += v * rate; else missing.add(c);
    }
  }
  const hasReports = list.some((a) => a.platform === 'apple' ? !!a.revenueByCurrency : a.revenueAvailable);
  return { total: hasReports && !missing.size ? total : hasReports ? total : null, partial: missing.size > 0, missing: [...missing], hasReports, any };
}
export function originalByPlatform(list) {
  const out = { apple: {}, google: {} };
  for (const a of list) {
    const rev = a.platform === 'google' ? a.grossRevenueByCurrency : a.revenueByCurrency;
    for (const [c, v] of Object.entries(rev || {})) out[a.platform][c] = (out[a.platform][c] || 0) + v;
  }
  return out;
}
export function growthOf(app, previous) {
  const old = previous.find((a) => a.id === app.id)?.installs;
  return app.installs != null && old > 0 ? (app.installs / old - 1) * 100 : null;
}
export function totals(list, previous) {
  const avail = list.filter((a) => a.installs != null);
  const total = avail.reduce((s, a) => s + a.installs, 0);
  const old = previous.filter((a) => list.some((x) => x.id === a.id) && a.installs != null).reduce((s, a) => s + a.installs, 0);
  return { installs: avail.length ? total : null, change: old > 0 && avail.length ? (total / old - 1) * 100 : null };
}
export function seriesSum(list) {
  const map = new Map();
  list.forEach((a) => a.dailyTrends.forEach((d) => { if (d.installs != null) map.set(d.date, (map.get(d.date) || 0) + d.installs); else if (!map.has(d.date)) map.set(d.date, null); }));
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, v }));
}

// NEW: before/after impact of every release (7 days either side).
export function versionImpact(appId) {
  const rows = TIMELINE[appId];
  return api.allEvents().filter((e) => e.appId === appId && e.type === 'release').map((e) => {
    const i = rows.findIndex((r) => r.date === e.date);
    if (i < 7) return null;
    const before = rows.slice(i - 7, i), after = rows.slice(i, i + 7);
    const avg = (xs, k) => xs.reduce((s, r) => s + r[k], 0) / xs.length;
    const b = avg(before, 'installs'), a = after.length >= 3 ? avg(after, 'installs') : null;
    const rb = avg(before, 'usd') / b, ra = a ? avg(after, 'usd') / a : null;
    const reviews = (api.allReviews()[appId] || []).filter((r) => r.date >= e.date && (!rows[i + 7] || r.date < rows[i + 7].date));
    return { ...e, before: b, after: a, change: a ? (a / b - 1) * 100 : null, rpiChange: ra ? (ra / rb - 1) * 100 : null, days: after.length, reviews: reviews.length, low: reviews.filter((r) => r.rating <= 2).length };
  }).filter(Boolean).reverse();
}

// NEW: one prioritized task list across the portfolio.
export function buildTasks(apps, anomalies) {
  const dismissed = new Set(api.dismissed());
  const reviews = api.allReviews();
  const tasks = [];
  for (const a of apps) {
    const open = (reviews[a.id] || []).filter((r) => r.canReply && !r.replyText);
    const low = open.filter((r) => r.rating <= 2);
    if (low.length) tasks.push({ key: 'low:' + a.id + ':' + low.map((r) => r.id).join(), kind: 'lowReview', appId: a.id, app: a, count: low.length, review: low[0], weight: 90 + low.length });
    const rest = open.length - low.length;
    if (!low.length && rest > 0) tasks.push({ key: 'rev:' + a.id + ':' + open.length, kind: 'reviews', appId: a.id, app: a, count: rest, weight: 40 + rest });
    if (a.error) tasks.push({ key: 'src:' + a.id, kind: 'source', appId: a.id, app: a, status: a.sourceStatus, weight: 80 });
    else if (a.lastDate && a.lastDate < LAST) tasks.push({ key: 'lag:' + a.id + a.lastDate, kind: 'lag', appId: a.id, app: a, lastDate: a.lastDate, weight: 20 });
  }
  for (const n of anomalies) {
    const a = apps.find((x) => x.id === n.appId); if (!a) continue;
    tasks.push({ key: 'an:' + n.key + n.date, kind: n.kind === 'rank' ? 'rankDrop' : n.direction === 'up' ? 'spike' : 'drop', appId: a.id, app: a, anomaly: n, weight: n.direction === 'down' ? 85 : 50 });
  }
  return tasks.filter((t) => !dismissed.has(t.key)).sort((x, y) => y.weight - x.weight);
}

// ---------- store ----------
export function createStore(initial, render) {
  const state = initial;
  let queued = false;
  const store = {
    state,
    set(patch) { Object.assign(state, typeof patch === 'function' ? patch(state) : patch); store.schedule(); },
    schedule() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; render(state); }); },
    now() { queued = false; render(state); },
  };
  return store;
}

export function readPref(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
export function writePref(key, v) { try { localStorage.setItem(key, v); } catch {} }

// Theme + language helpers shared by both shells.
export function applyTheme(theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  return dark;
}
export function applyLang(lang) { setLang(lang); document.documentElement.lang = lang; }

export { LAST, TODAY, APPS };
