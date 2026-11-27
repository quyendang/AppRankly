const { randomUUID } = require("node:crypto");
const { db } = require("../lib/db");
const store = require("../lib/portfolio");
const keywords = require("../lib/aso/keywords");
const catalog = require("../lib/aso/catalog");
const ranks = require("../lib/aso/rankTracker");
const campaigns = require("../lib/aso/campaignLinks");

const jobs = new Map();
const active = new Map();
const ONE_HOUR = 3600000;
const score = value => Number.isFinite(value) && value > 0 ? value : null;
const jobDTO = ({ id, country, state, checked, failed, error }) => ({ id, country, state, checked, failed, error });
const campaignDTO = row => ({
  id: Number(row.id), name: row.name, source: row.utm_source || row.utmSource,
  path: "/l/" + row.slug, clicks: row.clicks, createdAt: row.created_at || null,
});
const competitorDTO = (row, pinned) => ({
  id: String(row.competitor_key || row.appId || row.bundleId || row.id || ""),
  title: row.title || row.name || row.trackName || "", rating: score(row.score ?? row.rating), pinned,
});

function safeStoreUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["apps.apple.com", "play.google.com"].includes(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}
function campaignRows(app) {
  return campaigns.getCampaignLinks(app.packageName, app.platform).map(campaignDTO);
}

function startRankCheck(app, country) {
  const key = app.id + ":" + country;
  if (active.has(key)) return active.get(key);
  for (const [id, previous] of jobs) if (previous.finishedAt && Date.now() - previous.finishedAt >= ONE_HOUR) jobs.delete(id);
  if (jobs.size >= 128) {
    const oldest = [...jobs.values()].find(job => job.finishedAt);
    if (!oldest) throw new Error("RANK_CHECK_BUSY");
    jobs.delete(oldest.id);
  }
  const job = { id: randomUUID(), appId: app.id, country, state: "running", checked: 0, failed: 0, error: null };
  jobs.set(job.id, job);
  active.set(key, job);
  Promise.resolve().then(() => ranks.checkRanks(app, country, { partial: true }))
    .then(result => {
      job.checked = result.ranks.length;
      job.failed = result.failed.length;
      job.state = "completed";
    }).catch(() => {
      job.state = "failed";
      job.error = "RANK_SOURCE_FAILED";
    }).finally(() => {
      job.finishedAt = Date.now();
      active.delete(key);
    });
  return job;
}

module.exports = function registerASO(router, authenticate, run) {
  const route = (method, suffix, fn) => router[method]("/apps/:appId" + suffix, authenticate, run(async (req, res) =>
    fn(req, res, await store.ownedApp(req.params.appId))
  ));

  route("get", "/keywords", async (req, res, app) => {
    const market = keywords.market(req.query.country);
    res.json({ market, markets: Object.keys(ranks.markets).map(code => keywords.market(code)),
      keywords: keywords.list(app, market.country), source: "public_store_search" });
  });
  route("post", "/keywords", async (req, res, app) => {
    const bulk = Array.isArray(req.body?.terms);
    if (bulk && req.body.term !== undefined) throw new Error("INVALID_KEYWORD");
    const added = keywords.track(app, bulk ? req.body.terms : [req.body?.term], bulk ? "ai" : "manual");
    res.status(201).json({ success: true, added });
  });
  route("delete", "/keywords/:keywordId", async (req, res, app) => {
    keywords.remove(app, Number(req.params.keywordId));
    res.json({ success: true });
  });
  route("get", "/keywords/:keywordId/history", async (req, res, app) => {
    const market = keywords.market(req.query.country);
    res.json({ market, ...keywords.history(app, Number(req.params.keywordId), market.country) });
  });
  route("post", "/rank-checks", async (req, res, app) => {
    const { country } = keywords.market(req.body?.country);
    res.status(202).json(jobDTO(startRankCheck(app, country)));
  });
  route("get", "/rank-checks/:jobId", async (req, res, app) => {
    const job = jobs.get(req.params.jobId);
    if (!job || job.appId !== app.id || (job.finishedAt && Date.now() - job.finishedAt >= ONE_HOUR))
      throw new Error("RANK_CHECK_NOT_FOUND");
    res.json(jobDTO(job));
  });

  route("get", "/listing", async (req, res, app) => {
    const meta = await catalog.listing(app);
    if (!meta) throw new Error("LISTING_UNAVAILABLE");
    res.json({ title: meta.title || meta.trackName || app.name, subtitle: meta.summary || meta.subtitle || null,
      description: meta.description || null, developer: meta.developer || null, rating: score(meta.score),
      storeUrl: safeStoreUrl(meta.url || meta.trackViewUrl) || safeStoreUrl(app.storeUrl), source: "public_listing" });
  });
  route("get", "/competitors", async (req, res, app) => {
    const tracked = catalog.tracked(app).map(row => competitorDTO(row, true));
    if (req.query.q === undefined) return res.json({ competitors: tracked });
    const pinned = new Set(tracked.map(row => row.id));
    const rows = await catalog.search(app, req.query.q, keywords.market(req.query.country));
    const competitors = rows.map(row => competitorDTO(row, false))
      .filter(row => row.id && row.title && row.id !== app.packageName && row.id !== String(app.appId))
      .map(row => ({ ...row, pinned: pinned.has(row.id) }));
    res.json({ competitors: [...new Map(competitors.map(row => [row.id, row])).values()] });
  });
  route("post", "/competitors", async (req, res, app) => {
    await catalog.pin(app, req.body?.competitorId);
    res.status(201).json({ success: true });
  });
  route("delete", "/competitors/:competitorId", async (req, res, app) => {
    catalog.unpin(app, req.params.competitorId);
    res.json({ success: true });
  });

  route("get", "/campaigns", async (req, res, app) => res.json({ campaigns: campaignRows(app) }));
  route("post", "/campaigns", async (req, res, app) => {
    const created = catalog.createCampaign(app, req.body);
    res.status(201).json(campaignDTO(created));
  });
  route("delete", "/campaigns/:campaignId", async (req, res, app) => {
    const id = Number(req.params.campaignId);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("INVALID_INPUT");
    const match = db.prepare("DELETE FROM campaign_links WHERE id=? AND package_name=? AND platform=?")
      .run(id, app.packageName, app.platform);
    if (!match.changes) throw new Error("CAMPAIGN_NOT_FOUND");
    res.json({ success: true });
  });
};
