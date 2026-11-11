// A · Leaderboard — apps race in lanes; changing the metric or period re-sorts them with FLIP motion.
import { createStore, applyTheme, applyLang, readPref, api } from '../shared/core.js';
import * as F from '../shared/features.js';
const { t, icon, esc, num, compact, pct, date, appMark, changeChip, tw, skel, sparkline, panel } = F;

const root = document.getElementById('app');
const store = createStore(F.initialState({
  theme: readPref('apprankly-v2-theme', 'system'), lang: readPref('apprankly-v2-lang', 'vi'),
  page: pageFromHash(), metric: readPref('lb-metric', 'installs'), trayOpen: false, taskLimit: 4,
}), render);
const S = store.state;
applyTheme(S.theme); applyLang(S.lang);
S.sort = S.metric;

function pageFromHash() { const h = location.hash.slice(1); return ['portfolio', 'appDetail', 'settings'].includes(h) ? h : 'portfolio'; }

const METRICS = [['installs', 'sortInstalls'], ['growth', 'sortGrowth'], ['revenue', 'sortRevenue'], ['rating', 'sortRating']];
function metricValue(s, a, m = s.metric) {
  if (m === 'growth') return F.growthOf(a, s.previous);
  if (m === 'revenue') return F.usdTotal([a], s.exchange).hasReports && s.exchange ? F.usdTotal([a], s.exchange).total : null;
  if (m === 'rating') return a.rating;
  return a.installs;
}
function metricHTML(s, a, key) {
  const v = metricValue(s, a);
  if (F.isPending(s, a) && v == null) return skel('4em', '1.1em');
  if (s.metric === 'growth') return v == null ? '<span class="na">—</span>' : tw(key, v, 1, 'pct');
  if (s.metric === 'revenue') { if (!F.usdTotal([a], s.exchange).hasReports) return '<span class="na">—</span>'; if (!s.exchange) return skel('4em', '1.1em'); return tw(key, v, 0) + '<small class="ccy">USD</small>'; }
  if (s.metric === 'rating') return tw(key, v, 1) + '<small class="ccy">★</small>';
  return tw(key, v, 0);
}

// Places from the previous ordering, so a lane can show “up 2” after a re-sort.
let lastOrder = { sig: '', ids: [] }, movement = {};
function orderSig(s) { return s.metric + '|' + s.period + '|' + s.platform; }

function brand() {
  return `<a class="brand" href="#portfolio" data-act="go" data-page="portfolio" aria-label="AppRankly"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 20V11h4v9zM10 20V4h4v16zM16 20v-6h4v6z" fill="currentColor"/></svg></span><span>AppRankly</span></a>`;
}

function header(s) {
  const sum = F.syncSummary(s);
  const pages = [['portfolio', 'trophy', 'lb_title'], ['appDetail', 'smartphone', 'appDetail'], ['settings', 'settings', 'settings']];
  const unread = s.notifications.some((n) => !n.read);
  return `<header class="top" data-key="top">${brand()}
    <nav class="pillnav" aria-label="${t('portfolio')}">${pages.map(([p, ic, l]) => `<button type="button" data-act="go" data-page="${p}" ${s.page === p ? 'aria-current="page"' : ''}>${icon(ic)}<span>${t(l)}</span></button>`).join('')}<span class="pill-ink" aria-hidden="true"></span></nav>
    <div class="top-end">
      <div class="tray-wrap"><button type="button" class="sync-pill ${sum.loading ? 'busy' : sum.error ? 'err' : 'ok'}" data-act="tray" aria-expanded="${s.trayOpen}" aria-label="${t('sync')}">
        <span class="meter" style="--p:${sum.done / sum.total}" aria-hidden="true"></span>${sum.loading ? icon('loader', 'spin') : sum.error ? icon('alert-triangle') : icon('check')}
        <span class="sp-text">${sum.loading ? t('syncing') : `${sum.done}/${sum.total}`}</span></button>
        ${s.trayOpen ? `<div class="tray" data-key="tray">${F.syncTray(s)}<div class="btn-row"><button class="btn primary sm" data-act="sync" ${F.busy(s, 'sync') ? 'disabled' : ''}>${icon('refresh-cw', F.busy(s, 'sync') ? 'spin' : '')}${t(F.busy(s, 'sync') ? 'syncing' : 'sync')}</button></div></div>` : ''}
      </div>
      <button class="icon-btn" data-act="notifications" aria-label="${t('notifications')}">${icon('bell')}${unread ? '<i class="dot"></i>' : ''}</button>
      <button class="icon-btn" data-act="lang" data-v="${s.lang === 'vi' ? 'en' : 'vi'}" aria-label="${t('language')}"><span class="lang-tag">${s.lang.toUpperCase()}</span></button>
      <button class="icon-btn" data-act="logout" aria-label="${t('logout')}">${icon('log-out')}</button>
    </div></header>`;
}

