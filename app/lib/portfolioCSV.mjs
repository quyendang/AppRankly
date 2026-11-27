export function portfolioCSV(apps, headers, revenueBasis) {
  const rows = [headers];
  for (const app of apps) {
    const entries = Object.entries((app.platform === "google" ? app.grossRevenueByCurrency : app.revenueByCurrency) || {});
    const basis = revenueBasis(app.platform);
    for (const [currency, value] of entries.length ? entries : [["", ""]])
      rows.push([app.name, app.platform, app.installs ?? "", value, currency, basis]);
  }
  return "\uFEFF" + rows.map(row => row.map(value =>
    '"' + (typeof value === "string" && /^[=+@\-\t\r]/.test(value) ? "'" + value : String(value)).replace(/"/g, '""') + '"'
  ).join(",")).join("\r\n");
}
