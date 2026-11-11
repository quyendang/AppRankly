import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { revenueSummary, usdSummary } from "./revenue.js";
import { BulkReplyDialog, CountryTable, EventsPanel, RankHistory, TemplatePicker, renderTemplate, useTemplates } from "./insights.jsx";
import {
  LayoutGrid,
  Smartphone,
  Settings,
  Sun,
  Moon,
  Monitor,
  Globe,
  Lock,
  RefreshCw,
  Download,
  Search,
  Sparkles,
  LogOut,
  Bell,
  Trash2,
  Pencil,
  Info,
  Send,
  ArrowLeft,
  AlertTriangle,
  FileJson,
  Clock,
} from "lucide-react";
import { buildTasks } from "./tasks.js";
import { Num, Skel, Toasts, toast, transition } from "./motion.jsx";
import { ActionInbox, AppCard, CommandPalette, Delta, ReleaseImpact, SyncDots, SyncProgress } from "./today.jsx";
import { trendSeries } from "./series.js";
import {
  AppIcon,
  PlatformLabel,
  appColor,
  Avatar,
  Button,
  Chart,
  Dialog,
  Empty,
  Panel,
  Tabs,
  FormField,
  api,
  csvDownload,
  download,
} from "./components.jsx";
const platforms = ["apple", "google"];
const sources = ["apple", "google", "rates", "insights", "reviews"];
const pages = [
  ["portfolio", LayoutGrid],
  ["appDetail", Smartphone],
  ["settings", Settings],
];
const day = 86400000;
function rangeFor(days, offset = 0) {
  const now = new Date();
  const end = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      day -
      offset * day,
  );
  return {
    startDate: new Date(+end - (days - 1) * day).toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}
