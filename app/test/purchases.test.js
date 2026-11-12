const assert = require("node:assert/strict");
const { appleKind, googleKind, summarizePurchases } = require("../lib/purchases");

// Product type mapping: only paid in-app items and subscriptions count.
assert.equal(appleKind("IA1"), "iap");
assert.equal(appleKind("ia9-m"), "subscription");
assert.equal(appleKind("IAY"), "subscription");
for (const type of ["1F", "7", "3", "IAC", "FI1", "", undefined]) assert.equal(appleKind(type), null, String(type));
assert.equal(googleKind("Subscription"), "subscription");
assert.equal(googleKind("One-time product"), "iap");
assert.equal(googleKind("Paid app"), null);
assert.equal(googleKind(""), null);

const s = summarizePurchases([
  { date: "2026-10-02", kind: "subscription", sku: "pro-month", title: "Pro monthly", units: 2, currency: "USD", amount: 7 },
  { date: "2026-10-01", kind: "iap", sku: "coins", title: "Coins", units: 1, currency: "EUR", amount: 0.99 },
  { date: "2026-10-02", kind: "subscription", sku: "pro-month", title: "", units: -1, currency: "USD", amount: -3.5 },
  { date: "2026-10-02", kind: "iap", sku: "coins", units: 3, currency: "EUR", amount: 2.97 },
  { date: "bad", kind: "iap", sku: "x", units: 1 },
  { date: "2026-10-03", kind: "other", sku: "x", units: 1 },
]);
assert.deepEqual(s.daily, [
  { date: "2026-10-01", iap: 1, subscription: 0, refunds: 0 },
  { date: "2026-10-02", iap: 3, subscription: 2, refunds: 1 },
]);
assert.deepEqual(s.totals.subscription, { purchases: 2, refunds: 1, revenueByCurrency: { USD: 3.5 } });
assert.deepEqual(s.totals.iap, { purchases: 4, refunds: 0, revenueByCurrency: { EUR: 3.96 } });
const pro = s.products.find((p) => p.sku === "pro-month");
assert.equal(pro.title, "Pro monthly");
assert.deepEqual([s.products[0].sku, s.products.length], ["coins", 2]);
assert.deepEqual(summarizePurchases(), { daily: [], products: [], totals: { iap: { purchases: 0, refunds: 0, revenueByCurrency: {} }, subscription: { purchases: 0, refunds: 0, revenueByCurrency: {} } } });
console.log("PASS: purchase classification, signed refunds, daily/product/total summaries and invalid rows.");
