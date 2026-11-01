const { getBaseConfig } = require("./config");
const { buildAppleViewer, buildGoogleViewer } = require("./viewerFactory");
const resolver = require("./resolver");
const merge = (installs, revenue) => {
  const rows = new Map();
  for (const r of installs) rows.set(r.country, { country: r.country, installs: r.installs || 0, revenueByCurrency: r.revenueByCurrency || {} });
  for (const [country, revenueByCurrency] of Object.entries(revenue)) {
    const row = rows.get(country) || { country, installs: 0, revenueByCurrency: {} };
    row.revenueByCurrency = revenueByCurrency;
    rows.set(country, row);
  }
  return [...rows.values()];
};
// Installs and revenue per country; revenue basis follows the store (Apple proceeds, Google charged amount).
async function countryRevenue(app, range) {
  return resolver.resolve("personal:country-revenue", { id: app.id, ...range }, async () => {
    const config = getBaseConfig();
    if (app.platform === "apple")
      return { rows: await buildAppleViewer(config, app.packageName).getCountryRevenue(range.startDate, range.endDate) };
    const viewer = buildGoogleViewer(config, app.packageName);
    const [dimension, sales] = await Promise.all([
      viewer.getDimensionStats("country", range.startDate, range.endDate).catch(() => []),
      require("./googleSales").getGoogleSales(config, app.packageName, range).catch(() => ({})),
    ]);
    const installs = dimension.filter((d) => /^[A-Z]{2}$/.test(d.label))
      .map((d) => ({ country: d.label, installs: d.dailyUserInstalls ?? d.totalInstalls ?? 0 }));
    return { rows: merge(installs, sales.grossRevenueByCountry || {}), revenueAvailable: !!sales.revenueAvailable };
  });
}
module.exports = { countryRevenue, merge };
