const { randomBytes } = require("node:crypto");
const { db } = require("../lib/db");
const { redact } = require("../lib/runtime");
const { createLimiter } = require("../lib/utils/concurrency");
const store = require("../lib/portfolio");
const reviews = require("../lib/storeReviews");
const replies = require("../lib/reviewReplies");
const templates = require("../lib/reviewTemplates");
const draft = require("../lib/reviewDraft");
const insights = require("../lib/insights");
const resolver = require("../lib/resolver");
const { appDTO, rangeOf } = require("./mobileAnalytics");

const refresh = createLimiter(2);
const refreshing = new Map();
const previews = new Map();
const dateKey = "COALESCE(json_extract(payload,'$.date'),'')";
const replyKey = "COALESCE(json_extract(payload,'$.replyText'),'')";
const writeCodes = new Set(["REVIEW_REPLY_IN_PROGRESS", "REVIEW_REPLY_UNCERTAIN", "REVIEW_REPLY_NOT_VERIFIED",
  "REVIEW_REPLY_CONFLICT", "IDEMPOTENCY_CONFLICT", "REVIEW_NOT_FOUND", "INVALID_REVIEW_REPLY",
  "REVIEWS_PERMISSION_REQUIRED", "REVIEW_REPLY_FAILED", "PREVIEW_REQUIRED"]);

function dto(app, review) {
  const official = review.source === "official";
  return {
    app: appDTO(app), id: review.id, author: review.author || review.userName || null,
    text: review.text || [review.title, review.body].filter(Boolean).join("\n"),
    rating: Number.isInteger(review.rating ?? review.score) ? (review.rating ?? review.score) : null,
    date: review.date || null, territory: review.territory || null, language: review.language || null,
    source: official ? "official" : review.source === "csv" ? "report" : "public",
    canReply: official && review.canReply === true,
    replyText: review.replyText || null, replyDate: review.replyDate || null,
    replyState: review.replyText ? (review.responseState === "PENDING_PUBLISH" ? "pending" : "published") : "unanswered",
    revision: reviews.revision(review), replyLimit: reviews.replyLimit(app),
  };
}
function status(appId) {
  const source = db.prepare("SELECT status,synced_at AS checkedAt FROM review_source WHERE app_id=?").get(appId);
  return { appId, status: source?.status || "unknown", checkedAt: source?.checkedAt || null };
}
function refreshApp(app) {
  if (refreshing.has(app.id)) return refreshing.get(app.id);
  const job = refresh(async () => {
    try {
      const { sourceStatus } = await reviews.loadReviews(app);
      return { appId: app.id, status: sourceStatus, checkedAt: status(app.id).checkedAt };
    } catch {
      const checkedAt = new Date().toISOString();
      db.prepare(`INSERT INTO review_source(app_id,status,synced_at) VALUES(?,'unavailable',?)
        ON CONFLICT(app_id) DO UPDATE SET status=excluded.status,synced_at=excluded.synced_at`)
        .run(app.id, checkedAt);
      return { appId: app.id, status: "unavailable", checkedAt };
    }
  }).finally(() => refreshing.delete(app.id));
  refreshing.set(app.id, job);
  return job;
}

function page(apps, query) {
  const { cursor, status: filter = "all", stars, limit = "30" } = query;
  if (!["all", "unanswered", "answered"].includes(filter) ||
      (stars !== undefined && !["1", "2", "3", "4", "5"].includes(stars)) ||
      typeof limit !== "string" || !/^[1-9][0-9]?$|^100$/.test(limit))
    throw new Error("INVALID_INPUT");
  let after = ["", "", ""];
  if (cursor !== undefined) {
    try {
      if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,2000}$/.test(cursor)) throw new Error();
      after = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!Array.isArray(after) || after.length !== 3 ||
          after.some(value => typeof value !== "string" || value.length > 500)) throw new Error();
    } catch {
      throw new Error("INVALID_INPUT");
    }
  }
  const rows = db.prepare(`SELECT app_id,review_id,payload,${dateKey} AS sort_date FROM review_archive
    WHERE app_id IN (SELECT value FROM json_each(?))
      AND (?='all' OR (?='answered') = (${replyKey} <> ''))
      AND (? IS NULL OR COALESCE(json_extract(payload,'$.rating'),json_extract(payload,'$.score'))=?)
      AND (?=0 OR (${dateKey},review_id,app_id) < (?,?,?))
    ORDER BY sort_date DESC,review_id DESC,app_id DESC LIMIT ?`)
    .all(JSON.stringify(apps.map(app => app.id)), filter, filter, stars ? Number(stars) : null, stars ? Number(stars) : null,
      cursor ? 1 : 0, ...after, Number(limit) + 1);
  const shown = rows.slice(0, Number(limit));
  const last = shown.at(-1);
  const byID = new Map(apps.map(app => [app.id, app]));
  return { reviews: shown.map(row => dto(byID.get(row.app_id), JSON.parse(row.payload))),
    sources: apps.map(app => status(app.id)),
    nextCursor: rows.length > shown.length
      ? Buffer.from(JSON.stringify([last.sort_date, last.review_id, last.app_id])).toString("base64url") : null };
}

