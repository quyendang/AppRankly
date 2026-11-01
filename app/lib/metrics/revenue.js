const fs = require("fs");
const path = require("path");

/**
 * Standard Apple Product Type Identifiers:
 * 1 / 1F: First-time download (Paid / Free)
 * 7 / 7F: Redownload / Update (Paid / Free)
 * IA1: In-App Purchase
 * IA9: Auto-Renewable Subscription
 * IAC: Auto-Renewable Subscription Renewal
 * IA3: Non-Renewing Subscription
 */
function classifyProductType(typeId = "") {
  const tid = String(typeId).toUpperCase().trim();
  if (tid === "1F") return "free_download";
  if (tid === "1") return "paid_download";
  if (tid === "7F" || tid === "7") return "update_redownload";
  if (tid === "IA1" || tid === "IAY") return "in_app_purchase";
  if (tid === "IA9" || tid === "IAC") return "subscription";
  if (tid === "IA3") return "non_renewing_subscription";
  return "other";
}

/**
 * Parses an Apple sales report (.txt TSV) content string
 * and computes financial metrics.
 *
 * @param {string} content - Raw TSV file contents
 * @returns {Array<Object>} parsed rows
 */
function parseAppleSalesTsv(content) {
  if (!content) return [];
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split("\t").map((h) => h.trim());
  const idx = {
    sku: headers.indexOf("SKU"),
    title: headers.indexOf("Title"),
    version: headers.indexOf("Version"),
    typeId: headers.indexOf("Product Type Identifier"),
    units: headers.indexOf("Units"),
    proceeds: headers.indexOf("Developer Proceeds"),
    beginDate: headers.indexOf("Begin Date"),
    custCurrency: headers.indexOf("Customer Currency"),
    country: headers.indexOf("Country Code"),
    currencyProceeds: headers.indexOf("Currency of Proceeds"),
    custPrice: headers.indexOf("Customer Price"),
    device: headers.indexOf("Device"),
    category: headers.indexOf("Category"),
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    if (cols.length < headers.length - 2) continue;

    const units = parseInt(cols[idx.units] || "0", 10) || 0;
    const proceeds = parseFloat(cols[idx.proceeds] || "0") || 0;
    const price = parseFloat(cols[idx.custPrice] || "0") || 0;

    rows.push({
      sku: cols[idx.sku] || "",
      title: cols[idx.title] || "",
      version: cols[idx.version] || "",
      productType: cols[idx.typeId] || "",
      categoryType: classifyProductType(cols[idx.typeId]),
      units,
      developerProceeds: proceeds,
      customerPrice: price,
      beginDate: cols[idx.beginDate] || "",
      customerCurrency: cols[idx.custCurrency] || "USD",
      proceedsCurrency: (
        cols[idx.currencyProceeds] ||
        cols[idx.custCurrency] ||
        "USD"
      ).trim(),
      countryCode: cols[idx.country] || "",
      device: cols[idx.device] || "",
      category: cols[idx.category] || "",
    });
  }

  return rows;
}

/**
 * Aggregates Apple sales files in a directory across dates.
 *
 * @param {string} dirPath - Directory containing sales_YYYY-MM-DD.txt files
 * @param {Object} [filter] - Optional date and SKU filter
 * @returns {Object} financial and product stats
 */
function aggregateSalesReports(dirPath, { sku, startDate, endDate } = {}) {
  const result = {
    totalUnits: 0,
    totalProceeds: 0,
    freeUnits: 0,
    paidUnits: 0,
    subscriptionUnits: 0,
    iapUnits: 0,
    currencyBreakdown: {},
    countryBreakdown: {},
    productTypeBreakdown: {},
    dailyFinancials: [],
  };

  if (!fs.existsSync(dirPath)) return result;

  const files = fs
    .readdirSync(dirPath)
    .filter((f) => f.startsWith("sales_") && f.endsWith(".txt"))
    .sort();

  const dailyMap = new Map();

  for (const file of files) {
    const dateMatch = file.match(/sales_(\d{4}-\d{2}-\d{2})\.txt/);
    const fileDate = dateMatch ? dateMatch[1] : null;

    if (fileDate) {
      if (startDate && fileDate < startDate) continue;
      if (endDate && fileDate > endDate) continue;
    }

    const fullPath = path.join(dirPath, file);
    const content = fs.readFileSync(fullPath, "utf8");
    const rows = parseAppleSalesTsv(content);

    for (const row of rows) {
      if (sku && row.sku !== sku) continue;

      result.totalUnits += row.units;
      const proceeds = row.developerProceeds * row.units;
      result.totalProceeds += proceeds;

      // Category breakdown
      if (row.categoryType === "free_download") result.freeUnits += row.units;
      else if (row.categoryType === "paid_download")
        result.paidUnits += row.units;
      else if (row.categoryType === "subscription")
        result.subscriptionUnits += row.units;
      else if (row.categoryType === "in_app_purchase")
        result.iapUnits += row.units;

      result.productTypeBreakdown[row.categoryType] =
        (result.productTypeBreakdown[row.categoryType] || 0) + row.units;

      // Currency breakdown
      const curr = row.proceedsCurrency || "UNKNOWN";
      result.currencyBreakdown[curr] =
        (result.currencyBreakdown[curr] || 0) + proceeds;

      // Country breakdown
      const c = row.countryCode || "OTHER";
      if (!result.countryBreakdown[c]) {
        result.countryBreakdown[c] = {
          units: 0,
          proceeds: 0,
          currencyBreakdown: {},
        };
      }
      result.countryBreakdown[c].units += row.units;
      result.countryBreakdown[c].proceeds += proceeds;

      result.countryBreakdown[c].currencyBreakdown[curr] =
        (result.countryBreakdown[c].currencyBreakdown[curr] || 0) + proceeds;

      // Daily map
      const day = fileDate || row.beginDate || "unknown";
      if (!dailyMap.has(day)) {
        dailyMap.set(day, {
          date: day,
          units: 0,
          proceeds: 0,
          currencyBreakdown: {},
        });
      }
      const dayEntry = dailyMap.get(day);
      dayEntry.units += row.units;
      dayEntry.proceeds += proceeds;
      dayEntry.currencyBreakdown[curr] =
        (dayEntry.currencyBreakdown[curr] || 0) + proceeds;
    }
  }

  for (const group of [
    ...Object.values(result.countryBreakdown),
    ...dailyMap.values(),
  ]) {
    if (Object.keys(group.currencyBreakdown).length > 1) group.proceeds = null;
  }
  // Format daily financials sorted
  result.dailyFinancials = Array.from(dailyMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  result.totalProceeds =
    Object.keys(result.currencyBreakdown).length > 1
      ? null
      : Math.round(result.totalProceeds * 100) / 100;

  return result;
}

module.exports = {
  classifyProductType,
  parseAppleSalesTsv,
  aggregateSalesReports,
};
