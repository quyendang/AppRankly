import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { revenueSummary, usdSummary } from "./revenue.js";
import { AnomalyPanel, BulkReplyDialog, CountryTable, EventsPanel, RankHistory, TemplatePicker, renderTemplate, useTemplates } from "./insights.jsx";
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
  ArrowRight,
  Sparkles,
  LogOut,
  Bell,
  Check,
  ChevronRight,
  Calendar,
  Trash2,
  Pencil,
  Info,
  Send,
} from "lucide-react";
import {
  LoadingState,
  Avatar,
  Button,
  Change,
  Chart,
  Dialog,
  Empty,
  Panel,
  Sparkline,
  Tabs,
  FormField,
  api,
  csvDownload,
  download,
} from "./components.jsx";
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
  const [data, setData] = useState(null),
    [previous, setPrevious] = useState([]),
    [selected, setSelected] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [settings, setSettings] = useState(null),
    [integrations, setIntegrations] = useState(null),
    [notifications, setNotifications] = useState([]);
  const [detailTab, setDetailTab] = useState(location.hash === "#aso" ? "storeListing" : "overview"),
    [dimensions, setDimensions] = useState(null),
    [dimensionBusy, setDimensionBusy] = useState(false);
  const [asoData, setAsoData] = useState(null),
    [asoBusy, setAsoBusy] = useState(false),
    [searchCompetitors, setSearchCompetitors] = useState([]);
  const [modal, setModal] = useState(null),
    [drawer, setDrawer] = useState(null),
    [aiResult, setAiResult] = useState(null),
    [refresh, setRefresh] = useState(0);
  const [rankCountry, setRankCountry] = useState("us");
  const [reviewFilter, setReviewFilter] = useState("allReviews");
  const [events, setEvents] = useState([]),
    [rankHistory, setRankHistory] = useState([]),
    [picked, setPicked] = useState([]),
    [digestPreview, setDigestPreview] = useState("");
  const heading = useRef(null),
    pending = useRef(false),
    messageTimer = useRef(null);
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
  const filtered = apps
    .filter(
      (a) =>
        (platform === "all" || a.platform === platform) &&
        a.name.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "growth"
        ? (growth(b) || 0) - (growth(a) || 0)
        : (b.installs ?? -1) - (a.installs ?? -1),
    );
  function growth(app) {
    const old = previous.find((a) => a.id === app.id)?.installs;
    return app.installs != null && old > 0
      ? (app.installs / old - 1) * 100
      : null;
  }
  function notify(code) {
    setMessage(code);
    clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(""), 4500);
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
  const loadASO = useCallback(
    async (signal) => {
      if (!current) return;
      setAsoBusy(true);
      try {
        const id = encodeURIComponent(current.id);
        const [next, history, eventList] = await Promise.all([
          api("/api/aso/app/" + id, { signal }),
          api("/api/aso/ranks/history?appId=" + id, { signal }).catch(() => ({ history: [] })),
          api("/api/aso/events?appId=" + id, { signal }).catch(() => ({ events: [] })),
        ]);
        setRankHistory(history.history);
        setEvents(eventList.events);
        setAsoData(next);
        setAiResult(next.aiResult || null);
      } catch (e) {
        handleError(e);
      } finally {
        if (!signal?.aborted) setAsoBusy(false);
      }
    },
    [current?.id, handleError],
  );
  useEffect(() => {
    api("/api/auth/me")
      .then(() => setAuthenticated(true))
      .catch((e) => {
        setAuthenticated(false);
        if (e.message !== "AUTH_REQUIRED") setError(e.message);
      });
    return () => clearTimeout(messageTimer.current);
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
    const abort = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      api("/api/portfolio", {
        method: "POST",
        body: rangeFor(period),
        signal: abort.signal,
      }),
      api("/api/portfolio", {
        method: "POST",
        body: rangeFor(period, period),
        signal: abort.signal,
      }),
    ])
      .then(([now, old]) => {
        setData(now);
        setPrevious(old.apps);
        setSelected((id) =>
          now.apps.some((a) => a.id === id) ? id : now.apps[0]?.id || "",
        );
      })
      .catch(handleError)
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [authenticated, period, refresh, handleError]);
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
    const load = () => api("/api/exchange-rates", { signal: abort.signal }).then(setExchange).catch(() => {});
    load();
    const timer = setInterval(load, 3600000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [authenticated, refresh]);
  useEffect(() => {
    if (!authenticated || page !== "appDetail" || !current) return;
    setAsoData(null);
    setEvents([]);
    setRankHistory([]);
    setPicked([]);
    const abort = new AbortController();
    loadASO(abort.signal);
    return () => abort.abort();
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
  function navigate(next) {
    setPage(next);
    setDrawer(null);
    setError("");
  }
  async function sync() {
    await action(async () => {
      await api("/api/refresh", { method: "POST", body: {} });
      setRefresh((v) => v + 1);
    }, "syncStarted");
  }
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
  function kpis(list) {
    const available = list.filter((a) => a.installs != null),
      total = available.reduce((s, a) => s + a.installs, 0),
      old = previous
        .filter((a) => list.some((x) => x.id === a.id) && a.installs != null)
        .reduce((s, a) => s + a.installs, 0);
    return (
      <section className="kpi-strip">
        <div className="kpi">
          <span>{t("totalInstalls")}</span>
          <div className="kpi-value">
            {available.length ? number(total) : "—"}
            <Change
              value={
                old > 0 && available.length ? (total / old - 1) * 100 : null
              }
            />
          </div>
          <small>{t("lastMonth")}</small>
        </div>
        <div className="kpi revenue-kpi">
          <span>{t("availableRevenue")}</span>
          <div className="currency-values">{revenue(list)}</div>
          <details className="fx-details">
            <summary><Info className="icon" />{t("howCalculated")}</summary>
            {exchangeInfo(list)}
          </details>
        </div>
        {list.length === 1 ? (
          <div className="kpi">
            <span>{t("storeRating")}</span>
            <div className="kpi-value">
              {number(list[0].rating, 1)}
              {list[0].rating != null && <span className="stars" aria-hidden="true" style={{ "--rating": list[0].rating }} />}
            </div>
            <small>{t("storeRatingHint")}</small>
          </div>
        ) : (
          <div className="kpi">
            <span>{t("activeApps")}</span>
            <div className="kpi-value">{list.length}</div>
            <small>{t("privateWorkspace")}</small>
          </div>
        )}
      </section>
    );
  }
  function appSelect() {
    return (
      <label className="select-wrap app-selector">
        <Smartphone className="icon" />
        <select
          value={current?.id || ""}
          onChange={(e) => {
            setSelected(e.target.value);
            setAiResult(null);
          }}
          aria-label={t("chooseApp")}
        >
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.platform === "apple" ? "App Store" : "Google Play"}
            </option>
          ))}
        </select>
      </label>
    );
  }
  function appTable() {
    const max = Math.max(
      1,
      ...filtered.flatMap((a) => a.dailyTrends.map((d) => d.installs || 0)),
    );
    return (
      <Panel
        title={t("compareApps")}
        description={
          filtered.length + " " + t("appCount") + " · " + t("compareScale")
        }
        className="apps-panel"
        action={
          <div className="table-controls">
            <label className="search-field">
              <Search className="icon" />
              <input
                type="search"
                aria-label={t("searchLabel")}
                placeholder={t("search")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              className="sort-select"
              aria-label={t("sort")}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="installs">{t("sortInstalls")}</option>
              <option value="growth">{t("sortGrowth")}</option>
            </select>
          </div>
        }
      >
        <div className="table-scroll">
          <table className="app-table comparison">
            <thead>
              <tr>
                <th>{t("appColumn")}</th>
                <th className="spark-column">{t("trend")}</th>
                <th className="numeric">{t("installs")}</th>
                <th className="numeric">{t("change")}</th>
                <th className="numeric revenue-column">{t("revenue")}</th>
                <th className="numeric rating-column">{t("rating")}</th>
                <th>
                  <span className="sr-only">{t("details")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr
                  key={a.id}
                  className="clickable-row"
                  onClick={(e) => {
                    if (e.target.closest("button,a,details,summary")) return;
                    setSelected(a.id);
                    navigate("appDetail");
                  }}
                >
                  <td>
                    <button
                      className="app-row-button"
                      onClick={() => {
                        setSelected(a.id);
                        setDrawer(a);
                      }}
                    >
                      <Avatar app={a} />
                    </button>
                    {(a.error || a.installs == null) && (
                      <small className="app-data-status">
                        {a.sourceStatus
                          ? t("appleReportHTTP", { status: a.sourceStatus })
                          : t(
                              a.error === "SOURCE_FAILED"
                                ? "appSourceFailed"
                                : "appNoReports",
                            )}
                      </small>
                    )}
                  </td>
                  <td className="spark-column">
                    <Sparkline
                      values={a.dailyTrends.map((d) => d.installs)}
                      max={max}
                      tone={growth(a) > 0 ? "positive" : growth(a) < 0 ? "negative" : "accent"}
                      label={t("trend") + " " + a.name}
                    />
                  </td>
                  <td className="numeric strong-number">
                    {number(a.installs)}
                  </td>
                  <td className="numeric">
                    <Change value={growth(a)} />
                  </td>
                  <td className="numeric revenue-column">
                    <div className="table-currency">{revenue([a], true)}</div>
                  </td>
                  <td className="numeric rating-column">
                    {a.rating != null && <span className="star-mark" aria-hidden="true">★</span>}
                    {number(a.rating, 1)}
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      onClick={() => {
                        setSelected(a.id);
                        navigate("appDetail");
                      }}
                      aria-label={t("viewApp") + " " + a.name}
                    >
                      <ChevronRight className="icon" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>
            {t("allRows")} · {filtered.length}
          </span>
          {filtered.some((a) => a.platform === "google") && (
            <span>{t("noGoogleRevenueReal")}</span>
          )}
        </div>
      </Panel>
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
            <p className="content-message">{t("loading")}</p>
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
    return (
      <>
        <div className="detail-nav">
          <Tabs
            items={["overview", "countries", "versions", "storeListing", "keywords", "competitors", "reviews", "campaigns"]}
            value={detailTab}
            onChange={setDetailTab}
          />
        </div>
        {["overview", "countries", "versions"].includes(detailTab) && kpis([current])}
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
            {breakdown()}
            {detailTab === "countries" && <CountryTable app={current} range={rangeFor(period)} exchange={exchange} number={number} />}
          </>
        )}
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
        {asoBusy ? (
          <p role="status" className="content-message">
            {t("loading")}
          </p>
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
                    await loadASO();
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
                  await loadASO();
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
                                await loadASO();
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
                          await loadASO();
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
                  await loadASO();
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
                      await loadASO();
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
  const title =
    page === "portfolio"
      ? t("spectrumTitle")
      : page === "appDetail"
        ? current?.name || t("appDetail")
        : t("settingsTitle");
  return (
    <>
      <a className="skip-link" href="#main-content">
        {t("overview")}
      </a>
      <header className="spectrum-nav">
        <Brand />
        <nav className="main-nav" aria-label={t("appsLabel")}>
          {pages.map(([key, Icon]) => (
            <button
              key={key}
              className={"nav-item " + (page === key ? "active" : "")}
              aria-current={page === key ? "page" : undefined}
              onClick={() => navigate(key)}
            >
              <Icon className="icon" />
              <span>{t(key)}</span>
            </button>
          ))}
        </nav>
        <div className="spectrum-owner">
          <Lock className="icon" />
          <span>{t("owner")}</span>
          <button
            className="icon-button"
            aria-label={t("notifications")}
            onClick={() => setModal({ type: "notifications" })}
          >
            <Bell className="icon" />
            {notifications.some((n) => !n.read) && (
              <i className="notification-dot" />
            )}
          </button>
          <button
            className="icon-button"
            aria-label={t("logout")}
            onClick={() =>
              action(async () => {
                await api("/api/auth/logout", { method: "POST", body: {} });
                setAuthenticated(false);
                setData(null);
                setExchange(null);
              })
            }
          >
            <LogOut className="icon" />
          </button>
        </div>
      </header>
      <div className="app-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Spectrum <span>/</span> {t(page)}
          </div>
          <div className="topbar-end">
            <span className="private-label">
              <Lock className="icon" />
              {t("privateWorkspace")}
            </span>
            <div className="quick-preferences">
              <label className="sr-only" htmlFor="quick-theme">
                {t("theme")}
              </label>
              <select
                id="quick-theme"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
              >
                {["system", "light", "dark"].map((k) => (
                  <option key={k} value={k}>
                    {t(k)}
                  </option>
                ))}
              </select>
              <button
                className="language-button"
                onClick={() =>
                  i18n.changeLanguage(i18n.language === "vi" ? "en" : "vi")
                }
                aria-label={t("language")}
              >
                <Globe className="icon" />
                {i18n.language === "vi" ? "VI" : "EN"}
              </button>
            </div>
            <button
              className="icon-button mobile-logout"
              aria-label={t("logout")}
              onClick={() =>
                action(async () => {
                  await api("/api/auth/logout", { method: "POST", body: {} });
                  setAuthenticated(false);
                })
              }
            >
              <LogOut className="icon" />
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content">
          <div className="page-heading">
            <div>
              <h1 ref={heading} tabIndex={-1}>
                {page === "appDetail" && current ? <span className="detail-identity"><Avatar app={current} /></span> : title}
              </h1>
              <p>
                {t(
                  page === "portfolio"
                    ? "portfolioSubtitle"
                    : page === "settings" ? "settingsSubtitle" : "appDetailSubtitle",
                )}
              </p>
            </div>
            {page === "appDetail" && current && (
              <Button
                primary
                icon={Sparkles}
                onClick={() => setModal({ type: "ai" })}
              >
                {t("previewAI")}
              </Button>
            )}
          </div>
          {["portfolio", "appDetail"].includes(page) && (
            <div className="toolbar">
              <div className="filter-group">
                {page === "appDetail" ? current && appSelect() : <label className="select-wrap">
                  <Smartphone className="icon" />
                  <select
                    aria-label={t("platform")}
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                  >
                    <option value="all">{t("allPlatforms")}</option>
                    <option value="apple">App Store</option>
                    <option value="google">Google Play</option>
                  </select>
                </label>}
                <label className="select-wrap">
                  <Calendar className="icon" />
                  <select
                    aria-label={t("chooseRange")}
                    value={period}
                    onChange={(e) => setPeriod(Number(e.target.value))}
                  >
                    {[7, 30, 90].map((v) => (
                      <option key={v} value={v}>
                        {v} {t("days")}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="toolbar-date">
                  {formatDate(rangeFor(period).startDate)} –{" "}
                  {formatDate(rangeFor(period).endDate)}
                </span>
                {page === "portfolio" && filtered.length > 0 && (
                  <span className="toolbar-date">
                    · {t("reportDate")}: {formatDate(filtered.map((a) => a.lastDate).filter(Boolean).sort().at(-1))}
                  </span>
                )}
              </div>
              <div className="toolbar-actions">
                <Button
                  icon={Download}
                  onClick={() => exportData()}
                  disabled={!filtered.length}
                >
                  {t("export")}
                </Button>
                {page === "portfolio" && (
                  <Button onClick={() => exportData(true)} disabled={!filtered.length}>
                    {t("downloadRaw")}
                  </Button>
                )}
                <Button
                  icon={RefreshCw}
                  onClick={sync}
                  disabled={busy || loading}
                >
                  {t(busy ? "syncing" : "sync")}
                </Button>
              </div>
            </div>
          )}
          {error && (
            <div className="state-banner error-banner" role="alert">
              <Info className="icon" />
              <span>{t(error, { defaultValue: t("OPERATION_FAILED") })}</span>
              <Button
                onClick={() => {
                  setError("");
                  setRefresh((v) => v + 1);
                }}
              >
                {t("retry")}
              </Button>
            </div>
          )}
          {(!!data?.warnings?.length || apps.some((app) => app.error)) && (
            <div className="state-banner stale-banner">
              <Info className="icon" />
              <span>{t("sourceUnavailable")}</span>
            </div>
          )}
          {!loading &&
            apps.some(
              (app) => app.lastDate && app.lastDate < data?.range?.endDate,
            ) && (
              <div className="state-banner stale-banner">
                <Info className="icon" />
                <span>{t("incompleteReports")}</span>
              </div>
            )}
          <div className="page-content">
            {page === "portfolio" ? (
              loading ? (
                <LoadingState t={t} />
              ) : !apps.length ? (
                <Empty
                  title="firstConnection"
                  text="firstConnectionHint"
                  action={
                    <Button primary onClick={() => navigate("settings")}>
                      {t("viewSettings")}
                    </Button>
                  }
                />
              ) : !filtered.length ? (
                <Empty
                  title="emptyTitle"
                  text="emptyText"
                  action={
                    <Button
                      onClick={() => {
                        setQuery("");
                        setPlatform("all");
                      }}
                    >
                      {t("resetFilters")}
                    </Button>
                  }
                />
              ) : (
                <>
                  {kpis(filtered)}
                  <AnomalyPanel number={number} />
                  {appTable()}
                  <Panel title={t("trend")}>
                    <Chart
                      apps={filtered}
                      previous={previous.filter((a) =>
                        filtered.some((x) => x.id === a.id),
                      )}
                      theme={resolvedTheme}
                      range={data?.range}
                    />
                  </Panel>
                </>
              )
            ) : page === "appDetail" ? (
              detail()
            ) : (
              settingsPage()
            )}
          </div>
          <footer className="production-footer">
            <Lock className="icon" />
            {t("privateWorkspace")} · AppRankly
          </footer>
        </main>
      </div>
      {drawer && (
        <Dialog drawer title={t("appDetail")} onClose={() => setDrawer(null)}>
          <div className="listing-brand">
            <Avatar app={drawer} />
          </div>
          {kpis([drawer])}
          <Chart apps={[drawer]} theme={resolvedTheme} range={data?.range} />
          <p className="content-message">{t("dataCoverageText")}</p>
          <Button
            primary
            icon={ArrowRight}
            onClick={() => navigate("appDetail")}
          >
            {t("viewApp")}
          </Button>
        </Dialog>
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
        onClose={() => setModal(null)} onDone={() => { setModal(null); setPicked([]); loadASO(); }} />}
      {modal?.type === "review" && <ReviewReplyDialog app={modal.app} review={modal.review} busy={busy} action={action} error={error}
        onClose={() => setModal(null)} onSaved={review => {
          setAsoData(data => ({ ...data, reviews: data.reviews.map(item => item.id === review.id ? review : item) }));
          setModal(null); notify("replyPublished");
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
      {message && (
        <div className="toast visible" role="status">
          <Check className="icon" />
          {t(message, { defaultValue: message })}
          <button aria-label={t("dismiss")} onClick={() => setMessage("")}>
            ×
          </button>
        </div>
      )}
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
