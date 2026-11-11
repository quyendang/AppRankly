// B · Today — a morning inbox of what needs you, then app cards that expand into their detail (shared-element morph).
import { createStore, applyTheme, applyLang, readPref, api } from '../shared/core.js';
import * as F from '../shared/features.js';
import { toast, reduced } from '../shared/util.js';
const { t, icon, esc, num, compact, date, appMark, changeChip, tw, skel, sparkline, panel } = F;

const root = document.getElementById('app');
const store = createStore(F.initialState({
  theme: readPref('apprankly-v2-theme', 'system'), lang: readPref('apprankly-v2-lang', 'vi'),
  page: pageFromHash(), done: [], cmd: null, sort: 'installs',
}), render);
const S = store.state;
applyTheme(S.theme); applyLang(S.lang);

function pageFromHash() { const h = location.hash.slice(1); return ['portfolio', 'appDetail', 'settings'].includes(h) ? h : 'portfolio'; }
const brand = () => `<a class="brand" href="#portfolio" data-act="go" data-page="portfolio" aria-label="AppRankly"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></span><span>AppRankly</span></a>`;

function greeting() { const h = new Date().getHours(); return t(h < 11 ? 'td_greeting_m' : h < 18 ? 'td_greeting_a' : 'td_greeting_e'); }

function header(s) {
  const sum = F.syncSummary(s);
  const unread = s.notifications.some((n) => !n.read);
  return `<header class="top" data-key="top">${brand()}
    <button class="cmd-trigger" data-act="cmd" aria-label="${t('cmdHint')}">${icon('search')}<span>${t('cmd_placeholder')}</span><kbd>⌘K</kbd></button>
    <div class="top-end">
      <button class="sync-dots ${sum.loading ? 'busy' : sum.error ? 'err' : 'ok'}" data-act="sync" ${F.busy(s, 'sync') ? 'disabled' : ''} title="${t('sync')}" aria-label="${t('sync')}">
        ${['apple', 'google', 'rates', 'insights', 'reviews'].map((k) => `<i class="${s.sources[k]?.state || 'idle'}"></i>`).join('')}<span>${sum.loading ? t('syncing') : t('sync')}</span></button>
      <button class="icon-btn" data-act="notifications" aria-label="${t('notifications')}">${icon('bell')}${unread ? '<i class="dot"></i>' : ''}</button>
      <button class="icon-btn hide-sm" data-act="go" data-page="settings" aria-label="${t('settings')}" ${s.page === 'settings' ? 'aria-current="page"' : ''}>${icon('settings')}</button>
      <button class="icon-btn hide-sm" data-act="logout" aria-label="${t('logout')}">${icon('log-out')}</button>
    </div></header>`;
}

// ---------- Today ----------
function inbox(s) {
  const all = F.buildTasks(s.apps, s.anomalies);
  const list = all.filter((k) => !s.done.includes(k.key));
  const loading = (!s.apps.length && s.loading) || (s.sources.insights?.state === 'loading' && !s.anomalies.length);
  if (!s.apps.length && s.loading) return `<ul class="inbox" aria-busy="true">${[0, 1, 2].map((i) => `<li class="inbox-item skel-item" data-key="ib-sk${i}">${skel('36px', '36px', 'r10')}<div>${skel('60%')}${skel('85%', '.85em')}</div></li>`).join('')}</ul>`;
  if (!list.length) return `<div class="inbox-clear" data-key="ib-clear"><span class="clear-mark">${icon('check')}</span><div><b>${t('allClear')}</b><p>${t('allClearHint')}</p></div></div>`;
  const shown = s.inboxAll ? list : list.slice(0, 5);
  return `<ul class="inbox" data-key="ib">${shown.map((k, i) => {
    const c = F.taskCopy(k);
    return `<li class="inbox-item ${c.tone}" data-key="ib-${esc(k.key)}" data-i="${i}" data-enter="ib-${esc(k.key)}">
      <button class="done-btn" data-act="done" data-k="${esc(k.key)}" aria-label="${t('td_done')}: ${esc(c.title)}"><span>${icon('check')}</span></button>
      <div class="ib-body"><div class="ib-title"><b>${esc(c.title)}</b><span class="ib-app">${appMark(k.app, 'sm')}${esc(k.app.name)}</span></div><p>${esc(c.body)}</p></div>
      <button class="btn sm ${c.tone === 'neg' ? 'primary' : ''}" data-act="${c.act}" data-id="${k.appId}">${c.cta}</button></li>`;
  }).join('')}${list.length > 5 ? `<li class="inbox-more" data-key="ib-toggle"><button class="btn ghost sm" data-act="inbox-all">${s.inboxAll ? t('td_less') : t('td_more', { n: list.length - 5 })}</button></li>` : ''}${loading ? `<li class="inbox-item ghost" data-key="ib-more">${icon('loader', 'spin')}<span>${t('srcInsights')} · ${t('srcLoading')}</span></li>` : ''}</ul>`;
}

