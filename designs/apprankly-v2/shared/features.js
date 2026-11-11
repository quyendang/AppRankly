// Feature layer shared by both prototypes: data loading strategy, every AppRankly function, dialogs and settings.
// Each prototype supplies its own shell, portfolio layout and CSS; class names here are the shared vocabulary.
import { api, sim, rangeFor, usdTotal, originalByPlatform, growthOf, totals, seriesSum, versionImpact, buildTasks, resetDB, writePref, applyTheme, applyLang, LAST } from './core.js';
import { esc, num, compact, pct, date, region, toast, download, morph, tween, enter, vt, reduced } from './util.js';
import { icon } from './icons.js';
import { drawChart, sparkline } from './chart.js';
import { T } from './locales.js';

export { icon, esc, num, compact, pct, date, region, sparkline, vt, rangeFor, growthOf, totals, seriesSum, usdTotal, buildTasks, versionImpact, LAST };

// ---------------- i18n ----------------
export function t(key, vars) {
  const lang = document.documentElement.lang === 'en' ? 'en' : 'vi';
  let s = T[lang][key] ?? T.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}
const errText = (e) => t('err_' + (e?.code || e?.message || 'OPERATION_FAILED'), {}) .startsWith('err_') ? t('err_OPERATION_FAILED') : t('err_' + (e?.code || e?.message));

// ---------------- state ----------------
export function initialState(extra = {}) {
  return {
    auth: null, lang: 'vi', theme: 'system',
    period: 30, platform: 'all', query: '', sort: 'installs',
    apps: [], previous: [], range: rangeFor(30), loading: false, pendingPlatforms: [],
    sources: {}, exchange: null, anomalies: [], loadError: null,
    selected: null, detailTab: 'overview',
    aso: {}, dims: {}, country: {},
    settings: null, integrations: null, notifications: [],
    modal: null, busy: {}, reviewFilter: 'allReviews', picked: [], rankCountry: 'us', searchCompetitors: [], digestPreview: '',
    simOpen: false, ...extra,
  };
}
export const busy = (s, k) => !!s.busy[k];
export const current = (s) => s.apps.find((a) => a.id === s.selected) || s.apps[0] || null;
export function filtered(s) {
  const q = s.query.trim().toLowerCase();
  const list = s.apps.filter((a) => (s.platform === 'all' || a.platform === s.platform) && (!q || a.name.toLowerCase().includes(q) || a.store.toLowerCase().includes(q)));
  const val = (a) => s.sort === 'growth' ? growthOf(a, s.previous) ?? -1e9 : s.sort === 'revenue' ? usdTotal([a], s.exchange).total ?? -1 : s.sort === 'rating' ? a.rating ?? -1 : a.installs ?? -1;
  return list.sort((a, b) => val(b) - val(a));
}

async function run(store, key, fn, { ok, quiet } = {}) {
  const s = store.state;
  if (s.busy[key]) return;
  store.set({ busy: { ...s.busy, [key]: true } });
  try {
    const r = await fn();
    if (ok) toast(t(ok), { undoLabel: t('undo') });
    return r;
  } catch (e) {
    if (!quiet) toast(errText(e), { tone: 'err' });
    throw e;
  } finally {
    const b = { ...store.state.busy }; delete b[key];
    store.set({ busy: b });
  }
}

// ---------------- loading strategy ----------------
// 1. Each store source streams in independently (Apple, Google, rates, insights) with its own status.
// 2. Switching period keeps the old numbers on screen, marks the rows still pending and tweens to new values.
// 3. Results are cached per period, and other periods are prefetched on hover, so revisits are instant.
const cache = new Map();
const inflight = new Map();
let token = 0;

function fetchPeriod(period, force) {
  const k = period;
  if (!force && cache.has(k)) return { cached: cache.get(k) };
  if (!force && inflight.has(k)) return { promises: inflight.get(k) };
  const range = rangeFor(period), prev = rangeFor(period, period);
  const promises = Object.fromEntries(['apple', 'google'].map((p) => [p, Promise.all([api.portfolioSource(p, range), api.portfolioSource(p, prev)])]));
  inflight.set(k, promises);
  Promise.allSettled(Object.values(promises)).then((rs) => {
    inflight.delete(k);
    if (rs.every((r) => r.status === 'fulfilled')) cache.set(k, { range, apple: rs[0].value, google: rs[1].value });
  });
  return { promises };
}
export function prefetch(period) { if (!cache.has(period) && !inflight.has(period)) fetchPeriod(period).promises && null; }

export async function loadPortfolio(store, { force = false } = {}) {
  const s = store.state, my = ++token, period = s.period;
  const range = rangeFor(period);
  const got = fetchPeriod(period, force);
  const stamp = () => new Date().toISOString();
  if (got.cached) {
    const c = got.cached;
    store.set({ apps: [...c.apple[0], ...c.google[0]], previous: [...c.apple[1], ...c.google[1]], range, loading: false, pendingPlatforms: [], loadError: null });
    return;
  }
  const hadData = s.apps.length > 0;
  store.set({
    loading: true, loadError: null, pendingPlatforms: ['apple', 'google'], range: hadData ? s.range : range,
    sources: { ...s.sources, apple: { state: 'loading' }, google: { state: 'loading' } },
  });
  const results = {};
  await Promise.all(['apple', 'google'].map((p) => got.promises[p].then(([now, old]) => {
    if (my !== token) return;
    results[p] = true;
    const st = store.state;
    const keep = (list) => list.filter((a) => a.platform !== p);
    store.set({
      apps: [...keep(st.apps), ...now].sort((a, b) => a.platform.localeCompare(b.platform)),
      previous: [...keep(st.previous), ...old],
      range, pendingPlatforms: st.pendingPlatforms.filter((x) => x !== p),
      sources: { ...st.sources, [p]: { state: 'done', at: stamp(), count: now.length } },
    });
    if (!st.selected && now[0]) store.set({ selected: now[0].id });
  }).catch((e) => {
    if (my !== token) return;
    const st = store.state;
    store.set({ pendingPlatforms: st.pendingPlatforms.filter((x) => x !== p), loadError: e.code || 'SOURCE_FAILED', sources: { ...st.sources, [p]: { state: 'error', at: stamp(), code: e.code } } });
  })));
  if (my !== token) return;
  store.set({ loading: false });
  const st = store.state;
  if (!st.apps.some((a) => a.id === st.selected)) store.set({ selected: st.apps[0]?.id || null });
}

export async function loadSide(store, { force = false } = {}) {
  const stamp = () => new Date().toISOString();
  const s = store.state;
  store.set({ sources: { ...s.sources, rates: { state: 'loading' }, insights: { state: 'loading' }, reviews: { state: force ? 'loading' : s.sources.reviews?.state || 'loading' } } });
  const tasks = [
    api.exchange().then((r) => store.set({ exchange: r, sources: { ...store.state.sources, rates: { state: 'done', at: stamp() } } })).catch(() => store.set({ sources: { ...store.state.sources, rates: { state: 'error', at: stamp() } } })),
    api.anomalies().then((r) => store.set({ anomalies: r.anomalies, sources: { ...store.state.sources, insights: { state: 'done', at: stamp(), count: r.anomalies.length } } })).catch(() => store.set({ sources: { ...store.state.sources, insights: { state: 'error', at: stamp() } } })),
    new Promise((r) => setTimeout(r, sim.speed === 'slow' ? 2600 : sim.speed === 'fast' ? 250 : 1300)).then(() => store.set({ sources: { ...store.state.sources, reviews: { state: 'done', at: stamp() } } })),
  ];
  if (!s.settings) tasks.push(Promise.all([api.settings(), api.integrations(), api.notifications()]).then(([st, i, n]) => store.set({ settings: st, integrations: i, notifications: n.notifications })));
  await Promise.all(tasks);
}

export async function sync(store) {
  cache.clear();
  store.set({ aso: {}, dims: {}, country: {} });
  await run(store, 'sync', () => Promise.all([loadPortfolio(store, { force: true }), loadSide(store, { force: true })]));
  const st = store.state;
  const failed = ['apple', 'google', 'rates', 'insights'].filter((k) => st.sources[k]?.state === 'error');
  toast(failed.length ? t('syncPartial', { n: failed.length }) : t('syncDone'), { tone: failed.length ? 'warn' : 'ok' });
}

const asoInflight = new Map();
export function loadASO(store, appId, { force = false } = {}) {
  if (!appId) return;
  const s = store.state;
  if (!force && (s.aso[appId]?.data || asoInflight.has(appId))) return asoInflight.get(appId);
  store.set({ aso: { ...s.aso, [appId]: { ...(s.aso[appId] || {}), loading: true, error: null } } });
  const p = api.aso(appId).then((data) => {
    store.set({ aso: { ...store.state.aso, [appId]: { data, loading: false } } });
  }).catch((e) => {
    store.set({ aso: { ...store.state.aso, [appId]: { ...(store.state.aso[appId] || {}), loading: false, error: e.code || 'NETWORK_ERROR' } } });
  }).finally(() => asoInflight.delete(appId));
  asoInflight.set(appId, p);
  return p;
}
export function loadDims(store, appId, dimension) {
  const s = store.state, k = appId + ':' + dimension + ':' + s.period;
  if (!appId || s.dims[k]) return;
  store.set({ dims: { ...s.dims, [k]: { loading: true } } });
  api.dimension(appId, dimension, rangeFor(s.period)).then((rows) => store.set({ dims: { ...store.state.dims, [k]: { rows } } }))
    .catch(() => store.set({ dims: { ...store.state.dims, [k]: { error: true } } }));
}
export function loadCountry(store, appId) {
  const s = store.state, k = appId + ':' + s.period;
  if (!appId || s.country[k]) return;
  store.set({ country: { ...s.country, [k]: { loading: true } } });
  api.countryRevenue(appId, rangeFor(s.period)).then((r) => store.set({ country: { ...store.state.country, [k]: { rows: r.rows } } }))
    .catch(() => store.set({ country: { ...store.state.country, [k]: { error: true } } }));
}
// Prefetch everything a detail view needs as soon as the pointer shows intent.
export function warmApp(store, appId) {
  loadASO(store, appId);
  loadDims(store, appId, 'country');
}
export function ensureDetail(store) {
  const s = store.state, app = current(s);
  if (!app) return;
  loadASO(store, app.id);
  if (['overview', 'countries'].includes(s.detailTab)) loadDims(store, app.id, 'country');
  if (s.detailTab === 'versions') loadDims(store, app.id, 'app_version');
  if (s.detailTab === 'countries') loadCountry(store, app.id);
}