function controls(s) {
  return `<div class="controls" data-key="controls">
    <div class="metric-switch" role="radiogroup" aria-label="${t('lb_rankBy')}"><span class="ms-label">${t('lb_rankBy')}</span>
      ${METRICS.map(([k, l]) => `<button type="button" role="radio" aria-checked="${s.metric === k}" data-act="metric" data-v="${k}">${t(l)}</button>`).join('')}<span class="ms-ink" aria-hidden="true"></span></div>
    <div class="ctrl-right">
      <div class="seg" role="group" aria-label="${t('chooseRange')}">${[7, 30, 90].map((p) => `<button type="button" aria-pressed="${s.period === p}" data-act="period" data-v="${p}">${p}${s.lang === 'vi' ? 'N' : 'D'}</button>`).join('')}</div>
      <div class="seg" role="group" aria-label="${t('platform')}">${[['all', 'allPlatforms'], ['apple', null], ['google', null]].map(([k, l]) => `<button type="button" aria-pressed="${s.platform === k}" data-act="platform" data-v="${k}" ${l ? '' : `aria-label="${F.storeName(k)}"`}>${l ? t(l) : icon(k === 'apple' ? 'apple' : 'play')}</button>`).join('')}</div>
      <label class="search"><span class="sr">${t('searchLabel')}</span>${icon('search')}<input type="search" data-bind-q placeholder="${t('search')}" value="${esc(s.query)}"></label>
    </div></div>`;
}

function scoreboard(s, list) {
  const tot = F.totals(list, s.previous), rev = F.revenueOf(s, list, 'sb-rev');
  const rated = list.filter((a) => a.rating != null);
  const pending = s.pendingPlatforms.length > 0;
  return `<section class="scoreboard" aria-label="${t('portfolio')}" data-key="sb">
    <div class="sb-cell"><span>${t('totalInstalls')}</span><b class="${pending ? 'is-updating' : ''}">${tot.installs == null ? skel('5em', '1em') : tw('sb-inst', tot.installs)}</b>${changeChip(tot.change)}<small>${t('vsPrev')}</small></div>
    <div class="sb-cell"><span>${t('revenueUsd')}</span><b class="${pending ? 'is-updating' : ''}">${rev.html}</b>
      <details class="how"><summary>${icon('info')}${t('howCalculated')}</summary>${F.revenueDetail(s, list)}</details></div>
    <div class="sb-cell"><span>${t('avgRating')}</span><b>${rated.length ? tw('sb-rat', rated.reduce((x, a) => x + a.rating, 0) / rated.length, 2) : '—'}<small class="ccy">★</small></b><small>${t('lb_summary', { n: list.length, d: date(s.range.startDate) + ' – ' + date(s.range.endDate) })}</small></div>
  </section>`;
}

