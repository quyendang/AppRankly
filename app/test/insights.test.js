const assert = require("node:assert/strict");
const insights = require("../lib/insights");
const { merge } = require("../lib/countryRevenue");
const { getSettings, saveSettings } = require("../lib/config");

// Anomalies: needs a baseline, flags big moves in both directions, ignores noise and tiny apps.
const flat = [100, 105, 95, 100, 102, 98, 100];
assert.equal(insights.detectSeriesAnomaly([...flat, 104]), null);
assert.equal(Math.round(insights.detectSeriesAnomaly([...flat, 40]).change), -60);
assert.ok(insights.detectSeriesAnomaly([...flat, 160]).change > 0);
assert.equal(insights.detectSeriesAnomaly([2, 3, 2, 3, 2, 3, 2, 30]), null);
assert.equal(insights.detectSeriesAnomaly([100, 100, 40]), null);
const days = [...flat, 40].map((installs, i) => ({ date: `2026-10-0${i + 1}`, installs,
  revenueByCurrency: { USD: i === 7 ? 0 : 10 } }));
const found = insights.appAnomalies({ id: "apple:x", name: "X", platform: "apple" }, days, 30);
assert.deepEqual(found.map((a) => [a.kind, a.direction, a.currency]), [["installs", "down", undefined], ["revenue", "down", "USD"]]);
assert.equal(found[0].key, "apple:x|installs||2026-10-08");

// Rank moves compare only the last two checks; leaving the top 100 counts as a large drop.
const row = (keyword_id, rank, checked_at, country = "us") => ({ keyword_id, term: "k" + keyword_id, country, rank, checked_at });
const moves = insights.rankMoves([
  row(1, 30, "2026-10-02T00:00:00Z"), row(1, 10, "2026-10-01T00:00:00Z"), row(1, 1, "2026-09-30T00:00:00Z"),
  row(2, null, "2026-10-02T00:00:00Z"), row(2, 20, "2026-10-01T00:00:00Z"),
  row(3, 12, "2026-10-02T00:00:00Z"), row(3, 14, "2026-10-01T00:00:00Z"),
  row(4, 5, "2026-10-02T00:00:00Z"),
  row(5, 90, "2026-10-02T08:00:00Z"), row(5, 20, "2026-10-02T07:00:00Z"),
]);
assert.deepEqual(moves.map((m) => [m.keywordId, m.move]), [[1, -20], [2, -81]]);

// Digest schedule honours timezone, hour, weekly day and once-per-day delivery.
const at = new Date("2026-11-02T01:30:00Z"); // Monday 08:30 in Ho Chi Minh
const parts = insights.localParts(at, "Asia/Ho_Chi_Minh");
assert.deepEqual(parts, { date: "2026-11-02", hour: 8, weekday: "Mon" });
const base = { digest: "daily", digestHour: 8 };
assert.equal(insights.digestDue(base, parts, undefined), true);
assert.equal(insights.digestDue(base, parts, "2026-11-02"), false);
assert.equal(insights.digestDue({ ...base, digestHour: 9 }, parts, undefined), false);
assert.equal(insights.digestDue({ ...base, digest: "off" }, parts, undefined), false);
assert.equal(insights.digestDue({ ...base, digest: "weekly" }, parts, undefined), true);
assert.equal(insights.digestDue({ ...base, digest: "weekly" }, { ...parts, weekday: "Tue" }, undefined), false);

// Events: validated, de-duplicated, sorted.
const app = { id: "google:com.x", packageName: "com.x", platform: "google" };
insights.addEvent(app, "2026-10-05", "Ads launch");
insights.addEvent(app, "2026-10-05", "Ads launch");
insights.addEvent(app, "2026-10-01", "Redesign");
assert.throws(() => insights.addEvent(app, "2026-02-31", "Bad date"), /INVALID_EVENT/);
assert.throws(() => insights.addEvent(app, "2026-10-05", " "), /INVALID_EVENT/);
insights.listEvents(app).then((events) => {
  assert.deepEqual(events.map((e) => e.label), ["Redesign", "Ads launch"]);

  // Country merge keeps revenue-only countries and revenue stays per currency.
  assert.deepEqual(merge([{ country: "US", installs: 10 }], { US: { USD: 5 }, JP: { JPY: 900 } }),
    [{ country: "US", installs: 10, revenueByCurrency: { USD: 5 } }, { country: "JP", installs: 0, revenueByCurrency: { JPY: 900 } }]);

  // Settings accept the new digest options and reject bad ones.
  assert.equal(saveSettings({ digest: "weekly", digestHour: 7, anomalyThreshold: 25 }).digest, "weekly");
  assert.throws(() => saveSettings({ digest: "hourly" }), /INVALID_SETTINGS/);
  assert.throws(() => saveSettings({ anomalyThreshold: 5 }), /INVALID_SETTINGS/);
  assert.equal(getSettings().digestLocale, "vi");
  console.log("PASS: insights anomalies, rank moves, digest schedule, events, country merge, settings.");
}).catch((error) => { console.error(error); process.exitCode = 1; });
