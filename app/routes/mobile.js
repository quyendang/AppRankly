const express = require("express");
const rateLimit = require("express-rate-limit");
const { createHash, createHmac, randomBytes, randomUUID } = require("node:crypto");
const { signingKey, verifyOwnerPassword } = require("../lib/auth");
const { db } = require("../lib/db");

const accessLifetime = 15 * 60;
const refreshLifetime = 30 * 24 * 60 * 60;
const now = () => Math.floor(Date.now() / 1000);
const secretToken = () => randomBytes(32).toString("base64url");
const tokenHash = token => createHash("sha256").update(token).digest("hex");
const credentialVersion = () => createHmac("sha256", signingKey()).update("mobile-session-v1").digest("hex");
const validToken = token => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
const run = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

function fail(res, status, code) {
  return res.status(status).json({ error: { code, requestId: res.locals.mobileRequestId } });
}

function tokenPair() {
  return { accessToken: secretToken(), refreshToken: secretToken(), expiresIn: accessLifetime };
}

function authenticate(req, res, next) {
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.get("authorization") || "")?.[1];
  const session = token && db.prepare(
    "SELECT id FROM mobile_session WHERE access_hash=? AND credential_version=? AND access_expires_at>?"
  ).get(tokenHash(token), credentialVersion(), now());
  if (!session) return fail(res, 401, "AUTH_REQUIRED");
  req.mobileSessionID = session.id;
  next();
}

module.exports = function mobileRouter(loginLimit) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.locals.mobileRequestId = randomUUID();
    res.set("X-Request-Id", res.locals.mobileRequestId);
    if (process.env.NODE_ENV === "production" && !req.secure)
      return fail(res, 400, "HTTPS_REQUIRED");
    next();
  });
  router.use(rateLimit({
    windowMs: 60000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => fail(res, 429, "RATE_LIMIT"),
  }));
  const parseJSON = express.json({ limit: "64kb" });
  const parseBulkJSON = express.json({ limit: "768kb" });
  router.use((req, res, next) => {
    if (req.method === "POST" && /^\/apps\/[^/]+\/reviews\/bulk-replies\/?$/i.test(req.path))
      return authenticate(req, res, () => parseBulkJSON(req, res, next));
    return parseJSON(req, res, next);
  });

  router.post("/auth/login", loginLimit, run(async (req, res) => {
    const version = credentialVersion();
    if (!(await verifyOwnerPassword(req.body?.password)) || version !== credentialVersion())
      return fail(res, 401, "INVALID_LOGIN");
    const time = now();
    const pair = tokenPair();
    db.prepare("DELETE FROM mobile_session WHERE refresh_expires_at<=? OR credential_version<>?").run(time, version);
    db.prepare(
      "INSERT INTO mobile_session (id, access_hash, refresh_hash, credential_version, access_expires_at, refresh_expires_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(randomUUID(), tokenHash(pair.accessToken), tokenHash(pair.refreshToken), version,
      time + accessLifetime, time + refreshLifetime);
    res.json(pair);
  }));

  router.post("/auth/refresh", (req, res) => {
    const token = req.body?.refreshToken;
    if (!validToken(token)) return fail(res, 401, "AUTH_REQUIRED");
    const time = now();
    const pair = tokenPair();
    // Only one concurrent request can exchange the old refresh token.
    const updated = db.prepare(`
      UPDATE mobile_session
      SET access_hash=?, refresh_hash=?, access_expires_at=MIN(?, refresh_expires_at)
      WHERE refresh_hash=? AND credential_version=? AND refresh_expires_at>?
      RETURNING access_expires_at
    `).get(tokenHash(pair.accessToken), tokenHash(pair.refreshToken), time + accessLifetime,
      tokenHash(token), credentialVersion(), time);
    if (!updated) return fail(res, 401, "AUTH_REQUIRED");
    res.json({ ...pair, expiresIn: updated.access_expires_at - time });
  });

  router.get("/auth/me", authenticate, (req, res) => res.json({ owner: true }));
  router.post("/auth/logout", authenticate, (req, res) => {
    db.prepare("DELETE FROM mobile_session WHERE id=?").run(req.mobileSessionID);
    res.sendStatus(204);
  });

  require("./mobileAnalytics")(router, authenticate, run);
  require("./mobileReviews")(router, authenticate, run);

  router.use((req, res) => fail(res, 404, "NOT_FOUND"));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === "entity.too.large") return fail(res, 413, "REQUEST_TOO_LARGE");
    if (error.status === 400) return fail(res, 400, "INVALID_INPUT");
    if (error.status === 415) return fail(res, 415, "UNSUPPORTED_MEDIA_TYPE");
    const code = error.message;
    if (["APP_NOT_FOUND", "NO_REPORTS", "REVIEW_NOT_FOUND"].includes(code)) return fail(res, 404, code);
    if (["INVALID_INPUT", "INVALID_DATE_RANGE", "INVALID_PLATFORM", "PREVIEW_REQUIRED", "INVALID_REVIEW_REPLY"].includes(code))
      return fail(res, 400, code);
    if (["REVIEW_REPLY_CONFLICT", "IDEMPOTENCY_CONFLICT", "REVIEW_REPLY_UNCERTAIN",
      "REVIEW_REPLY_IN_PROGRESS", "REVIEW_REPLY_NOT_VERIFIED"].includes(code)) return fail(res, 409, code);
    if (code === "REVIEWS_PERMISSION_REQUIRED") return fail(res, 403, code);
    if (code === "AI_NOT_CONFIGURED") return fail(res, 503, code);
    if (["AI_INVALID_RESPONSE", "AI_EMPTY_RESPONSE", "AI_OUTPUT_TRUNCATED", "REVIEW_REPLY_FAILED"].includes(code))
      return fail(res, 502, code);
    return fail(res, 500, "OPERATION_FAILED");
  });
  return router;
};
