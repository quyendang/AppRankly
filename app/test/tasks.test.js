const assert = require("node:assert/strict");
(async () => {
  const { buildTasks } = await import("../frontend/src/tasks.js");
  const apps = [
    { id: "a", name: "A", platform: "apple", lastDate: "2026-10-31" },
    { id: "g", name: "G", platform: "google", lastDate: "2026-10-29" },
    { id: "x", name: "X", platform: "apple", error: "SOURCE_FAILED", sourceStatus: 403 },
    { id: "n", name: "N", platform: "google", error: "NO_REPORTS" },
  ];
  const tasks = buildTasks({
    apps, rangeEnd: "2026-10-31",
    openReviews: [{ appId: "a", open: 3, low: 1, latest: "2026-10-30", sample: { id: "r1" } }, { appId: "g", open: 2, low: 0 }, { appId: "gone", open: 9, low: 9 }],
    anomalies: [{ appId: "g", kind: "installs", direction: "down", key: "g|installs" }, { appId: "a", kind: "rank", direction: "up", key: "a|rank" }],
  });
  assert.deepEqual(tasks.map((t) => t.kind), ["lowReview", "drop", "source", "rankRise", "reviews", "lag"]);
  assert.equal(tasks.find((t) => t.kind === "lowReview").count, 1);
  assert.ok(!tasks.some((t) => t.app.id === "n"), "NO_REPORTS is not a source failure");
  const dismissed = buildTasks({ apps, rangeEnd: "2026-10-31", openReviews: [], anomalies: [], dismissed: [tasks.find((t) => t.kind === "source").key] });
  assert.deepEqual(dismissed.map((t) => t.kind), ["lag"]);
  // A new low review changes the key, so a dismissed item comes back.
  const again = buildTasks({ apps, openReviews: [{ appId: "a", open: 4, low: 2, latest: "2026-10-31" }], dismissed: [tasks[0].key] });
  assert.equal(again[0].kind, "lowReview");
  console.log("PASS: action center ordering, dismissal and reappearance.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
