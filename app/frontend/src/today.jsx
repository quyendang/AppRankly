import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight, ArrowUpRight, ArrowDownRight, Check, CheckCircle2, AlertTriangle, Loader2, CircleDashed, MessageSquare, Inbox, Clock, TrendingDown, TrendingUp, Flag, Search, Settings, RefreshCw, Download, Sparkles, Moon, Sun, Globe, LayoutGrid,
} from "lucide-react";
import { Panel, AppIcon, PlatformLabel, appColor, api } from "./components.jsx";
import { Num, Skel } from "./motion.jsx";

const ICONS = { lowReview: MessageSquare, reviews: Inbox, source: AlertTriangle, lag: Clock, drop: TrendingDown, spike: TrendingUp,
  revenueDrop: TrendingDown, revenueSpike: TrendingUp, rankDrop: Flag, rankRise: Flag };
const TONES = { lowReview: "neg", source: "neg", drop: "neg", revenueDrop: "neg", rankDrop: "neg", spike: "pos", revenueSpike: "pos", rankRise: "pos", reviews: "mid", lag: "info" };

export function taskText(task, t, number, formatDate) {
  const a = task.anomaly;
  switch (task.kind) {
    case "lowReview": return { title: t("taskLowReview", { count: task.count }), body: task.sample?.text ? "“" + task.sample.text + "”" : "", cta: t("taskReply"), tab: "reviews" };
    case "reviews": return { title: t("taskReviews", { count: task.count }), body: t("taskReviewsBody"), cta: t("taskOpenReviews"), tab: "reviews" };
    case "source": return { title: t("taskSource"), body: task.status ? t("appleReportHTTP", { status: task.status }) : t("taskSourceBody"), cta: t("taskCheck"), settings: true };
    case "lag": return { title: t("taskLag", { date: formatDate(task.lastDate) }), body: t("taskLagBody"), cta: t("taskOpen"), tab: "overview" };
    case "drop": case "spike":
      return { title: t(task.kind === "drop" ? "taskDrop" : "taskSpike", { percent: Math.abs(Math.round(a.change)) }), body: t("taskVsAverage", { latest: number(a.latest), avg: number(a.avg) }), cta: t("taskOpen"), tab: "overview" };
    case "revenueDrop": case "revenueSpike":
      return { title: t(task.kind === "revenueDrop" ? "taskRevenueDrop" : "taskRevenueSpike", { currency: a.currency, percent: Math.abs(Math.round(a.change)) }), body: t("taskVsAverage", { latest: number(a.latest, 2), avg: number(a.avg, 2) }), cta: t("taskOpen"), tab: "countries" };
    default:
      return { title: t(task.kind === "rankDrop" ? "taskRankDrop" : "taskRankRise", { term: a.term, country: String(a.country).toUpperCase() }), body: t("taskRankBody", { from: a.from ?? t("rankOut"), to: a.to ?? t("rankOut") }), cta: t("taskKeywords"), tab: "keywords" };
  }
}

export function ActionInbox({ tasks, loading, onOpen, onDone, expanded, onToggle, number, formatDate }) {
  const { t } = useTranslation();
  const [leaving, setLeaving] = useState([]);
  const shown = expanded ? tasks : tasks.slice(0, 5);
  if (loading && !tasks.length)
    return <ul className="inbox" aria-busy="true">{[0, 1, 2].map((i) => <li className="inbox-item" key={i}><Skel w="30px" h="30px" round /><div className="ib-body"><Skel w="60%" /><Skel w="85%" h=".85em" /></div></li>)}</ul>;
  if (!tasks.length)
    return <div className="inbox-clear"><span className="clear-mark"><Check className="icon" /></span><div><strong>{t("allClear")}</strong><p>{t("allClearHint")}</p></div></div>;
  return (
    <ul className="inbox">
      {shown.map((task, i) => {
        const text = taskText(task, t, number, formatDate), Icon = ICONS[task.kind] || Inbox, done = leaving.includes(task.key);
        return (
          <li key={task.key} className={"inbox-item " + (TONES[task.kind] || "info") + (done ? " is-done" : "")} style={{ "--i": i }}>
            <button type="button" className="done-btn" aria-label={t("markDone") + ": " + text.title}
              onClick={() => { setLeaving((l) => [...l, task.key]); setTimeout(() => { onDone(task.key); setLeaving((l) => l.filter((k) => k !== task.key)); }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 380); }}>
              <Check className="icon" />
            </button>
            <div className="ib-body">
              <div className="ib-title"><Icon className="icon ib-kind" aria-hidden="true" /><strong>{text.title}</strong>
                <span className="ib-app"><AppIcon app={task.app} size="xs" />{task.app.name}</span></div>
              {text.body && <p>{text.body}</p>}
            </div>
            <button type="button" className={"button small" + (TONES[task.kind] === "neg" ? " primary" : "")} onClick={() => onOpen(task, text)}>
              {text.cta}<ArrowRight className="icon" />
            </button>
          </li>
        );
      })}
      {tasks.length > 5 && <li className="inbox-more"><button type="button" className="text-button" onClick={onToggle}>{expanded ? t("showLess") : t("showMore", { count: tasks.length - 5 })}</button></li>}
    </ul>
  );
}

