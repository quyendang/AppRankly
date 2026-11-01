const { getBaseConfig, getSettings } = require("./config");
const {
  buildAppleViewer,
  buildGoogleViewer,
  isIgnored,
  getIgnoredSet,
} = require("./viewerFactory");
const { getCachedStoreData } = require("./scraper");
const scraper = require("./aso/scraper");
const { limited } = require("./utils/concurrency");
async function metadata(app) {
  return resolver.resolve("personal:listing", { id: app.id }, () =>
    limited(() =>
      app.platform === "google"
        ? scraper.getPlayListing(app.packageName, { force: true })
        : scraper.getAppleLookup(app.appId || app.packageName, { force: true }),
    ),
  );
}
const resolver = require("./resolver");
const identifier = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(value);
function dateRange(input = {}) {
  const endDate =
    input.endDate || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const startDate =
    input.startDate ||
    new Date(new Date(endDate + "T12:00:00Z").getTime() - 29 * 86400000)
      .toISOString()
      .slice(0, 10);
  if (
    ![startDate, endDate].every(
      (s) =>
        typeof s === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(s) &&
        !isNaN(Date.parse(s)) &&
        new Date(s).toISOString().slice(0, 10) === s,
    ) ||
    startDate > endDate ||
    (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 365
  )
    throw new Error("INVALID_DATE_RANGE");
  return { startDate, endDate };
}
async function listApps() {
  const config = getBaseConfig(),
    apps = [],
    warnings = [];
  const ignored = getIgnoredSet(config);
  for (const platform of ["google", "apple"]) {
    if (!(platform === "google" ? config.keyJson : config.applePrivateKey))
      continue;
    try {
      const viewer =
        platform === "google"
          ? buildGoogleViewer(config, "dummy")
          : buildAppleViewer(config);
      let packages = await resolver
        .resolve("packages:personal", { platform }, () => viewer.listPackages())
        .catch((error) => {
          if (platform !== "google") throw error;
          warnings.push({ platform, error: "SOURCE_FAILED" });
          return [];
        });
      if (platform === "google")
        packages = [
          ...new Map(
            [
              ...packages,
              ...(config.googlePackages || []).map((packageName) => ({
                packageName,
              })),
            ].map((item) => [item.bundleId || item.packageName, item]),
          ).values(),
        ];
      for (const p of packages) {
        if (isIgnored(p, ignored)) continue;
        const packageName = p.bundleId || p.packageName;
        if (!identifier(packageName)) continue;
        const cached = getCachedStoreData(packageName, platform);
        apps.push({
          id: platform + ":" + packageName,
          platform,
          packageName,
          name:
            config.appMetadata?.[packageName]?.displayName ||
            cached?.title ||
            p.name ||
            packageName,
          appId: p.appId || p.adamId || null,
          rating: cached?.score ?? null,
          version: cached?.version || null,
          storeUrl:
            platform === "google"
              ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`
              : p.adamId
                ? `https://apps.apple.com/app/id${p.adamId}`
                : null,
        });
      }
    } catch {
      warnings.push({ platform, error: "SOURCE_FAILED" });
    }
  }
  await Promise.all(
    apps.map(async (app) => {
      try {
        const meta = await metadata(app);
        if (meta) {
          app.name =
            config.appMetadata?.[app.packageName]?.displayName ||
            meta.title ||
            meta.trackName ||
            app.name;
          app.rating = meta.score ?? null;
          app.version = meta.version || null;
          app.iconAvailable = !!(meta.icon || meta.iconUrl);
        }
      } catch {
        app.metadataError = "SOURCE_FAILED";
      }
    }),
  );
  return { apps, warnings };
}
async function ownedApp(id) {
  const { apps } = await listApps();
  const app = apps.find((a) => a.id === id);
  if (!app) throw new Error("APP_NOT_FOUND");
  return app;
}
async function appStats(app, range) {
  return resolver.resolve(
    "personal:stats:v2",
    { id: app.id, ...range },
    async () => {
      const config = getBaseConfig();
      const raw = await (
        app.platform === "apple"
          ? buildAppleViewer(config, app.packageName)
          : buildGoogleViewer(config, app.packageName)
      ).getAppStats(range.startDate, range.endDate);
      const trends = raw.dailyTrends || [];
      const revenueByCurrency = {};
      for (const day of trends)
        for (const [currency, value] of Object.entries(
          day.revenueByCurrency || {},
        ))
          revenueByCurrency[currency] =
            (revenueByCurrency[currency] || 0) + value;
      const knownInstalls = trends
        .map((day) => day.dailyUserInstalls ?? day.dailyInstalls)
        .filter(Number.isFinite);
      return {
        dailyTrends: trends.map((day) => ({
          date: day.date,
          installs: day.dailyUserInstalls ?? day.dailyInstalls ?? null,
          uninstalls:
            app.platform === "apple"
              ? null
              : (day.dailyUserUninstalls ?? day.dailyUninstalls ?? null),
          upgrades: day.upgrades ?? day.dailyDeviceUpgrades ?? null,
          revenueByCurrency: day.revenueByCurrency || {},
        })),
        installs: knownInstalls.length
          ? knownInstalls.reduce((a, b) => a + b, 0)
          : null,
        revenueByCurrency,
        activeDevices:
          app.platform === "apple"
            ? null
            : (trends.at(-1)?.activeDevices ?? null),
        retention: null,
        lastDate: trends.at(-1)?.date || null,
      };
    },
  );
}
async function portfolio(input = {}) {
  const range = dateRange(input),
    { apps, warnings } = await listApps();
  const results = await Promise.all(
    apps.map(async (app) => {
      try {
        return { ...app, ...(await appStats(app, range)), error: null };
      } catch (error) {
        return {
          ...app,
          installs: null,
          revenueByCurrency: {},
          dailyTrends: [],
          error:
            error.message === "NO_REPORTS" ? "NO_REPORTS" : "SOURCE_FAILED",
        };
      }
    }),
  );
  return {
    apps: results,
    warnings,
    range,
    generatedAt: new Date().toISOString(),
  };
}
module.exports = {
  listApps,
  ownedApp,
  appStats,
  portfolio,
  dateRange,
  identifier,
  metadata,
};