function hero(s) {
  const list = F.filtered(s);
  const tot = F.totals(list, s.previous), rev = F.revenueOf(s, list, 'h-rev');
  const n = F.buildTasks(s.apps, s.anomalies).filter((k) => !s.done.includes(k.key)).length;
  const y = F.seriesSum(list).filter((d) => d.v != null).at(-1);
  return `<section class="today-hero" data-key="hero">
    <div class="th-greet"><p class="th-date">${date(new Date().toISOString(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h1 tabindex="-1">${greeting()}.</h1><p class="th-lead">${!s.apps.length && s.loading ? skel('14em', '1em') : n ? esc(t('td_lead', { n: '\u0000' })).replace('\u0000', `<b class="lead-n">${n}</b>`) : t('td_leadNone')}</p></div>
    <dl class="th-stats">
      <div><dt>${t('td_yesterday')}</dt><dd>${y ? tw('h-y', y.v) : skel('3em')}</dd><small>${t('installs').toLowerCase()} · ${y ? date(y.date) : ''}</small></div>
      <div><dt>${t('periodN', { n: s.period })}</dt><dd>${tot.installs == null ? skel('4em') : tw('h-inst', tot.installs)}</dd>${changeChip(tot.change)}</div>
      <div class="rev"><dt>${t('revenueUsd')}</dt><dd>${rev.html}</dd><details class="how"><summary>${icon('info')}${t('howCalculated')}</summary>${F.revenueDetail(s, list)}</details></div>
    </dl>
    <div class="th-inbox"><header><h2>${t('actionCenter')} <span class="badge-new">${t('new')}</span></h2></header>${inbox(s)}</div>
  </section>`;
}

function card(s, a, max) {
  const g = F.growthOf(a, s.previous), pending = F.isPending(s, a);
  const rev = F.revenueOf(s, [a], 'c-rev-' + a.id);
  const open = (s.aso[a.id]?.data?.reviews || []).filter((r) => r.canReply && !r.replyText).length;
  return `<li class="app-card-wrap" data-key="cw-${a.id}"><button class="app-card ${pending ? 'is-updating' : ''} ${a.error ? 'has-error' : ''}" data-act="open-app" data-id="${a.id}" style="--app:${a.color};view-transition-name:card-${a.id}" aria-label="${t('lb_open', { name: a.name })}">
    <span class="card-top">${appMark(a)}<span class="card-name"><b>${esc(a.name)}</b><small>${F.storeName(a.platform)}</small></span>${a.error ? `<span class="pill neg">${icon('alert-triangle')}HTTP ${a.sourceStatus}</span>` : open ? `<span class="pill rev-pill">${icon('message-square')}${open}</span>` : ''}</span>
    <span class="card-chart">${pending && a.installs == null ? skel('100%', '48px') : sparkline(a.dailyTrends.map((d) => d.installs), { w: 260, h: 48, color: a.color, max })}</span>
    <span class="card-stats"><span><small>${t('installs')}</small><b>${pending && a.installs == null ? skel('3em') : tw('c-i-' + a.id, a.installs)}</b>${changeChip(g)}</span>
      <span><small>${t('revenue')}</small><b>${rev.html}</b></span><span><small>${t('rating')}</small><b>${num(a.rating, 1)}<em aria-hidden="true">★</em></b></span></span>
    ${pending ? `<span class="card-flag">${icon('loader', 'spin')}</span>` : ''}
  </button></li>`;
}

