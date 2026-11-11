// Builds the "To do" inbox from data the app already has. Pure, so it can be tested without a browser.
export function buildTasks({ apps = [], openReviews = [], anomalies = [], rangeEnd, dismissed = [] }) {
  const skip = new Set(dismissed), tasks = [];
  const byId = new Map(apps.map((app) => [app.id, app]));
  for (const summary of openReviews) {
    const app = byId.get(summary.appId);
    if (!app || !summary.open) continue;
    if (summary.low)
      tasks.push({ key: `low|${app.id}|${summary.low}|${summary.latest || ""}`, kind: "lowReview", app, count: summary.low, sample: summary.sample, weight: 90 + summary.low });
    else
      tasks.push({ key: `rev|${app.id}|${summary.open}|${summary.latest || ""}`, kind: "reviews", app, count: summary.open, weight: 40 + Math.min(summary.open, 20) });
  }
  for (const app of apps) {
    if (app.error === "SOURCE_FAILED") tasks.push({ key: `src|${app.id}`, kind: "source", app, status: app.sourceStatus, weight: 80 });
    else if (app.lastDate && rangeEnd && app.lastDate < rangeEnd) tasks.push({ key: `lag|${app.id}|${app.lastDate}`, kind: "lag", app, lastDate: app.lastDate, weight: 20 });
  }
  for (const anomaly of anomalies) {
    const app = byId.get(anomaly.appId);
    if (!app) continue;
    const down = anomaly.direction === "down";
    const kind = anomaly.kind === "rank" ? (down ? "rankDrop" : "rankRise") : anomaly.kind === "revenue" ? (down ? "revenueDrop" : "revenueSpike") : down ? "drop" : "spike";
    tasks.push({ key: "an|" + anomaly.key, kind, app, anomaly, weight: down ? 85 : 45 });
  }
  return tasks.filter((task) => !skip.has(task.key)).sort((a, b) => b.weight - a.weight);
}
