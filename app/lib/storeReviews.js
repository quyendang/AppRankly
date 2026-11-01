const { GoogleAuth } = require("google-auth-library");
const axios = require("axios");
const { getBaseConfig } = require("./config");
const { buildAppleViewer } = require("./viewerFactory");
const scraper = require("./aso/scraper");
const resolver = require("./resolver");
const { db } = require("./db");
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
function remember(app, review) {
  if (!review.id || typeof review.id !== "string") return;
  const previous = db.prepare("SELECT payload FROM review_archive WHERE app_id=? AND review_id=?").get(app.id, review.id);
  const old = previous ? JSON.parse(previous.payload) : {};
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
    return { reviews: db.prepare("SELECT payload FROM review_archive WHERE app_id=? ORDER BY json_extract(payload,'$.date') DESC LIMIT 500")
      .all(app.id).map(row => JSON.parse(row.payload)), sourceStatus };
  });
}
async function replyReview(app, reviewId, body) {
  if (typeof reviewId !== "string" || !reviewId || reviewId.length > 500 ||
      typeof body !== "string" || !body.trim() || body.length > (app.platform === "google" ? 350 : 5970) || redact(body) !== body)
    throw new Error("INVALID_REVIEW_REPLY");
  const known = db.prepare("SELECT payload FROM review_archive WHERE app_id=? AND review_id=?").get(app.id, reviewId);
  if (!known) throw new Error("INVALID_REVIEW_REPLY");
  let review = JSON.parse(known.payload);
  try {
    if (app.platform === "google") {
      const auth = googleRequest();
      // Verify the target with Google before publishing, including reviews older than the list window.
      const { data } = await auth.request({ url: googleUrl(app, reviewId), timeout: 15000, retry: false });
      review = normalizeGoogle(data);
      await auth.request({ url: googleUrl(app, reviewId) + ":reply", method: "POST", data: { replyText: body.trim() }, timeout: 15000, retry: false });
    } else {
      if (review.source !== "official") throw new Error("INVALID_REVIEW_REPLY");
      const response = await appleRequest(app, "/v1/customerReviewResponses", { method: "POST", data: { data: {
        type: "customerReviewResponses", attributes: { responseBody: body.trim() },
        relationships: { review: { data: { id: reviewId, type: "customerReviews" } } },
      } } });
      review.responseState = response.data.data?.attributes?.state || "PENDING_PUBLISH";
    }
  } catch (error) {
    if (error.message === "INVALID_REVIEW_REPLY") throw error;
    throw new Error("REVIEW_REPLY_FAILED");
  }
  review.replyText = body.trim(); review.replyDate = new Date().toISOString(); review.source = "official";
  remember(app, review);
  resolver.clearCache("managed:reviews");
  return review;
}
module.exports = { loadReviews, replyReview, normalizeGoogle };