function appsSection(s) {
  const list = F.filtered(s);
  const max = Math.max(1, ...list.flatMap((a) => a.dailyTrends.map((d) => d.installs || 0)));
  let body;
  if (!s.apps.length && s.loading) body = `<ul class="cards" aria-busy="true">${Array.from({ length: 6 }, (_, i) => `<li class="app-card-wrap" data-key="cs-${i}"><div class="app-card skeleton"><span class="card-top">${skel('38px', '38px', 'r11')}<span class="card-name">${skel('7em')}${skel('4em', '.8em')}</span></span>${skel('100%', '48px')}<span class="card-stats">${skel('4em')}${skel('4em')}${skel('3em')}</span></div></li>`).join('')}</ul>`;
  else if (!s.apps.length) body = `<div class="empty">${icon('smartphone')}<h3>${t('firstConnection')}</h3><p>${t('firstConnectionHint')}</p><button class="btn primary" data-act="go" data-page="settings">${t('viewSettings')}</button></div>`;
  else if (!list.length) body = `<div class="empty">${icon('search')}<h3>${t('emptyTitle')}</h3><p>${t('emptyText')}</p><button class="btn" data-act="reset-filters">${t('resetFilters')}</button></div>`;
  else body = `<ul class="cards" data-key="cards">${list.map((a) => card(s, a, max)).join('')}</ul>`;
  return `<section class="apps-sec" data-key="apps-sec">
    <header class="sec-head"><h2>${t('td_yourApps')} <small class="tnum">${s.apps.length || ''}</small></h2>
      <div class="filters">
        <div class="seg" role="group" aria-label="${t('chooseRange')}">${[7, 30, 90].map((p) => `<button type="button" aria-pressed="${s.period === p}" data-act="period" data-v="${p}">${t('periodN', { n: p })}</button>`).join('')}</div>
        <div class="seg" role="group" aria-label="${t('platform')}">${[['all', t('allPlatforms')], ['apple', 'iOS'], ['google', 'Android']].map(([k, l]) => `<button type="button" aria-pressed="${s.platform === k}" data-act="platform" data-v="${k}">${l}</button>`).join('')}</div>
        <label class="sort"><span class="sr">${t('sort')}</span><select data-bind-sort>${[['installs', 'sortInstalls'], ['growth', 'sortGrowth'], ['revenue', 'sortRevenue'], ['rating', 'sortRating']].map(([k, l]) => `<option value="${k}" ${s.sort === k ? 'selected' : ''}>${t(l)}</option>`).join('')}</select></label>
        <label class="search"><span class="sr">${t('searchLabel')}</span>${icon('search')}<input type="search" data-bind-q placeholder="${t('search')}" value="${esc(s.query)}"></label>
        <button class="btn ghost sm" data-act="export-csv" ${list.length ? '' : 'disabled'}>${icon('download')}<span>CSV</span></button>
        <button class="btn ghost sm" data-act="export-json" ${list.length ? '' : 'disabled'}>${icon('file-json')}<span>JSON</span></button>
      </div></header>
    ${body}
    ${s.apps.length ? `<div class="grid-2 lower">${panel(t('trend'), `<div class="chart" data-chart="portfolio" data-static></div>`, { desc: t('thisPeriod') + ' · ' + t('prevPeriod') + ' ┄', key: 'pf-chart' })}${panel(t('sync') + ` <span class="badge-new">${t('new')}</span>`, F.syncTray(s) + `<button class="btn sm" data-act="sync" ${F.busy(s, 'sync') ? 'disabled' : ''}>${icon('refresh-cw', F.busy(s, 'sync') ? 'spin' : '')}${t(F.busy(s, 'sync') ? 'syncing' : 'sync')}</button>`, { key: 'sync-panel' })}</div>` : ''}
  </section>`;
}

function todayPage(s) {
  s._chartList = F.filtered(s);
  return `<div class="page today" data-key="pg-today"><div class="banners">${F.banners(s)}</div>${hero(s)}${appsSection(s)}</div>`;
}

