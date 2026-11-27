const { db } = require("../db");
const { identifier } = require("../portfolio");
const { redact } = require("../runtime");
const resolver = require("../resolver");
const scraper = require("./scraper");
const { storeOf } = require("./rankTracker");
const campaigns = require("./campaignLinks");

async function listing(app) {
  return resolver.resolve("personal:listing", { id: app.id }, () =>
    app.platform === "google" ? scraper.getPlayListing(app.packageName) : scraper.getAppleLookup(app.appId || app.packageName));
}

async function search(app, rawTerm, market) {
  const term = typeof rawTerm === "string" ? rawTerm.trim() : "";
  if (!term || term.length > 100 || redact(term) !== term) throw new Error("INVALID_INPUT");
  const opts = market ? { strict: true } : undefined;
  const hits = app.platform === "google"
    ? await scraper.getPlaySearch(term, 10, market?.country, market?.language, opts)
    : await scraper.getAppleSearch(term, market?.country, 10, opts);
  return hits.slice(0, 10);
}

async function pin(app, id) {
  if (!identifier(id)) throw new Error("INVALID_INPUT");
  const meta = app.platform === "google" ? await scraper.getPlayListing(id) : await scraper.getAppleLookup(id);
  if (!meta) throw new Error("COMPETITOR_NOT_FOUND");
  const platform = storeOf(app);
  db.prepare(`INSERT INTO aso_competitor(package_name,platform,store,competitor_key,title,rating,pinned,fetched_at)
    VALUES(?,?,?,?,?,?,1,datetime('now')) ON CONFLICT(package_name,platform,store,competitor_key)
    DO UPDATE SET title=excluded.title,rating=excluded.rating,pinned=1,fetched_at=excluded.fetched_at`)
    .run(app.packageName, platform, platform, id, meta.title || meta.trackName || id, meta.score ?? meta.averageUserRating ?? null);
}

function tracked(app) {
  return db.prepare(`SELECT competitor_key,title,rating FROM aso_competitor
    WHERE package_name=? AND platform=? AND store=? AND pinned=1 ORDER BY fetched_at DESC,competitor_key`)
    .all(app.packageName, storeOf(app), storeOf(app));
}

function unpin(app, id) {
  if (!identifier(id)) throw new Error("INVALID_INPUT");
  const platform = storeOf(app);
  db.prepare("DELETE FROM aso_competitor WHERE package_name=? AND platform=? AND store=? AND competitor_key=?")
    .run(app.packageName, platform, platform, id);
}

function createCampaign(app, input) {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const source = typeof input?.source === "string" ? input.source.trim() : "";
  if (!name || !source || name.length > 100 || source.length > 100 ||
      redact(name) !== name || redact(source) !== source)
    throw new Error("INVALID_INPUT");
  if (app.platform === "apple" && !/^\d+$/.test(String(app.appId || ""))) throw new Error("LISTING_UNAVAILABLE");
  return campaigns.saveCampaignLink({
    packageName: app.packageName, platform: app.platform, name,
    utmSource: source, utmCampaign: name, appleAppId: app.appId,
  });
}

module.exports = { listing, search, pin, tracked, unpin, createCampaign };
