const { createHash, randomUUID } = require("node:crypto");
const { db } = require("./db");
const reviews = require("./storeReviews");
const { redact } = require("./runtime");
const sending = new Set();
const SETTLE_MS = 5 * 60 * 1000;
const RETAIN_MS = 30 * 86400000;

const invalid = code => new Error(code);
const definite = new Set(["REVIEW_NOT_FOUND", "INVALID_REVIEW_REPLY", "REVIEWS_PERMISSION_REQUIRED",
  "REVIEW_REPLY_FAILED", "REVIEW_REPLY_CONFLICT"]);
const setState = (appId, key, state, result = null) => db.prepare(
  "UPDATE review_reply_operation SET state=?,result=?,updated_at=? WHERE app_id=? AND operation_id=?"
).run(state, result && JSON.stringify(result), Date.now(), appId, key);

async function reconcile(app, reviewId, key, row, text) {
  if (row.state === "sending" && Date.now() - row.updated_at < 45000)
    throw invalid("REVIEW_REPLY_IN_PROGRESS");
  let live;
  try {
    live = await reviews.refreshOfficialReview(app, reviewId);
  } catch {
    throw invalid("REVIEW_REPLY_UNCERTAIN");
  }
  if (live.replyText === text) {
    setState(app.id, key, "done", live);
    return live;
  }
  if (Date.now() - row.updated_at >= SETTLE_MS) {
    setState(app.id, key, "failed", "REVIEW_REPLY_NOT_VERIFIED");
    throw invalid("REVIEW_REPLY_NOT_VERIFIED");
  }
  throw invalid("REVIEW_REPLY_UNCERTAIN");
}

async function publish(app, reviewId, text, { operationId = randomUUID(), expectedRevision = null } = {}) {
  if (typeof reviewId !== "string" || !reviewId || reviewId.length > 500 ||
      typeof text !== "string" || !text.trim() || text.trim().length > reviews.replyLimit(app) || redact(text) !== text)
    throw invalid("INVALID_REVIEW_REPLY");
  text = text.trim();
  operationId = operationId.toLowerCase();
  const fingerprint = createHash("sha256").update(JSON.stringify([reviewId, text, expectedRevision])).digest("hex");
  const row = db.prepare("SELECT * FROM review_reply_operation WHERE app_id=? AND operation_id=?").get(app.id, operationId);
  if (row && row.fingerprint !== fingerprint) throw invalid("IDEMPOTENCY_CONFLICT");
  if (row?.state === "done") return JSON.parse(row.result);
  if (row?.state === "failed") throw invalid(JSON.parse(row.result));
  const lock = JSON.stringify([app.id, reviewId]);
  if (sending.has(lock)) throw invalid("REVIEW_REPLY_IN_PROGRESS");
  sending.add(lock);
  try {
    if (row) return await reconcile(app, reviewId, operationId, row, text);
    const blocked = db.prepare(`SELECT 1 FROM review_reply_operation
      WHERE app_id=? AND review_id=? AND state IN ('sending','uncertain') AND updated_at>?`)
      .get(app.id, reviewId, Date.now() - SETTLE_MS);
    if (blocked) throw invalid("REVIEW_REPLY_UNCERTAIN");
    db.prepare("DELETE FROM review_reply_operation WHERE updated_at<?").run(Date.now() - RETAIN_MS);
    db.prepare(`INSERT INTO review_reply_operation(app_id,operation_id,review_id,fingerprint,state,updated_at)
      VALUES(?,?,?,?,'sending',?)`).run(app.id, operationId, reviewId, fingerprint, Date.now());
    try {
      const review = await reviews.replyReview(app, reviewId, text, expectedRevision);
      setState(app.id, operationId, "done", review);
      return review;
    } catch (error) {
      const code = definite.has(error.message) ? error.message : "REVIEW_REPLY_UNCERTAIN";
      if (code === "REVIEW_REPLY_UNCERTAIN") setState(app.id, operationId, "uncertain");
      else setState(app.id, operationId, "failed", code);
      throw invalid(code);
    }
  } finally {
    sending.delete(lock);
  }
}
module.exports = { publish };