function detailPage(s) {
  const a = F.current(s);
  if (!a) return `<div class="page">${s.loading ? F.skeletonPanel(6) : `<div class="empty">${icon('smartphone')}<h3>${t('firstConnection')}</h3></div>`}</div>`;
  const g = F.growthOf(a, s.previous), rev = F.revenueOf(s, [a], 'd-rev-' + a.id);
  const others = F.filtered(s);
  return `<div class="page detail" data-key="pg-detail" style="--app:${a.color}">
    <section class="detail-head" style="view-transition-name:card-${a.id}" data-key="dh-${a.id}">
      <div class="dh-row"><a class="back" href="#portfolio" data-act="go" data-page="portfolio">${icon('arrow-left')}<span>${t('td_back')}</span></a>
        <div class="dh-switch" role="group" aria-label="${t('appDetail')}">${others.map((o) => `<button type="button" data-act="open-app" data-id="${o.id}" ${o.id === a.id ? 'aria-current="true"' : ''} aria-label="${esc(o.name)}" title="${esc(o.name)}">${appMark(o, 'sm')}</button>`).join('')}</div></div>
      <div class="dh-id">${appMark(a, 'xl')}<div><h1 tabindex="-1">${esc(a.name)}</h1><p>${F.storeName(a.platform)} · ${esc(a.category)} · <code>${esc(a.store)}</code></p></div>
        <button class="btn primary" data-act="ai">${icon('sparkles')}<span>${t('previewAI')}</span></button></div>
      <dl class="dh-stats">
        <div><dt>${t('installs')} · ${t('periodN', { n: s.period })}</dt><dd>${tw('d-i-' + a.id, a.installs)}</dd>${changeChip(g)}</div>
        <div><dt>${t('revenueUsd')}</dt><dd>${rev.html}</dd><details class="how"><summary>${icon('info')}${t('howCalculated')}</summary>${F.revenueDetail(s, [a])}</details></div>
        <div><dt>${t('rating')}</dt><dd>${num(a.rating, 1)}<em aria-hidden="true">★</em></dd><small>${t('ratingsN', { n: num(a.ratings) })}</small></div>
        <div class="dh-period"><div class="seg" role="group" aria-label="${t('chooseRange')}">${[7, 30, 90].map((p) => `<button type="button" aria-pressed="${s.period === p}" data-act="period" data-v="${p}">${p}</button>`).join('')}</div><small>${date(s.range.startDate)} – ${date(s.range.endDate)}</small></div>
      </dl>
    </section>
    ${F.tabBar(s, 'td-tabs')}
    ${F.detailBody(s)}
  </div>`;
}

// ---------- command palette ----------
function cmdItems(s) {
  const q = (s.cmd?.q || '').toLowerCase().trim();
  const items = [
    ...s.apps.map((a) => ({ k: 'app:' + a.id, ic: null, app: a, label: a.name, sub: F.storeName(a.platform), run: () => openApp(a.id) })),
    ...F.DETAIL_TABS.map((tb) => ({ k: 'tab:' + tb, ic: 'arrow-right', label: t(tb), sub: F.current(s)?.name || '', run: () => { go('appDetail', { tab: tb }); } })),
    { k: 'go:portfolio', ic: 'sun', label: t('td_back'), sub: t('portfolio'), run: () => go('portfolio') },
    { k: 'go:settings', ic: 'settings', label: t('settings'), sub: '', run: () => go('settings') },
    { k: 'sync', ic: 'refresh-cw', label: t('sync'), sub: '', run: () => F.sync(store) },
    { k: 'csv', ic: 'download', label: t('export'), sub: '', run: () => F.exportCSV(S) },
    { k: 'ai', ic: 'sparkles', label: t('previewAI'), sub: F.current(s)?.name || '', run: () => F.handleAction(store, 'ai', document.body, null, ctx) },
    { k: 'theme', ic: 'moon', label: t('theme') + ': ' + t(s.theme === 'dark' ? 'light' : 'dark'), sub: '', run: () => F.setTheme(store, s.theme === 'dark' ? 'light' : 'dark') },
    { k: 'lang', ic: 'globe', label: s.lang === 'vi' ? 'English' : 'Tiếng Việt', sub: t('language'), run: () => F.setLangAll(store, s.lang === 'vi' ? 'en' : 'vi') },
  ];
  return q ? items.filter((i) => (i.label + ' ' + i.sub).toLowerCase().includes(q)) : items;
}
function cmdLayer(s) {
  if (!s.cmd) return '';
  const items = cmdItems(s), sel = Math.min(s.cmd.i, items.length - 1);
  return `<div class="modal-layer cmd-layer" data-key="cmd"><div class="scrim" data-act="cmd-close"></div><div class="cmd" role="dialog" aria-modal="true" aria-label="${t('cmdHint')}">
    <label class="cmd-input">${icon('search')}<input data-cmd-q placeholder="${t('cmd_placeholder')}" value="${esc(s.cmd.q)}" role="combobox" aria-expanded="true" aria-controls="cmd-list" aria-activedescendant="cmd-${sel}" autocomplete="off"><kbd>esc</kbd></label>
    <ul id="cmd-list" role="listbox">${items.length ? items.map((it, i) => `<li id="cmd-${i}" role="option" aria-selected="${i === sel}" data-act="cmd-run" data-i="${i}" data-key="ci-${it.k}">${it.app ? appMark(it.app, 'sm') : `<span class="cmd-ic">${icon(it.ic)}</span>`}<span>${esc(it.label)}</span><small>${esc(it.sub)}</small></li>`).join('') : `<li class="cmd-none">${t('cmd_none')}</li>`}</ul></div></div>`;
}

