const assert = require("node:assert/strict");
const { GoogleAuth } = require("google-auth-library");
require("../lib/config").getBaseConfig = () => ({ keyJson: {} });
const scraper = require("../lib/aso/scraper");
require("../lib/viewerFactory").buildAppleViewer = () => ({ generateToken: () => "synthetic-apple-token" });
const axiosPath = require.resolve("axios");
const appleRequests = [];
require.cache[axiosPath].exports = async options => {
  appleRequests.push(options);
  if (options.method === "POST") return { data: { data: { attributes: { state: "PENDING_PUBLISH" } } } };
  return { data: { data: [{ id: "apple-review", attributes: { reviewerNickname: "Apple user", body: "Useful timer", rating: 5, createdDate: "2026-10-30" },
    relationships: { response: { data: { id: "apple-response" } } } }],
    included: [{ id: "apple-response", type: "customerReviewResponses", attributes: { responseBody: "Existing Apple reply" } }] } };
};
scraper.getPlayReviews = async () => [{ id: "older-review", userName: "Public user", score: 5, text: "Useful", replyText: "An older response", date: "2026-09-01" }];
require("../lib/googleReviewHistory").getGoogleReviewHistory = async () => [];
let fail = false;
const requests = [];
GoogleAuth.prototype.request = async function(options) {
  requests.push(options);
  if (fail) throw new Error("Synthetic denied with credential contents");
  const review = { reviewId: "new-review", authorName: "User", comments: [
    { userComment: { text: "Great timer", starRating: 5, lastModified: { seconds: 1793350800 } } },
    { developerComment: { text: "Existing response", lastModified: { seconds: 1793350801 } } },
  ] };
  return { data: options.url.endsWith("/reviews") ? { reviews: [review] } : options.method === "POST" ? {} : review };
};
const { loadReviews, replyReview } = require("../lib/storeReviews");
const { db } = require("../lib/db");
(async () => {
  const app = { id: "google:com.example.reviews", packageName: "com.example.reviews", platform: "google" };
  const loaded = await loadReviews(app);
  assert.equal(loaded.sourceStatus, "available");
  assert.equal(loaded.reviews.length, 2);
  assert.equal(loaded.reviews.find(review => review.id === "new-review").replyText, "Existing response");
  assert.equal(loaded.reviews.find(review => review.id === "older-review").replyText, "An older response");
  const before = requests.length;
  await assert.rejects(replyReview(app, "not-owned", "hello"), /INVALID_REVIEW_REPLY/);
  await assert.rejects(replyReview(app, "new-review", "x".repeat(351)), /INVALID_REVIEW_REPLY/);
  assert.equal(requests.length, before);
  const updated = await replyReview(app, "new-review", "Thanks for your feedback!");
  assert.equal(updated.replyText, "Thanks for your feedback!");
  assert.equal(requests.at(-1).method, "POST");
  assert.deepEqual(requests.at(-1).data, { replyText: "Thanks for your feedback!" });
  fail = true;
  const cached = await loadReviews(app);
  assert.equal(cached.sourceStatus, "unavailable");
  assert.ok(cached.reviews.some(review => review.replyText === "Thanks for your feedback!"));
  await assert.rejects(replyReview(app, "new-review", "Another response"), /REVIEW_REPLY_FAILED/);
  const apple = { id: "apple:com.example.reviews", packageName: "com.example.reviews", appId: "123", platform: "apple" };
  const appleLoaded = await loadReviews(apple);
  assert.equal(appleLoaded.reviews[0].replyText, "Existing Apple reply");
  const appleReply = await replyReview(apple, "apple-review", "Thank you for your Apple review!");
  assert.equal(appleReply.responseState, "PENDING_PUBLISH");
  assert.equal(appleRequests.at(-1).data.data.relationships.review.data.id, "apple-review");
  assert.equal(appleRequests.at(-1).headers.Authorization, "Bearer synthetic-apple-token");
  db.close();
  console.log("PASS: official/public developer replies, review archive retention, owned targets, reply length and sanitized store failures.");
})().catch(error => { console.error(error); process.exitCode = 1; });
