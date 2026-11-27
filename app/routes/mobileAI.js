const { createHash, randomBytes } = require("node:crypto");
const { db } = require("../lib/db");
const { redact } = require("../lib/runtime");
const ai = require("../lib/ai");
const store = require("../lib/portfolio");
const mobileCatalog = require("../lib/mobileCatalog");
const reviews = require("../lib/storeReviews");
const draft = require("../lib/reviewDraft");
const catalog = require("../lib/aso/catalog");
const keywordAI = require("../lib/aso/keywordAI");
const keywords = require("../lib/aso/keywords");

const previews = new Map();
const analysisKinds = ["audit", "variants", "reviews", "ask"];

async function analysisPayload(app, kind, locale, body) {
  const { question = "", includeMetrics = false, range = {} } = body;
  if (typeof question !== "string" || question.length > 1000 || typeof includeMetrics !== "boolean" ||
      !range || typeof range !== "object" || Array.isArray(range)) throw new Error("INVALID_INPUT");
  const { listing, keywords: tracked } = keywordAI.basePayload(app, await catalog.listing(app), locale);
  const payload = { app: { name: app.name, platform: app.platform, packageName: app.packageName },
    kind, locale, question, listing, keywords: tracked };
  if (kind === "reviews") {
    payload.reviews = (await reviews.loadReviews(app)).reviews.slice(0, 20).map(review => ({
      rating: review.rating ?? review.score ?? null,
      text: String(review.text || review.body || review.title || "").slice(0, 500),
    }));
  }
  if (includeMetrics) {
    const selected = require("./mobileAnalytics").rangeOf({ from: range.startDate, to: range.endDate });
    const stats = await store.appStats(app, selected);
    payload.metrics = { range: selected, installs: stats.installs ?? null,
      revenueByCurrency: stats.revenueByCurrency || {}, grossRevenueByCurrency: stats.grossRevenueByCurrency || {},
      revenueBasis: app.platform === "google" ? "gross_buyer_payments_including_tax" : "estimated_developer_proceeds" };
  }
  return payload;
}

module.exports = function registerAI(router, authenticate, run) {
  router.post("/ai/previews", authenticate, run(async (req, res) => {
    const { kind, appId, reviewId, country, count, locale = "vi" } = req.body || {};
    if (!["reviewReply", "keywords", ...analysisKinds].includes(kind) || typeof appId !== "string" || !["vi", "en"].includes(locale))
      throw new Error("INVALID_INPUT");
    const app = await mobileCatalog.ownedApp(appId);
    const destination = draft.destination();
    if (!destination) throw new Error("AI_NOT_CONFIGURED");
    let context;
    if (kind === "reviewReply") {
      const review = reviews.archivedReview(app, reviewId);
      context = { kind, app: app.name, replyLimit: reviews.replyLimit(app),
        review: { text: String(review.text || [review.title, review.body].filter(Boolean).join("\n")).slice(0, 5000),
          rating: review.rating ?? review.score ?? null, language: review.language || null },
        instruction: draft.instruction };
    } else if (kind === "keywords") {
      keywords.market(country);
      if (count !== undefined && (!Number.isSafeInteger(count) || count < 5 || count > 25)) throw new Error("INVALID_INPUT");
      context = keywordAI.extend(keywordAI.basePayload(app, await catalog.listing(app), locale), app, country, count);
    } else {
      context = await analysisPayload(app, kind, locale, req.body);
    }
    const payload = JSON.parse(JSON.stringify(context, (key, value) => redact(value)));
    const now = Date.now(), expires = now + 600000;
    for (const [id, entry] of previews) if (entry.expires <= now) previews.delete(id);
    if (previews.size >= 20) previews.delete(previews.keys().next().value);
    const previewId = randomBytes(24).toString("hex");
    previews.set(previewId, { expires, session: req.mobileSessionID, app, payload, destination });
    res.json({ previewId, expiresAt: new Date(expires).toISOString(), destination, payload,
      ...(analysisKinds.includes(kind) ? { payloadJSON: JSON.stringify(payload, null, 2) } : {}) });
  }));

  router.post("/ai/runs", authenticate, run(async (req, res) => {
    const entry = previews.get(req.body?.previewId);
    if (req.body?.confirmed !== true || !entry || entry.expires <= Date.now() || entry.session !== req.mobileSessionID ||
        JSON.stringify(entry.destination) !== JSON.stringify(draft.destination()))
      throw new Error("PREVIEW_REQUIRED");
    mobileCatalog.assertVisible(entry.app.id);
    previews.delete(req.body.previewId);
    if (entry.payload.kind === "reviewReply") return res.json({ text: await draft.generate(entry.payload) });
    const prompt = JSON.stringify(entry.payload);
    const result = await ai.generateJSON({
      system: keywordAI.system(entry.payload.locale),
      prompt, schema: draft.schema, maxTokens: 2500,
    });
    const kind = entry.payload.kind;
    const suggestions = kind === "keywords"
      ? keywordAI.clean(result.data, entry.payload, [...entry.payload.keywords, ...keywordAI.existingTerms(entry.app)]) : null;
    const safe = suggestions
      ? { candidates: suggestions.map(row => row.term), recommendations: suggestions.map(row => row.reason) }
      : JSON.parse(JSON.stringify(result.data, (key, value) => redact(value)));
    db.prepare(`INSERT INTO aso_ai_run(package_name,platform,kind,provider,model,input_hash,prompt_version,input_tokens,output_tokens,payload)
      VALUES(?,?,?,?,?,?,1,?,?,?)`).run(entry.app.packageName, entry.app.platform, kind, result.provider, result.model,
      createHash("sha256").update(prompt).digest("hex"), result.usage?.inputTokens || 0, result.usage?.outputTokens || 0,
      JSON.stringify(safe));
    res.json(suggestions ? { suggestions } : { result: safe, provider: result.provider, model: result.model });
  }));

  router.get("/apps/:appId/ai/latest", authenticate, run(async (req, res) => {
    const app = await mobileCatalog.ownedApp(req.params.appId);
    const row = db.prepare(`SELECT payload,kind,provider,model FROM aso_ai_run
      WHERE package_name=? AND platform=? AND kind IN ('audit','variants','reviews','ask') ORDER BY id DESC LIMIT 1`)
      .get(app.packageName, app.platform);
    res.json({ result: row ? JSON.parse(row.payload) : null, kind: row?.kind ?? null,
      provider: row?.provider ?? null, model: row?.model ?? null });
  }));
};
