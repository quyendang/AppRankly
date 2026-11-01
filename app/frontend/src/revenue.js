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
export function usdSummary(apps, exchange) {
  let total = 0, hasReports = false;
  const missing = new Set(), dates = new Set();
  for (const app of apps) {
    const values = (app.platform === "google" ? app.grossRevenueByCurrency : app.revenueByCurrency) || {};
    if (Object.keys(values).length || app.revenueAvailable) hasReports = true;
    for (const [currency, amount] of Object.entries(values)) {
      if (!Number.isFinite(amount) || amount === 0) continue;
      const item = currency === "USD" ? { rate: 1 } : exchange?.rates?.[currency];
      if (!item || !Number.isFinite(item.rate) || item.rate <= 0) { missing.add(currency); continue; }
      if (item.date) dates.add(item.date);
      total += amount * item.rate;
    }
  }
  return { total: hasReports && !missing.size ? total : null, missing: [...missing], dates: [...dates].sort() };
}
