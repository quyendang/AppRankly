const express = require("express");
const crypto = require("node:crypto");
const { db } = require("../lib/db");
const { ownedApp, appStats, dateRange } = require("../lib/portfolio");
const resolver = require("../lib/resolver");
const asoCatalog = require("../lib/aso/catalog");
const keywordStore = require("../lib/aso/keywords");
const keywordAI = require("../lib/aso/keywordAI");
const { getKeywordHints } = require("../lib/aso/keywordHints");
const { lintMetadata } = require("../lib/aso/metadataLinter");
const { calculatePppPricing } = require("../lib/aso/pppPricing");
const campaigns = require("../lib/aso/campaignLinks");
const { getNotesFromStorage } = require("../lib/notes");
const { generateJSON, getAIStatus } = require("../lib/ai");
const { redact } = require("../lib/runtime");
const router = express.Router();
const managedReviews = require("../lib/storeReviews");
const reviewReplies = require("../lib/reviewReplies");
const replyTemplates = require("../lib/reviewTemplates");
const reviewDraft = require("../lib/reviewDraft");
const rankTracker = require("../lib/aso/rankTracker");
const insights = require("../lib/insights");
const run = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
const previews = new Map();
const codePlatform = (app) => (app.platform === "google" ? "play" : "apple");
async function reviews(app) {
  return (await managedReviews.loadReviews(app)).reviews;
}
router.get("/ai/status", (req, res) => res.json(getAIStatus()));
router.get(
  "/aso/app/:id",
  run(async (req, res) => {
    const app = await ownedApp(req.params.id),
      platform = codePlatform(app);
    const [metadata, reviewList] = await Promise.all([
      asoCatalog.listing(app),
      managedReviews.loadReviews(app),
    ]);
    res.json({
      listing: metadata,
      reviews: reviewList.reviews || [],
      reviewSourceStatus: reviewList.sourceStatus,
      keywords: db
        .prepare(
          "SELECT * FROM aso_keyword WHERE package_name=? AND platform=? ORDER BY tracked DESC, added_at DESC",
        )
        .all(app.packageName, platform),
      ranks: db
        .prepare(
          "SELECT r.* FROM aso_rank_history r WHERE r.package_name=? AND r.platform=? AND r.checked_at=(SELECT MAX(h.checked_at) FROM aso_rank_history h WHERE h.keyword_id=r.keyword_id AND h.store=r.store AND h.country=r.country) ORDER BY r.checked_at DESC",
        )
        .all(app.packageName, platform),
      competitors: db
        .prepare(
          "SELECT * FROM aso_competitor WHERE package_name=? AND platform=? ORDER BY pinned DESC",
        )
        .all(app.packageName, platform),
      aiResult: JSON.parse(
        db
          .prepare(
            "SELECT payload FROM aso_ai_run WHERE package_name=? AND platform=? AND kind NOT IN ('keywords','reviewReply') ORDER BY id DESC LIMIT 1",
          )
          .get(app.packageName, app.platform)?.payload || "null",
      ),
      campaigns: campaigns.getCampaignLinks(app.packageName),
    });
  }),
);
router.post("/aso/reviews/reply", run(async (req, res) => {
  if (req.body.confirmed !== true) throw new Error("PREVIEW_REQUIRED");
  const app = await ownedApp(req.body.appId);
  res.json({ review: await reviewReplies.publish(app, req.body.reviewId, req.body.text) });
}));
router.post("/aso/reviews/refresh", run(async (req, res) => {
  const app = await ownedApp(req.body.appId);
  resolver.clearCache("managed:reviews");
  res.json(await managedReviews.loadReviews(app));
}));
router.post("/aso/keywords", run(async (req, res) => {
  keywordStore.track(await ownedApp(req.body.appId), [req.body.term]);
  res.json({ success: true });
}));
router.post("/aso/keywords/bulk", run(async (req, res) => {
  const added = keywordStore.track(await ownedApp(req.body.appId), req.body.terms, "ai");
  res.json({ success: true, added });
}));
router.delete(
  "/aso/keywords/:id",
  run(async (req, res) => {
    db.prepare("DELETE FROM aso_keyword WHERE id=?").run(Number(req.params.id));
    res.json({ success: true });
  }),
);
router.post(
  "/aso/ranks",
  run(async (req, res) => {
    const app = await ownedApp(req.body.appId);
    res.json(await rankTracker.checkRanks(app, req.body.country || "us"));
  }),
);
router.get(
  "/aso/ranks/history",
  run(async (req, res) => {
    const app = await ownedApp(req.query.appId);
    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const rows = db
      .prepare(
        `SELECT r.keyword_id, k.term, r.country, r.rank, r.top_n, r.checked_at FROM aso_rank_history r
         JOIN aso_keyword k ON k.id=r.keyword_id
         WHERE r.package_name=? AND r.platform=? AND r.checked_at>=? ORDER BY r.checked_at`,
      )
      .all(app.packageName, codePlatform(app), since);
    const groups = new Map();
    for (const r of rows) {
      const key = r.keyword_id + ":" + r.country;
      if (!groups.has(key)) groups.set(key, { keywordId: r.keyword_id, term: r.term, country: r.country, points: [] });
      groups.get(key).points.push({ date: r.checked_at.slice(0, 10), rank: r.rank, topN: r.top_n });
    }
    res.json({ history: [...groups.values()] });
  }),
);
router.get(
  "/aso/events",
  run(async (req, res) => {
    res.json({ events: await insights.listEvents(await ownedApp(req.query.appId)) });
  }),
);
router.post(
  "/aso/events",
  run(async (req, res) => {
    const app = await ownedApp(req.body.appId);
    res.status(201).json(insights.addEvent(app, req.body.date, req.body.label));
  }),
);
router.delete(
  "/aso/events/:id",
  run(async (req, res) => {
    db.prepare("DELETE FROM app_event WHERE id=? AND source='manual'").run(Number(req.params.id));
    res.json({ success: true });
  }),
);
router.get("/review-templates", (req, res) => res.json({ templates: replyTemplates.list() }));
router.post("/review-templates", (req, res) => res.status(201).json(replyTemplates.create(req.body)));
router.delete("/review-templates/:id", (req, res) => {
  replyTemplates.remove(Number(req.params.id));
  res.json({ success: true });
});
router.post(
  "/aso/reviews/reply-bulk",
  run(async (req, res) => {
    if (req.body.confirmed !== true) throw new Error("PREVIEW_REQUIRED");
    const items = req.body.items;
    if (!Array.isArray(items) || !items.length || items.length > 20) throw new Error("INVALID_INPUT");
    const app = await ownedApp(req.body.appId), results = [];
    // Sequential on purpose: store APIs are rate limited and one failure must not hide the rest.
    for (const item of items) {
      try {
        await reviewReplies.publish(app, item?.reviewId, item?.text);
        results.push({ reviewId: item.reviewId, ok: true });
      } catch (error) {
        results.push({ reviewId: item?.reviewId, ok: false, error: error.message });
      }
    }
    res.json({ results });
  }),
);
router.get(
  "/insights/anomalies",
  run(async (req, res) => res.json({ anomalies: await insights.collectAnomalies() })),
);
router.get(
  "/insights/open-reviews",
  (req, res) => res.json({ apps: insights.openReviewSummary() }),
);
router.get(
  "/insights/release-impact",
  run(async (req, res) => res.json({ releases: await insights.releaseImpactFor(await ownedApp(req.query.appId)) })),
);
router.get(
  "/insights/digest",
  run(async (req, res) => res.json(await insights.buildDigest(req.query.period === "weekly" ? "weekly" : "daily"))),
);
router.post(
  "/insights/digest/send",
  run(async (req, res) => {
    const digest = await insights.buildDigest(req.body.period === "weekly" ? "weekly" : "daily");
    res.json({ digest, delivery: await require("../lib/notifier").broadcastAlert({ title: digest.title, message: digest.message }) });
  }),
);
router.get(
  "/aso/hints",
  run(async (req, res) => {
    const term = String(req.query.term || "").slice(0, 80);
    res.json(await getKeywordHints({ term, platform: "all" }));
  }),
);
router.post("/aso/competitors", run(async (req, res) => {
  res.json({ competitors: await asoCatalog.search(await ownedApp(req.body.appId), req.body.term) });
}));
router.post("/aso/competitors/track", run(async (req, res) => {
  try {
    await asoCatalog.pin(await ownedApp(req.body.appId), req.body.competitorId);
  } catch (error) {
    if (error.message === "COMPETITOR_NOT_FOUND") throw new Error("INVALID_INPUT");
    throw error;
  }
  res.json({ success: true });
}));
router.post(
  "/aso/lint",
  run(async (req, res) => {
    const { platform, metadata } = req.body;
    if (
      !["apple", "play"].includes(platform) ||
      !metadata ||
      JSON.stringify(metadata).length > 30000
    )
      throw new Error("INVALID_INPUT");
    res.json(lintMetadata({ ...metadata, platform }));
  }),
);
router.get(
  "/aso/pricing",
  run(async (req, res) => {
    const price = Number(req.query.price);
    if (!Number.isFinite(price) || price <= 0 || price > 10000)
      throw new Error("INVALID_INPUT");
    res.json(calculatePppPricing(price));
  }),
);
router.post("/aso/campaigns", run(async (req, res) => {
  try {
    res.json(asoCatalog.createCampaign(await ownedApp(req.body.appId), req.body));
  } catch (error) {
    if (error.message === "LISTING_UNAVAILABLE") throw new Error("INVALID_INPUT");
    throw error;
  }
}));
router.delete(
  "/aso/campaigns/:id",
  run(async (req, res) => {
    campaigns.deleteCampaignLink(Number(req.params.id));
    res.json({ success: true });
  }),
);
router.post(
  "/ai/preview",
  run(async (req, res) => {
    const {
      appId,
      kind = "audit",
      question = "",
      includeMetrics = false,
      noteIds = [],
      locale = "vi",
      range = {},
      reviewId,
    } = req.body;
    if (
      !["audit", "variants", "reviews", "reviewReply", "ask", "note", "keywords"].includes(kind) ||
      !["vi", "en"].includes(locale) ||
      typeof question !== "string" ||
      question.length > 1000 ||
      !Array.isArray(noteIds) ||
      noteIds.length > 10 ||
      typeof includeMetrics !== "boolean"
    )
      throw new Error("INVALID_INPUT");
    const app = await ownedApp(appId),
      meta = await asoCatalog.listing(app);
    let payload = {
      app: {
        name: app.name,
        packageName: app.packageName,
        platform: app.platform,
      },
      kind,
      locale,
      question: redact(question),
      listing: {
        title: meta?.title || meta?.trackName || app.name,
        summary: meta?.summary || meta?.subtitle || "",
        description: String(meta?.description || "").slice(0, 12000),
      },
      keywords: db
        .prepare(
          "SELECT term FROM aso_keyword WHERE package_name=? AND platform=? LIMIT 30",
        )
        .all(app.packageName, codePlatform(app)),
    };
    if (kind === "keywords") {
      payload = keywordAI.extend(payload, app, String(req.body.country || "us").toLowerCase(), Number(req.body.count));
    }
    if (kind === "reviews")
      payload.reviews = (await reviews(app)).slice(0, 20).map((x) => ({
        rating: x.score || x.rating,
        text: String(x.text || x.body || x.title || "").slice(0, 500),
      }));
    if (kind === "reviewReply") {
      if (typeof reviewId !== "string") throw new Error("INVALID_REVIEW_REPLY");
      const review = (await reviews(app)).find(review => review.id === reviewId);
      if (!review) throw new Error("INVALID_REVIEW_REPLY");
      payload.review = { rating: review.rating || review.score, text: String(review.text || review.body || "").slice(0, 5000), language: review.language || "" };
      payload.replyLimit = app.platform === "google" ? 350 : 5970;
      payload.instruction = reviewDraft.instruction;
    }
    if (includeMetrics) {
      const stats = await appStats(app, dateRange(range));
      payload.metrics = {
        installs: stats.installs,
        revenueByCurrency: stats.revenueByCurrency,
        grossRevenueByCurrency: stats.grossRevenueByCurrency || {},
        revenueBasis: app.platform === "google" ? "gross_buyer_payments_including_tax" : "estimated_developer_proceeds",
        range: dateRange(range),
      };
    }
    if (noteIds.length)
      payload.notes = (await getNotesFromStorage())
        .filter(
          (n) =>
            noteIds.includes(n.id) &&
            (n.packageName === app.packageName || n.packageName === "all"),
        )
        .map((n) => ({ title: n.title, content: n.content.slice(0, 2000) }));
    const safePayload = JSON.parse(
      JSON.stringify(payload, (key, value) => redact(value)),
    );
    for (const [id, entry] of previews)
      if (entry.expires < Date.now()) previews.delete(id);
    if (previews.size >= 20) previews.delete(previews.keys().next().value);
    const previewId = crypto.randomBytes(24).toString("hex");
    previews.set(previewId, {
      payload: safePayload,
      expires: Date.now() + 600000,
    });
    const status = getAIStatus();
    const destination = status.providers.find(
      (provider) => provider.id === status.defaultProvider,
    );
    res.json({
      destination: destination
        ? {
            provider: destination.id,
            origin: destination.endpointOrigin,
            model: destination.model,
          }
        : null,
      previewId,
      payload: safePayload,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    });
  }),
);
router.post(
  "/ai/run",
  run(async (req, res) => {
    const entry = previews.get(req.body.previewId);
    if (req.body.confirmed !== true || !entry || entry.expires < Date.now())
      throw new Error("PREVIEW_REQUIRED");
    previews.delete(req.body.previewId);
    const result = await generateJSON({
      system: entry.payload.kind === "reviewReply"
        ? reviewDraft.system
        : keywordAI.system(entry.payload.locale),
      prompt: JSON.stringify(entry.payload),
      schema: reviewDraft.schema,
      maxTokens: entry.payload.kind === "reviewReply" ? 8192 : 2500,
    });
    const payload = entry.payload;
    if (payload.kind === "keywords") {
      const terms = keywordAI.existingTerms(payload.app);
      const clean = keywordAI.clean(result.data, payload, [...payload.keywords.map(row => row.term), ...terms]);
      result.data.candidates = clean.map(item => item.term);
      result.data.recommendations = clean.map(item => item.reason);
    }
    if (payload.kind === "reviewReply") reviewDraft.validate(result.data, payload.replyLimit);
    db.prepare(
      `INSERT INTO aso_ai_run(package_name,platform,kind,provider,model,input_hash,prompt_version,input_tokens,output_tokens,payload) VALUES(?,?,?,?,?,?,1,?,?,?)`,
    ).run(
      payload.app.packageName,
      payload.app.platform,
      payload.kind,
      result.provider,
      result.model,
      crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      result.usage?.inputTokens || 0,
      result.usage?.outputTokens || 0,
      JSON.stringify(result.data),
    );
    res.json({
      result: result.data,
      provider: result.provider,
      model: result.model,
    });
  }),
);
module.exports = router;
