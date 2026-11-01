const assert = require("assert");
const path = require("path");
const { db, migrate } = require("../lib/db");
const {
  diffWords,
  diffMetadata,
  recordMetadataSnapshot,
  getTimeline,
} = require("../lib/metadataDiff");
const {
  classifyProductType,
  parseAppleSalesTsv,
  aggregateSalesReports,
} = require("../lib/metrics/revenue");
const {
  checkAndAlertReviews,
  getRecentAlerts,
} = require("../lib/reviewWatcher");

console.log("Running v1.6.0 features test suite...");

// 1. Database Migration 006 Verification
migrate();
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .all()
  .map((r) => r.name);
assert.ok(
  tables.includes("metadata_timeline"),
  "metadata_timeline table must exist",
);
assert.ok(
  tables.includes("negative_review_alerts"),
  "negative_review_alerts table must exist",
);
assert.ok(tables.includes("users"), "users table must exist");
console.log("✓ Migration 006 tables verified in SQLite");

// 2. Metadata Diff Engine Tests
const diffRes = diffWords(
  "Habit Tracker Daily Routine",
  "Habit Tracker Pro Routine Planner",
);
assert.deepStrictEqual(diffRes.added, ["Pro", "Planner"]);
assert.deepStrictEqual(diffRes.removed, ["Daily"]);

const oldMeta = {
  title: "My App: Daily Habit Tracker",
  subtitle: "Simple habit streak counter",
  version: "1.0.0",
  score: 4.2,
};
const newMeta = {
  title: "My App: Habit Tracker & Goal Tracker",
  subtitle: "Simple habit streak counter",
  version: "1.1.0",
  score: 4.5,
};
const metaDiff = diffMetadata(oldMeta, newMeta);
assert.strictEqual(metaDiff.changed, true);
assert.ok(metaDiff.changes.title);
assert.ok(metaDiff.changes.version);
assert.ok(metaDiff.changes.score);
assert.strictEqual(metaDiff.changes.subtitle, undefined); // Unchanged

// Snapshot recording test
const pkgTest = `test.app.v160_${Date.now()}`;
const snap1 = recordMetadataSnapshot({
  packageName: pkgTest,
  platform: "google",
  version: "1.0.0",
  title: "Initial App Title",
  description: "First version of app",
});
assert.strictEqual(snap1.recorded, true);

// Record identical (should skip)
const snapDuplicate = recordMetadataSnapshot({
  packageName: pkgTest,
  platform: "google",
  version: "1.0.0",
  title: "Initial App Title",
  description: "First version of app",
});
assert.strictEqual(snapDuplicate.recorded, false);

// Record change
const snap2 = recordMetadataSnapshot({
  packageName: pkgTest,
  platform: "google",
  version: "1.1.0",
  title: "Updated App Title Pro",
  description: "First version of app",
});
assert.strictEqual(snap2.recorded, true);

const timeline = getTimeline(pkgTest, "google");
assert.strictEqual(timeline.length, 2);
assert.ok(
  timeline[0].diff.title,
  "Timeline entry should contain computed title diff",
);
console.log("✓ Metadata Diff Engine unit tests passed");

// 3. Apple Sales Revenue Aggregator Tests
assert.strictEqual(classifyProductType("1F"), "free_download");
assert.strictEqual(classifyProductType("1"), "paid_download");
assert.strictEqual(classifyProductType("IA1"), "in_app_purchase");
assert.strictEqual(classifyProductType("IA9"), "subscription");
assert.strictEqual(classifyProductType("7F"), "update_redownload");

const sampleSalesTsv = `Provider\tProvider Country\tSKU\tDeveloper\tTitle\tVersion\tProduct Type Identifier\tUnits\tDeveloper Proceeds\tBegin Date\tEnd Date\tCustomer Currency\tCountry Code\tCurrency of Proceeds\tApple Identifier\tCustomer Price\tPromo Code\tParent Identifier\tSubscription\tPeriod\tCategory\tCMB\tDevice\tSupported Platforms\tProceeds Reason\tPreserved Pricing\tClient\tOrder Type
APPLE\tUS\t1001\tDev\tTestApp\t1.0.0\t1F\t5\t0.00\t07/20/2026\t07/20/2026\tUSD\tUS\tUSD\t123456\t0.00\t \t \t \t \tProductivity\t\tiPhone\tiOS\t \t \t \t 
APPLE\tUS\t1001\tDev\tTestApp\t1.0.0\tIA1\t2\t3.50\t07/20/2026\t07/20/2026\tUSD\tUS\tUSD\t123456\t4.99\t \t \t \t \tProductivity\t\tiPhone\tiOS\t \t \t \t 
APPLE\tUS\t1001\tDev\tTestApp\t1.0.0\tIA9\t1\t7.00\t07/20/2026\t07/20/2026\tUSD\tGB\tUSD\t123456\t9.99\t \t \t \t \tProductivity\t\tiPhone\tiOS\t \t \t \t `;

const parsedRows = parseAppleSalesTsv(sampleSalesTsv);
assert.strictEqual(parsedRows.length, 3);
assert.strictEqual(parsedRows[0].units, 5);
assert.strictEqual(parsedRows[1].developerProceeds, 3.5);
assert.strictEqual(parsedRows[2].categoryType, "subscription");

// Synthetic per-unit proceeds, preserving separate currencies.
const fs = require("node:fs");
const appleDir = fs.mkdtempSync(
  path.join(require("node:os").tmpdir(), "apprankly-revenue-"),
);
fs.writeFileSync(path.join(appleDir, "sales_2026-07-20.txt"), sampleSalesTsv);
const single = aggregateSalesReports(appleDir);
assert.strictEqual(single.totalProceeds, 14);
assert.strictEqual(single.currencyBreakdown.USD, 14);
fs.writeFileSync(
  path.join(appleDir, "sales_2026-07-21.txt"),
  sampleSalesTsv.replace(/USD/g, "EUR"),
);
const liveSalesData = aggregateSalesReports(appleDir);
assert.strictEqual(liveSalesData.totalProceeds, null);
assert.deepStrictEqual(liveSalesData.currencyBreakdown, { USD: 14, EUR: 14 });
assert.strictEqual(liveSalesData.countryBreakdown.US.proceeds, null);
fs.rmSync(appleDir, { recursive: true, force: true });
console.log("✓ Apple Sales & Revenue aggregator tests passed");

// 4. Review Watchdog Tests
const testRevId = `test_rev_${Date.now()}`;
db.prepare(
  `
  INSERT INTO negative_review_alerts (review_id, package_name, platform, rating, author, title, body, alerted_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
`,
).run(
  testRevId,
  "com.example.test",
  "google",
  1,
  "AngryUser",
  "Broken",
  "Crashes on tap",
);

const recentAlerts = getRecentAlerts({ packageName: "com.example.test" });
assert.ok(recentAlerts.some((r) => r.review_id === testRevId));
console.log("✓ Negative review alerting and storage tests passed");

// 5. Team Users Table Tests
const testUser = `user_${Date.now()}`;
db.prepare(
  `
  INSERT INTO users (username, password_hash, role, team_name, created_at)
  VALUES (?, ?, ?, ?, datetime('now'))
`,
).run(testUser, "hash123", "viewer", "Team Alpha");

const member = db
  .prepare("SELECT username, role, team_name FROM users WHERE username = ?")
  .get(testUser);
assert.strictEqual(member.username, testUser);
assert.strictEqual(member.role, "viewer");
assert.strictEqual(member.team_name, "Team Alpha");
console.log("✓ Multi-tenant Team Users table tests passed");

console.log("All v1.6.0 feature tests passed successfully!");
