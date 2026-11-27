const { GoogleAuth } = require("google-auth-library");
const axios = require("axios");
const { getBaseConfig } = require("./config");
const { buildAppleViewer } = require("./viewerFactory");
const scraper = require("./aso/scraper");
const resolver = require("./resolver");
const { db } = require("./db");
const { createHash } = require("node:crypto");
const { redact } = require("./runtime");

function googleRequest() {
  const key = getBaseConfig().keyJson;
  if (!key) throw new Error("REVIEWS_PERMISSION_REQUIRED");
  return new GoogleAuth({ credentials: typeof key === "string" ? JSON.parse(key) : key,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"] });
}
function googleUrl(app, reviewId = "") {
  return `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(app.packageName)}/reviews` +
    (reviewId ? "/" + encodeURIComponent(reviewId) : "");
}
const timestamp = value => value?.seconds ? new Date(Number(value.seconds) * 1000).toISOString() : null;
function normalizeGoogle(review) {
  const user = review.comments?.find(c => c.userComment)?.userComment;
  const developer = review.comments?.find(c => c.developerComment)?.developerComment;
  return { id: review.reviewId, author: review.authorName || "", text: user?.text || "",
    rating: user?.starRating || null, language: user?.reviewerLanguage || "",
    date: timestamp(user?.lastModified), replyText: developer?.text || null,
    replyDate: timestamp(developer?.lastModified), canReply: true, source: "official" };
}
function remember(app, review, authoritative = false) {
  if (!review.id || typeof review.id !== "string") return;
  const previous = db.prepare("SELECT payload FROM review_archive WHERE app_id=? AND review_id=?").get(app.id, review.id);
  const old = previous ? JSON.parse(previous.payload) : {};
  if (old.source === "official" && review.source !== "official") return;
  // Listing refreshes can lag behind a just-confirmed write.
  if (!authoritative && old.replyText && old.replyDate && Date.now() - Date.parse(old.replyDate) < 300000 &&
      (!review.replyDate || Date.parse(review.replyDate) < Date.parse(old.replyDate))) {
    review.replyText = old.replyText;
    review.replyDate = old.replyDate;
    review.responseState = old.responseState;
  }
  // A stale public listing must not erase a response already confirmed by the store.
  if (!review.replyText && old.replyText && review.source !== "official") {
    review.replyText = old.replyText; review.replyDate = old.replyDate;
  }
  if (review.source !== "official" && old.replyText && old.replyDate &&
      (!review.replyDate || Date.parse(old.replyDate) > Date.parse(review.replyDate))) {
    review.replyText = old.replyText; review.replyDate = old.replyDate;
  }
  db.prepare("INSERT INTO review_archive(app_id,review_id,payload) VALUES(?,?,?) ON CONFLICT(app_id,review_id) DO UPDATE SET payload=excluded.payload,updated_at=datetime('now')")
    .run(app.id, review.id, JSON.stringify(review));
}
async function appleRequest(app, path, options = {}) {
  if (!path.startsWith("/v1/") || path.includes("://")) throw new Error("INVALID_INPUT");
  const token = buildAppleViewer(getBaseConfig(), app.packageName).generateToken();
  return axios({ url: "https://api.appstoreconnect.apple.com" + path,
    ...options, headers: { Authorization: `Bearer ${token}` }, timeout: 15000, maxRedirects: 0 });
}
async function loadReviews(app) {
  return resolver.resolve("managed:reviews", { appId: app.id }, async () => {
    let sourceStatus = "available";
    if (app.platform === "google") {
      const history = await require("./googleReviewHistory").getGoogleReviewHistory(getBaseConfig(), app.packageName).catch(() => []);
      for (const review of history.sort((a, b) => Date.parse(a.date) - Date.parse(b.date))) remember(app, review);
      const publicReviews = await scraper.getPlayReviews(app.packageName, 100);
      for (const review of publicReviews) remember(app, { id: review.id, author: review.userName || review.author || "",
        text: review.text || "", rating: review.score, date: review.date || null,
        replyText: review.replyText || null, replyDate: review.replyDate || null,
        canReply: !!review.id, source: "public" });
      try {
        const auth = googleRequest();
        const seen = new Set();
        let token;
        do {
          const { data } = await auth.request({ url: googleUrl(app), params: { maxResults: 100, ...(token ? { token } : {}) }, timeout: 15000, retry: false });
          for (const review of data.reviews || []) remember(app, normalizeGoogle(review));
          token = data.tokenPagination?.nextPageToken;
          if (token && seen.has(token)) throw new Error("PAGINATION_FAILED");
          seen.add(token);
        } while (token);
      } catch { sourceStatus = "unavailable"; }
    } else {
      try {
        const appId = app.appId || await buildAppleViewer(getBaseConfig(), app.packageName).getNumericAppId();
        let path = `/v1/apps/${encodeURIComponent(appId)}/customerReviews?limit=200&sort=-createdDate&include=response`;
        const seen = new Set();
        do {
          if (seen.has(path)) throw new Error("PAGINATION_FAILED");
          seen.add(path);
          const { data } = await appleRequest(app, path);
          for (const review of data.data || []) {
            const attrs = review.attributes || {};
            const responseId = review.relationships?.response?.data?.id;
            const response = data.included?.find(item => item.id === responseId && item.type === "customerReviewResponses");
            remember(app, { id: review.id, author: attrs.reviewerNickname, text: [attrs.title, attrs.body].filter(Boolean).join("\n"),
              rating: attrs.rating, date: attrs.createdDate, territory: attrs.territory,
              replyText: response?.attributes?.responseBody || null, replyDate: response?.attributes?.lastModifiedDate || null,
              responseState: response?.attributes?.state || null, source: "official", canReply: true });
          }
          if (!data.links?.next) break;
          const next = new URL(data.links.next);
          if (next.origin !== "https://api.appstoreconnect.apple.com") throw new Error("INVALID_INPUT");
          path = next.pathname + next.search;
        } while (path);
      } catch { sourceStatus = "unavailable"; }
      if (sourceStatus === "unavailable") {
        for (const review of await scraper.getAppleReviewsRSS(app.appId || app.packageName))
          remember(app, { ...review, date: review.date || review.reviewDate || null, canReply: false, source: "public" });
      }
    }
    db.prepare(`INSERT INTO review_source(app_id,status,synced_at) VALUES(?,?,?)
      ON CONFLICT(app_id) DO UPDATE SET status=excluded.status,synced_at=excluded.synced_at`)
      .run(app.id, sourceStatus, new Date().toISOString());
    return { reviews: db.prepare("SELECT payload FROM review_archive WHERE app_id=? ORDER BY json_extract(payload,'$.date') DESC LIMIT 500")
      .all(app.id).map(row => JSON.parse(row.payload)), sourceStatus };
  });
}
function archivedReview(app, reviewId) {
  if (typeof reviewId !== "string" || !reviewId || reviewId.length > 500)
    throw new Error("INVALID_REVIEW_REPLY");
  const row = db.prepare("SELECT payload FROM review_archive WHERE app_id=? AND review_id=?").get(app.id, reviewId);
  if (!row) throw new Error("REVIEW_NOT_FOUND");
  return JSON.parse(row.payload);
}

const replyLimit = app => app.platform === "google" ? 350 : 5970;
const revision = review => createHash("sha256")
  .update(JSON.stringify([review.text ?? null, review.rating ?? null, review.replyText || null]))
  .digest("hex");

async function officialReview(app, review, auth) {
  if (app.platform === "google") {
    const { data } = await auth.request({ url: googleUrl(app, review.id), timeout: 15000, retry: false });
    const live = normalizeGoogle(data);
    if (live.id !== review.id) throw new Error("REVIEWS_PERMISSION_REQUIRED");
    return live;
  }
  if (review.source !== "official") throw new Error("REVIEWS_PERMISSION_REQUIRED");
  const unanswered = { ...review, replyText: null, replyDate: null, responseState: null };
  try {
    const { data } = await appleRequest(app, "/v1/customerReviews/" + encodeURIComponent(review.id) + "/response");
    if (data?.data === null) return unanswered;
    const attrs = data?.data?.attributes;
    if (!attrs) throw new Error("REVIEW_REPLY_FAILED");
    return { ...review, replyText: attrs.responseBody || null, replyDate: attrs.lastModifiedDate || null,
      responseState: attrs.state || null };
  } catch (error) {
    if (error.response?.status === 404) return unanswered;
    throw error;
  }
}

function storeError(error, writing) {
  const code = error.response?.status;
  if (code === 401 || code === 403 || code === 404 || error.message === "REVIEWS_PERMISSION_REQUIRED")
    return new Error("REVIEWS_PERMISSION_REQUIRED");
  if (writing && (!code || code === 408 || code >= 500)) return new Error("REVIEW_REPLY_UNCERTAIN");
  return new Error("REVIEW_REPLY_FAILED");
}

async function refreshOfficialReview(app, reviewId) {
  const archived = archivedReview(app, reviewId);
  let live;
  try {
    live = await officialReview(app, archived, app.platform === "google" ? googleRequest() : null);
  } catch (error) {
    throw storeError(error, false);
  }
  remember(app, live, true);
  resolver.clearCache("managed:reviews");
  return live;
}

async function replyReview(app, reviewId, body, expectedRevision) {
  if (typeof body !== "string" || !body.trim() || body.trim().length > replyLimit(app) || redact(body) !== body)
    throw new Error("INVALID_REVIEW_REPLY");
  body = body.trim();
  let review;
  try {
    review = archivedReview(app, reviewId);
  } catch (error) {
    if (error.message === "REVIEW_NOT_FOUND" && !expectedRevision) throw new Error("INVALID_REVIEW_REPLY");
    throw error;
  }
  if (app.platform === "apple" && review.source !== "official") throw new Error("REVIEWS_PERMISSION_REQUIRED");
  if (expectedRevision && (review.source !== "official" || review.canReply !== true))
    throw new Error("REVIEWS_PERMISSION_REQUIRED");
  let auth;
  try {
    if (app.platform === "google") auth = googleRequest();
    review = await officialReview(app, review, auth);
  } catch (error) {
    throw storeError(error, false);
  }
  if (expectedRevision && revision(review) !== expectedRevision) {
    remember(app, review, true);
    resolver.clearCache("managed:reviews");
    throw new Error("REVIEW_REPLY_CONFLICT");
  }
  if (review.replyText === body) {
    remember(app, review, true);
    return review;
  }
  try {
    if (auth) {
      const { data } = await auth.request({ url: googleUrl(app, reviewId) + ":reply", method: "POST",
        data: { replyText: body }, timeout: 15000, retry: false });
      review.replyDate = timestamp(data?.result?.lastEdited);
      body = data?.result?.replyText ?? body;
    } else {
      const response = await appleRequest(app, "/v1/customerReviewResponses", { method: "POST", data: { data: {
        type: "customerReviewResponses", attributes: { responseBody: body },
        relationships: { review: { data: { id: reviewId, type: "customerReviews" } } },
      } } });
      review.responseState = response.data.data?.attributes?.state || "PENDING_PUBLISH";
      review.replyDate = response.data.data?.attributes?.lastModifiedDate;
      body = response.data.data?.attributes?.responseBody ?? body;
    }
  } catch (error) {
    throw storeError(error, true);
  }
  review.replyText = body;
  review.replyDate ||= new Date().toISOString();
  review.source = "official";
  remember(app, review, true);
  resolver.clearCache("managed:reviews");
  return review;
}
module.exports = { loadReviews, replyReview, normalizeGoogle, archivedReview, refreshOfficialReview, revision, replyLimit };