// ---------------- small render helpers ----------------
const GLYPH = { note: 'notebook-pen', leaf: 'leaf', wave: 'waves', scan: 'scan-line', coin: 'coins', kanji: 'languages', pulse: 'heart-pulse', book: 'book-open' };
export function appMark(app, cls = '') {
  return `<span class="app-mark ${cls}" style="--app:${app.color}" aria-hidden="true">${icon(GLYPH[app.glyph] || 'smartphone')}<i class="plat ${app.platform}">${icon(app.platform === 'apple' ? 'apple' : 'play')}</i></span>`;
}
export const storeName = (p) => (p === 'apple' ? 'App Store' : 'Google Play');
export function changeChip(v, cls = '') {
  if (v == null) return `<span class="chg none ${cls}">—</span>`;
  const dir = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
  return `<span class="chg ${dir} ${cls}">${icon(dir === 'down' ? 'arrow-down-right' : 'arrow-up-right')}${pct(v)}</span>`;
}
export function tw(key, value, digits = 0, kind = 'num') {
  return value == null ? '<span class="na">—</span>' : `<span class="tnum" data-tw="${value}" data-twk="${esc(key)}" data-twd="${digits}" data-twf="${kind}">${kind === 'pct' ? pct(value, digits) : num(value, digits)}</span>`;
}
export const skel = (w = '100%', h = '1em', cls = '') => `<span class="skel ${cls}" style="width:${w};height:${h}"></span>`;
export function isPending(s, app) { return s.pendingPlatforms.includes(app.platform); }

export function revenueOf(s, list, key) {
  const u = usdTotal(list, s.exchange);
  if (!u.hasReports) return { html: `<span class="na" title="${esc(t('revenueUnavailable'))}">—</span>`, u };
  if (!s.exchange) return { html: skel('4.5em', '1em'), u };
  return { html: `${tw(key, u.total, 2)}<small class="ccy">USD</small>`, u };
}
export function revenueDetail(s, list) {
  const o = originalByPlatform(list), u = usdTotal(list, s.exchange);
  const group = (p) => {
    const apps = list.filter((a) => a.platform === p); if (!apps.length) return '';
    const entries = Object.entries(o[p]).filter(([, v]) => v);
    const status = p === 'google' && apps.some((a) => a.revenueStatus !== 'available') ? `<em>${t(apps.some((a) => a.revenueAvailable) ? 'revenuePartial' : 'revenueUnavailable')}</em>` : '';
    return `<div class="rev-group"><b>${t(p === 'apple' ? 'appleNet' : 'googleGross')}</b>${entries.length ? entries.map(([c, v]) => `<span>${num(v, 2)} <small>${c}</small></span>`).join('') : `<span class="na">${t('noRevenueRows')}</span>`}${status}</div>`;
  };
  const rates = Object.keys({ ...o.apple, ...o.google }).filter((c) => c !== 'USD');
  return `<div class="rev-detail">${group('apple')}${group('google')}
    <p class="fine">${t('usdHint')}${list.some((a) => a.platform === 'apple') && list.some((a) => a.platform === 'google') ? ' ' + t('mixedBasis') : ''}</p>
    ${rates.length ? `<p class="fine">${rates.map((c) => s.exchange?.rates?.[c] ? `1 ${c} = ${num(s.exchange.rates[c].rate, 6)} USD` : t('missingRate', { c })).join(' · ')} · Frankfurter ${s.exchange?.rates ? '· ' + date(Object.values(s.exchange.rates)[0]?.date) : ''}</p>` : ''}
    ${u.missing.length ? `<p class="fine warn">${t('missingRate', { c: u.missing.join(', ') })}</p>` : ''}</div>`;
}
export function rel(isoTime) {
  if (!isoTime) return '';
  const sec = Math.max(1, Math.round((Date.now() - Date.parse(isoTime)) / 1000));
  return sec < 60 ? t('justNow') : t('minutesAgo', { n: Math.round(sec / 60) });
}

// ---------------- NEW: per-source sync tray ----------------
export function syncTray(s) {
  const rows = [['apple', 'srcApple'], ['google', 'srcGoogle'], ['rates', 'srcRates'], ['insights', 'srcInsights'], ['reviews', 'srcReviews']];
  return `<div class="sync-tray" role="status" aria-live="polite">
    ${rows.map(([k, label]) => {
      const st = s.sources[k] || { state: 'idle' };
      const ic = st.state === 'loading' ? icon('loader', 'spin') : st.state === 'error' ? icon('alert-triangle') : st.state === 'done' ? icon('check') : icon('circle-dashed');
      const note = st.state === 'loading' ? t('srcLoading') : st.state === 'error' ? t('srcError') : st.state === 'done' ? (st.count != null ? t('srcCount', { n: st.count }) + ' · ' : '') + rel(st.at) : t('srcIdle');
      return `<div class="src ${st.state}" data-key="src-${k}">${ic}<span>${t(label)}</span><small>${note}</small></div>`;
    }).join('')}
    <span class="badge-new">${t('new')}</span>
  </div>`;
}
export function syncSummary(s) {
  const keys = ['apple', 'google', 'rates', 'insights', 'reviews'];
  const loading = keys.filter((k) => s.sources[k]?.state === 'loading').length;
  const error = keys.filter((k) => s.sources[k]?.state === 'error').length;
  const done = keys.filter((k) => s.sources[k]?.state === 'done').length;
  return { loading, error, done, total: keys.length };
}

// ---------------- banners ----------------
export function banners(s) {
  const out = [];
  if (s.loadError) out.push(`<div class="banner err" role="alert" data-key="b-err">${icon('alert-triangle')}<span>${t('err_' + s.loadError)}</span><button class="btn sm" data-act="retry">${icon('refresh-cw')}${t('retry')}</button></div>`);
  if (s.apps.some((a) => a.error)) out.push(`<div class="banner warn" data-key="b-src">${icon('info')}<span>${t('sourceUnavailable', { names: s.apps.filter((a) => a.error).map((a) => a.name).join(', ') })}</span></div>`);
  if (!s.loading && s.apps.some((a) => a.lastDate && a.lastDate < s.range.endDate)) out.push(`<div class="banner info" data-key="b-lag">${icon('clock')}<span>${t('incompleteReports')}</span></div>`);
  return out.join('');
}

// ---------------- NEW: action center ----------------
export function taskCopy(task) {
  const a = task.anomaly;
  switch (task.kind) {
    case 'lowReview': return { tone: 'neg', ic: 'message-square', title: t('taskLowReview', { n: task.count }), body: `“${task.review.text}”`, cta: t('taskReply'), act: 'task-reply' };
    case 'reviews': return { tone: 'mid', ic: 'inbox', title: t('taskReviews', { n: task.count }), body: t('taskReviewsBody'), cta: t('taskOpenReviews'), act: 'task-reviews' };
    case 'source': return { tone: 'neg', ic: 'alert-triangle', title: t('taskSource'), body: t('appleReportHTTP', { status: task.status }), cta: t('taskCheck'), act: 'task-settings' };
    case 'lag': return { tone: 'info', ic: 'clock', title: t('taskLag', { d: date(task.lastDate) }), body: t('taskLagBody'), cta: t('taskOpen'), act: 'task-open' };
    case 'drop': return { tone: 'neg', ic: 'trending-down', title: t('taskDrop', { p: Math.abs(Math.round(a.change)) }), body: t('taskDropBody', { latest: num(a.latest), avg: num(a.avg) }), cta: t('taskOpen'), act: 'task-open' };
    case 'spike': return { tone: 'pos', ic: 'trending-up', title: t('taskSpike', { p: Math.round(a.change) }), body: t('taskDropBody', { latest: num(a.latest), avg: num(a.avg) }), cta: t('taskOpen'), act: 'task-open' };
    case 'rankDrop': return { tone: 'neg', ic: 'flag', title: t('taskRank', { term: a.term, c: a.country.toUpperCase() }), body: t('taskRankBody', { from: a.from, to: a.to }), cta: t('taskKeywords'), act: 'task-keywords' };
    default: return { tone: 'info', ic: 'info', title: task.kind, body: '', cta: t('taskOpen'), act: 'task-open' };
  }
}

// ---------------- charts ----------------
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export function portfolioChartSpec(s, list) {
  const cur = seriesSum(list), prevMap = seriesSum(s.previous.filter((p) => list.some((a) => a.id === p.id)));
  return {
    label: t('chartLabel'), height: 230, dates: cur.map((d) => d.date),
    series: [
      { key: 'now', label: t('thisPeriod'), color: css('--accent'), values: cur.map((d) => d.v), area: true },
      { key: 'prev', label: t('prevPeriod'), color: css('--muted-line'), values: cur.map((_, i) => prevMap[i]?.v ?? null), dashed: true },
    ],
    empty: t('noActualData'),
  };
}
export function appChartSpec(s, app) {
  const prev = s.previous.find((p) => p.id === app.id);
  const ev = s.aso[app.id]?.data?.events || [];
  return {
    label: t('chartLabelApp', { name: app.name }), height: 250, dates: app.dailyTrends.map((d) => d.date),
    series: [
      { key: 'now', label: t('installs'), color: app.color, values: app.dailyTrends.map((d) => d.installs), area: true },
      { key: 'prev', label: t('prevPeriod'), color: css('--muted-line'), values: app.dailyTrends.map((_, i) => prev?.dailyTrends[i]?.installs ?? null), dashed: true },
    ],
    events: ev, empty: app.error ? t('appSourceFailed') : t('noActualData'),
  };
}

