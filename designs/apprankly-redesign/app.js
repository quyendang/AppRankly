import { apps, initialNotes, releases, copy, icons } from './data.js?v=2';

const concept = document.body.dataset.concept || 'pulse';
const storageKey = `apprankly-prototype-${concept}`;
const safeRead = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const saved = safeRead(storageKey, {});
const state = {
  page:'portfolio', range:30, platform:'all', query:'', sort:'installs', appId:apps[0].id,
  metric:'installs', detailTab:'overview', asoTab:'storeListing', journalTab:'notes', noteQuery:'',
  scenario:'ready', theme:saved.theme || 'system', lang:saved.lang || 'vi', menu:false,
  notes:saved.notes || structuredClone(initialNotes), extraReleases:saved.extraReleases || [],
  frequency:saved.frequency || '1', notifications:saved.notifications || false,
  keywords:saved.keywords || ['note taking','offline notes','daily journal','simple notes'],
  modal:null, drawer:false, toast:'', busy:false, testing:'', auditComplete:false,
  aiPrivate:false, aiNotes:false, aiConsent:false
};
const root = document.querySelector('#app');
const t = key => copy[state.lang][key] ?? key;
const text = value => typeof value === 'object' && value !== null ? value[state.lang] : value;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = (name, cls='') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
const num = (value, digits=0) => new Intl.NumberFormat(state.lang==='vi'?'vi-VN':'en-US',{maximumFractionDigits:digits}).format(value);
const money = (value, currency='USD') => new Intl.NumberFormat(state.lang==='vi'?'vi-VN':'en-US',{style:'currency',currency,maximumFractionDigits:0}).format(value);
const date = value => new Intl.DateTimeFormat(state.lang==='vi'?'vi-VN':'en-GB',{day:'2-digit',month:'short',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`));
const app = () => apps.find(a=>a.id===state.appId) || apps[0];
const visibleApps = () => state.scenario==='empty' ? [] : apps.filter(a => (state.platform==='all'||a.platform===state.platform) && a.name.toLowerCase().includes(state.query.toLowerCase())).sort((a,b)=>state.sort==='growth'?b.delta-a.delta:b.installs-a.installs);
const installCount = a => Math.round(a.installs*state.range/30);
const appName = a => `<span class="app-avatar" aria-hidden="true" style="--app-color:${a.color}">${a.monogram}</span><span class="app-name"><strong>${esc(a.name)}</strong><small>${t(a.platform)}</small></span>`;
const delta = value => `<span class="delta ${value<0?'negative':'positive'}">${icon(value<0?'arrowDown':'arrowUp')}${num(Math.abs(value),1)}%</span>`;
const button = (label, action, name='', cls='button', extra='') => `<button class="${cls}" data-action="${action}" ${extra}>${name?icon(name):''}<span>${esc(label)}</span></button>`;
const navItems = [['portfolio','grid'],['appDetail','apps'],['aso','chart'],['journal','book'],['settings','settings']];
const persist = () => { try { localStorage.setItem(storageKey,JSON.stringify({theme:state.theme,lang:state.lang,notes:state.notes,extraReleases:state.extraReleases,frequency:state.frequency,notifications:state.notifications,keywords:state.keywords})); } catch {} };

function setTheme() {
  const dark = state.theme==='dark'||(state.theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark?'dark':'light';
  document.documentElement.lang = state.lang;
  document.title = `${concept[0].toUpperCase()+concept.slice(1)} · AppRankly`;
}

function brand(compact=false) {
  return `<a class="brand ${compact?'compact-brand':''}" href="index.html" aria-label="AppRankly · ${t('compareDesigns')}"><span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 17V9h4v8H4Zm6 0V5h4v12h-4Zm6 0v-6h4v6h-4Z" fill="currentColor"></path></svg></span>${compact?'':'<span>AppRankly<span class="brand-period">.</span></span>'}</a>`;
}

function nav() {
  return `<nav class="main-nav" aria-label="${t('appsLabel')}">${navItems.map(([key,name])=>`<button class="nav-item ${state.page===key?'active':''}" data-action="nav" data-page="${key}" ${state.page===key?'aria-current="page"':''} title="${t(key)}">${icon(name)}<span>${t(key)}</span>${key==='portfolio'?'<span class="nav-count">8</span>':''}</button>`).join('')}</nav>`;
}

function preferences() {
  return `<div class="quick-preferences"><label class="sr-only" for="quick-theme">${t('theme')}</label><span class="theme-icon">${icon(state.theme==='dark'?'moon':state.theme==='light'?'sun':'monitor')}</span><select id="quick-theme" data-control="theme" aria-label="${t('theme')}">${['system','light','dark'].map(v=>`<option value="${v}" ${state.theme===v?'selected':''}>${t(v)}</option>`).join('')}</select><button class="language-button" data-action="language" aria-label="${state.lang==='vi'?'Switch to English':'Chuyển sang tiếng Việt'}">${icon('globe')}<span>${state.lang==='vi'?'VI':'EN'}</span></button></div>`;
}

function appPane() {
  return `<aside class="app-pane"><div class="pane-heading"><strong>${t('appsLabel')}</strong><span class="count">${visibleApps().length}</span></div><label class="search-field pane-search">${icon('search')}<input data-control="search" type="search" value="${esc(state.query)}" placeholder="${t('search')}" aria-label="${t('searchLabel')}"></label><div class="pane-list">${visibleApps().map(a=>`<button class="pane-app ${a.id===state.appId?'selected':''}" data-action="select-app" data-id="${a.id}" aria-pressed="${a.id===state.appId}">${appName(a)}${icon('chevron')}</button>`).join('')}</div><div class="pane-footer">${icon('lock')}<span>${t('owner')}</span></div></aside>`;
}

function topbar() {
  return `<header class="topbar"><div class="breadcrumb"><button class="icon-button menu-button" data-action="menu" aria-label="${t('openMenu')}" aria-expanded="${state.menu}">${icon('menu')}</button><span class="concept-name">${concept[0].toUpperCase()+concept.slice(1)}</span><span class="breadcrumb-divider">/</span><span>${t(state.page)}</span></div><div class="topbar-end"><span class="mock-badge">${icon('flask')}<span>${t('prototype')}</span></span>${preferences()}<span class="owner-avatar" title="${t('owner')}">Q</span></div></header>`;
}

function toolbar() {
  return `<div class="toolbar"><div class="filter-group"><label class="select-wrap">${icon('apps')}<select data-control="platform" aria-label="${t('platform')}">${['all','apple','google'].map(v=>`<option value="${v}" ${state.platform===v?'selected':''}>${v==='all'?t('allPlatforms'):t(v)}</option>`).join('')}</select>${icon('down')}</label><label class="select-wrap">${icon('calendar')}<select data-control="range" aria-label="${t('chooseRange')}">${[7,30].map(v=>`<option value="${v}" ${state.range===v?'selected':''}>${v} ${t('days')}</option>`).join('')}</select>${icon('down')}</label>${concept==='focus'?'':`<span class="toolbar-date">${t('syntheticTime')}</span>`}</div><div class="toolbar-actions"><span class="sync-state"><span class="status-dot"></span>${state.scenario==='stale'?t('staleDate'):t('updated')}</span>${button(t('export'),'export','download','button subtle export-button')}${button(t(state.busy?'syncing':'sync'),'sync','refresh','button small',state.busy?'disabled':'')}</div></div>`;
}

function titleBlock() {
  const title = state.page==='portfolio'?t(concept==='pulse'?'portfolioTitle':concept==='spectrum'?'spectrumTitle':'focusTitle'):state.page==='appDetail'?app().name:state.page==='aso'?t('aso'):state.page==='journal'?t('journalTitle'):t('settingsTitle');
  const subtitle = state.page==='portfolio'?t('portfolioSubtitle'):state.page==='appDetail'?`${t(app().platform)} · ${app().package}`:state.page==='aso'?t('auditDesc'):state.page==='journal'?t('journalSubtitle'):t('settingsSubtitle');
  return `<div class="page-heading"><div><h1 tabindex="-1">${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="heading-action">${state.page==='aso'?button(t('previewAI'),'ai','spark','button primary'):state.page==='journal'?button(t(state.journalTab==='notes'?'newNote':'newRelease'),state.journalTab==='notes'?'new-note':'new-release','plus','button primary'):state.page==='settings'?'<span class="private-label">'+icon('lock')+t('owner')+'</span>':`<span class="period-label">${icon('calendar')}${state.range} ${t('days')}</span>`}</div></div>`;
}

function totals(list) {
  const installs = list.reduce((s,a)=>s+installCount(a),0);
  const previous = list.reduce((s,a)=>s+installCount(a)/(1+a.delta/100),0);
  const currencies = {};
  for (const a of list) if(a.revenue!==null) currencies[a.currency]=(currencies[a.currency]||0)+a.revenue*state.range/30;
  return {installs, growth:previous?(installs/previous-1)*100:0, currencies};
}

function kpis(list) {
  const values=totals(list);
  return `<section class="kpi-strip" aria-label="${t('overview')}"><div class="kpi"><span>${t('totalInstalls')}</span><div class="kpi-value">${num(values.installs)}${delta(values.growth)}</div><small>${t('lastMonth')}</small></div><div class="kpi revenue-kpi"><span>${t('availableRevenue')}${icon('info')}</span><div class="currency-values">${Object.entries(values.currencies).map(([c,v])=>`<strong>${money(v,c)}<small>${c}</small></strong>`).join('')||`<strong class="unavailable">${t('notAvailable')}</strong>`}</div><small title="${t('revenueFootnote')}">${t('separateCurrencies')}</small></div><div class="kpi"><span>${t('activeApps')}</span><div class="kpi-value">${num(list.length)}<span class="store-pair"><span class="platform-mini">iOS</span><span class="platform-mini">Android</span></span></div><small>${t('twoPlatforms')}</small></div></section>`;
}

function seriesFor(list) {
  const values = Array.from({length:28},(_,i)=>list.reduce((s,a)=>s+a.series[i]*(a.installs/a.series.reduce((x,y)=>x+y,0)),0));
  return state.range===7?values.slice(-7):values;
}

function chart(list, small=false, fixed=false) {
  const values=seriesFor(list);
  const max=fixed?950:Math.max(...values,10)*1.16;
  const w=small?240:innerWidth<=600?340:innerWidth<=800?460:920, h=small?65:200, left=small?2:48, right=small?2:20, top=small?5:22, bottom=small?5:40;
  const x=i=>left+i*(w-left-right)/Math.max(values.length-1,1), y=v=>h-bottom-(v/max)*(h-top-bottom);
  const points=values.map((v,i)=>`${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const baseline=h-bottom;
  const area=`M${left},${baseline} L${points.replace(/ /g,' L')} L${w-right},${baseline} Z`;
  const prev=values.map((v,i)=>`${x(i).toFixed(1)},${y(v*(0.74+Math.sin(i*1.4)*0.08)).toFixed(1)}`).join(' ');
  const accent=concept==='focus'?'var(--teal-chart)':'var(--accent)';
  const grid=small?'':Array.from({length:4},(_,i)=>{const val=max*(i/3), yy=y(val);return `<line x1="${left}" y1="${yy}" x2="${w-right}" y2="${yy}" stroke="var(--line)" stroke-dasharray="3 5"></line><text x="${left-12}" y="${yy+4}" text-anchor="end">${num(val)}</text>`;}).join('');
  const labelIndices=innerWidth<=600?[0,Math.floor((values.length-1)/2),values.length-1]:[0,Math.floor((values.length-1)/3),Math.floor((values.length-1)*2/3),values.length-1];
  const labels=small?'':labelIndices.map(i=>`<text x="${x(i)}" y="${h-10}" text-anchor="middle">${String(i+(state.range===7?24:3)).padStart(2,'0')}/10</text>`).join('');
  const markerLabelX=Math.min(w-right-50,Math.max(left+50,x(values.length-3)));
  const marker=small?'':`<line x1="${x(values.length-3)}" y1="12" x2="${x(values.length-3)}" y2="${baseline}" stroke="var(--secondary)" stroke-dasharray="4 4"></line><rect x="${markerLabelX-47}" y="5" width="94" height="22" rx="5" fill="var(--secondary-soft)"></rect><text x="${markerLabelX}" y="20" text-anchor="middle" class="chart-marker">${t('releaseMarker')}</text>`;
  return `<div class="chart-wrap ${small?'mini-chart':''}"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(t('trend'))}: ${num(values[0])} → ${num(values.at(-1))} ${t('installs')}"><title>${t('trend')}</title>${grid}${small?'':`<path d="${area}" fill="${accent}" opacity=".065"></path><polyline points="${prev}" fill="none" stroke="var(--chart-muted)" stroke-width="2" stroke-dasharray="5 5"></polyline>`}<polyline points="${points}" fill="none" stroke="${small&&list[0]?.delta<0?'var(--negative)':accent}" stroke-width="${small?2.2:3}" stroke-linecap="round" stroke-linejoin="round"></polyline>${marker}${labels}${small?'':values.map((v,i)=>i%4===0||i===values.length-1?`<circle cx="${x(i)}" cy="${y(v)}" r="6" class="chart-point" data-tip="${String(i+(state.range===7?24:3)).padStart(2,'0')}/10 · ${num(v)} ${t('installs')}" tabindex="0" role="img" aria-label="${i+3}/10: ${num(v)} ${t('installs')}"></circle>`:'').join('')}<circle cx="${x(values.length-1)}" cy="${y(values.at(-1))}" r="${small?3:4}" fill="${accent}"></circle></svg><output class="chart-tooltip" aria-live="off"></output></div>`;
}

function chartPanel(list, compact=false) {
  return `<section class="panel trend-panel"><div class="panel-heading"><div><h2>${t('trend')}</h2>${compact?'':`<p>${t('trendDesc')}</p>`}</div><div class="chart-legend"><span><i></i>${t('currentPeriod')}</span><span><i class="previous"></i>${t('previousPeriod')}</span></div></div>${chart(list)}<div class="chart-footer"><span>${icon('flag')}${t('releaseMarker')} · 28/10</span><span>${t('chartHelp')}</span></div></section>`;
}

function appTable(list, mode='normal') {
  return `<section class="panel apps-panel"><div class="panel-heading"><div><h2>${t('compareApps')}</h2><p>${list.length} ${t('appCount')}${concept==='spectrum'?' · '+t('compareScale'):''}</p></div><div class="table-controls"><label class="search-field">${icon('search')}<input type="search" data-control="search" value="${esc(state.query)}" placeholder="${t('search')}" aria-label="${t('searchLabel')}"></label><select class="sort-select" data-control="sort" aria-label="${t('sort')}"><option value="installs" ${state.sort==='installs'?'selected':''}>${t('sortInstalls')}</option><option value="growth" ${state.sort==='growth'?'selected':''}>${t('sortGrowth')}</option></select></div></div><div class="table-scroll"><table class="app-table ${mode}"><thead><tr><th scope="col">${t('appColumn')}</th><th scope="col" class="spark-column">${t('last28')}</th><th scope="col" class="numeric">${t('installs')}</th><th scope="col" class="numeric">${t('change')}</th><th scope="col" class="numeric revenue-column">${t('revenue')}</th><th scope="col" class="numeric rating-column">${t('rating')}</th><th scope="col"><span class="sr-only">${t('details')}</span></th></tr></thead><tbody>${list.map(a=>`<tr class="${concept==='focus'&&a.id===state.appId?'selected-row':''}"><td><button class="app-row-button" data-action="open-app" data-id="${a.id}">${appName(a)}</button></td><td class="spark-column">${chart([a],true,concept==='spectrum')}</td><td class="numeric strong-number">${num(installCount(a))}</td><td class="numeric">${delta(a.delta)}</td><td class="numeric revenue-column">${a.revenue===null?`<span class="not-available" title="${t('noGoogleRevenue')}">—</span>`:money(a.revenue*state.range/30,a.currency)}</td><td class="numeric rating-column">${icon('star','star-icon')}${num(a.rating,1)}</td><td>${button(t('viewApp'),'open-app','chevron','icon-button row-open',`data-id="${a.id}" aria-label="${t('viewApp')} ${esc(a.name)} ${t(a.platform)}"`)}</td></tr>`).join('')}</tbody></table></div><div class="table-footer"><span>${t('allRows')} · ${num(list.length)}</span><span>${t('revenueFootnote')}</span></div></section>`;
}

function timeline() {
  return `<section class="panel timeline-panel"><div class="panel-heading"><h2>${t('releaseTimeline')}</h2>${button(t('viewAll'),'nav','arrow','text-button','data-page="journal"')}</div><div class="release-timeline">${releases.slice(0,3).map(r=>{const a=apps.find(a=>a.id===r.app);return `<button class="timeline-event" data-action="open-app" data-id="${a.id}"><span class="timeline-dot" style="--event-color:${a.color}"></span><time>${date(r.date)}</time><strong>${esc(a.name)} <span>v${r.version}</span></strong><small>${esc(text(r.title))}</small></button>`;}).join('')}</div></section>`;
}

function portfolio() {
  const list=visibleApps();
  if(state.scenario==='loading')return `<div class="skeleton-area" role="status"><span class="loading-label">${icon('refresh','spin')}${t('loadingText')}</span><div class="skeleton-kpis">${'<div></div>'.repeat(3)}</div><div class="skeleton-chart"></div><div class="skeleton-table">${'<div></div>'.repeat(4)}</div></div>`;
  if(!list.length)return emptyState('emptyTitle','emptyText','resetFilters','reset');
  if(concept==='spectrum') return `${kpis(list)}<div class="spectrum-insight"><span class="insight-symbol">${icon('chart')}</span><div><strong>${t('changesTitle')}</strong><p>${t('changeSummary')}</p></div>${button(t('explore'),'open-app','arrow','text-button','data-id="scan-android"')}</div>${appTable(list,'comparison')}${chartPanel(list,true)}${timeline()}`;
  if(concept==='focus')return `${kpis(list)}<div class="focus-workspace"><div>${appTable(list,'dense')}<div class="coverage-note">${icon('info')}<span>${t('dataCoverageText')}</span></div></div><aside class="selected-app-panel">${detailCompact()}<div class="focus-tip">${icon('info')}<p>${t('focusHint')}</p></div></aside></div>${timeline()}`;
  return `${kpis(list)}${chartPanel(list)}<div class="attention-strip">${icon('info')}<span><strong>${t('needsAttention')}.</strong> ${t('attentionText')}</span>${button(t('explore'),'open-app','arrow','text-button','data-id="focus-ios"')}</div>${appTable(list)}${timeline()}`;
}

function detailCompact() {
  const a=app();
  return `<div class="compact-app-heading">${appName(a)}${button(t('viewApp'),'nav','arrow','icon-button','data-page="appDetail" aria-label="'+t('viewApp')+'"')}</div><label class="compact-metric-select"><span>${t('selectMetric')}</span><select data-control="metric">${['installs','revenue'].map(k=>`<option value="${k}" ${state.metric===k?'selected':''}>${t(k)}</option>`).join('')}</select></label><div class="compact-metric"><span>${t(state.metric)}</span><strong>${state.metric==='revenue'?(a.revenue===null?t('notAvailable'):money(a.revenue*state.range/30,a.currency)):num(installCount(a))}</strong>${state.metric==='installs'?delta(a.delta):''}</div>${state.metric==='installs'?chart([a]):`<p class="metric-source-note">${a.revenue===null?t('noGoogleRevenue'):t('separateCurrencies')}</p>`}<div class="compact-stat"><span>${t('rating')}</span><strong>${num(a.rating,1)} / 5</strong></div><div class="compact-stat"><span>${t('latestVersion')}</span><strong>${a.version}</strong></div><div class="compact-stat"><span>${t('retention')}</span><span class="muted">—</span></div>${button(t('previewAI'),'ai','spark','button full-width')}`;
}

function appSelector() {
  return `<label class="select-wrap app-selector">${icon('apps')}<select data-control="appId" aria-label="${t('chooseApp')}">${apps.map(a=>`<option value="${a.id}" ${a.id===state.appId?'selected':''}>${a.name} · ${t(a.platform)}</option>`).join('')}</select>${icon('down')}</label>`;
}

function tabs(keys, selected, control) {
  return `<div class="tabs" role="tablist">${keys.map(k=>`<button role="tab" tabindex="${k===selected?0:-1}" aria-selected="${k===selected}" class="tab ${k===selected?'active':''}" data-action="tab" data-control="${control}" data-value="${k}">${t(k)}</button>`).join('')}</div>`;
}

function breakdown(kind) {
  const countries=state.lang==='vi'?['Hoa Kỳ','Việt Nam','Nhật Bản','Vương quốc Anh','Khác']:['United States','Vietnam','Japan','United Kingdom','Other'];
  const labels=kind==='countries'?countries:[app().version,'2.7.4','2.7.0','2.6.1',t('all')];
  return `<section class="panel breakdown-panel"><div class="panel-heading"><h2>${t(kind)}</h2><span class="muted">${t('installs')}</span></div>${labels.map((name,i)=>`<div class="breakdown-row"><span>${esc(name)}</span><div class="bar-track"><div style="width:${[86,63,42,27,18][i]}%"></div></div><strong>${num(installCount(app())*[.36,.26,.18,.12,.08][i])}</strong><small>${[36,26,18,12,8][i]}%</small></div>`).join('')}</section>`;
}

function appDetail() {
  const a=app();
  return `<div class="detail-nav">${appSelector()}${tabs(['overview','countries','versions'],state.detailTab,'detailTab')}</div>${kpis([a])}${state.detailTab==='overview'?`${chartPanel([a])}<div class="detail-bottom">${breakdown('countries')}<section class="panel coverage-panel"><div class="panel-heading"><h2>${t('dataCoverage')}</h2>${icon('info')}</div><div class="coverage-metric"><span>${t('activeDevices')}</span><strong>—</strong><small>${t('unsupported')}</small></div><div class="coverage-metric"><span>${t('retention')}</span><strong>—</strong><small>${t('unsupported')}</small></div><p>${t('dataCoverageText')}</p></section></div>`:breakdown(state.detailTab)}${timeline()}`;
}

function aso() {
  const a=app();
  return `<div class="detail-nav">${appSelector()}${tabs(['storeListing','keywords','competitors','reviews'],state.asoTab,'asoTab')}</div>${state.asoTab==='storeListing'?`<div class="aso-grid"><section class="panel listing-panel"><div class="listing-brand">${appName(a)}<span class="pill">${t('publicOnly')}</span></div><div class="listing-field"><span>${t('titleField')}</span><h2>${esc(a.name)}${a.id.startsWith('luma')?' — '+(state.lang==='vi'?'ghi chú mỗi ngày':'everyday notes'):''}</h2><small>28 / 30</small></div><div class="listing-field"><span>${t('subtitleField')}</span><p>${t('subtitleExample')}</p><small>30 / 80</small></div><div class="listing-field"><span>${t('description')}</span><p>${t('listingText')}</p></div><div class="sample-screens"><div><span class="screen-motif">${icon('book')}</span><strong>${state.lang==='vi'?'Ý tưởng của bạn.':'Your ideas.'}</strong><span>${state.lang==='vi'?'Ở đúng nơi.':'Right here.'}</span></div><div><span class="screen-motif">${icon('check')}</span><strong>${state.lang==='vi'?'Nhẹ nhàng hơn.':'A little lighter.'}</strong><span>${state.lang==='vi'?'Mỗi ngày.':'Every day.'}</span></div><div><span class="screen-motif">${icon('globe')}</span><strong>${state.lang==='vi'?'Luôn sẵn sàng.':'Always ready.'}</strong><span>${state.lang==='vi'?'Kể cả ngoại tuyến.':'Even offline.'}</span></div></div></section><aside class="panel audit-panel"><div class="panel-heading"><h2>${t('listingAudit')}</h2>${icon('spark')}</div><div class="audit-number">82<span>/ 100</span></div><strong>${t('goodListing')}</strong><div class="audit-bars">${[['titleField',90],['subtitleField',68],['keywords',76]].map(([k,v])=>`<div><span>${t(k)}</span><div class="bar-track"><div style="width:${v}%"></div></div><strong>${v}</strong></div>`).join('')}</div><div class="audit-recommendation">${icon('spark')}<h3>${t(state.auditComplete?'aiResultTitle':'improveTitle')}</h3><p>${t(state.auditComplete?'aiResultBody':'improveDesc')}</p></div>${button(t('previewAI'),'ai','arrow','button primary full-width')}<p class="fine-print">${t('previewSubtitle')}</p></aside></div>`:state.asoTab==='keywords'?`<section class="panel keyword-panel"><div class="panel-heading"><h2>${t('keywords')} <span class="count">${state.keywords.length}</span></h2><span class="pill">VN · ${t(a.platform)}</span></div><form id="keyword-form" class="inline-form"><label class="sr-only" for="keyword-input">${t('keyword')}</label><input id="keyword-input" name="keyword" required maxlength="60" placeholder="${t('keywordPlaceholder')}"><button class="button primary" type="submit">${icon('plus')}${t('addKeyword')}</button></form><div class="table-scroll"><table><thead><tr><th>${t('keyword')}</th><th>${t('rank')}</th><th>${t('movement')}</th><th>${t('tracked')}</th></tr></thead><tbody>${state.keywords.map((kw,i)=>`<tr><td class="keyword-text">${esc(kw)}</td><td>#${[12,8,24,17][i%4]}</td><td>${delta([4,8,-2,3][i%4])}</td><td>${icon('check','positive')}</td></tr>`).join('')}</tbody></table></div></section>`:state.asoTab==='competitors'?`<section class="panel"><div class="panel-heading"><h2>${t('competitors')}</h2><span class="pill">${t('publicOnly')}</span></div><div class="competitor-list">${apps.filter(x=>x.id!==a.id).slice(0,3).map((x,i)=>`<div class="competitor-row">${appName(x)}<div><span>${t('rating')}</span><strong>${num(x.rating,1)}</strong></div><div><span>${t('rank')}</span><strong>#${x.rank}</strong></div>${chart([x],true)}</div>`).join('')}</div></section>`:`<section class="panel reviews-panel"><div class="panel-heading"><h2>${t('reviews')}</h2><span class="rating-summary">${icon('star')} ${num(a.rating,1)} / 5</span></div><article class="review"><div><strong>Minh Anh</strong><span class="stars">${icon('star').repeat(5)}</span><time>28/10/2026</time></div><p>${t('sampleReview')}</p>${button(t('reply'),'reply','spark','button subtle')}<div id="sample-reply" class="reply-text" hidden>${t('sampleReply')}</div></article></section>`}`;
}

function journal() {
  const notes=state.notes.filter(n=>(state.platform==='all'||apps.find(a=>a.id===n.app)?.platform===state.platform)&&`${text(n.title)} ${text(n.body)}`.toLowerCase().includes(state.noteQuery.toLowerCase()));
  return `<div class="journal-toolbar">${tabs(['notes','releases'],state.journalTab,'journalTab')}${state.journalTab==='notes'?`<label class="search-field">${icon('search')}<input type="search" data-control="noteQuery" value="${esc(state.noteQuery)}" placeholder="${t('searchNotes')}" aria-label="${t('searchNotes')}"></label>`:''}</div>${state.journalTab==='notes'?`<p class="privacy-note">${icon('lock')}${t('noteHint')}</p>${notes.length?`<div class="notes-grid">${notes.map(n=>{const a=apps.find(a=>a.id===n.app)||apps[0];return `<article class="note-card"><div class="note-top"><span class="note-app" style="--app-color:${a.color}"><i></i>${esc(a.name)}</span><time>${date(n.date)}</time></div><h2>${esc(text(n.title))}</h2><p>${esc(text(n.body))}</p><div class="note-bottom"><span class="tag">${n.tags==='aso'?'ASO':n.tags==='product'?t('releases'):t('insight')}</span><div>${button(t('edit'),'edit-note','edit','icon-button',`data-id="${n.id}" aria-label="${t('edit')}: ${esc(text(n.title))}"`)}${button(t('delete'),'delete-note','trash','icon-button',`data-id="${n.id}" aria-label="${t('delete')}: ${esc(text(n.title))}"`)}</div></div></article>`;}).join('')}</div>`:emptyState('noNotes','noNotesHint','newNote','new-note')}`:`<section class="panel release-list">${[...state.extraReleases,...releases].map(r=>{const a=apps.find(a=>a.id===r.app);return `<article class="release-row"><time>${date(r.date)}</time><span class="release-line-dot"></span><div>${appName(a)}<h3>${esc(text(r.title))}</h3><span class="muted">${t('syntheticRelease')}</span></div><span class="version-badge">v${esc(r.version)}</span></article>`;}).join('')}</section>`}`;
}

function settings() {
  return `<div class="settings-grid"><section class="panel connections-panel"><div class="panel-heading"><h2>${t('connections')}</h2>${icon('lock')}</div><p class="secure-note">${icon('lock')}${t('serverOnly')}</p>${[['google','G','googleStatusHint'],['apple','A','appleStatusHint'],['aiProvider','AI','aiStatusHint']].map(([key,letter,hint])=>`<div class="connection-row"><span class="connection-icon ${key}">${letter}</span><div class="connection-text"><h3>${key==='aiProvider'?'OpenAI':t(key)}</h3><p>${t(hint)}</p><span class="connection-status"><span class="status-dot"></span>${t(state.scenario==='error'?'disconnected':'connected')}</span></div>${button(t(state.testing===key?'checking':'checkConnection'),'test-connection','refresh','button small',`data-key="${key}" ${state.testing===key?'disabled':''}`)}</div>`).join('')}<div class="ai-privacy-label">${icon('check')}<span>${t('aiPrivacy')}</span></div><div class="reset-data-row">${button(t('resetData'),'reset-data','refresh','button subtle')}</div></section><section class="panel preferences-panel"><div class="panel-heading"><h2>${t('preferences')}</h2>${icon('settings')}</div><div class="setting-group"><span class="setting-label">${t('theme')}</span><div class="theme-options">${['light','dark','system'].map(v=>`<button class="theme-option ${state.theme===v?'selected':''}" data-action="theme" data-value="${v}" aria-pressed="${state.theme===v}">${icon(v==='light'?'sun':v==='dark'?'moon':'monitor')}${t(v)}</button>`).join('')}</div></div><div class="setting-group"><label for="setting-language">${t('language')}</label><select id="setting-language" data-control="lang"><option value="vi" ${state.lang==='vi'?'selected':''}>Tiếng Việt</option><option value="en" ${state.lang==='en'?'selected':''}>English</option></select></div><form id="settings-form"><div class="setting-group"><label for="frequency">${t('schedule')}</label><select id="frequency" name="frequency">${[['1','everyHour'],['3','every3Hours'],['6','every6Hours']].map(([v,k])=>`<option value="${v}" ${state.frequency===v?'selected':''}>${t(k)}</option>`).join('')}</select><small>${t('scheduleHint')}</small></div><div class="setting-group timezone-setting"><span>${t('timezone')}</span><strong>Asia/Ho_Chi_Minh</strong></div><div class="notification-setting"><div><label for="notify-toggle">${t('optionalNotifications')}</label><p>${t('notificationHint')}</p></div><input id="notify-toggle" class="toggle" type="checkbox" name="notifications" role="switch" ${state.notifications?'checked':''} aria-label="${t('optionalNotifications')}"></div><button class="button primary full-width" type="submit">${t('save')}</button></form></section></div>`;
}

function emptyState(title, description, label, action) {
  return `<section class="empty-state">${icon('search')}<h2>${t(title)}</h2><p>${t(description)}</p>${button(t(label),action,'plus','button primary')}</section>`;
}

function alert() {
  if(state.scenario==='error')return `<div class="state-banner error-banner" role="alert">${icon('info')}<div><strong>${t('errorTitle')}</strong><span>${t('errorText')}</span></div>${button(t('retry'),'retry','refresh','button small')}</div>`;
  if(state.scenario==='stale')return `<div class="state-banner stale-banner" role="status">${icon('clock')}<span>${t('staleText')}</span>${button(t('sync'),'sync','refresh','text-button')}</div>`;
  return '';
}

function payload() {
  const a=app();
  const result = { app:a.name, platform:t(a.platform), listing:{title:a.name,description:t('listingText')}, keywords:state.keywords, reviews:[t('sampleReview')] };
  if(state.aiPrivate)result.metrics={installs:installCount(a),days:state.range,...(a.revenue!==null?{revenue:Number((a.revenue*state.range/30).toFixed(2)),currency:a.currency}:{})};
  if(state.aiNotes) result.notes=state.notes.filter(n=>n.app===a.id).map(n=>({title:text(n.title),content:text(n.body)}));
  return result;
}

function modal() {
  if(!state.modal)return '';
  let content='';
  if(state.modal.type==='ai')content=`<div class="modal-heading"><span class="modal-icon">${icon('spark')}</span><h2 id="modal-title">${t('aiTitle')}</h2>${button(t('close'),'close-modal','close','icon-button close-modal',`aria-label="${t('close')}"`)}</div><p class="modal-intro">${t('aiIntro')}</p><div class="ai-public-row">${icon('lock')}<span>${t('aiPublic')}</span><span class="pill">${t('publicOnly')}</span></div><div class="ai-options"><label><input type="checkbox" data-control="aiPrivate" ${state.aiPrivate?'checked':''}>${t('aiPrivate')}</label><label><input type="checkbox" data-control="aiNotes" ${state.aiNotes?'checked':''}>${t('aiNotes')}</label><small>${t('aiPrivateHint')}</small></div><h3 class="payload-label">${t('payload')}</h3><pre class="payload">${esc(JSON.stringify(payload(),null,2))}</pre><label class="consent-label"><input type="checkbox" data-control="aiConsent" ${state.aiConsent?'checked':''}>${t('aiConsent')}</label><div class="modal-footer">${button(t('cancel'),'close-modal','','button')}${button(t('runAudit'),'run-ai','spark','button primary',state.aiConsent?'':'disabled')}</div>`;
  else {
    const isRelease=state.modal.type==='release';
    const existing=state.modal.note;
    content=`<div class="modal-heading"><h2 id="modal-title">${t(isRelease?'newRelease':existing?'edit':'newNote')}</h2>${button(t('close'),'close-modal','close','icon-button close-modal',`aria-label="${t('close')}"`)}</div><form id="note-form"><div class="form-field"><label for="note-app">${t('chooseApp')}</label><select id="note-app" name="app">${apps.map(a=>`<option value="${a.id}" ${(existing?.app||state.appId)===a.id?'selected':''}>${a.name} · ${t(a.platform)}</option>`).join('')}</select></div><div class="form-field"><label for="note-title">${t(isRelease?'versionField':'noteTitle')}</label><input id="note-title" name="title" value="${esc(existing?text(existing.title):'')}" maxlength="120" required ${isRelease?'placeholder="2.9.0"':''}></div><div class="form-field"><label for="note-body">${t(isRelease?'releaseNote':'noteContent')}</label><textarea id="note-body" name="body" rows="5" maxlength="4000" required>${esc(existing?text(existing.body):'')}</textarea></div><p class="fine-print">${t('aiWarning')} ${t('noteHint')}</p><div class="modal-footer">${button(t('cancel'),'close-modal','','button')}<button class="button primary" type="submit">${t('save')}</button></div></form>`;
  }
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">${content}</section></div>`;
}

function drawer() {
  return state.drawer?`<div class="drawer-backdrop"><section class="detail-drawer" role="dialog" aria-modal="true" aria-label="${t('appDetail')}" tabindex="-1"><div class="drawer-heading"><h2>${t('appDetail')}</h2>${button(t('close'),'close-drawer','close','icon-button',`aria-label="${t('close')}"`)}</div>${detailCompact()}<div class="drawer-divider"></div><p class="muted">${t('dataCoverageText')}</p>${button(t('viewApp'),'full-detail','arrow','button primary full-width')}</section></div>`:'';
}

function render() {
  setTheme();
  if(concept==='comparison'){renderComparison();return;}
  const content=state.page==='portfolio'?portfolio():state.page==='appDetail'?appDetail():state.page==='aso'?aso():state.page==='journal'?journal():settings();
  const shellStart=concept==='spectrum'?`<header class="spectrum-nav">${brand()}${nav()}<div class="spectrum-owner">${icon('lock')}<span>${t('owner')}</span><span class="owner-avatar">Q</span></div></header>`:`<aside class="sidebar ${state.menu?'menu-open':''}" ${innerWidth<=600&&!state.menu?'inert':''}>${brand(concept==='focus')}${nav()}<div class="sidebar-bottom"><a href="index.html" class="back-designs">${icon('grid')}<span>${t('compareDesigns')}</span></a><div class="sidebar-owner"><span class="owner-avatar">Q</span><div><strong>Quyen</strong><span>${t('owner')}</span></div></div></div></aside>`;
  root.innerHTML=`${shellStart}<div class="app-shell">${topbar()}<div class="work-area">${concept==='focus'?appPane():''}<main id="main-content" class="main-content">${titleBlock()}${['portfolio','appDetail','aso'].includes(state.page)?toolbar():''}${alert()}<div class="page-content">${content}</div><footer class="prototype-footer"><span>${t('mockOnly')} · ${concept[0].toUpperCase()+concept.slice(1)}</span><label>${t('demoState')}<select data-control="scenario" aria-label="${t('demoState')}">${['ready','loading','empty','error','stale'].map(k=>`<option value="${k}" ${state.scenario===k?'selected':''}>${t(k)}</option>`).join('')}</select></label></footer></main></div></div>${modal()}${drawer()}<div class="toast ${state.toast?'visible':''}" role="status">${icon('check')}<span>${esc(state.toast)}</span></div>`;
  document.body.classList.toggle('overlay-open',!!state.modal||state.drawer);
  updateHash();
}

function renderComparison() {
  root.innerHTML=`<header class="comparison-header">${brand()}<div><span class="mock-badge">${t('prototype')}</span>${preferences()}</div></header><main id="main-content" class="comparison-main"><div class="comparison-intro"><h1>${t('comparisonTitle')}</h1><p>${t('comparisonSubtitle')}</p><span>${t('compareLead')}</span></div><div class="concept-grid">${[['pulse','A','Pulse','pulsePitch','pulseDetail'],['spectrum','B','Spectrum','spectrumPitch','spectrumDetail'],['focus','C','Focus','focusPitch','focusDetail']].map(([key,letter,name,pitch,detail])=>`<article class="concept-card ${key}"><a href="${key}.html" class="concept-preview" aria-label="${t('reviewPrototype')} ${name}"><img src="screenshots/${key}-portfolio-1440.jpg" alt="${name} · ${t('portfolio')}" width="1440" height="1000"><span class="preview-open">${icon('arrow')}</span></a><div class="concept-description"><div class="concept-title"><span class="concept-letter">${letter}</span><h2>${name}</h2><span class="concept-colors"><i></i><i></i><i></i></span></div><h3>${t(pitch)}</h3><p>${t(detail)}</p><div class="concept-bottom"><span>${t('screenCount')}</span><a class="button primary" href="${key}.html">${t('independent')}${icon('arrow')}</a></div></div></article>`).join('')}</div><div class="review-note">${icon('info')}<p>${t('reviewHint')}</p></div><div class="comparison-features">${['light','dark','vietnamese','english','publicOnly'].map(k=>`<span>${icon('check')}${t(k)}</span>`).join('')}</div></main>`;
}

let toastTimer;
function toast(message) { state.toast=message; render(); clearTimeout(toastTimer); toastTimer=setTimeout(()=>{state.toast='';const el=document.querySelector('.toast');el?.classList.remove('visible');},3200); }
let lastFocus;
function openModal(value) {lastFocus=document.activeElement;state.modal=value;render();setTimeout(()=>document.querySelector('.modal input:not([type=checkbox]), .modal .close-modal, .modal')?.focus(),0);}
function closeOverlay() {const key=lastFocus?.dataset.action;state.modal=null;state.drawer=false;render();if(key){const id=lastFocus?.dataset.id,page=lastFocus?.dataset.page;document.querySelector(`[data-action="${key}"]${id?`[data-id="${id}"]`:''}${page?`[data-page="${page}"]`:''}`)?.focus();}}
function updateHash(){if(concept==='comparison')return;const hash=`#${state.page}`;if(location.hash!==hash)history.replaceState(null,'',hash);}

root.addEventListener('click',event=>{
  const el=event.target.closest('[data-action]');
  if(!el)return;
  const action=el.dataset.action;
  if(action==='nav'){state.page=el.dataset.page;state.menu=false;state.drawer=false;render();document.querySelector('h1')?.focus();}
  else if(action==='language'){state.lang=state.lang==='vi'?'en':'vi';persist();render();document.querySelector('[data-action=language]')?.focus();}
  else if(action==='theme'){state.theme=el.dataset.value;persist();render();document.querySelector(`[data-action=theme][data-value="${state.theme}"]`)?.focus();}
  else if(action==='menu'){state.menu=!state.menu;render();document.querySelector(state.menu?'.sidebar .nav-item.active':'[data-action=menu]')?.focus();}
  else if(action==='open-app'||action==='select-app'){
    state.appId=el.dataset.id;
    if(action==='open-app'&&concept==='spectrum'){lastFocus=el;state.drawer=true;render();document.querySelector('.detail-drawer .icon-button')?.focus();}
    else if(action==='select-app'){if(!['portfolio','appDetail','aso'].includes(state.page))state.page='appDetail';render();document.querySelector(`[data-action=select-app][data-id="${state.appId}"]`)?.focus({preventScroll:true});}
    else {state.page='appDetail';render();document.querySelector('h1')?.focus();window.scrollTo({top:0,behavior:'instant'});}
  }
  else if(action==='full-detail'){state.drawer=false;state.page='appDetail';render();document.querySelector('h1')?.focus();}
  else if(action==='close-drawer'||action==='close-modal')closeOverlay();
  else if(action==='tab'){const control=el.dataset.control,value=el.dataset.value;state[control]=value;render();document.querySelector(`[data-control="${control}"][data-value="${value}"]`)?.focus();}
  else if(action==='reset'){state.query='';state.platform='all';state.scenario='ready';render();}
  else if(action==='sync'||action==='retry'){
    state.busy=true;render();setTimeout(()=>{state.busy=false;state.scenario='ready';toast(t('synced'));},750);
  }
  else if(action==='ai'){state.aiPrivate=false;state.aiNotes=false;state.aiConsent=false;openModal({type:'ai'});}
  else if(action==='run-ai'&&state.aiConsent){state.modal=null;state.auditComplete=true;state.page='aso';state.asoTab='storeListing';toast(t('auditDone'));}
  else if(action==='reset-data'){state.notes=structuredClone(initialNotes);state.extraReleases=[];state.keywords=['note taking','offline notes','daily journal','simple notes'];state.frequency='1';state.notifications=false;state.auditComplete=false;persist();toast(t('resetSaved'));}
  else if(action==='new-note')openModal({type:'note'});
  else if(action==='new-release')openModal({type:'release'});
  else if(action==='edit-note')openModal({type:'note',note:state.notes.find(n=>n.id===el.dataset.id)});
  else if(action==='delete-note'){state.notes=state.notes.filter(n=>n.id!==el.dataset.id);persist();toast(t('deletedNote'));}
  else if(action==='test-connection'){state.testing=el.dataset.key;render();setTimeout(()=>{state.testing='';toast(t(state.scenario==='error'?'connectionFail':'connectionOK'));},700);}
  else if(action==='reply'){const reply=document.querySelector('#sample-reply');reply.hidden=!reply.hidden;el.setAttribute('aria-expanded',String(!reply.hidden));}
  else if(action==='export'){
    const headers=[t('appColumn'),t('platform'),t('installs'),t('revenue'),t('originCurrency')];
    const rows=visibleApps().map(a=>[a.name,t(a.platform),installCount(a),a.revenue===null?'':(a.revenue*state.range/30).toFixed(2),a.revenue===null?'':a.currency]);
    const csv='\uFEFF'+[headers,...rows].map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const link=document.createElement('a');link.href=url;link.download='apprankly-sample.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(t('exportDone'));
  }
});

root.addEventListener('change',event=>{
  const control=event.target.dataset.control;if(!control)return;
  const focusId=event.target.id;
  state[control]=event.target.type==='checkbox'?event.target.checked:control==='range'?Number(event.target.value):event.target.value;
  if(['aiPrivate','aiNotes'].includes(control))state.aiConsent=false;
  persist();render();
  if(focusId)document.getElementById(focusId)?.focus();
  else document.querySelector(`[data-control="${control}"]`)?.focus();
});

root.addEventListener('input',event=>{
  const key=event.target.dataset.control;
  if(!['search','noteQuery'].includes(key))return;
  const position=event.target.selectionStart, value=event.target.value;
  state[key==='search'?'query':key]=value;render();
  const input=document.querySelector(`[data-control="${key}"]`);input?.focus();try{input?.setSelectionRange(position,position);}catch{}
});

root.addEventListener('submit',event=>{
  event.preventDefault();const form=event.target;const data=new FormData(form);
  if(form.id==='settings-form'){state.frequency=data.get('frequency');state.notifications=data.has('notifications');persist();toast(t('scheduleSaved'));}
  else if(form.id==='keyword-form'){
    const value=String(data.get('keyword')||'').trim();if(!value)return;
    if(state.keywords.some(k=>k.toLowerCase()===value.toLowerCase())){toast(t('keywordExists'));return;}
    state.keywords.push(value);persist();toast(t('keywordAdded'));
  }
  else if(form.id==='note-form'){
    const title=String(data.get('title')||'').trim(),body=String(data.get('body')||'').trim();
    if(!title||!body){form.querySelector('input[name=title]')?.focus();return;}
    const newValue={app:data.get('app'),title:{vi:title,en:title},date:'2026-10-30'};
    if(state.modal.type==='release'){
      state.extraReleases.unshift({...newValue,version:title,title:{vi:body,en:body}});state.modal=null;persist();toast(t('releaseSaved'));
    }else{
      const note={...newValue,id:state.modal.note?.id||`note-${Date.now()}`,body:{vi:body,en:body},tags:'analysis'};
      const index=state.notes.findIndex(n=>n.id===note.id);if(index<0)state.notes.unshift(note);else state.notes[index]=note;
      state.modal=null;persist();toast(t('savedNote'));
    }
  }
});

document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&state.menu){state.menu=false;render();document.querySelector('[data-action=menu]')?.focus();}
  if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)&&event.target.matches('[role=tab]')){const buttons=[...event.target.parentElement.querySelectorAll('[role=tab]')],i=buttons.indexOf(event.target),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length;event.preventDefault();const value=buttons[next].dataset.value,control=buttons[next].dataset.control;state[control]=value;render();document.querySelector(`[data-control="${control}"][data-value="${value}"]`)?.focus();}
  if(event.key==='Escape'&&(state.modal||state.drawer)){event.preventDefault();closeOverlay();}
  if(event.key==='Tab'&&(state.modal||state.drawer)){
    const overlay=document.querySelector(state.modal?'.modal':'.detail-drawer');
    const controls=[...overlay.querySelectorAll('button:not([disabled]),input,select,textarea,[tabindex="0"]')].filter(x=>!x.hidden);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
});