function verifyWrite(input) {
  if (input?.confirmed !== true) throw new Error("PREVIEW_REQUIRED");
  if (typeof input.operationId !== "string" || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(input.operationId) ||
      typeof input.expectedRevision !== "string" || !/^[\da-f]{64}$/.test(input.expectedRevision))
    throw new Error("INVALID_INPUT");
}

module.exports = function registerReviews(router, authenticate, run) {
  const link = (method, path, handle) => router[method](path, authenticate, run(handle));
  const withApp = fn => async (req, res) => fn(req, res, await store.ownedApp(req.params.appId));
  link("get", "/reviews", async (req, res) => {
    const apps = req.query.appId === undefined ? (await store.listApps()).apps : [await store.ownedApp(req.query.appId)];
    res.json(page(apps, req.query));
  });
  link("get", "/apps/:appId/reviews", withApp(async (req, res, app) => res.json(page([app], req.query))));
  link("post", "/reviews/refresh", async (req, res) => {
    const apps = req.body?.appId === undefined ? (await store.listApps()).apps : [await store.ownedApp(req.body.appId)];
    resolver.clearCache("managed:reviews");
    res.json({ sources: await Promise.all(apps.map(refreshApp)) });
  });
  link("get", "/apps/:appId/reviews/:reviewId", withApp(async (req, res, app) => {
    const review = reviews.archivedReview(app, req.params.reviewId);
    res.json({ review: dto(app, review), source: status(app.id) });
  }));
  link("put", "/apps/:appId/reviews/:reviewId/reply", withApp(async (req, res, app) => {
    verifyWrite(req.body);
    const review = await replies.publish(app, req.params.reviewId, req.body.text, req.body);
    res.json({ review: dto(app, review) });
  }));
  link("post", "/apps/:appId/reviews/bulk-replies", withApp(async (req, res, app) => {
    if (req.body?.confirmed !== true) throw new Error("PREVIEW_REQUIRED");
    const items = req.body.items;
    if (!Array.isArray(items) || !items.length || items.length > 20 ||
        new Set(items.map(item => item?.reviewId)).size !== items.length ||
        new Set(items.map(item => item?.operationId)).size !== items.length)
      throw new Error("INVALID_INPUT");
    const results = [];
    for (const item of items) {
      try {
        verifyWrite({ ...item, confirmed: true });
        const review = await replies.publish(app, item.reviewId, item.text, item);
        results.push({ reviewId: item.reviewId, review: dto(app, review), error: null });
      } catch (error) {
        results.push({ reviewId: typeof item?.reviewId === "string" ? item.reviewId : null,
          review: null, error: writeCodes.has(error.message) ? error.message : "INVALID_INPUT" });
      }
    }
    res.json({ results });
  }));
  link("get", "/review-templates", async (req, res) => res.json({ templates: templates.list() }));
  link("post", "/review-templates", async (req, res) => res.status(201).json(templates.create(req.body)));
  link("delete", "/review-templates/:id", async (req, res) => {
    templates.remove(Number(req.params.id));
    res.json({ success: true });
  });
  link("get", "/inbox", async (req, res) => {
    const { buildTasks } = await import("../lib/actionTasks.mjs");
    const range = rangeOf(req.query);
    const catalog = await store.listApps();
    const [portfolio, anomalies] = await Promise.all([
      store.portfolio(range, catalog), insights.collectAnomalies(catalog),
    ]);
    const tasks = buildTasks({ apps: portfolio.apps, rangeEnd: range.endDate,
      openReviews: insights.openReviewSummary({ officialOnly: true }), anomalies });
    res.json({ tasks: tasks.map(task => ({ ...task, app: appDTO(task.app) })) });
  });

  link("post", "/ai/previews", async (req, res) => {
    const { kind, appId, reviewId } = req.body || {};
    if (kind !== "reviewReply" || typeof appId !== "string") throw new Error("INVALID_INPUT");
    const app = await store.ownedApp(appId);
    const review = dto(app, reviews.archivedReview(app, reviewId));
    const destination = draft.destination();
    if (!destination) throw new Error("AI_NOT_CONFIGURED");
    const payload = JSON.parse(JSON.stringify({
      kind, app: app.name, replyLimit: review.replyLimit,
      review: { text: review.text.slice(0, 5000), rating: review.rating, language: review.language },
      instruction: draft.instruction,
    }, (key, value) => redact(value)));
    const now = Date.now(), expires = now + 600000;
    for (const [key, entry] of previews) if (entry.expires <= now) previews.delete(key);
    if (previews.size >= 20) previews.delete(previews.keys().next().value);
    const previewId = randomBytes(24).toString("hex");
    previews.set(previewId, { expires, session: req.mobileSessionID, payload, destination });
    res.json({ previewId, expiresAt: new Date(expires).toISOString(), destination, payload });
  });
  link("post", "/ai/runs", async (req, res) => {
    const entry = previews.get(req.body?.previewId);
    if (req.body?.confirmed !== true || !entry || entry.expires <= Date.now() || entry.session !== req.mobileSessionID ||
        JSON.stringify(entry.destination) !== JSON.stringify(draft.destination()))
      throw new Error("PREVIEW_REQUIRED");
    previews.delete(req.body.previewId);
    res.json({ text: await draft.generate(entry.payload) });
  });
};