function lanes(s) {
  const list = F.filtered({ ...s, sort: s.metric === 'revenue' ? 'revenue' : s.metric });
  if (!s.apps.length && s.loading) return `<ol class="lanes" aria-busy="true">${Array.from({ length: 6 }, (_, i) => `<li class="lane skeleton" data-key="sk-${i}"><span class="place">${i + 1}</span>${skel('38px', '38px', 'r11')}<div class="lane-main">${skel(`${40 + (i * 13) % 40}%`, '0.9em')}<span class="lane-track"><i class="skel" style="width:${90 - i * 12}%"></i></span></div>${skel('4em', '1.2em')}</li>`).join('')}</ol>`;
  if (!s.apps.length) return `<div class="empty">${icon('smartphone')}<h3>${t('firstConnection')}</h3><p>${t('firstConnectionHint')}</p><button class="btn primary" data-act="go" data-page="settings">${t('viewSettings')}</button></div>`;
  if (!list.length) return `<div class="empty">${icon('search')}<h3>${t('emptyTitle')}</h3><p>${t('emptyText')}</p><button class="btn" data-act="reset-filters">${t('resetFilters')}</button></div>`;
  const vals = list.map((a) => metricValue(s, a));
  const finite = vals.filter((v) => v != null);
  const max = Math.max(...finite.map(Math.abs), 0.0001);
  const sum = s.metric === 'installs' ? finite.reduce((x, v) => x + v, 0) : null;
  const sig = orderSig(s), ids = list.map((a) => a.id);
  if (sig !== lastOrder.sig || ids.join() !== lastOrder.ids.join()) {
    movement = {};
    if (lastOrder.ids.length && !s.pendingPlatforms.length) ids.forEach((id, i) => { const j = lastOrder.ids.indexOf(id); if (j >= 0 && j !== i) movement[id] = j - i; });
    if (!s.pendingPlatforms.length) lastOrder = { sig, ids };
  }
  const sparkMax = Math.max(1, ...list.flatMap((a) => a.dailyTrends.map((d) => d.installs || 0)));
  return `<ol class="lanes" data-key="lanes">${list.map((a, i) => {
    const v = vals[i], pending = F.isPending(s, a);
    const w = v == null ? 0 : s.metric === 'growth' ? Math.min(50, (Math.abs(v) / max) * 50) : Math.max(2, (v / max) * 100);
    const mv = movement[a.id];
    const g = F.growthOf(a, s.previous);
    return `<li class="lane ${pending ? 'is-updating' : ''} ${i < 3 ? 'top top-' + (i + 1) : ''} ${a.error ? 'has-error' : ''}" data-key="ln-${a.id}" data-flip="${a.id}" style="--app:${a.color}">
      <button class="lane-hit" data-act="open-app" data-id="${a.id}" aria-label="${t('lb_open', { name: a.name })}"></button>
      <span class="place" aria-label="${t('lb_place', { n: i + 1 })}">${i + 1}</span>
      ${appMark(a)}
      <div class="lane-main">
        <div class="lane-name"><b>${esc(a.name)}</b>${mv ? `<span class="move ${mv > 0 ? 'up' : 'down'}">${icon(mv > 0 ? 'trending-up' : 'trending-down')}${t(mv > 0 ? 'lb_climb' : 'lb_fall', { n: Math.abs(mv) })}</span>` : ''}${a.error ? `<span class="pill neg">${t('appleReportHTTP', { status: a.sourceStatus })}</span>` : ''}${pending ? `<span class="pill">${icon('loader', 'spin')}${t('lb_pending')}</span>` : ''}</div>
        <div class="lane-track ${s.metric === 'growth' ? 'diverge' : ''}"><i class="${v != null && v < 0 ? 'neg' : ''}" style="--w:${w}%"></i><span class="lane-spark">${sparkline(a.dailyTrends.map((d) => d.installs), { w: 240, h: 22, color: 'var(--app)', max: sparkMax })}</span></div>
      </div>
      <div class="lane-val"><b>${metricHTML(s, a, 'lv-' + a.id)}</b><small>${s.metric === 'installs' ? (sum && v != null ? t('lb_share', { p: num((v / sum) * 100, 0) + '%' }) : '') + ' ' + changeChip(g) : s.metric === 'growth' ? num(a.installs) + ' ' + t('installs').toLowerCase() : s.metric === 'revenue' ? changeChip(g) : num(a.ratings) + ' ' + t('rating').toLowerCase()}</small></div>
      <span class="lane-go" aria-hidden="true">${icon('chevron-right')}</span>
    </li>`;
  }).join('')}</ol>`;
}