function Spark({ values, color, max }) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
  if (!pts.length) return <svg className="card-spark" viewBox="0 0 260 48" aria-hidden="true"><line x1="0" x2="260" y1="46" y2="46" className="spark-none" /></svg>;
  const x = (i) => (i / Math.max(1, values.length - 1)) * 258 + 1, y = (v) => 46 - (v / Math.max(max, 1)) * 42;
  const line = pts.map(([i, v], k) => (k ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join("");
  const area = line + `L${x(pts.at(-1)[0]).toFixed(1)} 48L${x(pts[0][0]).toFixed(1)} 48Z`;
  return (
    <svg className="card-spark" viewBox="0 0 260 48" preserveAspectRatio="none" aria-hidden="true">
      <path d={area} fill={color} opacity=".14" />
      <path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function AppCard({ app, change, revenue, pending, openReviews, max, number, onOpen, onWarm }) {
  const { t } = useTranslation();
  const color = appColor(app);
  return (
    <li className="app-card-wrap">
      <button type="button" className={"app-card" + (pending ? " is-updating" : "") + (app.error ? " has-error" : "")}
        style={{ "--app": color, viewTransitionName: "card-" + app.id.replace(/[^a-zA-Z0-9_-]/g, "-") }}
        onClick={onOpen} onPointerEnter={onWarm} onFocus={onWarm} aria-label={t("openApp", { name: app.name })}>
        <span className="card-top">
          <AppIcon app={app} />
          <span className="card-name"><strong>{app.name}</strong><PlatformLabel app={app} /></span>
          {app.error === "SOURCE_FAILED" ? <span className="pill neg"><AlertTriangle className="icon" />{app.sourceStatus ? "HTTP " + app.sourceStatus : t("appSourceFailed")}</span>
            : openReviews ? <span className="pill rev-pill"><MessageSquare className="icon" />{openReviews}</span> : null}
          {pending && <Loader2 className="icon spin card-flag" aria-label={t("updating")} />}
        </span>
        <span className="card-chart">{pending && app.installs == null ? <Skel h="48px" /> : <Spark values={(app.dailyTrends || []).map((d) => d.installs)} color={color} max={max} />}</span>
        <span className="card-stats">
          <span><small>{t("installs")}</small><b>{app.installs == null ? "—" : <Num value={app.installs} format={(v) => number(v)} />}</b><Delta value={change} number={number} /></span>
          <span><small>{t("revenue")}</small><b>{revenue}</b></span>
          <span><small>{t("rating")}</small><b>{number(app.rating, 1)}{app.rating != null && <em aria-hidden="true">★</em>}</b></span>
        </span>
      </button>
    </li>
  );
}

export function Delta({ value, number }) {
  if (value == null) return <span className="delta muted">—</span>;
  const Icon = value < 0 ? ArrowDownRight : ArrowUpRight;
  return <span className={"delta " + (value < 0 ? "negative" : value > 0 ? "positive" : "muted")}><Icon className="icon" />{number(Math.abs(value), 1)}%</span>;
}

export function SyncProgress({ state, onSync, syncing }) {
  const { t } = useTranslation();
  const rel = (at) => {
    if (!at) return "";
    const min = Math.round((Date.now() - Date.parse(at)) / 60000);
    return min < 1 ? t("justNow") : t("minutesAgo", { count: min });
  };
  const rows = [["apple", "srcApple"], ["google", "srcGoogle"], ["rates", "srcRates"], ["insights", "srcInsights"], ["reviews", "srcReviews"]];
  return (
    <div className="sync-progress" role="status" aria-live="polite">
      {rows.map(([key, label]) => {
        const s = state[key] || { state: "idle" };
        const Icon = s.state === "loading" ? Loader2 : s.state === "error" ? AlertTriangle : s.state === "done" ? CheckCircle2 : CircleDashed;
        return (
          <div className={"src " + s.state} key={key}>
            <Icon className={"icon" + (s.state === "loading" ? " spin" : "")} aria-hidden="true" />
            <span>{t(label)}</span>
            <small>{s.state === "loading" ? t("srcLoading") : s.state === "error" ? t("srcError") : s.state === "done" ? [s.count != null ? t("srcCount", { count: s.count }) : null, rel(s.at)].filter(Boolean).join(" · ") : t("srcIdle")}</small>
          </div>
        );
      })}
      {onSync && <button type="button" className="button small" onClick={onSync} disabled={syncing}><RefreshCw className={"icon" + (syncing ? " spin" : "")} />{t(syncing ? "syncing" : "sync")}</button>}
    </div>
  );
}

export function SyncDots({ state, onClick, syncing }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="sync-dots" onClick={onClick} disabled={syncing} aria-label={t("sync")} title={t("syncSources")}>
      {["apple", "google", "rates", "insights", "reviews"].map((k) => <i key={k} className={state[k]?.state || "idle"} />)}
      <span>{t(syncing ? "syncing" : "sync")}</span>
    </button>
  );
}

export function ReleaseImpact({ app, events, number, formatDate }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ loading: true });
  const releases = events.filter((e) => e.type === "release").map((e) => e.date).join();
  useEffect(() => {
    const abort = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    api("/api/insights/release-impact?appId=" + encodeURIComponent(app.id), { signal: abort.signal })
      .then((r) => setState({ rows: r.releases }))
      .catch((e) => e.name !== "AbortError" && setState({ error: true }));
    return () => abort.abort();
  }, [app.id, releases]);
  const body = state.loading && !state.rows ? [0, 1].map((i) => <div className="impact-row" key={i}><Skel w="40%" /><Skel h="3em" /></div>)
    : !state.rows?.length ? <p className="content-message">{t("impactEmpty")}</p>
    : <ol className="impact">{state.rows.map((v) => (
      <li key={v.id}>
        <div className="v-head"><strong>{v.label}</strong><time>{formatDate(v.date)}</time>{v.days < 7 && <span className="pill">{t("impactPartial", { count: v.days })}</span>}</div>
        <div className="v-stats">
          <div><small>{t("impactInstalls")}</small><Delta value={v.change} number={number} /><span className="fine-print">{number(v.before)} → {v.after == null ? "—" : number(v.after)} {t("perDay")}</span></div>
          <div><small>{t("impactRpi")}</small>{v.rpiChange == null ? <span className="muted" title={t("impactRpiMixed")}>—</span> : <Delta value={v.rpiChange} number={number} />}</div>
          <div><small>{t("impactReviews")}</small><b className="tnum">{v.reviews}</b>{!!v.low && <span className="pill neg">{t("impactLow", { count: v.low })}</span>}</div>
        </div>
      </li>))}</ol>;
  return <Panel title={<>{t("releaseImpact")} <span className="badge-new">{t("new")}</span></>} description={t("releaseImpactHint")} className="impact-panel">{body}</Panel>;
}