// ---------------- detail tabs ----------------
export const DETAIL_TABS = ['overview', 'countries', 'versions', 'storeListing', 'keywords', 'competitors', 'reviews', 'campaigns'];
const TAB_ICON = { overview: 'activity', countries: 'map', versions: 'layers', storeListing: 'eye', keywords: 'tag', competitors: 'users', reviews: 'message-square', campaigns: 'link' };
export function tabBar(s, cls = '') {
  const app = current(s);
  const open = (s.aso[app?.id]?.data?.reviews || []).filter((r) => r.canReply && !r.replyText).length;
  return `<div class="tabbar ${cls}" role="tablist" aria-label="${t('appDetail')}">${DETAIL_TABS.map((k) => `<button role="tab" type="button" id="tab-${k}" aria-selected="${s.detailTab === k}" tabindex="${s.detailTab === k ? 0 : -1}" data-act="tab" data-tab="${k}" data-key="tab-${k}">${icon(TAB_ICON[k])}<span>${t(k)}</span>${k === 'reviews' && open ? `<i class="count">${open}</i>` : ''}</button>`).join('')}<span class="tab-ink" aria-hidden="true"></span></div>`;
}

function asoGate(s, app, body) {
  const a = s.aso[app.id];
  if (a?.error && !a.data) return `<div class="panel"><div class="empty">${icon('alert-triangle')}<h3>${t('err_' + a.error)}</h3><button class="btn" data-act="aso-retry">${icon('refresh-cw')}${t('retry')}</button></div></div>`;
  if (!a?.data) return skeletonPanel(5);
  return body(a.data);
}
export function skeletonPanel(rows = 4, title = true) {
  return `<div class="panel is-skel" aria-busy="true">${title ? `<div class="panel-head">${skel('9em', '1.1em')}</div>` : ''}${Array.from({ length: rows }, (_, i) => `<div class="skel-row">${skel(30 + ((i * 17) % 50) + '%', '0.9em')}${skel('3.5em', '0.9em')}</div>`).join('')}</div>`;
}
const panel = (title, body, { desc = '', action = '', cls = '', key = '' } = {}) =>
  `<section class="panel ${cls}" ${key ? `data-key="${key}"` : ''}><header class="panel-head"><div><h2>${title}</h2>${desc ? `<p>${desc}</p>` : ''}</div>${action ? `<div class="panel-act">${action}</div>` : ''}</header>${body}</section>`;
export { panel };

export function detailBody(s) {
  const app = current(s);
  if (!app) return `<div class="empty">${icon('smartphone')}<h3>${t('firstConnection')}</h3><p>${t('firstConnectionHint')}</p></div>`;
  const tab = s.detailTab;
  const views = { overview: overviewTab, countries: countriesTab, versions: versionsTab, storeListing: listingTab, keywords: keywordsTab, competitors: competitorsTab, reviews: reviewsTab, campaigns: campaignsTab };
  return `<div class="tab-panel" role="tabpanel" aria-labelledby="tab-${tab}" data-key="tp-${tab}">${views[tab](s, app)}</div>`;
}

function breakdown(s, app, dimension) {
  const d = s.dims[app.id + ':' + dimension + ':' + s.period];
  const title = t(dimension === 'country' ? 'topCountries' : 'versions');
  if (!d || d.loading) return panel(title, `<div class="bars">${Array.from({ length: 5 }, () => `<div class="bar-row">${skel('5em')}<span class="track"><i class="skel-fill"></i></span>${skel('3em')}</div>`).join('')}</div>`, { key: 'bd-' + dimension });
  if (d.error || !d.rows?.length) return panel(title, `<p class="muted">${t('noActualData')}</p>`, { key: 'bd-' + dimension });
  const total = d.rows.reduce((x, r) => x + r.totalInstalls, 0) || 1;
  return panel(title, `<div class="bars">${d.rows.slice(0, 10).map((r, i) => `<div class="bar-row" data-key="br-${esc(r.label)}"><span class="lbl">${dimension === 'country' ? esc(region(r.label)) : 'v' + esc(r.label)}</span><span class="track"><i style="--w:${((r.totalInstalls / total) * 100).toFixed(1)}%;--d:${i * 40}ms"></i></span><b class="tnum">${num(r.totalInstalls)}</b><small>${num((r.totalInstalls / total) * 100, 1)}%</small></div>`).join('')}</div>`, { key: 'bd-' + dimension });
}

function eventsPanel(s, app) {
  const ev = s.aso[app.id]?.data?.events;
  const list = ev ? [...ev].reverse() : null;
  return panel(t('eventsTitle'), `
    <form class="row-form" data-form="event"><input type="date" name="date" required value="${LAST}" aria-label="${t('date')}"><input name="label" required maxlength="80" placeholder="${t('eventLabel')}" aria-label="${t('eventLabel')}"><button class="btn primary" ${busy(s, 'event') ? 'disabled' : ''}>${icon('plus')}${t('addEvent')}</button></form>
    ${!list ? skel('100%', '4em') : list.length ? `<ul class="event-list">${list.slice(0, 8).map((e) => `<li data-key="ev-${e.id}" class="${e.pending ? 'is-pending' : ''}"><time>${date(e.date)}</time><span class="etype ${e.type}">${t('eventType_' + e.type)}</span><span class="elabel">${esc(e.label)}</span>${e.source === 'manual' && !e.pending ? `<button class="icon-btn" data-act="del-event" data-id="${e.id}" aria-label="${t('delete')} ${esc(e.label)}">${icon('trash-2')}</button>` : ''}</li>`).join('')}</ul>` : `<p class="muted">${t('noEvents')}</p>`}`, { desc: t('eventsHint'), key: 'events' });
}

function overviewTab(s, app) {
  return `
    ${panel(t('trend'), `<div class="chart" data-chart="app" data-static></div>`, { desc: t('reportDate') + ': ' + date(app.lastDate, { day: '2-digit', month: 'short', year: 'numeric' }), key: 'app-chart' })}
    <div class="grid-2">${breakdown(s, app, 'country')}${panel(t('dataCoverage'), `
      <dl class="coverage"><div><dt>${t('activeDevices')}</dt><dd>${app.activeDevices == null ? '—' : num(app.activeDevices)}</dd><small>${app.activeDevices == null ? t('unsupported') : t('sourceStore')}</small></div>
      <div><dt>${t('retention')}</dt><dd>—</dd><small>${t('retentionUnavailable')}</small></div>
      <div><dt>${t('ratingsCount')}</dt><dd>${num(app.ratings)}</dd><small>${t('publicListing')}</small></div></dl>
      <p class="fine">${t('dataCoverageText')}</p>`, { key: 'coverage' })}</div>
    ${eventsPanel(s, app)}`;
}