// ---------- render ----------
function render(s) {
  if (s.auth === null) { F.mount(root, `<div class="boot" data-key="boot">${brand()}</div>`); return; }
  if (!s.auth) { F.mount(root, F.loginView(s, brand()) + F.simPanel(s)); F.afterRender(root, s); return; }
  const body = s.page === 'portfolio' ? todayPage(s) : s.page === 'appDetail' ? detailPage(s) : `<div class="page" data-key="pg-settings"><div class="page-title"><a class="back" href="#portfolio" data-act="go" data-page="portfolio">${icon('arrow-left')}<span>${t('td_back')}</span></a><h1 tabindex="-1">${t('settings')}</h1></div>${F.settingsBody(s)}</div>`;
  F.mount(root, header(s) + `<main id="main" data-key="main">${body}<footer class="foot">${icon('lock')}${t('privateWorkspace')} · AppRankly · ${t('syntheticData')}</footer></main>`
    + `<nav class="bottomnav" data-key="bn" aria-label="${t('portfolio')}">${[['portfolio', 'sun', 'td_back'], ['appDetail', 'smartphone', 'appDetail'], ['cmd', 'search', 'cmdHint'], ['settings', 'settings', 'settings']].map(([p, ic, l]) => `<button type="button" data-act="${p === 'cmd' ? 'cmd' : 'go'}" data-page="${p}" ${s.page === p ? 'aria-current="page"' : ''}>${icon(ic)}<span>${t(l)}</span></button>`).join('')}</nav>`
    + F.modalLayer(s) + cmdLayer(s) + F.simPanel(s));
  F.afterRender(root, s);
  if (s.cmd) { const inp = root.querySelector('[data-cmd-q]'); if (inp && document.activeElement !== inp) inp.focus(); root.querySelector('[aria-selected="true"][role="option"]')?.scrollIntoView({ block: 'nearest' }); }
}

// ---------- navigation with shared-element morph ----------
function go(page, { tab } = {}) {
  if (page === S.page && !tab) return;
  const from = S.page;
  F.vt(() => {
    store.set({ page, cmd: null, ...(tab ? { detailTab: tab } : {}) });
    if (location.hash.slice(1) !== page) history.pushState(null, '', '#' + page);
    store.now();
    scrollTo({ top: 0 });
    root.querySelector('h1')?.focus({ preventScroll: true });
  }, from === 'appDetail' && page === 'portfolio' ? 'collapse' : page === 'appDetail' ? 'expand' : 'page');
  if (page === 'appDetail') F.ensureDetail(store);
}
function openApp(id) {
  if (!id) return;
  if (S.page === 'appDetail') { F.vt(() => { store.set({ selected: id, picked: [], searchCompetitors: [], cmd: null }); store.now(); }, 'swap'); F.ensureDetail(store); return; }
  store.set({ selected: id, picked: [], searchCompetitors: [] });
  go('appDetail');
}
addEventListener('popstate', () => { F.vt(() => { store.set({ page: pageFromHash() }); store.now(); }); if (S.page === 'appDetail') F.ensureDetail(store); });

