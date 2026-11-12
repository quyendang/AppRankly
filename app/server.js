require("dotenv").config();
const { DATA_DIR, redact, protectLogs } = require("./lib/runtime");
protectLogs();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const axios = require("axios");
axios.defaults.timeout = 15000;
axios.defaults.maxRedirects = 0;
const auth = require("./lib/auth");
const config = require("./lib/config");
const { db } = require("./lib/db");
const store = require("./lib/portfolio");
const viewers = require("./lib/viewerFactory");
const resolver = require("./lib/resolver");
const notes = require("./lib/notes");
const releases = require("./lib/releases");
const scheduler = require("./lib/scheduler");
const notifier = require("./lib/notifier");
const campaigns = require("./lib/aso/campaignLinks");
const run = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
const helpers = { getBaseConfig: config.getBaseConfig, DATA_DIR, ...viewers };

function createApp() {
  auth.validateAuth();
  config.validateCredentials();
  require("./lib/ai").loadAIConfig();
  if (!db) throw new Error("DATABASE_REQUIRED");
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.set("json replacer", (key, value) =>
    redact(typeof value === "bigint" ? Number(value) : value),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests:
            process.env.NODE_ENV === "production" ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/healthz", (req, res) => res.json({ status: "ok" }));
  app.get("/readyz", (req, res) => {
    try {
      db.prepare("SELECT 1").get();
      const probe = path.join(DATA_DIR, ".ready-" + crypto.randomUUID());
      fs.writeFileSync(probe, "ok", { flag: "wx", mode: 0o600 });
      fs.unlinkSync(probe);
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ error: "NOT_READY" });
    }
  });
  app.get("/l/:slug", rateLimit({ windowMs: 60000, max: 60 }), (req, res) => {
    const link = campaigns.recordCampaignClick(req.params.slug);
    if (!link) return res.sendStatus(404);
    const target = /android/i.test(req.headers["user-agent"] || "")
      ? link.play_url || link.apple_url
      : link.apple_url || link.play_url;
    try {
      const url = new URL(target);
      if (
        url.protocol !== "https:" ||
        !["apps.apple.com", "play.google.com"].includes(url.hostname) ||
        url.username ||
        url.password
      )
        throw new Error();
      res.redirect(302, url.href);
    } catch {
      res.sendStatus(404);
    }
  });
  app.use("/api", auth.sameOrigin);
  app.post(
    "/api/auth/login",
    rateLimit({
      windowMs: 900000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "LOGIN_RATE_LIMIT" },
    }),
    run(auth.login),
  );
  app.use("/api", auth.authenticate);
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      max: 180,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "RATE_LIMIT" },
    }),
  );
  app.post("/api/auth/logout", auth.logout);
  app.get("/api/auth/me", (req, res) => res.json({ owner: true }));
  app.get("/api/settings", (req, res) => res.json(config.getSettings()));
  app.get("/api/exchange-rates", run(async (req, res) => res.json(await require("./lib/exchangeRates").getExchangeRates())));
  app.put(
    "/api/settings",
    run(async (req, res) => {
      res.json(config.saveSettings(req.body));
      if (require.main === module) scheduler.startPeriodicScheduler(helpers);
    }),
  );
  app.post(
    "/api/apps/google",
    run(async (req, res) => {
      const packageName = req.body.packageName;
      if (!store.identifier(packageName) || !packageName.includes("."))
        throw new Error("INVALID_PACKAGE");
      const settings = config.getSettings();
      config.saveSettings({
        googlePackages: [
          ...new Set([...(settings.googlePackages || []), packageName]),
        ],
      });
      res.status(201).json({ success: true });
    }),
  );
  app.get(
    "/api/apps/icon/:id",
    run(async (req, res) => {
      const app = await store.ownedApp(req.params.id),
        meta = await store.metadata(app);
      if (!meta?.icon && !meta?.iconUrl) return res.status(404).end();
      const icon = await require("./lib/appIcon").fetchIcon(
        meta.icon || meta.iconUrl,
      );
      res
        .set("Cache-Control", "private, max-age=3600")
        .type(icon.type)
        .send(Buffer.from(icon.data));
    }),
  );
  app.get("/api/integrations", (req, res) =>
    res.json({
      google: { configured: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON },
      apple: { configured: !!process.env.APPLE_PRIVATE_KEY },
      ai: require("./lib/ai").getAIStatus(),
      notifications: {
        configured: !!(
          process.env.NTFY_TOPIC ||
          process.env.DISCORD_WEBHOOK_URL ||
          process.env.SLACK_WEBHOOK_URL ||
          process.env.TELEGRAM_BOT_TOKEN
        ),
      },
    }),
  );
  app.post(
    "/api/integrations/:platform/test",
    run(async (req, res) => {
      if (!["google", "apple"].includes(req.params.platform))
        return res.sendStatus(404);
      try {
        const cfg = config.getBaseConfig(),
          viewer =
            req.params.platform === "google"
              ? viewers.buildGoogleViewer(cfg, "dummy")
              : viewers.buildAppleViewer(cfg);
        await viewer.listPackages();
        res.json({ success: true });
      } catch {
        res.status(502).json({ error: "CONNECTION_FAILED" });
      }
    }),
  );
  app.get(
    "/api/projects",
    run(async (req, res) => res.json(await store.listApps())),
  );
  app.post(
    "/api/portfolio",
    run(async (req, res) => res.json(await store.portfolio(req.body))),
  );
  app.post(
    "/api/dimension",
    run(async (req, res) => {
      const app = await store.ownedApp(req.body.appId),
        range = store.dateRange(req.body),
        dimension = req.body.dimension;
      if (
        !["country", "app_version", "os_version", "device"].includes(dimension)
      )
        throw new Error("INVALID_DIMENSION");
      const cfg = config.getBaseConfig(),
        viewer =
          app.platform === "apple"
            ? viewers.buildAppleViewer(cfg, app.packageName)
            : viewers.buildGoogleViewer(cfg, app.packageName);
      res.json(
        await viewer.getDimensionStats(
          dimension,
          range.startDate,
          range.endDate,
        ),
      );
    }),
  );
  app.post(
    "/api/country-revenue",
    run(async (req, res) => {
      const app = await store.ownedApp(req.body.appId),
        range = store.dateRange(req.body);
      res.json(await require("./lib/countryRevenue").countryRevenue(app, range));
    }),
  );
  app.post(
    "/api/purchases",
    run(async (req, res) => {
      const app = await store.ownedApp(req.body.appId),
        range = store.dateRange(req.body);
      const stats = await store.appStats(app, range);
      res.json({
        available: !!stats.purchases,
        purchases: stats.purchases || { daily: [], products: [], totals: { iap: {}, subscription: {} } },
        range,
      });
    }),
  );
  app.post(
    "/api/refresh",
    run(async (req, res) => {
      resolver.clearCache();
      res.json(await scheduler.checkAndNotifyStats(helpers, { force: true }));
    }),
  );
  app.get("/api/sync", (req, res) => {
    const { status, lastRun, appsChecked } = scheduler.getSchedulerStatus();
    res.json({ status, lastRun, appsChecked });
  });
  app.get(
    "/api/notes",
    run(async (req, res) => res.json(await notes.getNotesFromStorage())),
  );
  app.post(
    "/api/notes",
    run(async (req, res) => {
      const { title, content, appId, tags = [], pinned = false } = req.body;
      const target = appId ? await store.ownedApp(appId) : null,
        now = new Date().toISOString();
      const note = {
        id: crypto.randomUUID(),
        title,
        content,
        packageName: target?.packageName || "all",
        platform: target?.platform || "all",
        tags: Array.isArray(tags)
          ? tags.filter((x) => typeof x === "string").slice(0, 10)
          : [],
        pinned: pinned === true,
        createdAt: now,
        updatedAt: now,
      };
      await notes.saveNoteToStorage(note);
      res.status(201).json(note);
    }),
  );
  app.put(
    "/api/notes/:id",
    run(async (req, res) => {
      const all = await notes.getNotesFromStorage(),
        old = all.find((n) => n.id === req.params.id);
      if (!old) return res.sendStatus(404);
      const next = {
        ...old,
        title: req.body.title,
        content: req.body.content,
        updatedAt: new Date().toISOString(),
      };
      await notes.saveNoteToStorage(next);
      res.json(next);
    }),
  );
  app.delete(
    "/api/notes/:id",
    run(async (req, res) => {
      await notes.deleteNoteFromStorage(req.params.id);
      res.json({ success: true });
    }),
  );
  app.get("/api/releases", (req, res) =>
    res.json(releases.getReleasesFromFile()),
  );
  app.post(
    "/api/releases",
    run(async (req, res) => {
      const target = await store.ownedApp(req.body.appId);
      const { version, date, notes: content = "" } = req.body;
      if (
        typeof version !== "string" ||
        !version.trim() ||
        version.length > 100 ||
        typeof content !== "string" ||
        content.length > 10000 ||
        redact(content) !== content ||
        redact(version) !== version ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date || "") ||
        isNaN(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date
      )
        throw new Error("INVALID_RELEASE");
      const existing = releases.getReleasesFromFile();
      const old = req.body.id
        ? existing.find((item) => item.id === req.body.id)
        : null;
      if (
        req.body.id &&
        (!old ||
          old.packageName !== target.packageName ||
          old.platform !== target.platform)
      )
        throw new Error("INVALID_RELEASE");
      const release = {
        ...old,
        id: old?.id || crypto.randomUUID(),
        version,
        date,
        notes: content,
        packageName: target.packageName,
        platform: target.platform,
        source: "manual",
      };
      releases.saveReleasesToFile(
        old
          ? existing.map((item) => (item.id === old.id ? release : item))
          : [release, ...existing],
      );
      res.status(old ? 200 : 201).json(release);
    }),
  );
  app.delete("/api/releases/:id", (req, res) => {
    releases.saveReleasesToFile(
      releases.getReleasesFromFile().filter((r) => r.id !== req.params.id),
    );
    res.json({ success: true });
  });
  app.get(
    "/api/notifications",
    run(async (req, res) => res.json(await notifier.syncNtfyTopicMessages())),
  );
  app.post("/api/notifications/read", (req, res) =>
    res.json(notifier.markNotificationsRead(DATA_DIR, req.body.id)),
  );
  app.post(
    "/api/notifications/test",
    run(async (req, res) =>
      res.json(
        await notifier.broadcastAlert({
          title: "AppRankly",
          message: "Test notification",
        }),
      ),
    ),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      max: 180,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "RATE_LIMIT" },
    }),
    require("./routes/aso"),
  );
  app.use("/api", (req, res) => res.status(404).json({ error: "NOT_FOUND" }));
  app.use(express.static(path.join(__dirname, "public"), { index: false }));
  app.get("*", (req, res) =>
    res.sendFile(path.join(__dirname, "public", "index.html")),
  );
  app.use((error, req, res, next) => {
    const code = String(error.message || "");
    const invalid = /^(INVALID_|UNSAFE_|PREVIEW_REQUIRED)/.test(code);
    const status =
      error.type === "entity.too.large"
        ? 413
        : error instanceof SyntaxError
          ? 400
          : code === "AI_NOT_CONFIGURED"
            ? 503
            : code === "APP_NOT_FOUND"
              ? 404
              : invalid
                ? 400
                : 502;
    res.status(status).json({
      error:
        status === 413
          ? "REQUEST_TOO_LARGE"
          : ["AI_NOT_CONFIGURED", "AI_INVALID_RESPONSE", "AI_EMPTY_RESPONSE", "AI_OUTPUT_TRUNCATED", "RANK_SOURCE_FAILED", "REVIEW_REPLY_FAILED", "REVIEWS_PERMISSION_REQUIRED"].includes(code)
            ? code
            : invalid
              ? code
              : status === 404
                ? "APP_NOT_FOUND"
                : status === 400
                  ? "INVALID_INPUT"
                  : "OPERATION_FAILED",
    });
  });
  return app;
}
if (require.main === module) {
  const app = createApp(),
    server = app.listen(process.env.PORT || 3000, "0.0.0.0", () =>
      console.log("AppRankly ready"),
    );
  scheduler.startPeriodicScheduler(helpers);
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const idle = scheduler.stopPeriodicScheduler();
    const force = setTimeout(() => process.exit(1), 15000);
    force.unref();
    server.close(async () => {
      await idle;
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
module.exports = { createApp };