function countriesTab(s, app) {
  const k = app.id + ':' + s.period, c = s.country[k];
  let table;
  if (!c || c.loading) table = `<div class="table-skel">${Array.from({ length: 6 }, () => `<div class="skel-row">${skel('8em')}${skel('4em')}${skel('3em')}${skel('4em')}</div>`).join('')}</div>`;
  else if (c.error || !c.rows?.length) table = `<p class="muted">${t('countryRevenueEmpty')}</p>`;
  else {
    const rows = c.rows.map((r) => { const u = usdTotal([{ platform: 'apple', revenueByCurrency: r.revenueByCurrency }], s.exchange); return { ...r, usd: u.total, per: r.installs ? (u.total || 0) / r.installs : null }; }).sort((a, b) => (b.usd || 0) - (a.usd || 0));
    const tot = rows.reduce((x, r) => x + r.installs, 0), best = Math.max(0.0001, ...rows.map((r) => r.per || 0));
    table = `<div class="table-wrap"><table class="data"><thead><tr><th>${t('colCountry')}</th><th class="n">${t('installs')}</th><th class="n">${t('colShare')}</th><th class="n">${t('colRevenueUsd')}</th><th class="n">${t('colRpi')}</th></tr></thead><tbody>
      ${rows.map((r) => `<tr data-key="cr-${r.country}"><td><span class="cc">${r.country}</span>${esc(region(r.country))}</td><td class="n">${num(r.installs)}</td><td class="n">${tot ? num((r.installs / tot) * 100, 1) + '%' : '—'}</td><td class="n">${r.usd ? num(r.usd, 2) : '—'}</td><td class="n per">${r.per != null ? num(r.per, 3) : '—'}${r.per ? `<i style="--w:${Math.max(4, (r.per / best) * 100)}%"></i>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
  }
  return breakdown(s, app, 'country') + panel(t('countryRevenueTitle'), table, { desc: t('countryRevenueNote'), key: 'country-rev' });
}

function versionsTab(s, app) {
  const impact = versionImpact(app.id);
  const body = impact.length ? `<ol class="impact">${impact.map((v) => `<li data-key="vi-${v.id}">
      <div class="v-head"><b>${esc(v.label)}</b><time>${date(v.date, { day: '2-digit', month: 'short', year: 'numeric' })}</time>${v.days < 7 ? `<span class="pill soft">${t('impactPartial', { n: v.days })}</span>` : ''}</div>
      <div class="v-stats"><div><small>${t('impactInstalls')}</small>${changeChip(v.change)}<span class="fine">${num(v.before, 0)} → ${v.after == null ? '—' : num(v.after, 0)} ${t('perDay')}</span></div>
      <div><small>${t('impactRpi')}</small>${changeChip(v.rpiChange)}</div>
      <div><small>${t('impactReviews')}</small><b class="tnum">${v.reviews}</b>${v.low ? `<span class="pill neg">${t('impactLow', { n: v.low })}</span>` : ''}</div></div></li>`).join('')}</ol>` : `<p class="muted">${t('impactEmpty')}</p>`;
  return panel(t('versionImpact') + ` <span class="badge-new">${t('new')}</span>`, body, { desc: t('versionImpactHint'), key: 'impact' }) + breakdown(s, app, 'app_version');
}

function listingTab(s, app) {
  return asoGate(s, app, (d) => `<div class="grid-2 listing">
    ${panel(t('listingSnapshot'), `<div class="listing-id">${appMark(app, 'lg')}<div><b>${esc(app.name)}</b><small>${storeName(app.platform)} · ${esc(app.store)}</small></div><span class="pill soft">${t('publicOnly')}</span></div>
      ${[['titleField', d.listing?.title, 30], ['subtitleField', d.listing?.subtitle, app.platform === 'apple' ? 30 : 80], ['description', d.listing?.description, 4000]].map(([k, v, lim]) => `<div class="field-read"><span>${t(k)}<small class="tnum">${(v || '').length}/${lim}</small></span><p>${esc(v) || t('notAvailable')}</p></div>`).join('')}`, { key: 'listing' })}
    ${panel(t('listingAudit'), `${d.aiResult || s.aiResult?.[app.id] ? (() => { const r = s.aiResult?.[app.id] || d.aiResult; return `<div class="ai-result"><p>${esc(r.summary)}</p><ul>${(r.recommendations || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${(r.candidates || []).length ? `<div class="candidates">${r.candidates.map((c) => `<button class="chip" data-act="copy" data-text="${esc(c)}">${icon('copy')}${esc(c)}</button>`).join('')}</div>` : ''}</div>`; })() : `<p class="muted">${t('noAiYet')}</p>`}
      <button class="btn primary" data-act="ai">${icon('sparkles')}${t('previewAI')}</button><p class="fine">${t('aiPrivacy')}</p>`, { key: 'audit' })}</div>`);
}

const MARKETS = ['us', 'vn', 'gb', 'jp', 'kr', 'de', 'fr'];
function keywordsTab(s, app) {
  return asoGate(s, app, (d) => {
    const c = s.rankCountry;
    const rows = d.keywords.map((k) => {
      const r = d.ranks.find((x) => x.keywordId === k.id && x.country === c);
      const h = d.rankHistory.find((x) => x.keywordId === k.id && x.country === c);
      const pts = h?.points || [];
      const delta = pts.length > 7 && pts.at(-1).rank && pts.at(-8).rank ? pts.at(-8).rank - pts.at(-1).rank : null;
      return `<tr data-key="kw-${esc(k.id)}" class="${k.pending ? 'is-pending' : ''}"><td><b>${esc(k.term)}</b></td>
        <td class="n rank">${busy(s, 'ranks') ? skel('2em') : r?.rank != null ? `<b class="tnum">#${r.rank}</b>` : r ? `<span class="muted">${t('rankNotFound', { n: r.top_n })}</span>` : '—'}</td>
        <td class="n">${delta == null ? '<span class="na">—</span>' : `<span class="chg ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}">${delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} ${Math.abs(delta)}</span>`}</td>
        <td class="spark-cell">${pts.length ? sparkline(pts.map((p) => (p.rank ? 101 - p.rank : null)), { w: 96, h: 26, color: app.color, max: 100 }) : ''}</td>
        <td class="muted">${r ? date(r.checked_at) : '—'}</td>
        <td>${k.pending ? icon('loader', 'spin') : `<button class="icon-btn" data-act="del-kw" data-id="${esc(k.id)}" aria-label="${t('delete')} ${esc(k.term)}">${icon('trash-2')}</button>`}</td></tr>`;
    }).join('');
    const histOpts = d.rankHistory.filter((h) => h.country === c);
    const pick = histOpts.find((h) => h.keywordId === s.rankPick) || histOpts[0];
    return panel(t('keywords'), `
      <div class="toolbar-row"><label class="field inline"><span>${t('rankMarket')}</span><select data-bind="rankCountry">${MARKETS.map((m) => `<option value="${m}" ${m === c ? 'selected' : ''}>${esc(region(m))}</option>`).join('')}</select></label>
      <form class="row-form grow" data-form="keyword"><input name="term" required maxlength="80" placeholder="${t('keywordPlaceholder')}" aria-label="${t('keyword')}"><button class="btn">${icon('plus')}${t('addKeyword')}</button></form></div>
      ${d.keywords.length ? `<div class="table-wrap"><table class="data kw"><thead><tr><th>${t('keyword')}</th><th class="n">${t('rank')}</th><th class="n">${t('rank7d')}</th><th>${t('trend30')}</th><th>${t('checked')}</th><th><span class="sr">${t('actions')}</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty sm">${icon('tag')}<p>${t('noKeywords')}</p></div>`}
      <p class="fine">${t('rankSourceHelp')}</p>`,
      { action: `<button class="btn" data-act="ranks" ${busy(s, 'ranks') || !d.keywords.length ? 'disabled' : ''}>${busy(s, 'ranks') ? icon('loader', 'spin') + t('checking') : icon('refresh-cw') + t('checkRanks')}</button>`, key: 'kw' }) +
      panel(t('rankHistory'), pick ? `<div class="chart" data-chart="rank" data-static></div>` : `<p class="muted">${t('rankHistoryEmpty')}</p>`,
        { desc: t('rankHistoryHint'), action: histOpts.length ? `<select data-bind="rankPick" aria-label="${t('chooseKeyword')}">${histOpts.map((h) => `<option value="${esc(h.keywordId)}" ${h === pick ? 'selected' : ''}>${esc(h.term)}</option>`).join('')}</select>` : '', key: 'rank-hist' });
  });
}
export function rankChartSpec(s, app) {
  const d = s.aso[app.id]?.data; if (!d) return null;
  const opts = d.rankHistory.filter((h) => h.country === s.rankCountry);
  const h = opts.find((x) => x.keywordId === s.rankPick) || opts[0]; if (!h) return null;
  return { label: t('rankHistory'), height: 200, reverse: true, min: 1, max: 100, dates: h.points.map((p) => p.date), series: [{ key: 'r', label: t('rank'), color: app.color, values: h.points.map((p) => p.rank) }], events: d.events, format: (v) => '#' + Math.round(v) };
}

function competitorsTab(s, app) {
  return asoGate(s, app, (d) => panel(t('competitors'), `
    <form class="row-form" data-form="competitors"><input name="term" required maxlength="100" placeholder="${t('searchTerm')}" aria-label="${t('searchTerm')}"><button class="btn primary" ${busy(s, 'comp-search') ? 'disabled' : ''}>${busy(s, 'comp-search') ? icon('loader', 'spin') : icon('search')}${t('findCompetitors')}</button></form>
    <ul class="comp-list">${[...d.competitors, ...s.searchCompetitors.filter((c) => !d.competitors.some((x) => x.title === c.title))].map((c) => `<li data-key="cp-${esc(c.id)}" class="${c.competitor_key ? 'tracked' : 'found'}"><span class="comp-mark">${esc(c.title[0])}</span><b>${esc(c.title)}</b><span class="muted">★ ${num(c.score, 1)}</span>${c.competitor_key ? `<span class="pill soft">${icon('check')}${t('tracked')}</span>` : `<button class="btn sm" data-act="track" data-id="${esc(c.id)}">${icon('plus')}${t('track')}</button>`}</li>`).join('')}
    ${busy(s, 'comp-search') ? Array.from({ length: 3 }, (_, i) => `<li class="found" data-key="cps-${i}">${skel('2em', '2em', 'round')}${skel('10em')}${skel('3em')}</li>`).join('') : ''}</ul>`, { key: 'comp' }));
}

function reviewsTab(s, app) {
  return asoGate(s, app, (d) => {
    const all = d.reviews;
    const counts = { allReviews: all.length, unanswered: all.filter((r) => !r.replyText).length, answered: all.filter((r) => r.replyText).length };
    const list = all.filter((r) => s.reviewFilter === 'allReviews' || (s.reviewFilter === 'answered' ? !!r.replyText : !r.replyText));
    const open = all.filter((r) => r.canReply && !r.replyText);
    const dist = [5, 4, 3, 2, 1].map((n) => all.filter((r) => r.rating === n).length);
    return `<div class="reviews-layout">
      <aside class="panel review-side" data-key="rv-side"><div class="rating-big"><b>${num(app.rating, 1)}</b><span class="stars" style="--r:${app.rating}" aria-label="${num(app.rating, 1)} / 5"></span><small>${t('ratingsN', { n: num(app.ratings) })}</small></div>
        <div class="dist">${dist.map((c, i) => `<div><span>${5 - i}★</span><span class="track"><i style="--w:${all.length ? (c / all.length) * 100 : 0}%"></i></span><small>${c}</small></div>`).join('')}</div>
        <p class="fine">${t(app.platform === 'google' ? 'googleReviewCoverage' : 'appleReviewCoverage')}</p></aside>
      ${panel(t('reviews'), `
        <div class="toolbar-row"><div class="seg" role="group" aria-label="${t('filter')}">${['allReviews', 'unanswered', 'answered'].map((k) => `<button type="button" aria-pressed="${s.reviewFilter === k}" data-act="rfilter" data-v="${k}">${t(k)}<small>${counts[k]}</small></button>`).join('')}</div>
        <div class="bulk">${s.picked.length ? `<button class="btn ghost sm" data-act="clear-pick">${t('clearSelection')}</button><button class="btn primary sm" data-act="bulk">${icon('send')}${t('bulkReply')} (${s.picked.length})</button>` : `<button class="btn ghost sm" data-act="pick-open" ${open.length ? '' : 'disabled'}>${t('selectUnanswered')}</button>`}</div></div>
        ${d.reviewSourceStatus === 'unavailable' ? `<div class="banner warn">${icon('info')}<span>${t('reviewSourceUnavailable')}</span></div>` : ''}
        ${list.length ? `<ul class="review-list">${list.map((r) => `<li data-key="rv-${esc(r.id)}" class="review ${r.publishing ? 'is-pending' : ''} ${r.replyText ? 'answered' : ''}">
          <div class="r-head">${r.canReply && !r.replyText ? `<input type="checkbox" data-act="pick" data-id="${esc(r.id)}" ${s.picked.includes(r.id) ? 'checked' : ''} aria-label="${t('selectReview', { name: r.author })}">` : '<span class="cb-gap"></span>'}<b>${esc(r.author)}</b><span class="stars sm" style="--r:${r.rating}" aria-label="${r.rating} / 5"></span><span class="pill soft">${esc(r.lang.toUpperCase())}</span><time>${date(r.date)}</time></div>
          <p>${esc(r.text)}</p>
          ${r.replyText ? `<div class="reply"><b>${t('developerReply')}</b><p>${esc(r.replyText)}</p><small>${r.publishing ? icon('loader', 'spin') + t('publishing') : date(r.replyDate) + (r.responseState === 'PENDING_PUBLISH' ? ' · ' + t('pendingPublish') : '')}</small></div>` : ''}
          ${r.canReply && !r.publishing ? `<button class="btn sm ${r.replyText ? 'ghost' : ''}" data-act="reply" data-id="${esc(r.id)}">${icon('pencil')}${t(r.replyText ? 'editReply' : 'replyReview')}</button>` : !r.canReply ? `<small class="fine">${t('readOnlyReview')}</small>` : ''}
        </li>`).join('')}</ul>` : `<div class="empty sm">${icon('inbox')}<p>${t(all.length ? 'noFilteredReviews' : 'noReviews')}</p></div>`}`,
        { action: `<button class="btn" data-act="refresh-reviews" ${busy(s, 'reviews') ? 'disabled' : ''}>${busy(s, 'reviews') ? icon('loader', 'spin') : icon('refresh-cw')}${t('refreshReviews')}</button>`, key: 'rv-main' })}</div>`;
  });
}

function campaignsTab(s, app) {
  return asoGate(s, app, (d) => panel(t('campaigns'), `
    <form class="row-form" data-form="campaign"><input name="name" required maxlength="100" placeholder="${t('campaignName')}" aria-label="${t('campaignName')}"><input name="source" required maxlength="100" placeholder="${t('campaignSource')}" aria-label="${t('campaignSource')}"><button class="btn primary" ${busy(s, 'campaign') ? 'disabled' : ''}>${icon('link')}${t('createCampaign')}</button></form>
    ${d.campaigns.length ? `<ul class="camp-list">${d.campaigns.map((c) => `<li data-key="cm-${c.id}" class="${c.pending ? 'is-pending' : ''}"><div><b>${esc(c.name)}</b><small>${esc(c.source)}</small></div><code>${esc(c.universal_url || '…')}</code><span class="tnum clicks"><b>${num(c.clicks)}</b> ${t('clicks')}</span>
      <span class="row-acts">${c.pending ? icon('loader', 'spin') : `<button class="icon-btn" data-act="copy" data-text="${esc(c.universal_url)}" aria-label="${t('copyLink')}">${icon('copy')}</button><button class="icon-btn" data-act="del-camp" data-id="${c.id}" aria-label="${t('delete')} ${esc(c.name)}">${icon('trash-2')}</button>`}</span></li>`).join('')}</ul>` : `<div class="empty sm">${icon('link')}<p>${t('noCampaigns')}</p></div>`}
    <p class="fine">${t('campaignHint')}</p>`, { key: 'camp' }));
}

// ---------------- settings ----------------
export function settingsBody(s) {
  const st = s.settings, ig = s.integrations;
  const conn = (key, label, hint) => `<div class="conn" data-key="conn-${key}"><span class="conn-ic ${key}">${icon(key === 'apple' ? 'apple' : key === 'google' ? 'play' : 'sparkles')}</span><div><b>${label}</b><p>${hint}</p></div>
    <span class="status ${ig ? (ig[key]?.configured || ig[key]?.providers?.some((p) => p.available) ? 'ok' : 'off') : ''}">${ig ? t(ig[key]?.configured || ig[key]?.providers?.some((p) => p.available) ? 'connected' : 'notConfigured') : skel('5em')}</span>
    ${key !== 'ai' ? `<button class="btn sm" data-act="test-conn" data-k="${key}" ${!ig?.[key]?.configured || busy(s, 'conn-' + key) ? 'disabled' : ''}>${busy(s, 'conn-' + key) ? icon('loader', 'spin') + t('checking') : t('checkConnection')}</button>` : ''}</div>`;
  return `<div class="settings">
    ${panel(t('connections'), `<p class="secure">${icon('lock')}${t('serverOnly')}</p>
      ${conn('google', 'Google Play', t('googleStatusHint'))}${conn('apple', 'App Store Connect', t('appleStatusHint'))}${conn('ai', ig?.ai?.defaultProvider || 'AI', t('aiPrivacy'))}
      <details class="help"><summary>${t('setupHelp')}</summary><p>${t('settingsReadOnly')}</p><code>GOOGLE_SERVICE_ACCOUNT_JSON<br>GOOGLE_BUCKET_NAME<br>APPLE_PRIVATE_KEY · APPLE_ISSUER_ID<br>APPLE_KEY_ID · APPLE_VENDOR_ID<br>OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY</code></details>
      <h3>${t('addGoogleApp')}</h3><p class="fine">${t('newAppHelp')}</p>
      <form class="row-form" data-form="package"><input name="pkg" required maxlength="200" placeholder="com.example.app" aria-label="${t('packageName')}" spellcheck="false"><button class="btn" ${busy(s, 'pkg') ? 'disabled' : ''}>${busy(s, 'pkg') ? icon('loader', 'spin') : icon('plus')}${t('add')}</button></form>
      <ul class="pkg-list">${(st?.googlePackages || []).map((p) => `<li data-key="pk-${esc(p)}"><code>${esc(p)}</code><button class="icon-btn" data-act="del-pkg" data-v="${esc(p)}" aria-label="${t('remove')} ${esc(p)}">${icon('trash-2')}</button></li>`).join('')}</ul>`, { key: 'set-conn' })}
    ${panel(t('preferences'), !st ? skeletonPanel(6, false) : `
      <div class="pref"><span>${t('theme')}</span><div class="seg" role="group" aria-label="${t('theme')}">${[['light', 'sun'], ['dark', 'moon'], ['system', 'monitor']].map(([k, ic]) => `<button type="button" aria-pressed="${s.theme === k}" data-act="theme" data-v="${k}">${icon(ic)}${t(k)}</button>`).join('')}</div></div>
      <div class="pref"><span>${t('language')}</span><div class="seg" role="group" aria-label="${t('language')}">${[['vi', 'Tiếng Việt'], ['en', 'English']].map(([k, l]) => `<button type="button" aria-pressed="${s.lang === k}" data-act="lang" data-v="${k}">${l}</button>`).join('')}</div></div>
      <form data-form="settings" class="set-form">
        <label class="field"><span>${t('schedule')}</span><select name="frequency">${[1, 3, 6, 12, 24].map((v) => `<option value="${v}" ${st.refreshIntervalHours === v ? 'selected' : ''}>${t('everyHours', { n: v })}</option>`).join('')}</select><small>${t('frequencyHint')}</small></label>
        <div class="field"><span>${t('timezone')}</span><b>${esc(st.timezone)}</b></div>
        <label class="switch-row"><div><b>${t('optionalNotifications')}</b><p>${t('notificationTargets')}</p></div><input type="checkbox" role="switch" name="notifications" class="switch" ${st.notificationsEnabled ? 'checked' : ''}></label>
        <h3>${t('digestSection')}</h3>
        <div class="grid-4">
          <label class="field"><span>${t('digestMode')}</span><select name="digest">${['off', 'daily', 'weekly'].map((v) => `<option value="${v}" ${st.digest === v ? 'selected' : ''}>${t('digest_' + v)}</option>`).join('')}</select></label>
          <label class="field"><span>${t('digestHour')}</span><select name="digestHour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${st.digestHour === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>
          <label class="field"><span>${t('digestLocale')}</span><select name="digestLocale"><option value="vi" ${st.digestLocale === 'vi' ? 'selected' : ''}>Tiếng Việt</option><option value="en" ${st.digestLocale === 'en' ? 'selected' : ''}>English</option></select></label>
          <label class="field"><span>${t('anomalyThreshold')}</span><input type="number" name="anomalyThreshold" min="10" max="90" value="${st.anomalyThreshold}"></label>
        </div>
        <small class="fine">${t('digestHint')}</small>
        <div class="btn-row"><button type="button" class="btn" data-act="digest-preview" ${busy(s, 'digest') ? 'disabled' : ''}>${busy(s, 'digest') ? icon('loader', 'spin') : icon('eye')}${t('digestPreview')}</button>
          ${st.notificationsEnabled && ig?.notifications?.configured ? `<button type="button" class="btn" data-act="digest-send">${icon('send')}${t('digestSend')}</button><button type="button" class="btn" data-act="notif-test">${icon('bell')}${t('notificationTest')}</button>` : ''}</div>
        ${s.digestPreview ? `<pre class="digest">${esc(s.digestPreview)}</pre>` : ''}
        <div class="btn-row end"><button class="btn primary" ${busy(s, 'settings') ? 'disabled' : ''}>${busy(s, 'settings') ? icon('loader', 'spin') + t('saving') : icon('check') + t('save')}</button></div>
      </form>`, { key: 'set-pref', action: `<button class="btn ghost sm" data-act="notifications">${icon('bell')}${t('notifications')}</button>` })}
  </div>`;
}

// ---------------- dialogs ----------------
export function modalLayer(s) {
  const m = s.modal; if (!m) return '';
  const app = s.apps.find((a) => a.id === m.appId) || current(s);
  let title = '', body = '';
  if (m.type === 'ai') {
    title = t('aiTitle');
    body = `<p class="intro">${t('aiLiveHint')}</p>
      <label class="field"><span>${t('aiKind')}</span><select data-bind="modal.kind">${['audit', 'variants', 'reviews', 'ask'].map((k) => `<option value="${k}" ${m.kind === k ? 'selected' : ''}>${t('ai_' + k)}</option>`).join('')}</select></label>
      <label class="field"><span>${t('aiQuestion')}</span><textarea rows="2" maxlength="1000" data-bind="modal.question" data-value="${esc(m.question)}">${esc(m.question)}</textarea></label>
      <label class="check"><input type="checkbox" data-bind="modal.metrics" ${m.metrics ? 'checked' : ''}><span>${t('aiPrivate')}<small>${t('aiPrivateHint')}</small></span></label>
      <button class="btn" data-act="ai-preview" ${busy(s, 'ai-preview') ? 'disabled' : ''}>${busy(s, 'ai-preview') ? icon('loader', 'spin') : icon('eye')}${t('buildPreview')}</button>
      ${m.preview ? `<p class="note">${icon('lock')}${t('aiDestination', m.preview.destination)}</p><pre class="payload">${esc(JSON.stringify(m.preview.payload, null, 2))}</pre>
        <label class="check"><input type="checkbox" data-bind="modal.confirmed" ${m.confirmed ? 'checked' : ''}><span>${t('aiConsent')}</span></label>` : ''}`;
    body += `<footer class="m-foot"><button class="btn ghost" data-act="close">${t('cancel')}</button><button class="btn primary" data-act="ai-run" ${!m.preview || !m.confirmed || busy(s, 'ai-run') ? 'disabled' : ''}>${busy(s, 'ai-run') ? icon('loader', 'spin') + t('aiRunning') : icon('sparkles') + t('runAI')}</button></footer>`;
  } else if (m.type === 'reply') {
    const r = s.aso[app.id]?.data?.reviews.find((x) => x.id === m.reviewId);
    const limit = app.platform === 'google' ? 350 : 5970;
    title = t('replyReview');
    body = `<p class="intro">${esc(app.name)} · ${storeName(app.platform)}</p><blockquote><b>${esc(r?.author)}</b> <span class="stars sm" style="--r:${r?.rating}"></span><br>${esc(r?.text)}</blockquote>
      ${templatePicker(s)}
      <label class="field"><span>${t('replyBody')}</span><textarea rows="5" maxlength="${limit}" data-bind="modal.text" data-value="${esc(m.text)}" class="${m.generating ? 'is-generating' : ''}">${esc(m.text)}</textarea><small class="count ${m.text.length > limit ? 'over' : ''}">${m.text.length} / ${limit}</small></label>
      <button class="btn" data-act="ai-draft" ${m.generating ? 'disabled' : ''}>${m.generating ? icon('loader', 'spin') + t('generatingAI') : icon('sparkles') + t('generateAI')}</button>
      <p class="note">${icon('info')}${t('replyPublishHint')}</p>
      <label class="check"><input type="checkbox" data-bind="modal.confirmed" ${m.confirmed ? 'checked' : ''}><span>${t('confirmPublicReply')}</span></label>
      <footer class="m-foot"><button class="btn ghost" data-act="close">${t('cancel')}</button><button class="btn primary" data-act="publish" ${!m.confirmed || !m.text.trim() || m.text.length > limit ? 'disabled' : ''}>${icon('send')}${t('publishReply')}</button></footer>`;
  } else if (m.type === 'bulk') {
    const reviews = (s.aso[app.id]?.data?.reviews || []).filter((r) => s.picked.includes(r.id));
    const limit = app.platform === 'google' ? 350 : 5970;
    const items = reviews.map((r) => ({ r, text: fill(m.body, r, app) }));
    const tooLong = items.some((i) => i.text.length > limit);
    title = t('bulkReply');
    if (m.results) {
      const failed = m.results.filter((x) => !x.ok).length;
      body = `<div class="result ${failed ? 'warn' : 'ok'}">${icon(failed ? 'alert-triangle' : 'check-circle-2')}<b>${t('bulkResult', { ok: m.results.length - failed, total: m.results.length })}</b>${failed ? `<p>${t('bulkFailed', { n: failed })}</p>` : ''}</div><footer class="m-foot"><button class="btn primary" data-act="close-bulk">${t('close')}</button></footer>`;
    } else {
      body = `<p class="intro">${esc(app.name)} · ${t('selectedN', { n: reviews.length })}</p>${templatePicker(s, true)}
        <label class="field"><span>${t('replyBody')}</span><textarea rows="4" maxlength="${limit}" data-bind="modal.body" data-value="${esc(m.body)}">${esc(m.body)}</textarea></label>
        <p class="fine">${t('templateVars')}</p>
        <div class="row-form"><input data-bind="modal.tplName" value="${esc(m.tplName || '')}" maxlength="60" placeholder="${t('templateName')}" aria-label="${t('templateName')}"><button class="btn sm" data-act="save-tpl" ${!m.tplName?.trim() || !m.body.trim() ? 'disabled' : ''}>${t('saveTemplate')}</button>${(s.templates || []).find((x) => x.name === m.tplName) ? `<button class="icon-btn" data-act="del-tpl" aria-label="${t('deleteTemplate')}">${icon('trash-2')}</button>` : ''}</div>
        ${m.body.trim() ? `<div class="bulk-preview"><h3>${t('bulkPreview')}</h3>${items.map(({ r, text }) => `<article data-key="bp-${esc(r.id)}"><b>${esc(r.author)}</b><span class="stars sm" style="--r:${r.rating}"></span><p>${esc(text)}</p></article>`).join('')}</div>` : ''}
        ${tooLong ? `<p class="note err">${t('bulkTooLong', { n: limit })}</p>` : ''}
        <p class="note">${icon('info')}${t('replyPublishHint')}</p>
        <label class="check"><input type="checkbox" data-bind="modal.confirmed" ${m.confirmed ? 'checked' : ''}><span>${t('bulkConfirm', { n: reviews.length })}</span></label>
        <footer class="m-foot"><button class="btn ghost" data-act="close">${t('cancel')}</button><button class="btn primary" data-act="bulk-publish" ${!m.confirmed || !m.body.trim() || tooLong || busy(s, 'bulk') ? 'disabled' : ''}>${busy(s, 'bulk') ? icon('loader', 'spin') + t('saving') : icon('send') + t('bulkPublish', { n: reviews.length })}</button></footer>`;
    }
  } else if (m.type === 'notifications') {
    title = t('notifications');
    body = `${s.notifications.length ? `<ul class="notif">${s.notifications.map((n) => `<li data-key="nt-${n.id}" class="${n.read ? '' : 'unread'}"><b>${esc(n.title)}</b><p>${esc(n.message)}</p><time>${date(n.timestamp, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></li>`).join('')}</ul>` : `<p class="muted">${t('noNotifications')}</p>`}
      <footer class="m-foot"><button class="btn" data-act="read-notifs" ${s.notifications.every((n) => n.read) ? 'disabled' : ''}>${icon('check')}${t('readNotifications')}</button></footer>`;
  }
  return `<div class="modal-layer" data-key="modal-${m.type}"><div class="scrim" data-act="close"></div><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title"><header><h2 id="m-title">${title}</h2><button class="icon-btn" data-act="close" aria-label="${t('close')}">${icon('x')}</button></header><div class="m-body">${body}</div></div></div>`;
}
function templatePicker(s, bulk) {
  const list = s.templates || [];
  return `<label class="field"><span>${t('templateLabel')}</span><select data-act-change="tpl" ${list.length ? '' : 'disabled'} data-bulk="${bulk ? 1 : 0}"><option value="">${list.length ? t('noTemplate') : t('noTemplates')}</option>${list.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>`;
}
const fill = (body, r, app) => body.replace(/\{name\}/g, r.author || t('reviewerFallback')).replace(/\{rating\}/g, r.rating).replace(/\{app\}/g, app.name).trim();

// ---------------- login ----------------
export function loginView(s, brand) {
  return `<main class="login" data-key="login"><form class="login-card" data-form="login">${brand}<h1>${t('loginTitle')}</h1><p>${t('loginHint')}</p>
    <label class="field"><span>${t('password')}</span><input type="password" name="password" required autocomplete="current-password" maxlength="256" autofocus></label>
    ${s.loginError ? `<p class="note err" role="alert">${t('err_' + s.loginError)}</p>` : ''}
    <button class="btn primary lg" ${busy(s, 'login') ? 'disabled' : ''}>${busy(s, 'login') ? icon('loader', 'spin') : icon('arrow-right')}${t('login')}</button>
    <p class="fine">${t('demoPassword')}</p>
    <button type="button" class="btn ghost sm" data-act="lang" data-v="${s.lang === 'vi' ? 'en' : 'vi'}">${icon('globe')}${s.lang === 'vi' ? 'English' : 'Tiếng Việt'}</button></form></main>`;
}

// ---------------- prototype control panel ----------------
export function simPanel(s) {
  return `<div class="sim ${s.simOpen ? 'open' : ''}" data-key="sim"><button class="sim-toggle" data-act="sim-toggle" aria-expanded="${s.simOpen}">${icon('sliders-horizontal')}<span>${t('simTitle')}</span></button>
    ${s.simOpen ? `<div class="sim-body"><p class="fine">${t('simHint')}</p>
      <div class="pref"><span>${t('simSpeed')}</span><div class="seg sm">${['fast', 'normal', 'slow'].map((k) => `<button type="button" aria-pressed="${sim.speed === k}" data-act="sim-speed" data-v="${k}">${t('speed_' + k)}</button>`).join('')}</div></div>
      <div class="pref"><span>${t('simScenario')}</span><div class="seg sm">${['normal', 'empty', 'error', 'stale'].map((k) => `<button type="button" aria-pressed="${sim.scenario === k}" data-act="sim-scenario" data-v="${k}">${t('scn_' + k)}</button>`).join('')}</div></div>
      <label class="check"><input type="checkbox" data-act-change="sim-fail" ${sim.fail ? 'checked' : ''}><span>${t('simFail')}</span></label>
      <button class="btn sm ghost" data-act="sim-reset">${icon('undo-2')}${t('simReset')}</button></div>` : ''}</div>`;
}

// ---------------- export ----------------
function csvCell(v) { const x = v == null ? '' : String(v); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }
export function exportCSV(s) {
  const list = filtered(s);
  const head = ['app', 'platform', 'package', 'installs', 'change_pct', 'rating', 'revenue_usd_estimate', 'revenue_basis', 'last_report'];
  const rows = list.map((a) => [a.name, a.platform, a.store, a.installs, growthOf(a, s.previous)?.toFixed(2), a.rating, usdTotal([a], s.exchange).total?.toFixed(2), a.platform === 'apple' ? 'apple_proceeds' : 'google_charged', a.lastDate]);
  download('apprankly-' + s.range.startDate + '_' + s.range.endDate + '.csv', [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
  toast(t('dataExported'));
}
export function exportJSON(s) {
  download('apprankly.json', JSON.stringify({ range: s.range, apps: filtered(s), exchangeRates: s.exchange }, null, 2));
  toast(t('dataExported'));
}

// ---------------- after render ----------------
let lastModal = null, opener = null;
export function afterRender(root, s) {
  tween(root);
  enter(root);
  const app = current(s);
  root.querySelectorAll('[data-chart]').forEach((el) => {
    const kind = el.dataset.chart;
    let spec = null;
    if (kind === 'portfolio') spec = portfolioChartSpec(s, s._chartList || filtered(s));
    else if (kind === 'app' && app) spec = appChartSpec(s, app);
    else if (kind === 'rank' && app) spec = rankChartSpec(s, app);
    else if (kind.startsWith('app:')) { const a = s.apps.find((x) => x.id === kind.slice(4)); if (a) spec = appChartSpec(s, a); }
    if (spec) drawChart(el, spec);
  });
  // Tab ink follows the active tab.
  root.querySelectorAll('.tabbar').forEach((bar) => {
    const on = bar.querySelector('[aria-selected="true"]'), ink = bar.querySelector('.tab-ink');
    if (on && ink) { ink.style.width = on.offsetWidth + 'px'; ink.style.transform = `translateX(${on.offsetLeft}px)`; }
  });
  const key = s.modal ? s.modal.type : null;
  if (key && key !== lastModal) {
    opener = document.activeElement;
    const m = root.querySelector('.modal');
    requestAnimationFrame(() => (m?.querySelector('select,textarea,input,button:not([data-act="close"])') || m)?.focus());
  } else if (!key && lastModal && opener?.isConnected) opener.focus();
  lastModal = key;
}

// ---------------- events ----------------
export function setTheme(store, v) { writePref('apprankly-v2-theme', v); store.set({ theme: v }); applyTheme(v); }
export function setLangAll(store, v) { writePref('apprankly-v2-lang', v); applyLang(v); store.set({ lang: v }); }

function findReview(s, appId, id) { return s.aso[appId]?.data?.reviews.find((r) => r.id === id); }
function patchASO(store, appId, fn) {
  const s = store.state, cur = s.aso[appId]; if (!cur?.data) return;
  const data = { ...cur.data }; fn(data);
  store.set({ aso: { ...s.aso, [appId]: { ...cur, data } } });
}

// Shared actions; returns true when handled. ctx.go(page) is provided by each shell.
export async function handleAction(store, act, el, ev, ctx) {
  const s = store.state, app = current(s);
  const id = el.dataset.id;
  switch (act) {
    case 'tab': {
      const tab = el.dataset.tab;
      if (tab === s.detailTab) return true;
      const order = DETAIL_TABS.indexOf(tab) > DETAIL_TABS.indexOf(s.detailTab) ? 'fwd' : 'back';
      vt(() => { store.set({ detailTab: tab }); store.now(); }, 'tab-' + order);
      ensureDetail(store);
      return true;
    }
    case 'retry': store.set({ loadError: null }); loadPortfolio(store, { force: true }); return true;
    case 'aso-retry': loadASO(store, app.id, { force: true }); return true;
    case 'sync': sync(store); return true;
    case 'export-csv': exportCSV(s); return true;
    case 'export-json': exportJSON(s); return true;
    case 'theme': setTheme(store, el.dataset.v); return true;
    case 'lang': setLangAll(store, el.dataset.v); return true;
    case 'notifications': store.set({ modal: { type: 'notifications' } }); return true;
    case 'close': store.set({ modal: null }); return true;
    case 'close-bulk': store.set({ modal: null, picked: [] }); loadASO(store, app.id, { force: true }); return true;
    case 'read-notifs': await run(store, 'notifs', () => api.readNotifications()).catch(() => {}); store.set({ notifications: store.state.notifications.map((n) => ({ ...n, read: true })) }); return true;
    case 'logout': await run(store, 'logout', () => api.logout()); store.set({ auth: false, apps: [], previous: [] }); return true;
    case 'copy': navigator.clipboard?.writeText(el.dataset.text).catch(() => {}); toast(t('copied')); return true;

    // keywords — optimistic add, undoable delete
    case 'del-kw': {
      const d = s.aso[app.id].data, k = d.keywords.find((x) => x.id === id), ranks = d.ranks.filter((r) => r.keywordId === id);
      patchASO(store, app.id, (x) => { x.keywords = x.keywords.filter((y) => y.id !== id); });
      api.deleteKeyword(id).then(() => {
        toast(t('keywordDeleted', { term: k.term }), { undoLabel: t('undo'), undo: () => { patchASO(store, app.id, (x) => { x.keywords = [...x.keywords, k]; }); api.restoreKeyword(k, ranks.map((r) => ({ ...r, history: [] }))).then(() => loadASO(store, app.id, { force: true })); } });
      }).catch((e) => { patchASO(store, app.id, (x) => { x.keywords = [...x.keywords, k]; }); toast(errText(e), { tone: 'err' }); });
      return true;
    }
    case 'ranks': await run(store, 'ranks', () => api.checkRanks(app.id, s.rankCountry), { ok: 'ranksChecked' }).catch(() => {}); await loadASO(store, app.id, { force: true }); return true;
    case 'track': {
      const c = s.searchCompetitors.find((x) => x.id === id);
      store.set({ searchCompetitors: s.searchCompetitors.map((x) => (x.id === id ? { ...x, competitor_key: 'pending' } : x)) });
      await run(store, 'track', () => api.trackCompetitor(app.id, c), { ok: 'competitorTracked' }).catch(() => {});
      store.set({ searchCompetitors: store.state.searchCompetitors.filter((x) => x.id !== id) });
      await loadASO(store, app.id, { force: true }); return true;
    }
    // reviews
    case 'rfilter': store.set({ reviewFilter: el.dataset.v }); return true;
    case 'pick': store.set({ picked: el.checked ? [...s.picked, id].slice(0, 20) : s.picked.filter((x) => x !== id) }); return true;
    case 'pick-open': store.set({ picked: s.aso[app.id].data.reviews.filter((r) => r.canReply && !r.replyText).slice(0, 20).map((r) => r.id) }); return true;
    case 'clear-pick': store.set({ picked: [] }); return true;
    case 'refresh-reviews': {
      const r = await run(store, 'reviews', () => api.refreshReviews(app.id)).catch(() => null);
      if (r) { const before = s.aso[app.id].data.reviews.length; patchASO(store, app.id, (x) => { x.reviews = r.reviews; }); toast(r.reviews.length > before ? t('newReviews', { n: r.reviews.length - before }) : t('noNewReviews')); }
      return true;
    }
    case 'reply': { loadTemplates(store); const r = findReview(s, app.id, id); store.set({ modal: { type: 'reply', appId: app.id, reviewId: id, text: r.replyText || '', confirmed: false } }); return true; }
    case 'ai-draft': {
      const m = s.modal;
      store.set({ modal: { ...m, generating: true, confirmed: false } });
      try {
        const p = await api.aiPreview({ appId: m.appId, kind: 'reviewReply', reviewId: m.reviewId, locale: s.lang });
        const r = await api.aiRun(p.previewId);
        if (store.state.modal?.reviewId === m.reviewId) typeInto(store, r.result.candidates[0]);
      } catch (e) { toast(errText(e), { tone: 'err' }); store.set({ modal: store.state.modal && { ...store.state.modal, generating: false } }); }
      return true;
    }
    case 'publish': {
      // Optimistic: close the dialog, show the reply as "publishing", roll back on failure.
      const m = s.modal, prev = { ...findReview(s, m.appId, m.reviewId) };
      store.set({ modal: null });
      patchASO(store, m.appId, (x) => { x.reviews = x.reviews.map((r) => (r.id === m.reviewId ? { ...r, replyText: m.text, publishing: true } : r)); });
      api.reply(m.appId, m.reviewId, m.text).then((res) => {
        patchASO(store, m.appId, (x) => { x.reviews = x.reviews.map((r) => (r.id === m.reviewId ? res.review : r)); });
        toast(t('replyPublished'));
      }).catch((e) => {
        patchASO(store, m.appId, (x) => { x.reviews = x.reviews.map((r) => (r.id === m.reviewId ? prev : r)); });
        toast(errText(e), { tone: 'err' });
      });
      return true;
    }
    case 'bulk': loadTemplates(store); store.set({ modal: { type: 'bulk', appId: app.id, body: '', tplName: '', confirmed: false } }); return true;
    case 'bulk-publish': {
      const m = s.modal, reviews = s.aso[app.id].data.reviews.filter((r) => s.picked.includes(r.id));
      const r = await run(store, 'bulk', () => api.bulkReply(app.id, reviews.map((x) => ({ reviewId: x.id, text: fill(m.body, x, app) })))).catch(() => null);
      if (r) store.set({ modal: { ...store.state.modal, results: r.results } });
      return true;
    }
    case 'save-tpl': await run(store, 'tpl', () => api.saveTemplate(s.modal.tplName.trim(), s.modal.body), { ok: 'templateSaved' }).catch(() => {}); loadTemplates(store, true); return true;
    case 'del-tpl': { const tp = s.templates.find((x) => x.name === s.modal.tplName); if (tp) { await api.deleteTemplate(tp.id); loadTemplates(store, true); } return true; }
    // AI
    case 'ai': store.set({ modal: { type: 'ai', appId: app.id, kind: 'audit', question: '', metrics: false, preview: null, confirmed: false } }); return true;
    case 'ai-preview': {
      const m = s.modal;
      const p = await run(store, 'ai-preview', () => api.aiPreview({ appId: m.appId, kind: m.kind, question: m.question, includeMetrics: m.metrics, locale: s.lang, range: rangeFor(s.period) })).catch(() => null);
      if (p && store.state.modal?.type === 'ai') store.set({ modal: { ...store.state.modal, preview: p, confirmed: false } });
      return true;
    }
    case 'ai-run': {
      const m = s.modal;
      const r = await run(store, 'ai-run', () => api.aiRun(m.preview.previewId)).catch(() => null);
      if (r) { store.set({ modal: null, aiResult: { ...(store.state.aiResult || {}), [m.appId]: r.result } }); ctx.openTab?.('storeListing'); toast(t('aiDone')); }
      return true;
    }
    // campaigns / events — optimistic
    case 'del-camp': {
      const c = s.aso[app.id].data.campaigns.find((x) => String(x.id) === id);
      patchASO(store, app.id, (x) => { x.campaigns = x.campaigns.filter((y) => String(y.id) !== id); });
      api.deleteCampaign(Number(id)).then(() => toast(t('deleted', { name: c.name }))).catch((e) => { patchASO(store, app.id, (x) => { x.campaigns.push(c); }); toast(errText(e), { tone: 'err' }); });
      return true;
    }
    case 'del-event': {
      const e0 = s.aso[app.id].data.events.find((x) => String(x.id) === id);
      patchASO(store, app.id, (x) => { x.events = x.events.filter((y) => String(y.id) !== id); });
      api.deleteEvent(Number(id)).then(() => toast(t('deleted', { name: e0.label }))).catch((e) => { patchASO(store, app.id, (x) => { x.events.push(e0); }); toast(errText(e), { tone: 'err' }); });
      return true;
    }
    // settings
    case 'test-conn': await run(store, 'conn-' + el.dataset.k, () => api.testConnection(el.dataset.k), { ok: 'connectionOK' }).catch(() => {}); return true;
    case 'del-pkg': { const r = await run(store, 'pkg-del', () => api.removeGooglePackage(el.dataset.v), { ok: 'settingsSaved' }).catch(() => null); if (r) store.set({ settings: r }); return true; }
    case 'digest-preview': { const r = await run(store, 'digest', () => api.digestPreview(s.settings.digest === 'weekly' ? 'weekly' : 'daily')).catch(() => null); if (r) store.set({ digestPreview: r.message }); return true; }
    case 'digest-send': await run(store, 'digest-send', () => api.digestSend(), { ok: 'digestSent' }).catch(() => {}); return true;
    case 'notif-test': await run(store, 'notif-test', () => api.notificationTest(), { ok: 'notificationSent' }).catch(() => {}); return true;
    // simulation
    case 'sim-toggle': store.set({ simOpen: !s.simOpen }); return true;
    case 'sim-speed': sim.speed = el.dataset.v; store.schedule(); return true;
    case 'sim-scenario': sim.scenario = el.dataset.v; cache.clear(); store.set({ apps: [], previous: [], aso: {}, dims: {}, country: {} }); loadPortfolio(store, { force: true }); loadSide(store, { force: true }); return true;
    case 'sim-reset': resetDB(); cache.clear(); sim.scenario = 'normal'; sim.fail = false; store.set({ apps: [], previous: [], aso: {}, dims: {}, country: {}, settings: null, picked: [], searchCompetitors: [], aiResult: {} }); loadPortfolio(store, { force: true }); loadSide(store, { force: true }); toast(t('simResetDone')); return true;
  }
  return false;
}

function typeInto(store, text) {
  // Stream the draft in so the wait ends with visible motion rather than a jump.
  if (reduced()) { store.set({ modal: { ...store.state.modal, text, generating: false } }); return; }
  let i = 0;
  const step = () => {
    const m = store.state.modal; if (!m || m.type !== 'reply') return;
    i = Math.min(text.length, i + 4);
    store.set({ modal: { ...m, text: text.slice(0, i), generating: i < text.length } });
    if (i < text.length) setTimeout(step, 14);
  };
  step();
}
function loadTemplates(store, force) {
  if (store.state.templates && !force) return;
  api.templates().then((r) => store.set({ templates: r.templates }));
}

export function handleChange(store, el) {
  const s = store.state;
  const bind = el.dataset.bind, actc = el.dataset.actChange;
  if (actc === 'sim-fail') { sim.fail = el.checked; return true; }
  if (actc === 'tpl') {
    const tp = (s.templates || []).find((x) => String(x.id) === el.value); if (!tp) return true;
    const app = current(s);
    if (el.dataset.bulk === '1') store.set({ modal: { ...s.modal, body: tp.body, tplName: tp.name, confirmed: false } });
    else { const r = findReview(s, s.modal.appId, s.modal.reviewId); store.set({ modal: { ...s.modal, text: fill(tp.body, r, app), confirmed: false } }); }
    el.value = ''; return true;
  }
  if (!bind) return false;
  const v = el.type === 'checkbox' ? el.checked : el.value;
  if (bind.startsWith('modal.')) {
    const k = bind.slice(6), m = { ...s.modal, [k]: v };
    // Any change to what would be sent or published clears earlier consent.
    if (k !== 'confirmed' && k !== 'tplName') { m.confirmed = false; if (m.type === 'ai') m.preview = null; }
    store.set({ modal: m });
    return true;
  }
  if (bind === 'rankCountry') { store.set({ rankCountry: v, rankPick: null }); return true; }
  if (bind === 'rankPick') { store.set({ rankPick: v }); return true; }
  return false;
}

export async function handleSubmit(store, form, ctx) {
  const s = store.state, app = current(s), fd = new FormData(form), kind = form.dataset.form;
  if (kind === 'login') {
    store.set({ loginError: null });
    try { await run(store, 'login', () => api.login(fd.get('password')), { quiet: true }); ctx.onLogin(); } catch (e) { store.set({ loginError: e.code || 'OPERATION_FAILED' }); }
    return;
  }
  if (kind === 'keyword') {
    const term = String(fd.get('term')).trim(); if (!term) return;
    const tmp = { id: 'tmp-' + Date.now(), appId: app.id, term, pending: true };
    patchASO(store, app.id, (x) => { x.keywords = [...x.keywords, tmp]; });
    form.reset();
    api.addKeyword(app.id, term).then((k) => { patchASO(store, app.id, (x) => { x.keywords = x.keywords.map((y) => (y.id === tmp.id ? k : y)); }); toast(t('keywordCreated', { term })); })
      .catch((e) => { patchASO(store, app.id, (x) => { x.keywords = x.keywords.filter((y) => y.id !== tmp.id); }); toast(errText(e), { tone: 'err' }); });
    return;
  }
  if (kind === 'competitors') {
    const r = await run(store, 'comp-search', () => api.searchCompetitors(app.id, String(fd.get('term')))).catch(() => null);
    if (r) store.set({ searchCompetitors: r.competitors });
    return;
  }
  if (kind === 'campaign') {
    const name = String(fd.get('name')).trim(), source = String(fd.get('source')).trim();
    const tmp = { id: 'tmp' + Date.now(), name, source, clicks: 0, pending: true };
    patchASO(store, app.id, (x) => { x.campaigns = [...x.campaigns, tmp]; });
    form.reset();
    api.createCampaign(app.id, name, source).then((c) => { patchASO(store, app.id, (x) => { x.campaigns = x.campaigns.map((y) => (y.id === tmp.id ? c : y)); x.events = [...x.events, { id: 'e' + c.id, appId: app.id, date: LAST, type: 'campaign', label: name, source: 'auto' }]; }); toast(t('linkCreated')); })
      .catch((e) => { patchASO(store, app.id, (x) => { x.campaigns = x.campaigns.filter((y) => y.id !== tmp.id); }); toast(errText(e), { tone: 'err' }); });
    return;
  }
  if (kind === 'event') {
    const date0 = String(fd.get('date')), label = String(fd.get('label')).trim();
    const tmp = { id: 'tmp' + Date.now(), date: date0, label, type: 'manual', source: 'manual', pending: true };
    patchASO(store, app.id, (x) => { x.events = [...x.events, tmp].sort((a, b) => a.date.localeCompare(b.date)); });
    form.querySelector('[name=label]').value = '';
    api.addEvent(app.id, date0, label).then((e) => { patchASO(store, app.id, (x) => { x.events = x.events.map((y) => (y.id === tmp.id ? e : y)); }); toast(t('eventAdded')); })
      .catch((e) => { patchASO(store, app.id, (x) => { x.events = x.events.filter((y) => y.id !== tmp.id); }); toast(errText(e), { tone: 'err' }); });
    return;
  }
  if (kind === 'package') {
    const r = await run(store, 'pkg', () => api.addGooglePackage(String(fd.get('pkg')).trim()), { ok: 'appAdded' }).catch(() => null);
    if (r) { store.set({ settings: r }); form.reset(); }
    return;
  }
  if (kind === 'settings') {
    const r = await run(store, 'settings', () => api.saveSettings({
      refreshIntervalHours: Number(fd.get('frequency')), notificationsEnabled: fd.has('notifications'), digest: fd.get('digest'),
      digestHour: Number(fd.get('digestHour')), digestLocale: fd.get('digestLocale'), anomalyThreshold: Number(fd.get('anomalyThreshold')),
    }), { ok: 'settingsSaved' }).catch(() => null);
    if (r) store.set({ settings: r });
  }
}

// Wire delegated listeners once. ctx: { onAction(act, el, ev) -> bool, onLogin(), go(page), openTab(tab) }
export function wire(root, store, ctx) {
  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled || el.tagName === 'SELECT') return;
    if (el.tagName === 'INPUT' && el.type === 'checkbox') return; // handled in change
    const act = el.dataset.act;
    if (el.tagName === 'A') ev.preventDefault();
    if (ctx.onAction?.(act, el, ev)) return;
    handleAction(store, act, el, ev, ctx);
  });
  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.act === 'pick') { handleAction(store, 'pick', el, ev, ctx); return; }
    if (ctx.onChange?.(el)) return;
    handleChange(store, el);
  });
  root.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'date' && el.type !== 'number')) {
      if (ctx.onInput?.(el)) return;
      if (el.dataset.bind) handleChange(store, el);
    }
  });
  root.addEventListener('submit', (ev) => { ev.preventDefault(); handleSubmit(store, ev.target, ctx); });
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && store.state.modal) { store.set({ modal: null }); return; }
    const tab = ev.target.closest?.('[role="tab"]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) {
      ev.preventDefault();
      const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')], i = tabs.indexOf(tab);
      const next = tabs[ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      next.focus(); next.click();
    }
    if (ev.key === 'Tab' && store.state.modal) {
      const m = root.querySelector('.modal'); if (!m) return;
      const f = [...m.querySelectorAll('button:not([disabled]),select:not([disabled]),textarea,input:not([disabled]),[tabindex="0"]')];
      if (!f.length) return;
      if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f.at(-1).focus(); }
      else if (!ev.shiftKey && document.activeElement === f.at(-1)) { ev.preventDefault(); f[0].focus(); }
    }
  });
}

export function mount(root, html) { morph(root, html); }