function tasks(s) {
  const list = F.buildTasks(s.apps, s.anomalies);
  const loadingInsights = s.sources.insights?.state === 'loading' && !s.anomalies.length;
  const shown = list.slice(0, s.taskLimit);
  return `<section class="panel tasks" data-key="tasks"><header class="panel-head"><div><h2>${t('lb_tasks')} <span class="badge-new">${t('new')}</span></h2><p>${t('actionCenterHint')}</p></div>${list.length ? `<span class="task-count tnum">${list.length}</span>` : ''}</header>
    ${!s.apps.length && s.loading ? Array.from({ length: 3 }, (_, i) => `<div class="task skel-task" data-key="tsk-${i}">${skel('28px', '28px', 'r8')}<div>${skel('70%')}${skel('45%', '.8em')}</div></div>`).join('') :
      list.length ? `<ul class="task-list">${shown.map((k) => { const c = F.taskCopy(k); return `<li class="task ${c.tone}" data-key="tk-${esc(k.key)}">
        ${appMark(k.app, 'sm')}<div class="task-body"><b>${esc(c.title)}</b><span class="task-app">${esc(k.app.name)}</span><p>${esc(c.body)}</p>
        <div class="task-acts"><button class="btn sm" data-act="${c.act}" data-id="${k.appId}" data-key2="${esc(k.key)}">${c.cta}${icon('arrow-right')}</button><button class="btn ghost sm" data-act="task-dismiss" data-k="${esc(k.key)}">${t('dismiss')}</button></div></div></li>`; }).join('')}</ul>
        ${list.length > 4 ? `<button class="btn ghost sm more" data-act="task-more">${s.taskLimit < list.length ? t('td_more', { n: list.length - s.taskLimit }) : t('td_less')}</button>` : ''}` :
      `<div class="empty sm">${icon('check-circle-2')}<p><b>${t('allClear')}</b><br>${t('allClearHint')}</p></div>`}
    ${loadingInsights ? `<p class="fine">${icon('loader', 'spin')} ${t('srcInsights')} · ${t('srcLoading')}</p>` : ''}
  </section>`;
}

function portfolioPage(s) {
  const list = F.filtered(s);
  s._chartList = list;
  return `<div class="page portfolio" data-key="pg-portfolio">
    <div class="page-title"><h1 tabindex="-1">${t('lb_title')}</h1><div class="title-acts"><button class="btn ghost sm" data-act="export-csv" ${list.length ? '' : 'disabled'}>${icon('download')}${t('export')}</button><button class="btn ghost sm" data-act="export-json" ${list.length ? '' : 'disabled'}>${icon('file-json')}${t('downloadRaw')}</button></div></div>
    ${controls(s)}
    <div class="banners">${F.banners(s)}</div>
    ${s.apps.length ? scoreboard(s, list) : ''}
    <div class="board">
      <div class="board-main">${lanes(s)}
        ${s.apps.length ? panel(t('trend'), `<div class="chart" data-chart="portfolio" data-static></div>`, { desc: t('thisPeriod') + ' — ' + t('prevPeriod').toLowerCase() + ' ┄', key: 'pf-chart' }) : ''}</div>
      <aside class="board-side">${tasks(s)}<section class="panel" data-key="side-sync"><header class="panel-head"><div><h2>${t('sync')}</h2></div></header>${F.syncTray(s)}</section></aside>
    </div></div>`;
}

