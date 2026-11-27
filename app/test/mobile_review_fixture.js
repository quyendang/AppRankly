const analytics = require("./mobile_analytics_fixture");
const timestamp = "2026-11-26T05:00:00Z";

function install() {
  analytics.install();
  const { db } = require("../lib/db");
  const storeReviews = require("../lib/storeReviews");
  const seen = [];
  const remote = new Map();
  const idFor = (app, id) => app.id + "/" + id;
  const remember = (app, review) => db.prepare(
    "INSERT OR REPLACE INTO review_archive(app_id,review_id,payload) VALUES(?,?,?)"
  ).run(app.id, review.id, JSON.stringify(review));
  const make = (id, text, options = {}) => ({ id, text, author: "Minh Thảo", date: timestamp, rating: 2,
    canReply: true, source: "official", ...options });
  const apple = analytics.apple;
  const google = analytics.google;
  const owned = [
    [apple, make("apple-review", "Xuất CSV bị kẹt ở màn hình tải.")],
    [apple, make("second", "Mong có bộ lọc tháng.")],
    [apple, make("public", "A public review", { canReply: false, source: "public", rating: 5 })],
    [apple, make("absent", "Mong sửa đồng bộ.")],
    [google, make("google-review", "Bitte Erinnerungen prüfen.")],
    [google, make("public", "A different app, same ID", { canReply: false, source: "csv", rating: 5 })],
  ];
  for (const [app, review] of owned) {
    remember(app, review);
    remote.set(idFor(app, review.id), review);
    db.prepare("INSERT OR REPLACE INTO review_source(app_id,status,synced_at) VALUES(?,'available',?)").run(app.id, timestamp);
  }
  storeReviews.loadReviews = async app => {
    db.prepare("INSERT OR REPLACE INTO review_source(app_id,status,synced_at) VALUES(?,'available',?)")
      .run(app.id, timestamp);
    return { sourceStatus: "available", reviews: owned.filter(([a]) => a.id === app.id).map(([, r]) => r) };
  };
  storeReviews.refreshOfficialReview = async (app, reviewId) => {
    const value = remote.get(idFor(app, reviewId));
    if (!value) throw new Error("REVIEW_NOT_FOUND");
    remember(app, value);
    return value;
  };
  storeReviews.replyReview = async (app, reviewId, text, expectedRevision) => {
    const key = idFor(app, reviewId);
    const existing = remote.get(key);
    if (!existing) throw new Error("REVIEW_NOT_FOUND");
    if (!existing.canReply) throw new Error("REVIEWS_PERMISSION_REQUIRED");
    if (expectedRevision && expectedRevision !== storeReviews.revision(existing)) throw new Error("REVIEW_REPLY_CONFLICT");
    seen.push({ key, text });
    if (reviewId === "absent" && text === "Did not reach") throw new Error("REVIEW_REPLY_UNCERTAIN");
    const updated = { ...existing, replyText: text, replyDate: timestamp,
      responseState: app.platform === "apple" ? "PENDING_PUBLISH" : null };
    remote.set(key, updated);
    if (text === "Store accepted this before timeout") throw new Error("REVIEW_REPLY_UNCERTAIN");
    if (text === "Slow reply") await new Promise(resolve => setTimeout(resolve, 120));
    remember(app, updated);
    return updated;
  };
  const ai = require("../lib/ai");
  let drafts = 0;
  ai.getAIStatus = () => ({ defaultProvider: "stub", providers: [
    { id: "stub", name: "Fixture", endpointOrigin: "https://ai.example.invalid", model: "mock" },
  ] });
  ai.generateJSON = async () => {
    drafts++;
    return { data: { candidates: ["Cảm ơn bạn đã mô tả lỗi xuất CSV."] } };
  };
  require("../lib/insights").collectAnomalies = async () => [
    { appId: apple.id, key: "mock-installs", kind: "installs", direction: "down", change: -35 },
  ];
  return { db, seen, remote, apple, google, drafts: () => drafts };
}
module.exports = { install };
