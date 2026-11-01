export function revenueSummary(apps) {
  const totals = new Map();
  for (const app of apps)
    for (const [currency, value] of Object.entries(app.revenueByCurrency || {})) {
      if (!Number.isFinite(value)) continue;
      totals.set(currency, (totals.get(currency) || 0) + value);
    }
  return {
    hasReports: totals.size > 0 || apps.some(app => app.revenueAvailable === true),
    entries: [...totals].filter(([, value]) => value !== 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  };
}
