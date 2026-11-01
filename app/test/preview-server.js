// Test-only UI fixture server; not copied into the production image.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "apprankly-ui-"));
process.env.DB_PATH = path.join(process.env.DATA_DIR, "database.sqlite");
process.env.NODE_ENV = "test";
process.env.PORT = "3002";
process.env.APP_ORIGIN = "http://127.0.0.1:3002";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.ADMIN_PASSWORD_HASH = require("bcryptjs").hashSync(
  "preview-only-password",
  10,
);
const apps = [
  {
    id: "google:example.muse",
    packageName: "example.muse",
    name: "Muse Notes",
    platform: "google",
    version: "2.4.0",
    rating: 4.8,
  },
  {
    id: "apple:example.daylight",
    packageName: "example.daylight",
    name: "Daylight",
    platform: "apple",
    appId: "123",
    version: "1.8.2",
    rating: 4.7,
  },
  {
    id: "google:example.pocket",
    packageName: "example.pocket",
    name: "Pocket Habits",
    platform: "google",
    version: "3.1.0",
    rating: 4.6,
  },
];
const portfolio = require("../lib/portfolio");
portfolio.listApps = async () => ({ apps, warnings: [] });
portfolio.ownedApp = async (id) => {
  const app = apps.find((a) => a.id === id);
  if (!app) throw new Error("APP_NOT_FOUND");
  return app;
};
portfolio.appStats = async (app, range) => {
  const index = apps.indexOf(app),
    count =
      Math.round(
        (Date.parse(range.endDate) - Date.parse(range.startDate)) / 86400000,
      ) + 1;
  const dailyTrends = Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.parse(range.startDate) + i * 86400000)
      .toISOString()
      .slice(0, 10),
    installs: Math.round(90 + index * 30 + i * 4 + Math.sin(i) * 30),
    uninstalls: app.platform === "apple" ? null : 12 + (i % 5),
    upgrades: 20 + (i % 8),
    revenueByCurrency: app.platform === "apple" ? { USD: 12 + i } : {},
  }));
  return {
    dailyTrends,
    installs: dailyTrends.reduce((s, d) => s + d.installs, 0),
    revenueByCurrency: app.platform === "apple" ? { USD: count * 20 } : {},
    activeDevices: app.platform === "apple" ? null : 8400,
    lastDate: range.endDate,
    retention: null,
  };
};
portfolio.portfolio = async (body) => {
  const range = portfolio.dateRange(body);
  return {
    apps: await Promise.all(
      apps.map(async (a) => ({
        ...a,
        ...(await portfolio.appStats(a, range)),
      })),
    ),
    warnings: [],
    range,
    generatedAt: new Date().toISOString(),
  };
};
const viewer = {
  getDimensionStats: async () => [
    { label: "US", totalInstalls: 2300 },
    { label: "VN", totalInstalls: 1700 },
  ],
};
const factory = require("../lib/viewerFactory");
factory.buildGoogleViewer = () => viewer;
factory.buildAppleViewer = () => viewer;
const scraper = require("../lib/aso/scraper");
const listing = {
  title: "Muse Notes: Daily Journal",
  summary: "Capture ideas and build a daily writing habit.",
  description: "Keep ideas, organize notes and reflect on your day.",
  developer: "Personal studio",
  score: 4.8,
  ratings: 128,
};
scraper.getPlayListing = async () => listing;
scraper.getAppleLookup = async () => listing;
scraper.getPlayReviews = async () => [
  {
    id: "r1",
    rating: 5,
    score: 5,
    author: "Preview user",
    title: "Useful",
    text: "A clean space for daily notes.",
  },
];
scraper.getAppleReviewsRSS = scraper.getPlayReviews;
scraper.getPlaySearch = async () => [];
scraper.getAppleSearch = async () => [];
const ai = require("../lib/ai");
ai.generateJSON = async () => ({
  data: {
    summary: "Preview result using synthetic data only.",
    recommendations: ["Review listing clarity."],
    candidates: [],
  },
  provider: "test",
  model: "fixture",
  usage: {},
});
fs.writeFileSync(
  path.join(process.env.DATA_DIR, "releases.json"),
  JSON.stringify([
    {
      id: "fixture-release",
      version: "2.5.0",
      packageName: "example.muse",
      platform: "google",
      date: "2026-10-30",
      notes: "Synthetic release: improved note search.",
    },
  ]),
);
const { createApp } = require("../server");
createApp().listen(3002, "127.0.0.1", () =>
  console.log("Synthetic UI preview: http://127.0.0.1:3002"),
);