function chartTip(event,visible) {
  const point=event.target.closest?.('.chart-point');if(!point)return;
  const wrap=point.closest('.chart-wrap'),tip=wrap.querySelector('.chart-tooltip');
  tip.textContent=point.dataset.tip;tip.classList.toggle('visible',visible);
  const rect=point.getBoundingClientRect(),parent=wrap.getBoundingClientRect();
  tip.style.left=`${Math.max(10,Math.min(parent.width-150,rect.left-parent.left))}px`;
  tip.style.top=`${Math.max(0,rect.top-parent.top-36)}px`;
}
root.addEventListener('pointerover',e=>chartTip(e,true));root.addEventListener('pointerout',e=>chartTip(e,false));root.addEventListener('focusin',e=>chartTip(e,true));root.addEventListener('focusout',e=>chartTip(e,false));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(state.theme==='system')render();});
let chartBand=innerWidth<=600?0:innerWidth<=800?1:2;window.addEventListener('resize',()=>{const next=innerWidth<=600?0:innerWidth<=800?1:2;if(next!==chartBand){chartBand=next;state.menu=false;render();}});
const initialPage=location.hash.slice(1);if(navItems.some(([key])=>key===initialPage))state.page=initialPage;
window.addEventListener('hashchange',()=>{const page=location.hash.slice(1);if(navItems.some(([key])=>key===page)){state.page=page;render();}});
render();
