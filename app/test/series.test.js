const assert = require("node:assert/strict");
(async () => {
  const { trendSeries, sparkSegments } =
    await import("../frontend/src/series.js");
  const { values, old } = trendSeries(
    [
      {
        dailyTrends: [
          { date: "2026-10-01", installs: 0 },
          { date: "2026-10-03", installs: 4 },
        ],
      },
    ],
    [{ dailyTrends: [{ date: "2026-09-29", installs: 3 }] }],
    { startDate: "2026-10-01", endDate: "2026-10-03" },
  );
  assert.deepEqual(values, [0, null, 4]);
  assert.deepEqual(old, [null, 3, null]);
  assert.equal(sparkSegments([1, null, 2], 2).length, 2);
  assert.deepEqual(sparkSegments([null, null], 2), []);
  console.log(
    "PASS: chart gaps remain missing, real zero is preserved and previous periods align by day.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
