const { randomUUID } = require("node:crypto");
const { DATA_DIR } = require("../lib/runtime");
const { db } = require("../lib/db");
const config = require("../lib/config");
const store = require("../lib/portfolio");
const operationsApi = require("../lib/ownerOperations");
const scheduler = require("../lib/scheduler");
const resolver = require("../lib/resolver");
const notifier = require("../lib/notifier");
const insights = require("../lib/insights");
const { rangeOf } = require("./mobileAnalytics");

const fields = ["refreshIntervalHours", "timezone", "notificationsEnabled", "digest", "digestHour", "digestLocale", "anomalyThreshold", "googlePackages"];
const editable = fields.filter(key => !["timezone", "googlePackages"].includes(key));
const settings = value => Object.fromEntries(fields.map(key => [key, value[key]]));
const status = value => ({ status: value?.status || "idle", lastRun: value?.lastRun || null,
  appsChecked: value?.appsChecked ?? null, sources: value?.sources || {} });
const eventDTO = item => ({ ...item, id: String(item.id) });
const day = period => period === undefined || period === "daily" ? "daily" : period === "weekly" ? "weekly" : null;

function digestPeriod(input) {
  const period = day(input);
  if (!period) throw new Error("INVALID_INPUT");
  return period;
}

function channelResults(value) {
  return Object.fromEntries(Object.entries(value).map(([key, result]) => [
    key, result?.success ? "sent" : result?.skipped ? "skipped" : "failed",
  ]));
}

function checkNotificationSettings() {
  if (!config.getSettings().notificationsEnabled || !operationsApi.integrations().notifications.configured)
    throw new Error("NOTIFICATIONS_DISABLED");
}

module.exports = function registerOwner(router, authenticate, run, operations) {
  let sync;
  const route = (method, path, handler) => router[method](path, authenticate, run(handler));
  route("get", "/settings", async (req, res) => res.json(settings(config.getSettings())));
  route("put", "/settings", async (req, res) => {
    const input = req.body;
    if (!input || Array.isArray(input) || Object.keys(input).some(key => !editable.includes(key)))
      throw new Error("INVALID_SETTINGS");
    const next = config.saveSettings(input);
    operations.settingsChanged();
    res.json(settings(next));
  });
  route("post", "/apps/google", async (req, res) =>
    res.status(201).json(settings(operationsApi.updateGooglePackage(req.body?.packageName))));
  route("delete", "/apps/google/:packageName", async (req, res) =>
    res.json(settings(operationsApi.updateGooglePackage(req.params.packageName, true))));
  route("get", "/integrations", async (req, res) => res.json(operationsApi.integrations()));
  route("post", "/integrations/:platform/test", async (req, res) => res.json(await operationsApi.testIntegration(req.params.platform)));

  route("get", "/sync", async (req, res) => res.json(status(scheduler.getSchedulerStatus())));
  route("post", "/sync", async (req, res) => {
    if (sync?.state === "running") return res.status(202).json(sync);
    const job = { id: randomUUID(), state: "running", appsChecked: null, sources: {} };
    sync = job;
    Promise.resolve().then(() => {
      resolver.clearCache();
      return operations.sync();
    }).then(result => {
      job.state = result?.status === "skipped" ? "skipped"
        : result?.status === "completed" || result?.success === true ? "completed" : "failed";
      job.appsChecked = result?.appsChecked ?? null;
      job.sources = result?.sources || {};
    }).catch(() => { job.state = "failed"; });
    res.status(202).json(job);
  });
  route("get", "/sync/:id", async (req, res) => {
    if (!sync || sync.id !== req.params.id) throw new Error("SYNC_NOT_FOUND");
    res.json(sync);
  });

  route("get", "/notifications", async (req, res) => res.json(await notifier.syncNtfyTopicMessages()));
  route("post", "/notifications/read", async (req, res) => {
    const id = req.body?.id;
    if (id !== undefined && (typeof id !== "string" || !id || id.length > 200)) throw new Error("INVALID_INPUT");
    res.json(notifier.markNotificationsRead(DATA_DIR, id));
  });
  route("delete", "/notifications/:id", async (req, res) => res.json(notifier.clearNotifications(DATA_DIR, req.params.id)));
  route("get", "/digest", async (req, res) => res.json(await insights.buildDigest(digestPeriod(req.query.period))));
  route("post", "/digest/send", async (req, res) => {
    if (req.body?.confirmed !== true) throw new Error("PREVIEW_REQUIRED");
    checkNotificationSettings();
    const digest = await insights.buildDigest(digestPeriod(req.body.period));
    res.json({ channels: channelResults(await notifier.broadcastAlert({ title: digest.title, message: digest.message, data: digest.data })) });
  });
  route("post", "/notifications/test", async (req, res) => {
    if (req.body?.confirmed !== true) throw new Error("PREVIEW_REQUIRED");
    checkNotificationSettings();
    res.json({ channels: channelResults(await notifier.broadcastAlert({ title: "AppRankly", message: "Test notification" })) });
  });

  route("get", "/apps/:appId/events", async (req, res) => {
    const app = await store.ownedApp(req.params.appId);
    res.json({ events: (await insights.listEvents(app)).map(eventDTO) });
  });
  route("post", "/apps/:appId/events", async (req, res) => {
    const app = await store.ownedApp(req.params.appId);
    res.status(201).json(eventDTO(insights.addEvent(app, req.body?.date, req.body?.label)));
  });
  route("delete", "/apps/:appId/events/:id", async (req, res) => {
    const app = await store.ownedApp(req.params.appId), id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("EVENT_NOT_FOUND");
    const deleted = db.prepare("DELETE FROM app_event WHERE id=? AND app_id=? AND source='manual'").run(id, app.id);
    if (!deleted.changes) throw new Error("EVENT_NOT_FOUND");
    res.json({ success: true });
  });
  route("get", "/export", async (req, res) => {
    const { format = "json", appId } = req.query;
    if (format !== "json" && format !== "csv") throw new Error("INVALID_INPUT");
    const range = rangeOf(req.query);
    const catalog = appId === undefined ? undefined : { apps: [await store.ownedApp(appId)], warnings: [] };
    const data = await store.portfolio(range, catalog);
    if (format === "json") return res.json({
      range, apps: data.apps, exchangeRates: await require("../lib/exchangeRates").getExchangeRates(),
    });
    const { portfolioCSV } = await import("../lib/portfolioCSV.mjs");
    const headers = ["Application", "Platform", "Installs", "Revenue", "Currency", "Revenue basis"];
    const basis = { google: "Gross buyer payments including tax", apple: "Estimated developer proceeds" };
    // JSON output is redacted by Express. Apply the same rule before serializing CSV.
    const safeApps = JSON.parse(JSON.stringify(data.apps, req.app.get("json replacer")));
    res.type("text/csv").send(portfolioCSV(safeApps, headers, platform => basis[platform]));
  });
};
