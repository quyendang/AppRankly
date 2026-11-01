import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Line } from "react-chartjs-2";
import { Trash2, Plus, Send } from "lucide-react";
import { Button, Dialog, FormField, Panel, api, eventPlugin } from "./components.jsx";

const flag = (code) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
const toUsd = (byCurrency, exchange) => {
  let total = 0;
  const missing = [];
  for (const [currency, amount] of Object.entries(byCurrency || {})) {
    if (!Number.isFinite(amount) || amount === 0) continue;
    const rate = currency === "USD" ? 1 : exchange?.rates?.[currency]?.rate;
    if (rate > 0) total += amount * rate;
    else missing.push(currency);
  }
  return { total, missing };
};

// Unusual installs/revenue/rank moves detected by the server; renders nothing when all is calm.
export function AnomalyPanel({ number }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  useEffect(() => {
    const abort = new AbortController();
    api("/api/insights/anomalies", { signal: abort.signal }).then((r) => setItems(r.anomalies)).catch(() => {});
    return () => abort.abort();
  }, []);
  if (!items.length) return null;
  const text = (a) => {
    const direction = t(a.direction === "up" ? "directionUp" : "directionDown");
    if (a.kind === "rank")
      return t("anomalyRank", { term: a.term, country: a.country.toUpperCase(), from: a.from ?? t("rankOut"), to: a.to ?? t("rankOut") });
    return t(a.kind === "installs" ? "anomalyInstalls" : "anomalyRevenue", {
      currency: a.currency, direction, percent: Math.abs(Math.round(a.change)),
      latest: number(a.latest, 2), avg: number(a.avg, 2) });
  };
  return (
    <Panel title={t("insightsTitle")} description={t("insightsHint")} className="insights-panel">
      <ul className="insight-list">
        {items.slice(0, 8).map((a) => (
          <li key={a.key} className={"insight " + (a.direction === "up" ? "positive" : "negative")}>
            <span aria-hidden="true">{a.direction === "up" ? "▲" : "▼"}</span>
            <div><strong>{a.name}</strong><span>{text(a)}</span></div>
            <time>{a.date}</time>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// Releases, campaigns and custom events shown as markers on the charts.
export function EventsPanel({ app, events, onChange, action, busy }) {
  const { t } = useTranslation();
  return (
    <Panel title={t("eventsTitle")} description={t("eventsHint")}>
      <form className="inline-form" onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget), target = e.currentTarget;
        action(async () => {
          await api("/api/aso/events", { method: "POST", body: { appId: app.id, date: form.get("date"), label: form.get("label") } });
          await onChange();
          target.reset();
        }, "eventAdded");
      }}>
        <input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} aria-label={t("date")} />
        <input name="label" required maxLength={80} placeholder={t("eventLabel")} aria-label={t("eventLabel")} />
        <Button primary type="submit" icon={Plus} disabled={busy}>{t("addEvent")}</Button>
      </form>
      {events.length ? (
        <ul className="event-list">
          {[...events].reverse().map((e) => (
            <li key={e.id}>
              <time>{e.date}</time>
              <span className={"event-type " + e.type}>{t("eventType_" + e.type, { defaultValue: e.type })}</span>
              <span>{e.label}</span>
              {e.source === "manual" && (
                <button className="icon-button" aria-label={t("delete") + " " + e.label} onClick={() =>
                  action(async () => { await api("/api/aso/events/" + e.id, { method: "DELETE" }); await onChange(); })}>
                  <Trash2 className="icon" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="content-message">{t("noEvents")}</p>}
    </Panel>
  );
}

// Rank over time for one tracked keyword + market; lower is better so the axis is reversed.
export function RankHistory({ history, events, theme }) {
  const { t, i18n } = useTranslation();
  const [pick, setPick] = useState("");
  const series = history.find((h) => h.keywordId + ":" + h.country === pick) || history[0];
  const dark = theme === "dark", color = dark ? "#F3A77C" : "#B84F2B", muted = dark ? "#B9B1CD" : "#666177";
  const chart = useMemo(() => {
    if (!series) return null;
    const byDate = new Map(series.points.map((p) => [p.date, p.rank ?? 101]));
    const dates = [];
    for (let time = Date.parse(series.points[0].date); time <= Date.parse(series.points.at(-1).date) && dates.length < 120; time += 86400000)
      dates.push(new Date(time).toISOString().slice(0, 10));
    return { dates, values: dates.map((d) => byDate.get(d) ?? null) };
  }, [series]);
  if (!series) return <Panel title={t("rankHistory")}><p className="content-message">{t("rankHistoryEmpty")}</p></Panel>;
  const label = (d) => new Intl.DateTimeFormat(i18n.language, { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(d + "T12:00:00Z"));
  return (
    <Panel title={t("rankHistory")} description={t("rankHistoryHint")} action={
      <select className="sort-select" aria-label={t("chooseKeyword")} value={series.keywordId + ":" + series.country} onChange={(e) => setPick(e.target.value)}>
        {history.map((h) => <option key={h.keywordId + h.country} value={h.keywordId + ":" + h.country}>{h.term} · {h.country.toUpperCase()}</option>)}
      </select>
    }>
      <div className="production-chart">
        <Line
          data={{ labels: chart.dates.map(label), datasets: [{ label: t("rank"), data: chart.values, borderColor: color, backgroundColor: color,
            borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 5, spanGaps: true, tension: 0.15 }] }}
          options={{
            responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: "index" },
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: {
                label: (i) => t("rank") + ": " + (i.parsed.y > 100 ? t("rankOut") : i.parsed.y),
                afterBody: (items) => events.filter((e) => e.date === chart.dates[items[0].dataIndex]).map((e) => "◆ " + e.label) } },
              eventMarkers: { events, dates: chart.dates, color: muted },
            },
            scales: {
              x: { grid: { display: false }, ticks: { maxTicksLimit: 6, color: muted, font: { size: 11 } } },
              y: { reverse: true, min: 1, grid: { color: dark ? "#3B354E" : "#E8E5F0" },
                ticks: { maxTicksLimit: 6, precision: 0, color: muted, font: { size: 11 }, callback: (v) => (v > 100 ? t("rankOut") : v) } },
            },
          }}
          plugins={[eventPlugin]}
          role="img"
          aria-label={t("rankHistory")}
        />
      </div>
    </Panel>
  );
}

// Installs, revenue and revenue per install by country, with revenue converted to USD.
export function CountryTable({ app, range, exchange, number }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    const abort = new AbortController();
    setState({ loading: true });
    api("/api/country-revenue", { method: "POST", body: { appId: app.id, ...range }, signal: abort.signal })
      .then((r) => setState({ rows: r.rows }))
      .catch((e) => e.name !== "AbortError" && setState({ error: true }));
    return () => abort.abort();
  }, [app.id, range.startDate, range.endDate]);
  if (state.loading) return <Panel title={t("countryRevenueTitle")}><p className="content-message">{t("loading")}</p></Panel>;
  if (state.error || !state.rows?.length) return <Panel title={t("countryRevenueTitle")}><p className="content-message">{t("countryRevenueEmpty")}</p></Panel>;
  const names = new Intl.DisplayNames([i18n.language], { type: "region" });
  const rows = state.rows.map((r) => ({ ...r, usd: toUsd(r.revenueByCurrency, exchange) }))
    .sort((a, b) => b.usd.total - a.usd.total || b.installs - a.installs).slice(0, 20);
  const totalInstalls = rows.reduce((s, r) => s + r.installs, 0);
  const best = Math.max(0, ...rows.filter((r) => r.installs > 0).map((r) => r.usd.total / r.installs));
  const missing = [...new Set(rows.flatMap((r) => r.usd.missing))];
  return (
    <Panel title={t("countryRevenueTitle")} description={t("countryRevenueNote")}>
      <div className="table-scroll">
        <table className="country-table">
          <thead><tr>
            <th>{t("colCountry")}</th><th className="numeric">{t("installs")}</th><th className="numeric">{t("colShare")}</th>
            <th className="numeric">{t("colRevenueUsd")}</th><th className="numeric">{t("colRevenuePerInstall")}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const per = r.installs > 0 ? r.usd.total / r.installs : null;
              return (
                <tr key={r.country}>
                  <td><span aria-hidden="true">{flag(r.country)}</span> {names.of(r.country) || r.country}</td>
                  <td className="numeric">{number(r.installs)}</td>
                  <td className="numeric">{totalInstalls ? number((r.installs / totalInstalls) * 100, 1) + "%" : "—"}</td>
                  <td className="numeric">{r.usd.total ? number(r.usd.total, 2) : "—"}</td>
                  <td className="numeric per-install">
                    {per != null ? number(per, 3) : "—"}
                    {per > 0 && <i style={{ width: Math.max(4, (per / best) * 100) + "%" }} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!!missing.length && <p className="fine-print">{t("missingRates", { currencies: missing.join(", ") })}</p>}
    </Panel>
  );
}

export function useTemplates() {
  const [templates, setTemplates] = useState([]);
  const reload = useCallback(() => api("/api/review-templates").then((r) => setTemplates(r.templates)).catch(() => {}), []);
  useEffect(() => { reload(); }, [reload]);
  return [templates, reload];
}
export function renderTemplate(body, review, app, fallback) {
  const rating = review.rating ?? review.score ?? "";
  return body.replace(/\{name\}/g, review.author || review.userName || fallback)
    .replace(/\{rating\}/g, rating).replace(/\{app\}/g, app.name);
}
export function TemplatePicker({ templates, onPick }) {
  const { t } = useTranslation();
  if (!templates.length) return null;
  return (
    <FormField label={t("templateLabel")}>
      <select defaultValue="" onChange={(e) => { const tpl = templates.find((x) => String(x.id) === e.target.value); if (tpl) onPick(tpl.body); e.target.value = ""; }}>
        <option value="">{t("noTemplate")}</option>
        {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
    </FormField>
  );
}

// Reply to many reviews at once with one template; nothing is published without explicit confirmation.
export function BulkReplyDialog({ app, reviews, busy, action, error, onClose, onDone }) {
  const { t } = useTranslation();
  const [templates, reloadTemplates] = useTemplates();
  const [body, setBody] = useState(""), [name, setName] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [results, setResults] = useState(null);
  const limit = app.platform === "google" ? 350 : 5970;
  const fallback = t("reviewerFallback");
  const items = reviews.map((r) => ({ review: r, text: renderTemplate(body, r, app, fallback).trim() }));
  const tooLong = items.some((i) => i.text.length > limit);
  const failed = results?.filter((r) => !r.ok).length || 0;
  return (
    <Dialog title={t("bulkReply")} onClose={() => (results ? onDone() : onClose())}>
      <p className="modal-intro">{app.name} · {t("selectedCount", { count: reviews.length })}</p>
      {results ? (
        <>
          <p className="content-message" role="status">{t("bulkResult", { ok: results.length - failed, total: results.length })}</p>
          {!!failed && <p role="alert" className="content-message">{t("bulkFailed", { count: failed })}</p>}
          <div className="modal-footer"><Button primary onClick={onDone}>{t("close")}</Button></div>
        </>
      ) : (
        <>
          <FormField label={t("templateLabel")}>
            <select value="" disabled={busy || !templates.length} onChange={(e) => { const tpl = templates.find((x) => String(x.id) === e.target.value); if (tpl) { setBody(tpl.body); setName(tpl.name); setConfirmed(false); } }}>
              <option value="">{templates.length ? t("noTemplate") : t("noTemplates")}</option>
              {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </FormField>
          <FormField label={t("replyBody")}>
            <textarea rows={4} maxLength={limit} value={body} disabled={busy} onChange={(e) => { setBody(e.target.value); setConfirmed(false); }} />
          </FormField>
          <p className="fine-print">{t("templateVars")}</p>
          <div className="inline-form">
            <input value={name} maxLength={60} placeholder={t("templateName")} aria-label={t("templateName")} onChange={(e) => setName(e.target.value)} />
            <Button disabled={busy || !name.trim() || !body.trim()} onClick={() => action(async () => {
              await api("/api/review-templates", { method: "POST", body: { name, body } });
              await reloadTemplates();
            }, "templateSaved")}>{t("saveTemplate")}</Button>
            {!!templates.find((x) => x.name === name) && (
              <button className="icon-button" aria-label={t("deleteTemplate")} onClick={() => action(async () => {
                await api("/api/review-templates/" + templates.find((x) => x.name === name).id, { method: "DELETE" });
                await reloadTemplates();
              })}><Trash2 className="icon" /></button>
            )}
          </div>
          {body.trim() && (
            <div className="bulk-preview">
              <h3>{t("bulkPreview")}</h3>
              {items.map(({ review, text }) => (
                <article className="review" key={review.id}>
                  <div><strong>{review.author || review.userName || fallback}</strong><span>{review.rating ?? review.score} / 5</span></div>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          )}
          {tooLong && <p role="alert" className="content-message">{t("bulkTooLong", { limit })}</p>}
          <p className="privacy-note">{t("replyPublishHint")}</p>
          {error && <p role="alert" className="content-message">{t(error, { defaultValue: t("OPERATION_FAILED") })}</p>}
          <label className="consent-label"><input type="checkbox" disabled={busy} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{t("bulkConfirm", { count: reviews.length })}</label>
          <div className="modal-footer">
            <Button onClick={onClose}>{t("cancel")}</Button>
            <Button primary icon={Send} disabled={busy || !confirmed || !body.trim() || tooLong} onClick={() => action(async () => {
              const r = await api("/api/aso/reviews/reply-bulk", { method: "POST", body: { appId: app.id, confirmed: true,
                items: items.map(({ review, text }) => ({ reviewId: review.id, text })) } });
              setResults(r.results);
            })}>{t(busy ? "saving" : "bulkPublish", { count: reviews.length })}</Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
