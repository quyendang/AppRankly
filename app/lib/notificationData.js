// Structured notification content: what changed (per-app metrics with a sign) and what to try next.
// Plain text is still generated for ntfy, Telegram and Slack; the dashboard renders `data` instead of parsing that text.
const KINDS = new Set(["stats", "anomaly", "rank", "review", "digest", "system"]);
const TABS = new Set(["overview", "countries", "versions", "storeListing", "keywords", "competitors", "reviews", "campaigns"]);

const finite = (value) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : null);
const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");

// Keep only known fields with bounded size so a bad caller cannot bloat notifications.json.
function cleanData(data) {
  if (!data || typeof data !== "object") return undefined;
  const kind = KINDS.has(data.kind) ? data.kind : "system";
  const out = { kind };
  if (Array.isArray(data.items)) {
    out.items = data.items.slice(0, 30).map((item) => ({
      appId: text(item.appId, 200) || undefined,
      name: text(item.name, 120),
      platform: ["apple", "google"].includes(item.platform) ? item.platform : undefined,
      metrics: Array.isArray(item.metrics)
        ? item.metrics.slice(0, 6).map((m) => ({
            key: ["installs", "uninstalls", "revenue", "rating", "rank", "reviews"].includes(m.key) ? m.key : "installs",
            value: finite(m.value), previous: finite(m.previous), change: finite(m.change),
            unit: text(m.unit, 8) || undefined,
          }))
        : [],
      note: text(item.note, 300) || undefined,
      tab: TABS.has(item.tab) ? item.tab : undefined,
      term: text(item.term, 80) || undefined,
      country: /^[a-z]{2}$/i.test(item.country || "") ? item.country.toLowerCase() : undefined,
    }));
  }
  if (Array.isArray(data.hints)) out.hints = data.hints.slice(0, 5).map((h) => ({ key: text(h.key, 40), tab: TABS.has(h.tab) ? h.tab : undefined, appId: text(h.appId, 200) || undefined }));
  if (typeof data.severity === "string" && ["info", "warn", "bad", "good"].includes(data.severity)) out.severity = data.severity;
  return out;
}

const pctChange = (now, before) => (Number.isFinite(now) && Number.isFinite(before) && before > 0 ? (now / before - 1) * 100 : null);

// Rule-based next steps; each hint is a stable key the dashboard translates, plus the tab to open.
function hintsFor(item, kind) {
  const hints = [];
  const m = Object.fromEntries((item.metrics || []).map((x) => [x.key, x]));
  if (kind === "review") hints.push({ key: "replyReview", tab: "reviews" });
  else if (kind === "rank") {
    if ((item.metrics?.[0]?.change ?? 0) < 0) hints.push({ key: "checkListingKeywords", tab: "storeListing" }, { key: "recheckRanks", tab: "keywords" });
    else hints.push({ key: "keepRankMomentum", tab: "keywords" });
  } else {
    const installs = m.installs;
    if (installs && installs.change != null && installs.change <= -25) hints.push({ key: "checkRelease", tab: "versions" }, { key: "checkCountries", tab: "countries" }, { key: "checkRecentReviews", tab: "reviews" });
    else if (installs && installs.change != null && installs.change >= 25) hints.push({ key: "findSpikeCause", tab: "overview" }, { key: "replyNewReviews", tab: "reviews" });
    if (m.uninstalls && m.uninstalls.value > 0 && m.installs && m.uninstalls.value > m.installs.value) hints.push({ key: "uninstallsHigh", tab: "reviews" });
    if (m.revenue && m.revenue.change != null && m.revenue.change <= -25) hints.push({ key: "checkRevenueDrop", tab: "overview" });
  }
  return hints.slice(0, 3).map((h) => ({ ...h, appId: item.appId }));
}

function statsData(apps) {
  const items = apps.map((app) => ({
    appId: app.appId, name: app.displayName, platform: String(app.platform).toLowerCase() === "apple" ? "apple" : "google",
    metrics: [
      { key: "installs", value: app.installs, previous: app.previousInstalls ?? null, change: pctChange(app.installs, app.previousInstalls) },
      ...(app.uninstalls ? [{ key: "uninstalls", value: app.uninstalls, previous: null, change: null }] : []),
    ],
    note: (app.smartAlerts || []).join("; ") || undefined,
  }));
  const hints = [...new Map(items.flatMap((i) => hintsFor(i, "stats")).map((h) => [h.key, h])).values()];
  return { kind: "stats", items, hints, severity: items.some((i) => (i.metrics[0].change ?? 0) <= -25) ? "bad" : "info" };
}

function anomalyData(a, app) {
  const isRank = a.kind === "rank";
  const metric = isRank
    ? { key: "rank", value: a.to ?? null, previous: a.from ?? null, change: a.move ?? a.change ?? null }
    : { key: a.kind === "revenue" ? "revenue" : "installs", value: a.latest, previous: a.avg, change: a.change, unit: a.currency };
  const item = { appId: a.appId, name: app?.name || a.name, platform: a.platform, metrics: [metric], term: a.term, country: a.country, tab: isRank ? "keywords" : "overview" };
  return { kind: isRank ? "rank" : "anomaly", items: [item], hints: hintsFor(item, isRank ? "rank" : "anomaly"), severity: a.direction === "down" ? "bad" : "good" };
}

function reviewData({ appId, name, platform, rating, snippet }) {
  const item = { appId, name, platform: platform === "apple" || platform === "ios" ? "apple" : "google", metrics: [{ key: "rating", value: rating, previous: null, change: null }], note: text(snippet, 300), tab: "reviews" };
  return { kind: "review", items: [item], hints: hintsFor(item, "review"), severity: "bad" };
}

module.exports = { cleanData, statsData, anomalyData, reviewData, hintsFor, pctChange };
