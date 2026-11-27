const fs = require("node:fs");
const path = require("node:path");

const apple = { id: "apple:example.ledger", name: "Sổ Chi Tiêu", platform: "apple", packageName: "example.ledger", rating: 4.7, version: "3.8", iconAvailable: true };
const google = { id: "google:example.focus", name: "Chậm", platform: "google", packageName: "example.focus", version: "2.4" };
const missing = { id: "google:example.missing", name: "Đổi Đơn Vị", platform: "google", packageName: "example.missing" };
const apps = [apple, google, missing];
const currencies = { EUR: 21.39, USD: 14.62 };
const purchaseTotal = { purchases: 2, refunds: 1, revenueByCurrency: { USD: 6 } };
const range = { startDate: "2026-11-14", endDate: "2026-11-20" };
const at = (startDate, day) => new Date(Date.parse(startDate) + day * 86400000).toISOString().slice(0, 10);

function install() {
  const store = require("../lib/portfolio");
  const requests = [];
  store.listApps = async () => ({ apps, warnings: [] });
  store.ownedApp = async id => {
    const app = apps.find(a => a.id === id);
    if (!app) throw new Error("APP_NOT_FOUND");
    return app;
  };
  store.metadata = async app => app.iconAvailable ? { icon: "https://is1-ssl.mzstatic.com/sample.png" } : null;
  require("../lib/appIcon").fetchIcon = async () => ({
    type: "image/png", data: fs.readFileSync(path.join(__dirname, "../public/favicon.png")),
  });
  store.appStats = async (app, dateRange) => {
    if (app.id === missing.id) throw new Error("NO_REPORTS");
    const start = dateRange.startDate;
    const appleStore = app.platform === "apple";
    const dailyTrends = [72, 0, null, 118, 91, null, 104].map((installs, i) => ({
      date: at(start, i),
      installs: appleStore || installs === null ? installs : Math.round(installs / 2),
      uninstalls: appleStore ? null : i,
      upgrades: i === 2 ? null : i,
    }));
    return {
      installs: dailyTrends.reduce((total, day) => total + (day.installs ?? 0), 0),
      lastDate: dailyTrends.at(-1).date,
      activeDevices: appleStore ? null : 38,
      retention: null,
      dailyTrends,
      revenueByCurrency: appleStore ? currencies : {},
      grossRevenueByCurrency: appleStore ? undefined : { VND: 148000 },
      revenueStatus: appleStore ? undefined : "partial",
      purchases: { daily: [{ date: start, iap: 2, subscription: 0, refunds: 1 }],
        products: [{ kind: "iap", sku: "ledger.pro", title: "Gói Pro", ...purchaseTotal }],
        totals: { iap: purchaseTotal, subscription: { purchases: 0, refunds: 0, revenueByCurrency: {} } } },
    };
  };
  store.portfolio = async (input, catalog) => {
    const current = catalog || await store.listApps();
    requests.push({ input, catalog });
    const scoped = input.platform ? current.apps.filter(app => app.platform === input.platform) : current.apps;
    const found = await Promise.all(scoped.map(async app => {
      try {
        const { purchases, ...stats } = await store.appStats(app, input);
        return { ...app, ...stats, error: null };
      } catch (error) {
        return { ...app, installs: null, dailyTrends: [], error: error.message };
      }
    }));
    return { apps: found, warnings: current.warnings, range: store.dateRange(input), generatedAt: new Date().toISOString() };
  };
  store.dimensionStats = async (app, dateRange, kind) => {
    if (kind !== "app_version") throw new Error("INVALID_DIMENSION");
    return [{ label: app.version || "3.8", dailyUserInstalls: 0, totalInstalls: 100 },
      { label: "3.7", totalInstalls: 32 }, { label: "3.6" }];
  };
  require("../lib/countryRevenue").countryRevenue = async (app, dateRange, options) => {
    if (!options?.preserveMissingInstalls) throw new Error("MISSING_OPTION");
    return { rows: [
      { country: "VN", installs: 0, revenueByCurrency: { VND: 24000 } },
      { country: "US", installs: null, revenueByCurrency: { USD: 2.15 } },
      { country: "DE", installs: 51, revenueByCurrency: { EUR: 5.4 } },
    ], revenueStatus: "partial", installStatus: "available" };
  };
  require("../lib/insights").releaseImpactFor = async () => [
    { id: 29, date: "2026-11-18", label: "v3.8", days: 6, before: 11.9, after: 16.2, change: 36.13, rpiChange: null, reviews: 6, low: 1 },
  ];
  require("../lib/exchangeRates").getExchangeRates = async () => ({
    base: "USD", status: "available", source: "Frankfurter",
    rates: { EUR: { rate: 1.2, date: "2026-11-20" }, USD: { rate: 1, date: null } },
  });
  return requests;
}

module.exports = { install, apple, google, missing, range, currencies };
