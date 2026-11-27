const { createHash, randomBytes } = require("node:crypto");
const { db } = require("../lib/db");
const { redact } = require("../lib/runtime");
const ai = require("../lib/ai");
const store = require("../lib/portfolio");
const reviews = require("../lib/storeReviews");
const draft = require("../lib/reviewDraft");
const catalog = require("../lib/aso/catalog");
const keywordAI = require("../lib/aso/keywordAI");
const keywords = require("../lib/aso/keywords");

const previews = new Map();

module.exports = function registerAI(router, authenticate, run) {
  router.post("/ai/previews", authenticate, run(async (req, res) => {
    const { kind, appId, reviewId, country, count, locale = "vi" } = req.body || {};
    if (!["reviewReply", "keywords"].includes(kind) || typeof appId !== "string" || !["vi", "en"].includes(locale))
      throw new Error("INVALID_INPUT");
    const app = await store.ownedApp(appId);
    const destination = draft.destination();
    if (!destination) throw new Error("AI_NOT_CONFIGURED");
    let context;
    if (kind === "reviewReply") {
      const review = reviews.archivedReview(app, reviewId);
      context = { kind, app: app.name, replyLimit: reviews.replyLimit(app),
        review: { text: String(review.text || [review.title, review.body].filter(Boolean).join("\n")).slice(0, 5000),
          rating: review.rating ?? review.score ?? null, language: review.language || null },
        instruction: draft.instruction };
    } else {
      keywords.market(country);
      if (count !== undefined && (!Number.isSafeInteger(count) || count < 5 || count > 25)) throw new Error("INVALID_INPUT");
      context = keywordAI.extend(keywordAI.basePayload(app, await catalog.listing(app), locale), app, country, count);
    }
    const payload = JSON.parse(JSON.stringify(context, (key, value) => redact(value)));
    const now = Date.now(), expires = now + 600000;
    for (const [id, entry] of previews) if (entry.expires <= now) previews.delete(id);
    if (previews.size >= 20) previews.delete(previews.keys().next().value);
    const previewId = randomBytes(24).toString("hex");
    previews.set(previewId, { expires, session: req.mobileSessionID, app, payload, destination });
    res.json({ previewId, expiresAt: new Date(expires).toISOString(), destination, payload });
  }));

  router.post("/ai/runs", authenticate, run(async (req, res) => {
    const entry = previews.get(req.body?.previewId);
    if (req.body?.confirmed !== true || !entry || entry.expires <= Date.now() || entry.session !== req.mobileSessionID ||
        JSON.stringify(entry.destination) !== JSON.stringify(draft.destination()))
      throw new Error("PREVIEW_REQUIRED");
    previews.delete(req.body.previewId);
    if (entry.payload.kind === "reviewReply") return res.json({ text: await draft.generate(entry.payload) });
    const prompt = JSON.stringify(entry.payload);
    const result = await ai.generateJSON({
      system: keywordAI.system(entry.payload.locale),
      prompt, schema: draft.schema, maxTokens: 2500,
    });
    const existing = [...entry.payload.keywords, ...keywordAI.existingTerms(entry.app)];
    const suggestions = keywordAI.clean(result.data, entry.payload, existing);
    db.prepare(`INSERT INTO aso_ai_run(package_name,platform,kind,provider,model,input_hash,prompt_version,input_tokens,output_tokens,payload)
      VALUES(?,?,'keywords',?,?,?,1,?,?,?)`).run(entry.app.packageName, entry.app.platform, result.provider, result.model,
      createHash("sha256").update(prompt).digest("hex"), result.usage?.inputTokens || 0, result.usage?.outputTokens || 0,
      JSON.stringify({ candidates: suggestions.map(row => row.term), recommendations: suggestions.map(row => row.reason) }));
    res.json({ suggestions });
  }));
};
