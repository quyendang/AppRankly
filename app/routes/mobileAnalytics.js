const store = require("../lib/portfolio");
const mobileCatalog = require("../lib/mobileCatalog");
const icons = require("../lib/appIcon");
const countries = require("../lib/countryRevenue");
const insights = require("../lib/insights");
const exchangeRates = require("../lib/exchangeRates");

const DAY = 86400000;
const iso = time => new Date(time).toISOString().slice(0, 10);
const number = value => Number.isFinite(value) ? value : null;

function rangeOf(query) {
  // Both bounds must accompany a custom range. The default is 30 days ending yesterday UTC.
  if (query.from !== undefined || query.to !== undefined) {
    if (typeof query.from !== "string" || !query.from || typeof query.to !== "string" || !query.to)
      throw new Error("INVALID_DATE_RANGE");
    return store.dateRange({ startDate: query.from, endDate: query.to });
  }
  return store.dateRange();
}

function preceding(range) {
  const start = Date.parse(range.startDate);
  const end = Date.parse(range.endDate);
  const duration = end - start + DAY;
  return { startDate: iso(start - duration), endDate: iso(start - DAY) };
}

function appDTO(app) {
  return {
    id: app.id, name: app.name, platform: app.platform, packageName: app.packageName,
    rating: number(app.rating), version: app.version ?? null, storeUrl: app.storeUrl ?? null,
    iconAvailable: app.iconAvailable === true, metadataError: app.metadataError ?? null,
  };
}

function reportDTO(app) {
  const google = app.platform === "google";
  const amounts = (google ? app.grossRevenueByCurrency : app.revenueByCurrency) || {};
  return {
    app: appDTO(app),
    installs: number(app.installs),
    activeDevices: number(app.activeDevices),
    retention: number(app.retention),
    lastDate: app.lastDate ?? null,
    error: app.error ?? null,
    sourceStatus: app.sourceStatus ?? null,
    revenue: {
      basis: google ? "gross_buyer_payments_including_tax" : "estimated_developer_proceeds",
      status: google ? app.revenueStatus || (app.revenueAvailable ? "available" : "unavailable")
        : Object.keys(amounts).length ? "available" : "unavailable",
      byCurrency: amounts,
    },
    daily: (app.dailyTrends || []).map(day => ({
      date: day.date, installs: number(day.installs), uninstalls: number(day.uninstalls),
      upgrades: number(day.upgrades), revenueByCurrency: day.revenueByCurrency || {},
    })),
  };
}

async function periods(range, platform, catalog) {
  const [current, previous] = await Promise.all([
    store.portfolio({ ...range, platform }, catalog),
    store.portfolio({ ...preceding(range), platform }, catalog),
  ]);
  return {
    range, previousRange: previous.range, generatedAt: current.generatedAt,
    warnings: current.warnings, current: current.apps.map(reportDTO), previous: previous.apps.map(reportDTO),
  };
}

module.exports = function registerAnalytics(router, authenticate, run) {
  const get = (path, handle) => router.get(path, authenticate, run(handle));
  const withApp = handle => async (req, res) => handle(req, res, await mobileCatalog.ownedApp(req.params.appId));

  get("/apps", async (req, res) => {
    const { apps, warnings } = await mobileCatalog.listApps();
    res.json({ apps: apps.map(appDTO), warnings });
  });
  get("/apps/:appId/icon", withApp(async (req, res, app) => {
    const meta = await store.metadata(app);
    const url = meta?.icon || meta?.iconUrl;
    if (!url) throw new Error("APP_NOT_FOUND");
    const { data, type } = await icons.fetchIcon(url);
    res.type(type).send(Buffer.from(data));
  }));
  get("/overview", async (req, res) => {
    const range = rangeOf(req.query);
    const platform = req.query.platform;
    if (platform !== undefined && !["apple", "google"].includes(platform))
      throw new Error("INVALID_PLATFORM");
    res.json(await periods(range, platform, await mobileCatalog.listApps()));
  });
  get("/exchange-rates", async (req, res) => res.json(await exchangeRates.getExchangeRates()));
  get("/apps/:appId/analytics", withApp(async (req, res, app) => {
    res.json(await periods(rangeOf(req.query), app.platform, { apps: [app], warnings: [] }));
  }));
  get("/apps/:appId/analytics/countries", withApp(async (req, res, app) => {
    const range = rangeOf(req.query);
    res.json(await countries.countryRevenue(app, range, { preserveMissingInstalls: true }));
  }));
  get("/apps/:appId/analytics/versions", withApp(async (req, res, app) => {
    const range = rangeOf(req.query);
    const rows = await store.dimensionStats(app, range, "app_version");
    res.json({ rows: rows.map(row => ({
      label: row.label, installs: number(row.dailyUserInstalls ?? row.totalInstalls),
    })) });
  }));
  get("/apps/:appId/analytics/purchases", withApp(async (req, res, app) => {
    const range = rangeOf(req.query);
    const stats = await store.appStats(app, range);
    res.json({ available: !!stats.purchases, purchases: stats.purchases || null });
  }));
  get("/apps/:appId/analytics/releases", withApp(async (req, res, app) => {
    const releases = await insights.releaseImpactFor(app);
    res.json({ releases: releases.map(release => ({ ...release, id: String(release.id) })) });
  }));
};
module.exports.appDTO = appDTO;
module.exports.rangeOf = rangeOf;
