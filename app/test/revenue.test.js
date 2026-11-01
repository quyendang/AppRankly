const assert = require("node:assert/strict");
(async () => {
  const { revenueSummary } = await import("../frontend/src/revenue.js");
  assert.deepEqual(revenueSummary([{}]), { hasReports: false, entries: [] });
  assert.deepEqual(revenueSummary([{ revenueByCurrency: { USD: 0, EUR: 0 } }]),
    { hasReports: true, entries: [] });
  assert.deepEqual(revenueSummary([
    { revenueByCurrency: { USD: 0.49, EUR: -2, VND: 0 } },
    { revenueByCurrency: { USD: 1, EUR: 0, GBP: NaN } },
  ]), { hasReports: true, entries: [["EUR", -2], ["USD", 1.49]] });
  console.log("PASS: revenue preserves missing vs zero, small amounts, refunds and separate currencies.");
})().catch(error => { console.error(error); process.exitCode = 1; });