function detailPage(s) {
  const a = F.current(s);
  if (!a) return `<div class="page">${s.loading ? F.skeletonPanel(6) : `<div class="empty">${icon('smartphone')}<h3>${t('firstConnection')}</h3></div>`}</div>`;
  const list = F.filtered({ ...s, sort: s.metric });
  const idx = list.findIndex((x) => x.id === a.id);
  const prev = list[idx - 1], next = list[idx + 1];
  const g = F.growthOf(a, s.previous), rev = F.revenueOf(s, [a], 'd-rev-' + a.id);
  return `<div class="page detail" data-key="pg-detail" style="--app:${a.color}">
    <a class="back" href="#portfolio" data-act="go" data-page="portfolio">${icon('arrow-left')}${t('lb_back')}</a>
    <section class="hero-app" data-key="hero-${a.id}">
      <div class="ha-id">${appMark(a, 'xl')}<div><h1 tabindex="-1">${esc(a.name)}</h1><p>${F.storeName(a.platform)} · ${esc(a.category)} · <code>${esc(a.store)}</code></p></div></div>
      <div class="ha-place">${idx >= 0 ? `<span class="big-place">#${idx + 1}</span><small>${t('lb_rankBy')} ${t(METRICS.find((m) => m[0] === s.metric)[1]).toLowerCase()}</small>` : ''}
        <div class="ha-nav"><button class="icon-btn" data-act="open-app" data-id="${prev?.id || ''}" ${prev ? '' : 'disabled'} aria-label="${prev ? esc(prev.name) : ''}">${icon('arrow-left')}</button><button class="icon-btn" data-act="open-app" data-id="${next?.id || ''}" ${next ? '' : 'disabled'} aria-label="${next ? esc(next.name) : ''}">${icon('arrow-right')}</button></div></div>
      <dl class="ha-stats">
        <div><dt>${t('installs')}</dt><dd>${tw('d-inst-' + a.id, a.installs)}</dd>${changeChip(g)}</div>
        <div><dt>${t('revenueUsd')}</dt><dd>${rev.html}</dd><details class="how"><summary>${icon('info')}${t('howCalculated')}</summary>${F.revenueDetail(s, [a])}</details></div>
        <div><dt>${t('rating')}</dt><dd>${num(a.rating, 1)}<small class="ccy">★</small></dd><small class="fine">${t('ratingsN', { n: num(a.ratings) })}</small></div>
      </dl>
      <div class="ha-acts"><div class="seg" role="group" aria-label="${t('chooseRange')}">${[7, 30, 90].map((p) => `<button type="button" aria-pressed="${s.period === p}" data-act="period" data-v="${p}">${p}${s.lang === 'vi' ? 'N' : 'D'}</button>`).join('')}</div>
        <button class="btn primary" data-act="ai">${icon('sparkles')}${t('previewAI')}</button></div>
    </section>
    ${F.tabBar(s, 'lb-tabs')}
    ${F.detailBody(s)}
  </div>`;
}

function render(s) {
  if (s.auth === null) { F.mount(root, `<div class="boot" data-key="boot">${brand()}<span class="skel" style="width:120px;height:4px"></span></div>`); return; }
  if (!s.auth) { F.mount(root, F.loginView(s, brand()) + F.simPanel(s)); F.afterRender(root, s); return; }
  const first = flipFirst();
  const body = s.page === 'portfolio' ? portfolioPage(s) : s.page === 'appDetail' ? detailPage(s) : `<div class="page" data-key="pg-settings"><div class="page-title"><h1 tabindex="-1">${t('settings')}</h1></div>${F.settingsBody(s)}</div>`;
  F.mount(root, header(s) + `<main id="main" data-key="main">${body}<footer class="foot">${icon('lock')}${t('privateWorkspace')} · AppRankly · ${t('syntheticData')}</footer></main>` + `<nav class="bottomnav" aria-label="${t('portfolio')}" data-key="bn">${[['portfolio', 'trophy', 'lb_title'], ['appDetail', 'smartphone', 'appDetail'], ['settings', 'settings', 'settings']].map(([p, ic, l]) => `<button type="button" data-act="go" data-page="${p}" ${s.page === p ? 'aria-current="page"' : ''}>${icon(ic)}<span>${t(l)}</span></button>`).join('')}</nav>` + F.modalLayer(s) + F.simPanel(s));
  F.afterRender(root, s);
  flipPlay(first);
  inks();
}

// ---- FLIP for lanes ----
function flipFirst() { const m = new Map(); root.querySelectorAll('[data-flip]').forEach((el) => m.set(el.dataset.flip, el.getBoundingClientRect().top)); return m; }
function flipPlay(first) {
  if (F.vt && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll('[data-flip]').forEach((el) => {
    const was = first.get(el.dataset.flip); if (was == null) return;
    const dy = was - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 2) return;
    el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 560, easing: 'cubic-bezier(.2,.9,.25,1.08)' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  });
}
function inks() {
  const ms = root.querySelector('.metric-switch'), on = ms?.querySelector('[aria-checked="true"]'), ink = ms?.querySelector('.ms-ink');
  if (on && ink) { ink.style.width = on.offsetWidth + 'px'; ink.style.transform = `translateX(${on.offsetLeft}px)`; }
  const pn = root.querySelector('.pillnav'), cur = pn?.querySelector('[aria-current]'), pi = pn?.querySelector('.pill-ink');
  if (pn && pi) { if (cur) { pi.style.opacity = 1; pi.style.width = cur.offsetWidth + 'px'; pi.style.transform = `translateX(${cur.offsetLeft}px)`; } }
}

// ---- navigation ----
function go(page, { tab } = {}) {
  if (page === S.page && !tab) return;
  F.vt(() => {
    store.set({ page, trayOpen: false, ...(tab ? { detailTab: tab } : {}) });
    if (location.hash.slice(1) !== page) history.pushState(null, '', '#' + page);
    store.now();
    scrollTo({ top: 0 });
    root.querySelector('h1')?.focus({ preventScroll: true });
  }, 'page');
  if (page === 'appDetail') F.ensureDetail(store);
}
addEventListener('popstate', () => { store.set({ page: pageFromHash() }); if (S.page === 'appDetail') F.ensureDetail(store); });

const ctx = {
  onLogin: () => { store.set({ auth: true }); boot(); },
  openTab: (tab) => { go('appDetail', { tab }); },
  onInput(el) { if (el.matches('[data-bind-q]')) { store.set({ query: el.value }); return true; } return false; },
  onAction(act, el) {
    switch (act) {
      case 'go': go(el.dataset.page); return true;
      case 'metric': store.set({ metric: el.dataset.v, sort: el.dataset.v }); try { localStorage.setItem('lb-metric', el.dataset.v); } catch {} return true;
      case 'period': { const p = Number(el.dataset.v); if (p === S.period) return true; store.set({ period: p, dims: {}, country: {} }); F.loadPortfolio(store); if (S.page === 'appDetail') F.ensureDetail(store); return true; }
      case 'platform': store.set({ platform: el.dataset.v }); return true;
      case 'reset-filters': store.set({ query: '', platform: 'all' }); return true;
      case 'tray': store.set({ trayOpen: !S.trayOpen }); return true;
      case 'open-app': if (!el.dataset.id) return true; store.set({ selected: el.dataset.id, picked: [], searchCompetitors: [] }); if (S.page === 'appDetail') { F.ensureDetail(store); store.now(); scrollTo({ top: 0, behavior: 'smooth' }); } else go('appDetail'); return true;
      case 'task-more': store.set({ taskLimit: S.taskLimit < 99 ? 99 : 4 }); return true;
      case 'task-dismiss': {
        const k = el.dataset.k, li = el.closest('.task');
        const doIt = () => { api.dismiss(k); store.schedule(); F.vt(() => {}, ''); };
        if (li && !matchMedia('(prefers-reduced-motion: reduce)').matches) { li.animate([{ opacity: 1, transform: 'none', maxHeight: li.offsetHeight + 'px' }, { opacity: 0, transform: 'translateX(24px)', maxHeight: '0px', paddingBlock: '0px' }], { duration: 260, easing: 'ease-in' }).finished.then(doIt); } else doIt();
        import('../shared/util.js').then((u) => u.toast(t('dismissed'), { undoLabel: t('undo'), undo: () => { api.undismiss(k); store.schedule(); } }));
        return true;
      }
      case 'task-reply': case 'task-reviews': store.set({ selected: el.dataset.id, reviewFilter: 'unanswered' }); go('appDetail', { tab: 'reviews' }); return true;
      case 'task-keywords': store.set({ selected: el.dataset.id }); go('appDetail', { tab: 'keywords' }); return true;
      case 'task-open': store.set({ selected: el.dataset.id }); go('appDetail', { tab: 'overview' }); return true;
      case 'task-settings': go('settings'); return true;
    }
    return false;
  },
};
F.wire(root, store, ctx);

// Prefetch on intent: hovering a lane loads its detail data; hovering a period loads that period.
root.addEventListener('pointerover', (e) => {
  const lane = e.target.closest('[data-act="open-app"][data-id]'); if (lane?.dataset.id) F.warmApp(store, lane.dataset.id);
  const per = e.target.closest('[data-act="period"]'); if (per) F.prefetch(Number(per.dataset.v));
});
document.addEventListener('click', (e) => { if (S.trayOpen && !e.target.closest('.tray-wrap')) store.set({ trayOpen: false }); });
addEventListener('resize', () => inks());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(S.theme); store.schedule(); });

async function boot() {
  F.loadPortfolio(store).then(() => { if (S.page === 'appDetail') F.ensureDetail(store); });
  F.loadSide(store);
  if (S.page === 'appDetail') F.ensureDetail(store);
}
api.me().then(() => { store.set({ auth: sessionStorage.getItem('lb-auth') !== '0' }); if (S.auth) boot(); });
const origSet = store.set;
store.set = (p) => { origSet(p); if ('auth' in (typeof p === 'object' ? p : {})) sessionStorage.setItem('lb-auth', p.auth ? '1' : '0'); };
render(S);