const ctx = {
  onLogin: () => { store.set({ auth: true }); sessionStorage.setItem('td-auth', '1'); boot(); },
  openTab: (tab) => go('appDetail', { tab }),
  onInput(el) {
    if (el.matches('[data-bind-q]')) { store.set({ query: el.value }); return true; }
    if (el.matches('[data-cmd-q]')) { store.set({ cmd: { q: el.value, i: 0 } }); return true; }
    return false;
  },
  onChange(el) { if (el.matches('[data-bind-sort]')) { store.set({ sort: el.value }); return true; } return false; },
  onAction(act, el) {
    switch (act) {
      case 'go': if (el.dataset.page === 'appDetail' && !S.selected) store.set({ selected: S.apps[0]?.id }); go(el.dataset.page); return true;
      case 'open-app': openApp(el.dataset.id); return true;
      case 'period': { const p = Number(el.dataset.v); if (p === S.period) return true; store.set({ period: p, dims: {}, country: {} }); F.loadPortfolio(store); if (S.page === 'appDetail') F.ensureDetail(store); return true; }
      case 'platform': F.vt(() => { store.set({ platform: el.dataset.v }); store.now(); }); return true;
      case 'reset-filters': store.set({ query: '', platform: 'all' }); return true;
      case 'done': {
        const k = el.dataset.k, li = el.closest('.inbox-item');
        li?.classList.add('is-done');
        setTimeout(() => {
          F.vt(() => { api.dismiss(k); store.set({ done: [...S.done, k] }); store.now(); });
        }, reduced() ? 0 : 420);
        toast(t('dismissed'), { undoLabel: t('undo'), undo: () => { api.undismiss(k); store.set({ done: S.done.filter((x) => x !== k) }); } });
        return true;
      }
      case 'task-reply': case 'task-reviews': store.set({ selected: el.dataset.id, reviewFilter: 'unanswered' }); go('appDetail', { tab: 'reviews' }); return true;
      case 'task-keywords': store.set({ selected: el.dataset.id }); go('appDetail', { tab: 'keywords' }); return true;
      case 'task-open': store.set({ selected: el.dataset.id }); go('appDetail', { tab: 'overview' }); return true;
      case 'task-settings': go('settings'); return true;
      case 'inbox-all': F.vt(() => { store.set({ inboxAll: !S.inboxAll }); store.now(); }); return true;
      case 'cmd': store.set({ cmd: { q: '', i: 0 } }); return true;
      case 'cmd-close': store.set({ cmd: null }); return true;
      case 'cmd-run': { const it = cmdItems(S)[Number(el.dataset.i)]; store.set({ cmd: null }); it?.run(); return true; }
    }
    return false;
  },
};
F.wire(root, store, ctx);

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); store.set({ cmd: S.cmd ? null : { q: '', i: 0 } }); return; }
  if (e.key === '/' && !S.cmd && !e.target.closest('input,textarea,select') && S.auth) { e.preventDefault(); store.set({ cmd: { q: '', i: 0 } }); return; }
  if (!S.cmd) return;
  if (e.key === 'Escape') { e.stopPropagation(); store.set({ cmd: null }); }
  const n = cmdItems(S).length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); store.set({ cmd: { ...S.cmd, i: (Math.min(S.cmd.i, n - 1) + (e.key === 'ArrowDown' ? 1 : -1) + n) % n } }); }
  if (e.key === 'Enter') { e.preventDefault(); const it = cmdItems(S)[Math.min(S.cmd.i, n - 1)]; store.set({ cmd: null }); it?.run(); }
}, true);

root.addEventListener('pointerover', (e) => {
  const c = e.target.closest('[data-act="open-app"][data-id]'); if (c) F.warmApp(store, c.dataset.id);
  const p = e.target.closest('[data-act="period"]'); if (p) F.prefetch(Number(p.dataset.v));
});
// Warm the first visible cards once data lands, so review counts appear on the cards.
let warmed = false;
const warmTimer = setInterval(() => { if (S.apps.length && !S.loading && !warmed) { warmed = true; S.apps.slice(0, 8).forEach((a, i) => setTimeout(() => F.loadASO(store, a.id), 200 * i)); clearInterval(warmTimer); } }, 400);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(S.theme); store.schedule(); });

function boot() {
  F.loadPortfolio(store).then(() => { if (S.page === 'appDetail') F.ensureDetail(store); });
  F.loadSide(store);
  if (S.page === 'appDetail') F.ensureDetail(store);
}
const _set = store.set;
store.set = (p) => { _set(p); if (p && typeof p === 'object' && 'auth' in p) sessionStorage.setItem('td-auth', p.auth ? '1' : '0'); };
api.me().then(() => { store.set({ auth: sessionStorage.getItem('td-auth') !== '0' }); if (S.auth) boot(); });
render(S);
