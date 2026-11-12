const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const data = require("../lib/notificationData");

// Per-app metrics carry sign-aware changes against a baseline, never fabricated when the baseline is missing.
assert.equal(data.pctChange(4, 20), -80);
assert.equal(data.pctChange(5, 0), null);
assert.equal(data.pctChange(null, 5), null);
const stats = data.statsData([
  { appId: "apple:a", displayName: "A", platform: "APPLE", installs: 4, previousInstalls: 20, uninstalls: 6, smartAlerts: ["Downloads dropped"] },
  { appId: "google:g", displayName: "G", platform: "GOOGLE", installs: 30, previousInstalls: null, uninstalls: 0, smartAlerts: [] },
]);
assert.equal(stats.severity, "bad");
assert.equal(stats.items[0].metrics[0].change, -80);
assert.equal(stats.items[1].metrics[0].change, null);
assert.deepEqual(stats.items[1].metrics.map((m) => m.key), ["installs"], "zero uninstalls are omitted");
assert.deepEqual(stats.hints.map((h) => h.key), ["checkRelease", "checkCountries", "checkRecentReviews"]);
assert.ok(stats.hints.every((h) => h.appId === "apple:a" && h.tab), "hints point at the app that caused them");

// Hints: drops suggest where to look, gains suggest finding the cause, rank drops point to listing + ranks.
const keys = (item, kind) => data.hintsFor(item, kind).map((h) => h.key);
assert.deepEqual(keys({ appId: "x", metrics: [{ key: "installs", value: 10, change: 60 }] }, "stats"), ["findSpikeCause", "replyNewReviews"]);
assert.deepEqual(keys({ appId: "x", metrics: [{ key: "installs", value: 10, change: 5 }] }, "stats"), []);
assert.deepEqual(keys({ appId: "x", metrics: [{ key: "rank", change: -12 }] }, "rank"), ["checkListingKeywords", "recheckRanks"]);
assert.deepEqual(keys({ appId: "x", metrics: [{ key: "rank", change: 12 }] }, "rank"), ["keepRankMomentum"]);
assert.deepEqual(keys({ appId: "x", metrics: [] }, "review"), ["replyReview"]);
assert.ok(data.hintsFor({ appId: "x", metrics: [{ key: "installs", value: 1, change: -50 }, { key: "uninstalls", value: 9 }] }, "stats").length <= 3);

const rank = data.anomalyData({ appId: "a", kind: "rank", term: "notes", country: "vn", from: 3, to: 40, move: -37, direction: "down" }, { name: "A" });
assert.deepEqual([rank.kind, rank.items[0].metrics[0].key, rank.items[0].metrics[0].change, rank.items[0].tab], ["rank", "rank", -37, "keywords"]);
const rev = data.anomalyData({ appId: "a", kind: "revenue", currency: "EUR", latest: 5, avg: 20, change: -75, direction: "down" }, { name: "A" });
assert.deepEqual([rev.items[0].metrics[0].key, rev.items[0].metrics[0].unit], ["revenue", "EUR"]);

// Anything stored is cleaned: unknown kinds/keys/tabs are dropped and sizes are bounded.
const clean = data.cleanData({ kind: "nope", items: Array.from({ length: 50 }, () => ({ name: "n".repeat(500), tab: "hack", country: "../..", metrics: [{ key: "bad", value: "x" }] })), hints: [{ key: "k", tab: "evil" }] });
assert.equal(clean.kind, "system");
assert.equal(clean.items.length, 30);
assert.equal(clean.items[0].name.length, 120);
assert.equal(clean.items[0].tab, undefined);
assert.equal(clean.items[0].country, undefined);
assert.deepEqual(clean.items[0].metrics, [{ key: "installs", value: null, previous: null, change: null, unit: undefined }]);
assert.equal(clean.hints[0].tab, undefined);
assert.equal(data.cleanData("text"), undefined);

// Notifier persists structured data, keeps plain text for other channels, supports per-item delete.
const notifier = require("../lib/notifier");
const { DATA_DIR } = require("../lib/runtime");
notifier.addNotificationRecord(DATA_DIR, { title: "old style", message: "line1\nline2" });
notifier.addNotificationRecord(DATA_DIR, { title: "new style", message: "text", data: stats });
(async () => {
  const { notifications } = await notifier.syncNtfyTopicMessages();
  const fresh = notifications.find((n) => n.title === "new style"), old = notifications.find((n) => n.title === "old style");
  assert.equal(fresh.data.kind, "stats");
  assert.equal(fresh.data.items[0].metrics[0].change, -80);
  assert.equal(old.data, undefined);
  assert.equal(old.message, "line1\nline2");
  notifier.markNotificationsRead(DATA_DIR, fresh.id);
  let after = (await notifier.syncNtfyTopicMessages()).notifications;
  assert.equal(after.find((n) => n.id === fresh.id).read, true);
  assert.equal(after.find((n) => n.id === old.id).read, false);
  notifier.clearNotifications(DATA_DIR, fresh.id);
  after = (await notifier.syncNtfyTopicMessages()).notifications;
  assert.ok(!after.some((n) => n.id === fresh.id) && after.some((n) => n.id === old.id));
  fs.rmSync(path.join(DATA_DIR, "notifications.json"), { force: true });
  console.log("PASS: structured notification data, rule-based hints, sanitising, persistence, read and per-item delete.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