function readPreference(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
export default function App() {
  const { t, i18n } = useTranslation();
  const [authenticated, setAuthenticated] = useState(null),
    [page, setPage] = useState(
      location.hash === "#aso" ? "appDetail" : pages.some(([p]) => p === location.hash.slice(1))
        ? location.hash.slice(1)
        : "portfolio",
    );
  const [theme, setTheme] = useState(
      readPreference("apprankly_theme", "system"),
    ),
    [systemDark, setSystemDark] = useState(
      matchMedia("(prefers-color-scheme:dark)").matches,
    );
  const resolvedTheme =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const [exchange, setExchange] = useState(null);
  const [period, setPeriod] = useState(30),
    [platform, setPlatform] = useState("all"),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("installs");
  // Each store is loaded on its own so the faster one renders first; results are cached per period.
  const [byPlatform, setByPlatform] = useState({}),
    [prevByPlatform, setPrevByPlatform] = useState({}),
    [range, setRange] = useState(null),
    [warnings, setWarnings] = useState([]),
    [pendingPlatforms, setPendingPlatforms] = useState([]),
    [sourceState, setSourceState] = useState({}),
    [anomalies, setAnomalies] = useState([]),
    [openReviews, setOpenReviews] = useState([]),
    [dismissed, setDismissed] = useState(() => { try { return JSON.parse(localStorage.getItem("apprankly_dismissed") || "[]"); } catch { return []; } }),
    [inboxAll, setInboxAll] = useState(false),
    [palette, setPalette] = useState(false),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [settings, setSettings] = useState(null),
    [integrations, setIntegrations] = useState(null),
    [notifications, setNotifications] = useState([]);
  const [detailTab, setDetailTab] = useState(location.hash === "#aso" ? "storeListing" : "overview"),
    [dimensions, setDimensions] = useState(null),
    [dimensionBusy, setDimensionBusy] = useState(false);
  const [asoById, setAsoById] = useState({}),
    [asoErrors, setAsoErrors] = useState({}),
    [searchCompetitors, setSearchCompetitors] = useState([]);
  const [modal, setModal] = useState(null),

    [aiResult, setAiResult] = useState(null),
    [refresh, setRefresh] = useState(0);
  const [rankCountry, setRankCountry] = useState("us");
  const [reviewFilter, setReviewFilter] = useState("allReviews");
  const [picked, setPicked] = useState([]),
    [digestPreview, setDigestPreview] = useState("");
  const heading = useRef(null),
    pending = useRef(false),
    portfolioCache = useRef(new Map()),
    asoInflight = useRef(new Map()),
    loadToken = useRef(0),
    syncWatch = useRef(false),
    loadedRef = useRef(new Set());
  const data = range ? { apps: platforms.flatMap((p) => byPlatform[p] || []), range, warnings } : null;
  const previous = platforms.flatMap((p) => prevByPlatform[p] || []);
  const loading = pendingPlatforms.length > 0;
  const number = useCallback(
    (v, digits = 0) =>
      v == null
        ? "—"
        : new Intl.NumberFormat(i18n.language, {
            maximumFractionDigits: digits,
          }).format(v),
    [i18n.language],
  );
  const formatDate = (value) =>
    value
      ? new Intl.DateTimeFormat(i18n.language, {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(new Date(value.length === 10 ? value + "T12:00:00Z" : value))
      : "—";
  const apps = data?.apps || [],
    current = apps.find((a) => a.id === selected) || apps[0];
  const entry = current ? asoById[current.id] : null;
  const asoData = entry?.data || null,
    asoBusy = !!current && !asoData && !asoErrors[current.id],
    events = entry?.events || [],
    rankHistory = entry?.history || [];
  const setAsoData = (fn) => current && setAsoById((all) => ({ ...all, [current.id]: { ...all[current.id], data: typeof fn === "function" ? fn(all[current.id]?.data) : fn } }));
  const setEvents = (list) => current && setAsoById((all) => ({ ...all, [current.id]: { ...all[current.id], events: list } }));
  const filtered = apps
    .filter(
      (a) =>
        (platform === "all" || a.platform === platform) &&
        a.name.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => {
      const value = (app) => sort === "growth" ? growth(app) ?? -1e9
        : sort === "revenue" ? usdSummary([app], exchange).total ?? -1
        : sort === "rating" ? app.rating ?? -1 : app.installs ?? -1;
      return value(b) - value(a);
    });
  function growth(app) {
    const old = previous.find((a) => a.id === app.id)?.installs;
    return app.installs != null && old > 0
      ? (app.installs / old - 1) * 100
      : null;
  }
  function notify(code) {
    toast(t(code, { defaultValue: code }));
  }
  const handleError = useCallback((e) => {
    if (e.name === "AbortError") return;
    if (e.message === "AUTH_REQUIRED") setAuthenticated(false);
    setError(e.message || "OPERATION_FAILED");
  }, []);
  async function action(fn, success) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      if (success) notify(success);
    } catch (e) {
      handleError(e);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const stamp = (key, state, extra = {}) =>
    setSourceState((all) => ({ ...all, [key]: { state, at: new Date().toISOString(), ...extra } }));
  // ASO data per app, kept after the first load so switching apps or tabs never refetches.
  const loadASO = useCallback(
    (appId, { force = false } = {}) => {
      if (!appId) return Promise.resolve();
      if (!force && asoInflight.current.has(appId)) return asoInflight.current.get(appId);
      const id = encodeURIComponent(appId);
      const work = Promise.all([
        api("/api/aso/app/" + id),
        api("/api/aso/ranks/history?appId=" + id).catch(() => ({ history: [] })),
        api("/api/aso/events?appId=" + id).catch(() => ({ events: [] })),
      ])
        .then(([next, history, eventList]) => {
          setAsoById((all) => ({ ...all, [appId]: { data: next, history: history.history, events: eventList.events } }));
          setAsoErrors((all) => { const copy = { ...all }; delete copy[appId]; return copy; });
          setAiResult((r) => (appId === current?.id ? next.aiResult || null : r));
        })
        .catch((e) => {
          if (e.message === "AUTH_REQUIRED") setAuthenticated(false);
          setAsoErrors((all) => ({ ...all, [appId]: e.message || "OPERATION_FAILED" }));
        })
        .finally(() => asoInflight.current.delete(appId));
      asoInflight.current.set(appId, work);
      return work;
    },
    [current?.id],
  );
  const warmApp = (appId) => { if (appId && !asoById[appId] && !asoInflight.current.has(appId)) loadASO(appId); };
  const loadOpenReviews = useCallback(() => {
    stamp("reviews", "loading");
    return api("/api/insights/open-reviews")
      .then((r) => { setOpenReviews(r.apps); stamp("reviews", "done", { count: r.apps.reduce((n, a) => n + a.open, 0) }); })
      .catch(() => stamp("reviews", "error"));
  }, []);
  useEffect(() => {
    api("/api/auth/me")
      .then(() => setAuthenticated(true))
      .catch((e) => {
        setAuthenticated(false);
        if (e.message !== "AUTH_REQUIRED") setError(e.message);
      });
  }, []);
  useEffect(() => {
    const key = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((v) => !v); }
      else if (e.key === "/" && !e.target.closest?.("input,textarea,select,[contenteditable]")) { e.preventDefault(); setPalette(true); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme:dark)"),
      update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    try {
      localStorage.setItem("apprankly_theme", theme);
    } catch {}
  }, [theme, resolvedTheme]);
  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);
  useEffect(() => {
    location.hash = page;
    heading.current?.focus({ preventScroll: true });
  }, [page]);
  useEffect(() => {
    const change = () => {
      if (location.hash === "#aso") { setPage("appDetail"); setDetailTab("storeListing"); }
      else if (location.hash === "#journal") setPage("portfolio");
      else if (pages.some(([p]) => p === location.hash.slice(1)))
        setPage(location.hash.slice(1));
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    const token = ++loadToken.current, now = rangeFor(period), old = rangeFor(period, period);
    const key = period + ":" + refresh;
    const cached = portfolioCache.current.get(key);
    setError("");
    if (cached) {
      setByPlatform(cached.now); setPrevByPlatform(cached.old); setRange(cached.range); setWarnings(cached.warnings);
      setPendingPlatforms([]);
      return;
    }
    // Old numbers stay on screen (marked as updating) until each store answers.
    setPendingPlatforms(platforms);
    const result = { now: {}, old: {}, range: now, warnings: [] };
    Promise.all(platforms.map((p) => {
      stamp(p, "loading");
      return Promise.all([
        api("/api/portfolio", { method: "POST", body: { ...now, platform: p } }),
        api("/api/portfolio", { method: "POST", body: { ...old, platform: p } }),
      ]).then(([cur, prev]) => {
        result.now[p] = cur.apps; result.old[p] = prev.apps; result.range = cur.range;
        result.warnings = [...new Set([...result.warnings, ...(cur.warnings || [])])];
        if (token !== loadToken.current) return;
        setByPlatform((all) => ({ ...all, [p]: cur.apps }));
        setPrevByPlatform((all) => ({ ...all, [p]: prev.apps }));
        setRange(cur.range);
        setWarnings((w) => [...new Set([...w, ...(cur.warnings || [])])]);
        stamp(p, "done", { count: cur.apps.length });
        setSelected((id) => id || cur.apps[0]?.id || "");
      }).catch((e) => {
        if (token !== loadToken.current) return;
        stamp(p, "error");
        handleError(e);
        throw e;
      }).finally(() => {
        if (token === loadToken.current) setPendingPlatforms((list) => list.filter((x) => x !== p));
      });
    })).then(() => portfolioCache.current.set(key, result)).catch(() => {});
  }, [authenticated, period, refresh, handleError]);
  // Prefetch another period when the pointer rests on its button.
  function prefetchPeriod(value) {
    const key = value + ":" + refresh;
    if (!authenticated || value === period || portfolioCache.current.has(key) || portfolioCache.current.has(key + ":pending")) return;
    portfolioCache.current.set(key + ":pending", true);
    const now = rangeFor(value), old = rangeFor(value, value), result = { now: {}, old: {}, range: now, warnings: [] };
    Promise.all(platforms.map((p) => Promise.all([
      api("/api/portfolio", { method: "POST", body: { ...now, platform: p } }),
      api("/api/portfolio", { method: "POST", body: { ...old, platform: p } }),
    ]).then(([cur, prev]) => { result.now[p] = cur.apps; result.old[p] = prev.apps; result.range = cur.range; })))
      .then(() => portfolioCache.current.set(key, result))
      .catch(() => {})
      .finally(() => portfolioCache.current.delete(key + ":pending"));
  }
  useEffect(() => {
    if (!authenticated) return;
    stamp("insights", "loading");
    api("/api/insights/anomalies").then((r) => { setAnomalies(r.anomalies); stamp("insights", "done", { count: r.anomalies.length }); }).catch(() => stamp("insights", "error"));
    loadOpenReviews();
  }, [authenticated, refresh, loadOpenReviews]);
  // Once both stores have answered, load each app's reviews in the background, one at a time,
  // so the To do list covers apps that have not been opened yet.
  const appIds = apps.map((a) => a.id).join("|");
  useEffect(() => {
    if (!authenticated || pendingPlatforms.length || !appIds) return;
    let stopped = false;
    (async () => {
      for (const id of appIds.split("|")) {
        if (stopped) return;
        if (loadedRef.current.has(id)) continue;
        loadedRef.current.add(id);
        if (!asoInflight.current.has(id)) await loadASO(id).catch(() => {});
        await new Promise((r) => setTimeout(r, 250));
      }
    })();
    return () => { stopped = true; };
  }, [authenticated, pendingPlatforms.length, appIds, refresh]);
  useEffect(() => {
    try { localStorage.setItem("apprankly_dismissed", JSON.stringify(dismissed.slice(-200))); } catch {}
  }, [dismissed]);
  useEffect(() => {
    if (!authenticated) return;
    const abort = new AbortController();
    Promise.all([
      api("/api/settings", { signal: abort.signal }),
      api("/api/integrations", { signal: abort.signal }),
      api("/api/notifications", { signal: abort.signal }),
    ])
      .then(([s, i, alerts]) => {
        setSettings(s);
        setIntegrations(i);
        setNotifications(alerts.notifications);
      })
      .catch(handleError);
    return () => abort.abort();
  }, [authenticated, handleError]);
  useEffect(() => {
    if (!authenticated) return;
    const abort = new AbortController();
    const load = () => {
      stamp("rates", "loading");
      return api("/api/exchange-rates", { signal: abort.signal })
        .then((r) => { setExchange(r); stamp("rates", r.status === "stale" ? "error" : "done"); })
        .catch((e) => { if (e.name !== "AbortError") stamp("rates", "error"); });
    };
    load();
    const timer = setInterval(load, 3600000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [authenticated, refresh]);
  useEffect(() => {
    if (!authenticated || page !== "appDetail" || !current) return;
    setPicked([]);
    setAiResult(asoById[current.id]?.data?.aiResult || null);
    if (!asoById[current.id]) loadASO(current.id);
  }, [page, current?.id, authenticated, loadASO]);
  useEffect(() => {
    if (!authenticated || page !== "appDetail" || !current || !["overview", "countries", "versions"].includes(detailTab)) return;
    const abort = new AbortController();
    setDimensions(null);
    setDimensionBusy(true);
    api("/api/dimension", {
      method: "POST",
      body: {
        appId: current.id,
        dimension: detailTab === "versions" ? "app_version" : "country",
        ...rangeFor(period),
      },
      signal: abort.signal,
    })
      .then(setDimensions)
      .catch(handleError)
      .finally(() => {
        if (!abort.signal.aborted) setDimensionBusy(false);
      });
    return () => abort.abort();
  }, [page, current?.id, period, detailTab, authenticated, handleError]);
  function navigate(next, { tab, kind } = {}) {
    const go = () => {
      setPage(next);
      if (tab) setDetailTab(tab);

      setPalette(false);
      setError("");
      scrollTo({ top: 0 });
    };
    if (next === page && !tab) return;
    transition(go, kind || (next === "appDetail" ? "expand" : page === "appDetail" ? "collapse" : "page"));
  }
  function openApp(id, tab) {
    if (page === "appDetail") { transition(() => { setSelected(id); if (tab) setDetailTab(tab); setPalette(false); }, "swap"); return; }
    setSelected(id);
    warmApp(id);
    navigate("appDetail", { tab });
  }
  async function sync() {
    await action(async () => {
      await api("/api/refresh", { method: "POST", body: {} });
      portfolioCache.current.clear();
      loadedRef.current.clear();
      setAsoById({});
      setRefresh((v) => v + 1);
    });
    syncWatch.current = true;
  }
  const syncing = busy && syncWatch.current || sources.some((k) => sourceState[k]?.state === "loading");
  useEffect(() => {
    if (!syncWatch.current || sources.some((k) => sourceState[k]?.state === "loading") || pendingPlatforms.length) return;
    syncWatch.current = false;
    const failed = sources.filter((k) => sourceState[k]?.state === "error").length;
    toast(failed ? t("syncPartial", { count: failed }) : t("syncDone"), { tone: failed ? "warn" : "ok" });
  }, [sourceState, pendingPlatforms, t]);
  function revenueAmounts(list) {
    const { hasReports, entries } = revenueSummary(list);
    if (!hasReports) return (
      <span className="muted" title={t("noCurrencyData")}>
        —
      </span>
    );
    if (!entries.length) return (
      <div className="revenue-zero"><strong>0</strong><span>{t("zeroRevenue")}</span></div>
    );
    const row = ([currency, value]) => (
      <div className="revenue-amount" key={currency}>
        <strong>{number(value, 2)}</strong><span>{currency}</span>
      </div>
    );
    return <div className="revenue-summary">
      {entries.slice(0, 2).map(row)}
      {entries.length > 2 && <details className="revenue-more">
        <summary>{t("moreCurrencies", { count: entries.length - 2 })}</summary>
        <div className="revenue-breakdown">{entries.slice(2).map(row)}</div>
      </details>}
    </div>;
  }
  function revenue(list, compact = false) {
    const converted = usdSummary(list, exchange);
    if (compact) {
      const { hasReports, entries } = revenueSummary(list);
      return <div className="revenue-amount" title={entries.map(([c, v]) => number(v, 2) + " " + c).join(" · ") || undefined}>
        <strong>{!hasReports || converted.total == null ? "—" : number(converted.total, 2)}</strong><span>USD</span>
      </div>;
    }
    return <div className="revenue-groups">
      <div className="usd-total"><span className="revenue-basis">{t("convertedTotal")}</span>
        <div className="revenue-amount"><strong>{converted.total == null ? "—" : number(converted.total, 2)}</strong><span>USD</span></div>
        {!!converted.missing.length && <small className="revenue-coverage">{t("missingRates", { currencies: converted.missing.join(", ") })}</small>}
      </div>
      <details className="original-revenue"><summary>{t("originalAmounts")}</summary>
      <div className="revenue-groups">{["apple", "google"].map(platform => {
      const group = list.filter(app => app.platform === platform);
      if (!group.length) return null;
      const values = platform === "google" ? group.map(app => ({ ...app, revenueByCurrency: app.grossRevenueByCurrency || {} })) : group;
      return <div className="revenue-group" key={platform}>
        <span className="revenue-basis">{t(platform === "apple" ? "appleNetRevenue" : "googleGrossRevenue")}</span>
        {revenueAmounts(values)}
        {platform === "google" && group.some(app => app.revenueStatus !== "available") &&
          <span className="revenue-coverage">{t(group.some(app => app.revenueAvailable) ? "revenuePartial" : "revenueUnavailable")}</span>}
      </div>;
      })}</div></details>
    </div>;
  }
  function exchangeInfo(list) {
    const converted = usdSummary(list, exchange);
    const currencies = [...new Set(list.flatMap(app => Object.entries((app.platform === "google" ? app.grossRevenueByCurrency : app.revenueByCurrency) || {})
      .filter(([, amount]) => Number.isFinite(amount) && amount !== 0).map(([currency]) => currency)))].filter(currency => currency !== "USD");
    return <div className="fx-info">
      <span>{t("usdEstimateHint")}</span>
      {list.some(app => app.platform === "apple") && list.some(app => app.platform === "google") && <span>{t("mixedRevenueBasis")}</span>}
      {!!currencies.length && <details><summary>{t("exchangeRates")} · Frankfurter {converted.dates.length ? "· " + converted.dates.join(" / ") : ""}</summary>
        {currencies.map(currency => <span key={currency}>{exchange?.rates?.[currency] ? `1 ${currency} = ${number(exchange.rates[currency].rate, 6)} USD · ${exchange.rates[currency].date}` : t("missingRates", { currencies: currency })}</span>)}
      </details>}
      {exchange?.status === "stale" && <span role="status">{t("staleRates")}</span>}
    </div>;
  }
  function usdValue(list) {
    const { hasReports } = revenueSummary(list.map((a) => (a.platform === "google" ? { ...a, revenueByCurrency: a.grossRevenueByCurrency || {} } : a)));
    const converted = usdSummary(list, exchange);
    if (!hasReports && !list.some((a) => a.revenueAvailable)) return <span className="muted" title={t("noCurrencyData")}>—</span>;
    if (!exchange) return <Skel w="4em" />;
    return converted.total == null
      ? <span className="muted" title={t("missingRates", { currencies: converted.missing.join(", ") })}>—</span>
      : <><Num value={converted.total} format={(v) => number(v, 2)} /><small className="ccy">USD</small></>;
  }
  // Loaded review lists are fresher than the server archive summary, so they win when present.
  const reviewSummary = useMemo(() => {
    const merged = new Map(openReviews.map((r) => [r.appId, r]));
    for (const [appId, item] of Object.entries(asoById)) {
      const list = item?.data?.reviews;
      if (!list) continue;
      const open = list.filter((r) => r.canReply && !r.replyText);
      const low = open.filter((r) => Number(r.rating ?? r.score) > 0 && Number(r.rating ?? r.score) <= 2);
      const latest = open.map((r) => r.date).filter(Boolean).sort().at(-1) || null;
      const sample = [...low].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
      merged.set(appId, { appId, open: open.length, low: low.length, latest, sample: sample && { id: sample.id, rating: sample.rating ?? sample.score, text: String(sample.text || "").slice(0, 160), date: sample.date } });
    }
    return [...merged.values()];
  }, [openReviews, asoById]);
  const tasks = useMemo(
    () => buildTasks({ apps, openReviews: reviewSummary, anomalies, rangeEnd: data?.range?.endDate, dismissed }),
    [apps, reviewSummary, anomalies, data?.range?.endDate, dismissed],
  );
  function dismissTask(key) {
    transition(() => setDismissed((list) => [...list, key]));
    toast(t("taskDismissed"), { undoLabel: t("undo"), undo: () => setDismissed((list) => list.filter((k) => k !== key)) });
  }
  function openTask(task, text) {
    if (text.settings) { navigate("settings"); return; }
    if (text.tab === "reviews") setReviewFilter("unanswered");
    openApp(task.app.id, text.tab);
  }
  function greeting() {
    const h = new Date().getHours();
    return t(h < 11 ? "greetingMorning" : h < 18 ? "greetingAfternoon" : "greetingEvening");
  }
  function todayView() {
    const firstLoad = !apps.length && loading;
    const tot = (() => {
      const avail = filtered.filter((a) => a.installs != null), total = avail.reduce((n, a) => n + a.installs, 0);
      const old = previous.filter((a) => filtered.some((x) => x.id === a.id) && a.installs != null).reduce((n, a) => n + a.installs, 0);
      return { value: avail.length ? total : null, change: old > 0 && avail.length ? (total / old - 1) * 100 : null };
    })();
    const days = trendSeries(filtered, [], data?.range);
    const lastIndex = days.values.map((v, i) => [v, i]).filter(([v]) => Number.isFinite(v)).at(-1);
    return (
      <section className="today-hero">
        <div className="th-greet">
          <p className="th-date">{new Intl.DateTimeFormat(i18n.language, { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p>
          <h1 ref={heading} tabIndex={-1}>{greeting()}.</h1>
          <p className="th-lead">{firstLoad ? <Skel w="14em" /> : tasks.length
            ? <>{t("todayLead", { count: tasks.length }).split(String(tasks.length))[0]}<b className="lead-n">{tasks.length}</b>{t("todayLead", { count: tasks.length }).split(String(tasks.length)).slice(1).join(String(tasks.length))}</>
            : t("todayLeadNone")}</p>
        </div>
        <dl className="th-stats">
          <div><dt>{t("yesterday")}</dt><dd>{lastIndex ? <Num value={lastIndex[0]} format={(v) => number(v)} /> : firstLoad ? <Skel w="3em" /> : "—"}</dd>
            <small>{t("installs").toLowerCase()}{lastIndex ? " · " + formatDate(days.dates[lastIndex[1]]) : ""}</small></div>
          <div><dt>{t("periodDays", { count: period })}</dt><dd>{tot.value == null ? (firstLoad ? <Skel w="4em" /> : "—") : <Num value={tot.value} format={(v) => number(v)} />}</dd><Delta value={tot.change} number={number} /></div>
          <div className="rev"><dt>{t("estimatedUsd")}</dt><dd>{firstLoad ? <Skel w="4em" /> : usdValue(filtered)}</dd>
            <details className="fx-details"><summary><Info className="icon" />{t("howCalculated")}</summary><div className="fx-pop">{revenue(filtered)}{exchangeInfo(filtered)}</div></details></div>
        </dl>
        <div className="th-inbox">
          <h2>{t("actionCenter")} <span className="badge-new">{t("new")}</span></h2>
          <ActionInbox tasks={tasks} loading={firstLoad || sourceState.reviews?.state === "loading" && !openReviews.length}
            expanded={inboxAll} onToggle={() => transition(() => setInboxAll((v) => !v))}
            onOpen={openTask} onDone={dismissTask} number={number} formatDate={formatDate} />
        </div>
      </section>
    );
  }
  function appGrid() {
    const max = Math.max(1, ...filtered.flatMap((a) => (a.dailyTrends || []).map((d) => d.installs || 0)));
    return (
      <section className="apps-sec">
        <div className="sec-head">
          <h2>{t("yourApps")} <small className="tnum">{apps.length || ""}</small></h2>
          <div className="filters">
            <label className="search-field">
              <Search className="icon" />
              <input type="search" aria-label={t("searchLabel")} placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div className="segmented" role="group" aria-label={t("platform")}>
              {[["all", t("allPlatforms")], ["apple", "iOS"], ["google", "Android"]].map(([k, l]) => (
                <button type="button" key={k} aria-pressed={platform === k} onClick={() => transition(() => setPlatform(k))}>{l}</button>
              ))}
            </div>
            <select className="sort-select" aria-label={t("sort")} value={sort} onChange={(e) => transition(() => setSort(e.target.value))}>
              {["installs", "growth", "revenue", "rating"].map((k) => <option key={k} value={k}>{t("sort" + k[0].toUpperCase() + k.slice(1))}</option>)}
            </select>
            <Button icon={Download} onClick={() => exportData()} disabled={!filtered.length}>CSV</Button>
            <Button icon={FileJson} onClick={() => exportData(true)} disabled={!filtered.length}>JSON</Button>
          </div>
        </div>
        {!apps.length && loading ? (
          <ul className="cards" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => <li className="app-card-wrap" key={i}><div className="app-card skeleton"><span className="card-top"><Skel w="40px" h="40px" /><span className="card-name"><Skel w="7em" /><Skel w="5em" h=".8em" /></span></span><Skel h="48px" /><span className="card-stats"><Skel w="4em" /><Skel w="4em" /><Skel w="3em" /></span></div></li>)}
          </ul>
        ) : !apps.length ? (
          <Empty title="firstConnection" text="firstConnectionHint" action={<Button primary onClick={() => navigate("settings")}>{t("viewSettings")}</Button>} />
        ) : !filtered.length ? (
          <Empty title="emptyTitle" text="emptyText" action={<Button onClick={() => { setQuery(""); setPlatform("all"); }}>{t("resetFilters")}</Button>} />
        ) : (
          <ul className="cards">
            {filtered.map((a) => (
              <AppCard key={a.id} app={a} change={growth(a)} revenue={usdValue([a])} pending={pendingPlatforms.includes(a.platform)}
                openReviews={reviewSummary.find((r) => r.appId === a.id)?.open || 0} max={max} number={number}
                onOpen={() => openApp(a.id, "overview")} onWarm={() => warmApp(a.id)} />
            ))}
          </ul>
        )}
        {!!apps.length && (
          <div className="lower">
            <Panel title={t("trend")} description={t("currentPeriod") + " · " + t("previousPeriod") + " ┄"}>
              <Chart apps={filtered} previous={previous.filter((a) => filtered.some((x) => x.id === a.id))} theme={resolvedTheme} range={data?.range} />
            </Panel>
            <Panel title={<>{t("syncSources")} <span className="badge-new">{t("new")}</span></>}>
              <SyncProgress state={sourceState} onSync={sync} syncing={syncing} />
            </Panel>
          </div>
        )}
      </section>
    );
  }
  function detailHead() {
    const idx = filtered.findIndex((a) => a.id === current.id);
    const color = appColor(current);
    return (
      <section className="detail-head" style={{ "--app": color, viewTransitionName: "card-" + current.id.replace(/[^a-zA-Z0-9_-]/g, "-") }}>
        <div className="dh-row">
          <button type="button" className="back" onClick={() => navigate("portfolio")}><ArrowLeft className="icon" /><span>{t("today")}</span></button>
          <div className="dh-switch" role="group" aria-label={t("chooseApp")}>
            {filtered.map((a) => (
              <button type="button" key={a.id} aria-current={a.id === current.id ? "true" : undefined} title={a.name} aria-label={a.name}
                onClick={() => a.id !== current.id && openApp(a.id)} onPointerEnter={() => warmApp(a.id)}>
                <AppIcon app={a} size="xs" />
              </button>
            ))}
          </div>
        </div>
        <div className="dh-id">
          <AppIcon app={current} size="xl" />
          <div>
            <h1 ref={heading} tabIndex={-1}>{current.name}</h1>
            <p><PlatformLabel app={current} /><code>{current.packageName}</code></p>
          </div>
          <Button primary icon={Sparkles} onClick={() => setModal({ type: "ai" })}><span>{t("previewAI")}</span></Button>
        </div>
        <dl className="dh-stats">
          <div><dt>{t("installs")} · {t("periodDays", { count: period })}</dt><dd>{current.installs == null ? "—" : <Num value={current.installs} format={(v) => number(v)} />}</dd><Delta value={growth(current)} number={number} /></div>
          <div className="rev"><dt>{t("estimatedUsd")}</dt><dd>{usdValue([current])}</dd>
            <details className="fx-details"><summary><Info className="icon" />{t("howCalculated")}</summary><div className="fx-pop">{revenue([current])}{exchangeInfo([current])}</div></details></div>
          <div><dt>{t("storeRating")}</dt><dd>{number(current.rating, 1)}{current.rating != null && <em aria-hidden="true">★</em>}</dd><small>{t("reportDate")}: {formatDate(current.lastDate)}</small></div>
          <div className="dh-period">{periodSwitch()}{idx >= 0 && <small>{idx + 1} / {filtered.length}</small>}</div>
        </dl>
        {(current.error || current.installs == null) && !pendingPlatforms.includes(current.platform) && (
          <p className="dh-status" role="status"><AlertTriangle className="icon" />{current.sourceStatus ? t("appleReportHTTP", { status: current.sourceStatus }) : t(current.error === "SOURCE_FAILED" ? "appSourceFailed" : "appNoReports")}</p>
        )}
      </section>
    );
  }
  function periodSwitch() {
    return (
      <div className="segmented" role="group" aria-label={t("chooseRange")}>
        {[7, 30, 90].map((v) => (
          <button type="button" key={v} aria-pressed={period === v} onClick={() => setPeriod(v)} onPointerEnter={() => prefetchPeriod(v)} onFocus={() => prefetchPeriod(v)}>
            {t("periodDays", { count: v })}
          </button>
        ))}
      </div>
    );
  }
  function breakdown() {
    const rows = Array.isArray(dimensions) ? dimensions : [];
    const total = rows.reduce(
      (s, r) => s + (r.dailyUserInstalls ?? r.totalInstalls ?? 0),
      0,
    );
    return (
      <Panel title={t(detailTab === "versions" ? "versions" : "countries")}>
        <div aria-busy={dimensionBusy}>
          {dimensionBusy ? (
            [0, 1, 2, 3].map((i) => <div className="breakdown-row" key={i}><Skel w="5em" /><div className="bar-track"><Skel h="8px" /></div><Skel w="3em" /><Skel w="2.5em" /></div>)
          ) : rows.length ? (
            rows.slice(0, 20).map((r, i) => {
              const value = r.dailyUserInstalls ?? r.totalInstalls ?? 0;
              const label =
                detailTab === "versions"
                  ? r.label
                  : r.label && /^[A-Z]{2}$/.test(r.label)
                    ? new Intl.DisplayNames([i18n.language], {
                        type: "region",
                      }).of(r.label)
                    : r.label;
              return (
                <div className="breakdown-row" key={i}>
                  <span>{label}</span>
                  <div className="bar-track">
                    <div
                      style={{
                        width: (total ? (value / total) * 100 : 0) + "%",
                      }}
                    />
                  </div>
                  <strong>{number(value)}</strong>
                  <small>{number(total ? (value / total) * 100 : 0, 1)}%</small>
                </div>
              );
            })
          ) : (
            <p className="content-message">{t("noActualData")}</p>
          )}
        </div>
      </Panel>
    );
  }
  function detail() {
    if (!current)
      return <Empty title="firstConnection" text="firstConnectionHint" />;
    const tabs = ["overview", "countries", "versions", "storeListing", "keywords", "competitors", "reviews", "campaigns"];
    const openCount = reviewSummary.find((r) => r.appId === current.id)?.open || 0;
    return (
      <>
        {detailHead()}
        <div className="detail-nav">
          <Tabs
            items={tabs}
            value={detailTab}
            counts={{ reviews: openCount }}
            onChange={(tab) => transition(() => setDetailTab(tab), tabs.indexOf(tab) > tabs.indexOf(detailTab) ? "tab-fwd" : "tab-back")}
          />
        </div>
        <div className="tab-panel" role="tabpanel">
        {!["overview", "countries", "versions"].includes(detailTab) ? aso() : detailTab === "overview" ? (
          <>
            <Panel
              title={t("trend")}
              description={
                t("reportDate") + ": " + formatDate(current.lastDate)
              }
            >
              <Chart
                apps={[current]}
                previous={previous.filter((a) => a.id === current.id)}
                theme={resolvedTheme}
                range={data?.range}
                events={events}
                color={appColor(current)}
              />
            </Panel>
            <EventsPanel app={current} events={events} action={action} busy={busy}
              onChange={() => api("/api/aso/events?appId=" + encodeURIComponent(current.id)).then((r) => setEvents(r.events))} />
            <div className="detail-bottom">
              {breakdown()}
              <Panel title={t("dataCoverage")}>
                <div className="coverage-metric">
                  <span>{t("activeDevices")}</span>
                  <strong>{number(current.activeDevices)}</strong>
                  <small>
                    {current.activeDevices == null
                      ? t("unsupported")
                      : t("source")}
                  </small>
                </div>
                <div className="coverage-metric">
                  <span>{t("retention")}</span>
                  <strong>—</strong>
                  <small>{t("retentionUnavailable")}</small>
                </div>
                <p className="content-message">{t("dataCoverageText")}</p>
              </Panel>
            </div>
          </>
        ) : (
          <>
            {detailTab === "versions" && <ReleaseImpact app={current} events={events} number={number} formatDate={formatDate} />}
            {breakdown()}
            {detailTab === "countries" && <CountryTable app={current} range={rangeFor(period)} exchange={exchange} number={number} />}
          </>
        )}
        </div>
      </>
    );
  }
  function aso() {
    if (!current)
      return <Empty title="firstConnection" text="firstConnectionHint" />;
    const listing = asoData?.listing,
      keywords = asoData?.keywords || [],
      reviewList = asoData?.reviews || [];
    return (
      <>
        {asoErrors[current.id] && !asoData ? (
          <Panel title={t(detailTab)}>
            <p className="content-message" role="alert">{t(asoErrors[current.id], { defaultValue: t("OPERATION_FAILED") })}</p>
            <Button icon={RefreshCw} onClick={() => loadASO(current.id, { force: true })}>{t("retry")}</Button>
          </Panel>
        ) : asoBusy ? (
          <section className="panel" aria-busy="true">
            <span className="sr-only" role="status">{t("loading")}</span>
            <Skel w="9em" h="1.1em" />
            {[0, 1, 2, 3, 4].map((i) => <div className="skel-row" key={i}><Skel w={40 + i * 9 + "%"} /><Skel w="3.5em" /></div>)}
          </section>
        ) : detailTab === "storeListing" ? (
          <>
            <div className="aso-grid">
              <Panel title={t("listingSnapshot")} className="listing-panel">
                {listing ? (
                  <>
                    <div className="listing-brand">
                      <Avatar app={current} />
                      <span className="pill">{t("publicOnly")}</span>
                    </div>
                    {[
                      ["titleField", listing.title || listing.trackName],
                      ["subtitleField", listing.summary || listing.subtitle],
                      ["description", listing.description],
                    ].map(([key, value]) => (
                      <div className="listing-field" key={key}>
                        <span>{t(key)}</span>
                        <p>{value || t("notAvailable")}</p>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="content-message">{t("noListing")}</p>
                )}
              </Panel>
              <Panel title={t("listingAudit")} className="audit-panel">
                {aiResult ? (
                  <>
                    <h3>{t("aiResult")}</h3>
                    <p className="ai-result">{aiResult.summary}</p>
                    <ul>
                      {aiResult.recommendations?.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                    {aiResult.candidates?.map((item, i) => (
                      <p key={i}>{item}</p>
                    ))}
                  </>
                ) : (
                  <p className="content-message">{t("noPrivateConsent")}</p>
                )}
                <Button
                  primary
                  icon={Sparkles}
                  onClick={() => setModal({ type: "ai" })}
                >
                  {t("previewAI")}
                </Button>
                <p className="fine-print">{t("aiPrivacy")}</p>
              </Panel>
            </div>
          </>
        ) : detailTab === "keywords" ? (
          <>
          <Panel
            title={t("keywords")}
            action={
              <Button
                disabled={busy || !keywords.length}
                onClick={() =>
                  action(async () => {
                    await api("/api/aso/ranks", {
                      method: "POST",
                      body: { appId: current.id, country: rankCountry },
                    });
                    await loadASO(current.id, { force: true });
                  })
                }
              >
                {t("checkRanks")}
              </Button>
            }
          >
            <div className="rank-context">
              <FormField label={t("rankMarket")}>
                <select
                  value={rankCountry}
                  onChange={(e) => setRankCountry(e.target.value)}
                >
                  {["us", "vn", "gb", "jp", "kr", "de", "fr"].map((code) => (
                    <option key={code} value={code}>
                      {new Intl.DisplayNames([i18n.language], {
                        type: "region",
                      }).of(code.toUpperCase())}{" "}
                      ·{" "}
                      {
                        {
                          us: "en",
                          vn: "vi",
                          gb: "en",
                          jp: "ja",
                          kr: "ko",
                          de: "de",
                          fr: "fr",
                        }[code]
                      }
                    </option>
                  ))}
                </select>
              </FormField>
              <p className="fine-print">{t("rankSourceHelp")}</p>
            </div>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const term = new FormData(e.currentTarget).get("term");
                action(async () => {
                  await api("/api/aso/keywords", {
                    method: "POST",
                    body: { appId: current.id, term },
                  });
                  await loadASO(current.id, { force: true });
                }, "keywordCreated");
                e.currentTarget.reset();
              }}
            >
              <input
                name="term"
                required
                maxLength={80}
                aria-label={t("keyword")}
                placeholder={t("keywordPlaceholder")}
              />
              <Button type="submit" primary disabled={busy}>
                {t("addKeyword")}
              </Button>
            </form>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("keyword")}</th>
                    <th>{t("rank")}</th>
                    <th>{t("date")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {keywords.map((k) => {
                    const rank = asoData.ranks.find(
                      (r) => r.keyword_id === k.id && r.country === rankCountry,
                    );
                    return (
                      <tr key={k.id}>
                        <td>{k.term}</td>
                        <td>
                          {rank?.rank ??
                            (rank
                              ? rank.top_n
                                ? t("rankNotFound", { count: rank.top_n })
                                : t("rankNoResults")
                              : "—")}
                        </td>
                        <td>{rank ? formatDate(rank.checked_at) : "—"}</td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={t("delete") + " " + k.term}
                            onClick={() =>
                              action(async () => {
                                await api("/api/aso/keywords/" + k.id, {
                                  method: "DELETE",
                                });
                                await loadASO(current.id, { force: true });
                              })
                            }
                          >
                            <Trash2 className="icon" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!keywords.length && (
              <p className="content-message">{t("noKeywords")}</p>
            )}
          </Panel>
          <RankHistory history={rankHistory} events={events} theme={resolvedTheme} />
          </>
        ) : detailTab === "competitors" ? (
          <Panel title={t("competitors")}>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const term = new FormData(e.currentTarget).get("term");
                action(async () => {
                  const result = await api("/api/aso/competitors", {
                    method: "POST",
                    body: { appId: current.id, term },
                  });
                  setSearchCompetitors(result.competitors);
                });
              }}
            >
              <input
                name="term"
                required
                maxLength={100}
                aria-label={t("searchTerm")}
                placeholder={t("searchTerm")}
              />
              <Button primary type="submit" disabled={busy}>
                {t("findCompetitors")}
              </Button>
            </form>
            <div className="competitor-list">
              {[...(asoData?.competitors || []), ...searchCompetitors].map(
                (c, i) => (
                  <div className="competitor-row" key={i}>
                    <strong>{c.title || c.name || c.trackName}</strong>
                    <span>
                      {t("rating")}: {number(c.score ?? c.rating, 1)}
                    </span>
                    <Button
                      disabled={busy || !!c.competitor_key}
                      onClick={() =>
                        action(async () => {
                          await api("/api/aso/competitors/track", {
                            method: "POST",
                            body: {
                              appId: current.id,
                              competitorId: String(
                                c.appId || c.bundleId || c.id,
                              ),
                            },
                          });
                          setSearchCompetitors([]);
                          await loadASO(current.id, { force: true });
                        })
                      }
                    >
                      {t(c.competitor_key ? "tracked" : "add")}
                    </Button>
                  </div>
                ),
              )}
            </div>
          </Panel>
        ) : detailTab === "reviews" ? (
          <Panel title={t("reviews")}>
            <div className="review-toolbar">
              <Tabs items={["allReviews", "unanswered", "answered"]} value={reviewFilter} onChange={setReviewFilter} />
              <Button icon={RefreshCw} disabled={busy} onClick={() => action(async () => {
                const next = await api("/api/aso/reviews/refresh", { method: "POST", body: { appId: current.id } });
                setAsoData(data => ({ ...data, reviews: next.reviews, reviewSourceStatus: next.sourceStatus }));
              })}>{t("refreshReviews")}</Button>
            </div>
            {(() => {
              const open = reviewList.filter(r => r.canReply && !r.replyText).slice(0, 20);
              return <div className="bulk-bar">
                <Button disabled={busy || !open.length} onClick={() => setPicked(open.map(r => r.id))}>{t("selectUnanswered")}</Button>
                {!!picked.length && <>
                  <Button onClick={() => setPicked([])}>{t("clearSelection")}</Button>
                  <Button primary icon={Send} disabled={busy} onClick={() => { setError(""); setModal({ type: "bulk" }); }}>
                    {t("bulkReply")} ({picked.length})
                  </Button>
                </>}
              </div>;
            })()}
            <p className="content-message">{t(current.platform === "google" ? "googleReviewCoverage" : "appleReviewCoverage")}</p>
            {asoData?.reviewSourceStatus === "unavailable" && <p className="content-message" role="status">{t("reviewSourceUnavailable")}</p>}
            {reviewList.filter(r => reviewFilter === "allReviews" || (reviewFilter === "answered" ? !!r.replyText : !r.replyText)).length ? (
              reviewList.filter(r => reviewFilter === "allReviews" || (reviewFilter === "answered" ? !!r.replyText : !r.replyText)).map((r, i) => (
                <article className="review" key={r.id || i}>
                  <div>
                    {r.canReply && !r.replyText && <input type="checkbox" className="review-pick" checked={picked.includes(r.id)} disabled={busy}
                      aria-label={t("bulkReply") + " " + (r.userName || r.author || "")}
                      onChange={e => setPicked(list => e.target.checked ? [...list, r.id].slice(0, 20) : list.filter(id => id !== r.id))} />}
                    <strong>{r.userName || r.author || t("anonymousReviewer")}</strong>
                    <span>{number(r.score || r.rating, 1)} / 5</span>
                    {r.date && <time>{formatDate(r.date)}</time>}
                  </div>
                  <p>{r.text || r.body || r.title}</p>
                  {r.replyText && <div className="reply-text">
                    <strong>{t("developerReply")}</strong>
                    <p>{r.replyText}</p>
                    {r.replyDate && <small>{formatDate(r.replyDate)}</small>}
                    {r.responseState === "PENDING_PUBLISH" && <small> · {t("pendingPublish")}</small>}
                  </div>}
                  {r.canReply && <Button disabled={busy} icon={Pencil} onClick={() => { setError(""); setModal({ type: "review", app: current, review: r }); }}>
                    {t(r.replyText ? "editReviewReply" : "replyReview")}
                  </Button>}
                </article>
              ))
            ) : (
              <p className="content-message">{t(reviewList.length ? "noFilteredReviews" : "noReviews")}</p>
            )}
          </Panel>
        ) : (
          <Panel title={t("campaigns")}>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                action(async () => {
                  await api("/api/aso/campaigns", {
                    method: "POST",
                    body: {
                      appId: current.id,
                      name: form.get("name"),
                      source: form.get("source"),
                    },
                  });
                  await loadASO(current.id, { force: true });
                }, "linkCreated");
              }}
            >
              <input
                name="name"
                required
                maxLength={100}
                placeholder={t("campaignName")}
                aria-label={t("campaignName")}
              />
              <input
                name="source"
                required
                maxLength={100}
                placeholder={t("campaignSource")}
                aria-label={t("campaignSource")}
              />
              <Button primary type="submit" disabled={busy}>
                {t("createCampaign")}
              </Button>
            </form>
            {asoData?.campaigns?.map((c) => (
              <div className="campaign-row" key={c.id}>
                <strong>{c.name}</strong>
                <a href={c.universal_url} target="_blank" rel="noreferrer">
                  {c.universal_url}
                </a>
                <span>{c.clicks}</span>
                <button
                  className="icon-button"
                  aria-label={t("delete") + " " + c.name}
                  onClick={() =>
                    action(async () => {
                      await api("/api/aso/campaigns/" + c.id, {
                        method: "DELETE",
                      });
                      await loadASO(current.id, { force: true });
                    })
                  }
                >
                  <Trash2 className="icon" />
                </button>
              </div>
            ))}
          </Panel>
        )}
      </>
    );
  }
  function settingsPage() {
    return (
      <div className="settings-grid">
        <Panel title={t("connections")} className="connections-panel">
          <p className="secure-note">
            <Lock className="icon" />
            {t("serverOnly")}
          </p>
          {[
            ["google", "G"],
            ["apple", "A"],
          ].map(([key, letter]) => (
            <div className="connection-row" key={key}>
              <span className={"connection-icon " + key}>{letter}</span>
              <div className="connection-text">
                <h3>{t(key)}</h3>
                <p>
                  {t(key === "google" ? "googleStatusHint" : "appleStatusHint")}
                </p>
                <span className="connection-status">
                  {t(
                    integrations?.[key]?.configured
                      ? "connected"
                      : "notConfigured",
                  )}
                </span>
              </div>
              <Button
                disabled={busy || !integrations?.[key]?.configured}
                onClick={() =>
                  action(
                    () =>
                      api("/api/integrations/" + key + "/test", {
                        method: "POST",
                        body: {},
                      }),
                    "connectionOK",
                  )
                }
              >
                {t("checkConnection")}
              </Button>
            </div>
          ))}
          <div className="connection-row">
            <span className="connection-icon aiProvider">AI</span>
            <div className="connection-text">
              <h3>{integrations?.ai?.defaultProvider || "AI"}</h3>
              <p>{t("aiPrivacy")}</p>
              <span>
                {t(
                  integrations?.ai?.providers?.some((p) => p.available)
                    ? "connected"
                    : "notConfigured",
                )}
              </span>
            </div>
          </div>
          <details className="setup-help">
            <summary>{t("setupHelp")}</summary>
            <p>{t("settingsReadOnly")}</p>
            <code>
              GOOGLE_SERVICE_ACCOUNT_JSON
              <br />
              GOOGLE_BUCKET_NAME
              <br />
              APPLE_PRIVATE_KEY
              <br />
              APPLE_ISSUER_ID
              <br />
              APPLE_KEY_ID
              <br />
              APPLE_VENDOR_ID
              <br />
              OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY
            </code>
          </details>
          <div className="rank-context">
            <h3>{t("addGoogleApp")}</h3>
            <p className="fine-print">{t("newAppHelp")}</p>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const packageName = new FormData(e.currentTarget)
                  .get("packageName")
                  .trim();
                action(async () => {
                  await api("/api/apps/google", {
                    method: "POST",
                    body: { packageName },
                  });
                  setSettings(await api("/api/settings"));
                  setRefresh((v) => v + 1);
                }, "appAdded");
              }}
            >
              <input
                name="packageName"
                required
                maxLength={200}
                placeholder="com.example.app"
                aria-label={t("packageName")}
              />
              <Button type="submit" primary disabled={busy}>
                {t("add")}
              </Button>
            </form>
            {settings?.googlePackages?.map((id) => (
              <div key={id} className="manual-package">
                <code>{id}</code>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("removeTrackedApp") + " " + id}
                  onClick={() =>
                    action(async () => {
                      setSettings(
                        await api("/api/settings", {
                          method: "PUT",
                          body: {
                            googlePackages: settings.googlePackages.filter(
                              (item) => item !== id,
                            ),
                          },
                        }),
                      );
                      setRefresh((v) => v + 1);
                    }, "settingsSaved")
                  }
                >
                  <Trash2 className="icon" />
                </button>
              </div>
            ))}
          </div>
        </Panel>
        <Panel
          title={t("preferences")}
          className="preferences-panel"
          action={
            <Button
              icon={Bell}
              onClick={() => setModal({ type: "notifications" })}
            >
              {t("notifications")}
            </Button>
          }
        >
          <div className="setting-group">
            <span className="setting-label">{t("theme")}</span>
            <div className="theme-options">
              {[
                ["light", Sun],
                ["dark", Moon],
                ["system", Monitor],
              ].map(([key, Icon]) => (
                <button
                  key={key}
                  className={
                    "theme-option " + (theme === key ? "selected" : "")
                  }
                  aria-pressed={theme === key}
                  onClick={() => setTheme(key)}
                >
                  <Icon className="icon" />
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
          <FormField label={t("language")}>
            <select
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
            >
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select>
          </FormField>
          {settings && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                action(async () => {
                  const next = await api("/api/settings", {
                    method: "PUT",
                    body: {
                      refreshIntervalHours: Number(form.get("frequency")),
                      notificationsEnabled: form.has("notifications"),
                      digest: form.get("digest"),
                      digestHour: Number(form.get("digestHour")),
                      digestLocale: form.get("digestLocale"),
                      anomalyThreshold: Number(form.get("anomalyThreshold")),
                    },
                  });
                  setSettings(next);
                }, "settingsSaved");
              }}
            >
              <div className="setting-group">
                <label htmlFor="frequency">{t("schedule")}</label>
                <select
                  id="frequency"
                  name="frequency"
                  defaultValue={settings.refreshIntervalHours}
                >
                  {[1, 3, 6, 12, 24].map((v) => (
                    <option value={v} key={v}>
                      {t("hoursInterval", { count: v })}
                    </option>
                  ))}
                </select>
                <small>{t("frequencyChanged")}</small>
              </div>
              <div className="timezone-setting">
                <span>{t("timezone")}</span>
                <strong>{settings.timezone}</strong>
              </div>
              <div className="notification-setting">
                <div>
                  <label htmlFor="notifications">
                    {t("optionalNotifications")}
                  </label>
                  <p>{t("notificationTargets")}</p>
                </div>
                <input
                  id="notifications"
                  className="toggle"
                  name="notifications"
                  type="checkbox"
                  role="switch"
                  defaultChecked={settings.notificationsEnabled}
                />
              </div>
              <div className="setting-group digest-settings">
                <h3>{t("digestSection")}</h3>
                <div className="digest-grid">
                  <FormField label={t("digestMode")}>
                    <select name="digest" defaultValue={settings.digest}>
                      {["off", "daily", "weekly"].map((v) => <option key={v} value={v}>{t("digest" + v[0].toUpperCase() + v.slice(1))}</option>)}
                    </select>
                  </FormField>
                  <FormField label={t("digestHour")}>
                    <select name="digestHour" defaultValue={settings.digestHour}>
                      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                    </select>
                  </FormField>
                  <FormField label={t("digestLocale")}>
                    <select name="digestLocale" defaultValue={settings.digestLocale}>
                      <option value="vi">Tiếng Việt</option>
                      <option value="en">English</option>
                    </select>
                  </FormField>
                  <FormField label={t("anomalyThreshold")}>
                    <input name="anomalyThreshold" type="number" min={10} max={90} defaultValue={settings.anomalyThreshold} />
                  </FormField>
                </div>
                <small>{t("digestHint")}</small>
                <div className="digest-actions">
                  <Button disabled={busy} onClick={() => action(async () => {
                    setDigestPreview((await api("/api/insights/digest?period=" + (settings.digest === "weekly" ? "weekly" : "daily"))).message);
                  })}>{t("digestPreview")}</Button>
                  {settings.notificationsEnabled && integrations?.notifications?.configured && (
                    <Button disabled={busy} onClick={() => action(() => api("/api/insights/digest/send", { method: "POST", body: { period: settings.digest === "weekly" ? "weekly" : "daily" } }), "digestSent")}>
                      {t("digestSend")}
                    </Button>
                  )}
                </div>
                {digestPreview && <pre className="digest-preview">{digestPreview}</pre>}
              </div>
              <Button primary type="submit" disabled={busy}>
                {t("save")}
              </Button>
              {settings.notificationsEnabled &&
                integrations?.notifications?.configured && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      action(
                        () =>
                          api("/api/notifications/test", {
                            method: "POST",
                            body: {},
                          }),
                        "notificationSent",
                      )
                    }
                  >
                    {t("notificationTest")}
                  </Button>
                )}
            </form>
          )}
        </Panel>
      </div>
    );
  }
  function exportData(raw = false) {
    if (raw)
      download(
        "apprankly.json",
        JSON.stringify(
          { range: rangeFor(period), apps: filtered, exchangeRates: exchange },
          null,
          2,
        ),
      );
    else csvDownload(filtered, t);
    notify("dataExported");
  }
  if (authenticated === null)
    return (
      <main className="login-screen">
        <RefreshCw
          className="icon spin"
          role="status"
          aria-label={t("loading")}
        />
      </main>
    );
  if (!authenticated)
    return (
      <main className="login-screen">
        <section className="login-box">
          <Brand />
          <h1>{t("loginTitle")}</h1>
          <p>{t("loginHint")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const password = new FormData(e.currentTarget).get("password");
              action(async () => {
                await api("/api/auth/login", {
                  method: "POST",
                  body: { password },
                });
                setAuthenticated(true);
              });
            }}
          >
            <FormField label={t("password")}>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
              />
            </FormField>
            {error && (
              <p role="alert" className="login-error">
                {t(error, { defaultValue: t("OPERATION_FAILED") })}
              </p>
            )}
            <Button primary type="submit" disabled={busy}>
              {t("login")}
            </Button>
          </form>
          <button
            className="text-button"
            onClick={() =>
              i18n.changeLanguage(i18n.language === "vi" ? "en" : "vi")
            }
          >
            <Globe className="icon" />
            {i18n.language === "vi" ? "English" : "Tiếng Việt"}
          </button>
        </section>
      </main>
    );
  const navItems = [["portfolio", LayoutGrid, "today"], ["appDetail", Smartphone, "appDetail"], ["palette", Search, "commandPalette"], ["settings", Settings, "settings"]];
  const unread = notifications.some((n) => !n.read);
  const logout = () => action(async () => {
    await api("/api/auth/logout", { method: "POST", body: {} });
    setAuthenticated(false);
    setByPlatform({}); setPrevByPlatform({}); setRange(null); portfolioCache.current.clear(); setAsoById({});
    setExchange(null);
  });
  return (
    <>
      <a className="skip-link" href="#main-content">{t("overview")}</a>
      <header className="top">
        <Brand />
        <button type="button" className="cmd-trigger" onClick={() => setPalette(true)} aria-label={t("commandPalette")}>
          <Search className="icon" /><span>{t("commandPlaceholder")}</span><kbd>⌘K</kbd>
        </button>
        <div className="top-end">
          <SyncDots state={sourceState} onClick={sync} syncing={syncing} />
          <button className="icon-button" aria-label={t("notifications")} onClick={() => setModal({ type: "notifications" })}>
            <Bell className="icon" />{unread && <i className="notification-dot" />}
          </button>
          <button className="icon-button hide-sm" aria-label={t("settings")} aria-current={page === "settings" ? "page" : undefined} onClick={() => navigate("settings")}>
            <Settings className="icon" />
          </button>
          <button className="icon-button hide-sm" aria-label={t("logout")} onClick={logout}><LogOut className="icon" /></button>
        </div>
      </header>
      <main id="main-content" className={"main-content page-" + page}>
        {error && (
          <div className="state-banner error-banner" role="alert">
            <AlertTriangle className="icon" />
            <span>{t(error, { defaultValue: t("OPERATION_FAILED") })}</span>
            <Button onClick={() => { setError(""); portfolioCache.current.clear(); setRefresh((v) => v + 1); }}>{t("retry")}</Button>
          </div>
        )}
        {(!!data?.warnings?.length || apps.some((app) => app.error === "SOURCE_FAILED")) && (
          <div className="state-banner stale-banner"><Info className="icon" /><span>{t("sourceUnavailable")}</span></div>
        )}
        {!loading && apps.some((app) => app.lastDate && app.lastDate < data?.range?.endDate) && page === "portfolio" && (
          <div className="state-banner stale-banner"><Clock className="icon" /><span>{t("incompleteReports")}</span></div>
        )}
        {page === "portfolio" ? (
          <div className="page today">
            {todayView()}
            <div className="period-row">{periodSwitch()}<span className="toolbar-date">{formatDate(rangeFor(period).startDate)} – {formatDate(rangeFor(period).endDate)}</span></div>
            {appGrid()}
          </div>
        ) : page === "appDetail" ? (
          <div className="page detail" style={current ? { "--app": appColor(current) } : undefined}>{detail()}</div>
        ) : (
          <div className="page settings-page">
            <div className="page-title">
              <button type="button" className="back" onClick={() => navigate("portfolio")}><ArrowLeft className="icon" /><span>{t("today")}</span></button>
              <h1 ref={heading} tabIndex={-1}>{t("settings")}</h1>
              <p>{t("settingsSubtitle")}</p>
            </div>
            {settingsPage()}
          </div>
        )}
        <footer className="production-footer"><Lock className="icon" />{t("privateWorkspace")} · AppRankly</footer>
      </main>
      <nav className="bottomnav" aria-label={t("appsLabel")}>
        {navItems.map(([key, Icon, label]) => (
          <button type="button" key={key} aria-current={page === key ? "page" : undefined}
            onClick={() => (key === "palette" ? setPalette(true) : key === "appDetail" && !current ? null : navigate(key))}>
            <Icon className="icon" /><span>{t(label)}</span>
          </button>
        ))}
      </nav>
      {palette && (
        <CommandPalette apps={apps} current={page === "appDetail" ? current : null} theme={resolvedTheme} onClose={() => setPalette(false)}
          onOpenApp={(id) => openApp(id, page === "appDetail" ? undefined : "overview")}
          onTab={(tab) => (page === "appDetail" ? transition(() => setDetailTab(tab), "tab-fwd") : navigate("appDetail", { tab }))}
          onPage={(p) => navigate(p)} onSync={sync} onExport={() => exportData()}
          onAI={() => setModal({ type: "ai" })} onTheme={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          onLanguage={() => i18n.changeLanguage(i18n.language === "vi" ? "en" : "vi")} />
      )}
      {modal?.type === "ai" && (
        <AIDialog
          app={current}
          range={rangeFor(period)}
          busy={busy}
          action={action}
          onClose={() => setModal(null)}
          onResult={(result) => {
            setAiResult(result);
            navigate("appDetail");
            setDetailTab("storeListing");
            setModal(null);
          }}
        />
      )}
      {modal?.type === "bulk" && <BulkReplyDialog app={current} busy={busy} action={action} error={error}
        reviews={(asoData?.reviews || []).filter(r => picked.includes(r.id))}
        onClose={() => setModal(null)} onDone={() => { setModal(null); setPicked([]); loadASO(current.id, { force: true }); loadOpenReviews(); }} />}
      {modal?.type === "review" && <ReviewReplyDialog app={modal.app} review={modal.review} busy={busy} action={action} error={error}
        onClose={() => setModal(null)} onSaved={review => {
          setAsoData(data => ({ ...data, reviews: data.reviews.map(item => item.id === review.id ? review : item) }));
          setModal(null); notify("replyPublished"); loadOpenReviews();
        }} />}
      {modal?.type === "notifications" && (
        <Dialog title={t("notifications")} onClose={() => setModal(null)}>
          {!notifications.length && (
            <p className="content-message">{t("noNotifications")}</p>
          )}
          {notifications.map((n) => (
            <article className="review" key={n.id}>
              <h3>{n.title}</h3>
              <p>{n.message}</p>
              <small>{formatDate(n.timestamp)}</small>
            </article>
          ))}
          <Button
            onClick={() =>
              action(async () => {
                await api("/api/notifications/read", {
                  method: "POST",
                  body: {},
                });
                setNotifications((n) => n.map((x) => ({ ...x, read: true })));
              })
            }
          >
            {t("readNotifications")}
          </Button>
        </Dialog>
      )}
      <Toasts closeLabel={t("dismiss")} />
    </>
  );
}
function Brand() {
  return (
    <a className="brand" href="#portfolio" aria-label="AppRankly">
      <span className="brand-mark">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 17V9h4v8H4Zm6 0V5h4v12h-4Zm6 0v-6h4v6h-4Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span>
        AppRankly<span className="brand-period">.</span>
      </span>
    </a>
  );
}
function ReviewReplyDialog({ app, review, busy, action, error, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState(review.replyText || "");
  const [generating, setGenerating] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const limit = app.platform === "google" ? 350 : 5970;
  const [templates] = useTemplates();
  return <Dialog title={t("replyReview")} onClose={onClose}>
    <p className="modal-intro">{app.name} · {app.platform === "google" ? "Google Play" : "App Store"}</p>
    <blockquote className="review-quote">{review.text || review.body || review.title}</blockquote>
    <TemplatePicker templates={templates} onPick={body => { setText(renderTemplate(body, review, app, t("reviewerFallback")).slice(0, limit)); setConfirmed(false); }} />
    <FormField label={t("replyBody")}>
      <textarea rows={5} maxLength={limit} value={text} disabled={busy} onChange={event => { setText(event.target.value); setConfirmed(false); }} />
    </FormField>
    <p className="reply-count">{text.length} / {limit}</p>
    <Button disabled={busy} aria-busy={generating} icon={Sparkles} onClick={() => action(async () => {
      setGenerating(true);
      setConfirmed(false);
      try {
        const preview = await api("/api/ai/preview", { method: "POST", body: {
          appId: app.id, kind: "reviewReply", reviewId: review.id, locale: i18n.language,
        } });
        const result = await api("/api/ai/run", { method: "POST", body: { previewId: preview.previewId, confirmed: true } });
        const draft = result.result?.candidates?.[0];
        if (typeof draft !== "string" || !draft.trim() || draft.length > limit) throw new Error("AI_INVALID_RESPONSE");
        setText(draft); setConfirmed(false);
      } finally { setGenerating(false); }
    })}>{t(generating ? "generatingAIResponse" : "generateAIResponse")}</Button>
    <p className="privacy-note">{t("replyPublishHint")}</p>
    {error && <p role="alert" className="content-message">{t(error, { defaultValue: t("OPERATION_FAILED") })}</p>}
    <label className="consent-label"><input type="checkbox" disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t("confirmPublicReply")}</label>
    <div className="modal-footer">
      <Button onClick={onClose}>{t("cancel")}</Button>
      <Button primary disabled={busy || !confirmed || !text.trim() || text.length > limit} onClick={() => action(async () => {
        const result = await api("/api/aso/reviews/reply", { method: "POST", body: { appId: app.id, reviewId: review.id, text, confirmed: true } });
        onSaved(result.review);
      })}>{t(busy ? "saving" : "publishReply")}</Button>
    </div>
  </Dialog>;
}
function AIDialog({ app, range, action, busy, onClose, onResult }) {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState("audit"),
    [question, setQuestion] = useState(""),
    [metrics, setMetrics] = useState(false),
    [preview, setPreview] = useState(null),
    [confirmed, setConfirmed] = useState(false);
  function change(fn) {
    fn();
    setPreview(null);
    setConfirmed(false);
  }
  return (
    <Dialog title={t("aiTitle")} onClose={onClose}>
      <p className="modal-intro">{t("aiLiveHint")}</p>
      <FormField label={t("aiKind")}>
        <select
          value={kind}
          onChange={(e) => change(() => setKind(e.target.value))}
        >
          {["audit", "variants", "reviews", "ask"].map((k) => (
            <option value={k} key={k}>
              {t(k)}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label={t("aiQuestion")}>
        <textarea
          maxLength={1000}
          rows={2}
          value={question}
          onChange={(e) => change(() => setQuestion(e.target.value))}
        />
      </FormField>
      <div className="ai-options">
        <label>
          <input
            type="checkbox"
            checked={metrics}
            onChange={(e) => change(() => setMetrics(e.target.checked))}
          />
          {t("aiPrivate")}
        </label>
        <small>{t("aiPrivateHint")}</small>
      </div>
      <Button
        disabled={busy}
        onClick={() =>
          action(async () => {
            const result = await api("/api/ai/preview", {
              method: "POST",
              body: {
                appId: app.id,
                kind,
                question,
                includeMetrics: metrics,
                locale: i18n.language,
                range,
              },
            });
            setPreview(result);
            setConfirmed(false);
          })
        }
      >
        {t("buildPreview")}
      </Button>
      {preview && (
        <>
          {preview.destination && (
            <p className="privacy-note">
              {t("aiDestination", {
                provider: preview.destination.provider,
                origin: preview.destination.origin,
                model: preview.destination.model,
              })}
            </p>
          )}
          <pre className="payload">
            {JSON.stringify(preview.payload, null, 2)}
          </pre>
          <label className="consent-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t("aiConsent")}
          </label>
          <div className="modal-footer">
            <Button onClick={onClose}>{t("cancel")}</Button>
            <Button
              primary
              disabled={busy || !confirmed}
              onClick={() =>
                action(async () => {
                  const result = await api("/api/ai/run", {
                    method: "POST",
                    body: { previewId: preview.previewId, confirmed: true },
                  });
                  onResult(result.result);
                })
              }
            >
              {t(busy ? "aiRunning" : "runAI")}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
