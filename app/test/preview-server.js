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
  {
    id: "apple:example.free",
    packageName: "example.free",
    name: "Free Journal",
    platform: "apple",
    appId: "456",
  },
];
const portfolio = require("../lib/portfolio");
require("../lib/exchangeRates").getExchangeRates = async () => ({
  base: "USD", source: "Frankfurter", status: "available", fetchedAt: "2026-11-01T00:00:00Z",
  rates: Object.fromEntries(Object.entries({ USD: 1, EUR: 1.1, GBP: 1.3, NZD: 0.6, CAD: 0.72, JPY: 0.0065, VND: 0.00004 }).map(([currency, rate]) => [currency, { rate, date: currency === "USD" ? null : "2026-10-30" }])),
});
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
    revenueByCurrency: app.platform !== "apple" ? {} : app.appId === "456"
      ? Object.fromEntries(["USD", "EUR", "GBP", "JPY", "VND", "CAD", "AUD"].map(c => [c, 0]))
      : { USD: count * 20 + 0.49, EUR: 12.75, GBP: -2, JPY: 1200, VND: 250000, CAD: 6.99 },
    grossRevenueByCurrency: app.platform === "google" ? { USD: 29.97 } : {},
    revenueAvailable: true,
    revenueStatus: "available",
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
    candidates: ["Thank you for your feedback! We're glad the app is useful."],
  },
  provider: "test",
  model: "fixture",
  usage: {},
});
const reviewFixtures = [
  { id: "r1", author: "Preview user", rating: 5, text: "A clean space for daily notes.", date: "2026-10-29T12:00:00Z", replyText: "Thank you for sharing your feedback!", replyDate: "2026-10-30T12:00:00Z", canReply: true, source: "official" },
  { id: "r2", author: "Another preview user", rating: 4, text: "Useful app. Could the timer text be a little larger?", date: "2026-10-28T12:00:00Z", replyText: null, canReply: true, source: "official" },
  { id: "r3", author: "Minh", rating: 5, text: "Love the daily streaks.", date: "2026-10-27T12:00:00Z", replyText: null, canReply: true, source: "official" },
  { id: "r4", author: "", rating: 2, text: "Crashes when I open settings.", date: "2026-10-26T12:00:00Z", replyText: null, canReply: true, source: "official" },
];
const managedReviews = require("../lib/storeReviews");
managedReviews.loadReviews = async () => ({ reviews: reviewFixtures, sourceStatus: "available" });
managedReviews.replyReview = async (app, id, text) => {
  const review = reviewFixtures.find(review => review.id === id);
  if (!review || text.length > 350) throw new Error("INVALID_REVIEW_REPLY");
  review.replyText = text; review.replyDate = new Date().toISOString();
  return review;
};
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
// Synthetic keyword rank history (one drop of 25 places on the last check) and per-country revenue.
const { db } = require("../lib/db");
const keyword = db.prepare("INSERT INTO aso_keyword(package_name,platform,term,normalized,source,tracked,added_at) VALUES('example.muse','play','daily journal','daily journal','manual',1,datetime('now'))").run();
for (let i = 0; i < 12; i++)
  db.prepare("INSERT INTO aso_rank_history(keyword_id,package_name,platform,store,country,rank,top_n,checked_at,language) VALUES(?,?,?,?,?,?,?,?, 'en')")
    .run(keyword.lastInsertRowid, "example.muse", "play", "play", "us", i === 11 ? 38 : 18 - Math.floor(i / 2), 100,
      new Date(Date.parse("2026-10-20T08:00:00Z") + i * 86400000).toISOString());
require("../lib/countryRevenue").countryRevenue = async () => ({ rows: [
  { country: "US", installs: 2300, revenueByCurrency: { USD: 410.5 } },
  { country: "VN", installs: 1700, revenueByCurrency: { VND: 9500000 } },
  { country: "JP", installs: 520, revenueByCurrency: { JPY: 180000 } },
  { country: "DE", installs: 410, revenueByCurrency: { EUR: 90.2 } },
  { country: "BR", installs: 380, revenueByCurrency: {} },
] });
const { createApp } = require("../server");
createApp().listen(3002, "127.0.0.1", () =>
  console.log("Synthetic UI preview: http://127.0.0.1:3002"),
);