export function CommandPalette({ apps, current, onClose, onOpenApp, onTab, onPage, onSync, onExport, onAI, onTheme, onLanguage, theme }) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState(""), [sel, setSel] = useState(0);
  const input = useRef(null), list = useRef(null), previous = useRef(document.activeElement);
  useEffect(() => { input.current?.focus(); const p = previous.current; return () => p?.focus?.(); }, []);
  const items = useMemo(() => {
    const tabs = ["overview", "countries", "versions", "storeListing", "keywords", "competitors", "reviews", "campaigns"];
    const all = [
      ...apps.map((a) => ({ key: "app:" + a.id, app: a, label: a.name, sub: a.platform === "apple" ? "App Store" : "Google Play", run: () => onOpenApp(a.id) })),
      ...(current ? tabs.map((tab) => ({ key: "tab:" + tab, icon: ArrowRight, label: t(tab), sub: current.name, run: () => onTab(tab) })) : []),
      { key: "today", icon: LayoutGrid, label: t("today"), sub: "", run: () => onPage("portfolio") },
      { key: "settings", icon: Settings, label: t("settings"), sub: "", run: () => onPage("settings") },
      { key: "sync", icon: RefreshCw, label: t("sync"), sub: "", run: onSync },
      { key: "csv", icon: Download, label: t("export"), sub: "CSV", run: onExport },
      ...(current ? [{ key: "ai", icon: Sparkles, label: t("previewAI"), sub: current.name, run: onAI }] : []),
      { key: "theme", icon: theme === "dark" ? Sun : Moon, label: t("theme") + ": " + t(theme === "dark" ? "light" : "dark"), sub: "", run: onTheme },
      { key: "lang", icon: Globe, label: i18n.language === "vi" ? "English" : "Tiếng Việt", sub: t("language"), run: onLanguage },
    ];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((x) => (x.label + " " + x.sub).toLowerCase().includes(needle)) : all;
  }, [q, apps, current, theme, i18n.language, t]);
  const active = Math.min(sel, items.length - 1);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [active]);
  const run = (item) => { if (!item) return; onClose(); item.run(); };
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="palette" role="dialog" aria-modal="true" aria-label={t("commandPalette")}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); onClose(); }
          else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSel((active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(items.length, 1)); }
          else if (e.key === "Enter") { e.preventDefault(); run(items[active]); }
          else if (e.key === "Tab") e.preventDefault();
        }}>
        <label className="palette-input"><Search className="icon" /><input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }}
          placeholder={t("commandPlaceholder")} role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items.length ? "palette-" + active : undefined} autoComplete="off" /><kbd>esc</kbd></label>
        <ul id="palette-list" role="listbox" ref={list}>
          {items.length ? items.map((item, i) => (
            <li key={item.key} id={"palette-" + i} role="option" aria-selected={i === active} onMouseEnter={() => setSel(i)} onClick={() => run(item)}>
              {item.app ? <AppIcon app={item.app} size="xs" /> : <span className="palette-icon">{React.createElement(item.icon, { className: "icon" })}</span>}
              <span>{item.label}</span><small>{item.sub}</small>
            </li>
          )) : <li className="palette-empty">{t("commandEmpty")}</li>}
        </ul>
      </section>
    </div>
  );
}
