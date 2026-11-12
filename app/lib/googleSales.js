const { Storage } = require("@google-cloud/storage");
const csv = require("@fast-csv/parse");
const yauzl = require("yauzl");
const resolver = require("./resolver");
const { googleKind, summarizePurchases } = require("./purchases");
const limited = require("./utils/concurrency").createLimiter(2);

function text(buffer) {
  return buffer.toString(buffer[0] === 255 && buffer[1] === 254 ? "utf16le" : "utf8").replace(/^\uFEFF/, "");
}
async function readLimited(stream, maximum) {
  const parts = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maximum) { stream.destroy(); throw new Error("GOOGLE_REPORT_TOO_LARGE"); }
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}
function unzipCsv(buffer) {
  return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error);
    const files = [];
    let total = 0;
    const fail = error => { zip.close(); reject(error); };
    zip.on("error", fail);
    zip.on("end", () => resolve(files));
    zip.on("entry", entry => {
      if (!entry.fileName.endsWith(".csv")) return zip.readEntry();
      total += entry.uncompressedSize;
      if (total > 100 * 1024 * 1024) return fail(new Error("GOOGLE_REPORT_TOO_LARGE"));
      zip.openReadStream(entry, (error, stream) => {
        if (error) return fail(error);
        readLimited(stream, 100 * 1024 * 1024).then(bytes => {
          files.push(text(bytes)); zip.readEntry();
        }, fail);
      });
    });
    zip.readEntry();
  }));
}
async function parseSales(contents) {
  const rows = [];
  for (const content of contents)
    await new Promise((resolve, reject) => {
      const parser = csv.parseString(content, { headers: true });
      parser.on("headers", headers => {
        if (!["Package ID", "Order Charged Date", "Financial Status", "Currency of Sale", "Charged Amount"].every(header => headers.includes(header)))
          parser.destroy(new Error("INVALID_GOOGLE_SALES_REPORT"));
      })
      .on("data", row => {
        const status = String(row["Financial Status"] || "").trim().toLowerCase();
        if (!["charged", "refund", "refunded", "partial refund"].includes(status)) return;
        const amount = Number(String(row["Charged Amount"] ?? "").replace(/,/g, ""));
        const date = row["Order Charged Date"], currency = row["Currency of Sale"];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !/^[A-Z]{3}$/.test(currency || "") ||
            !String(row["Charged Amount"] ?? "").trim() || !Number.isFinite(amount)) return;
        const country = String(row["Country of Buyer"] || "").trim().toUpperCase();
        const kind = googleKind(row["Product Type"]);
        rows.push({ packageName: row["Package ID"], date, currency,
          amount: status === "charged" ? amount : -Math.abs(amount),
          ...(/^[A-Z]{2}$/.test(country) ? { country } : {}),
          // A full refund reverses one purchase; a partial refund only reduces the amount.
          ...(kind ? { kind, sku: row["SKU ID"] || "", title: row["Product Title"] || "",
            units: status === "charged" ? 1 : status === "partial refund" ? 0 : -1 } : {}) });
      }).on("error", reject).on("end", resolve);
    });
  return rows;
}
async function getGoogleSales(config, packageName, range) {
  const credentials = typeof config.keyJson === "string" ? JSON.parse(config.keyJson) : config.keyJson;
  const storage = new Storage({ credentials, scopes: "https://www.googleapis.com/auth/devstorage.read_only",
    retryOptions: { maxRetries: 1, totalTimeout: 20 } });
  const months = [];
  const cursor = new Date(range.startDate.slice(0, 7) + "-01T00:00:00Z");
  while (cursor.toISOString().slice(0, 7) <= range.endDate.slice(0, 7)) {
    months.push(cursor.toISOString().slice(0, 7).replace("-", ""));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const results = await Promise.all(months.map(month => limited(async () => {
    try {
      return await resolver.resolve("google:estimated-sales:v2", { bucket: config.bucketName, month }, async () => {
        const stream = storage.bucket(config.bucketName).file(`sales/salesreport_${month}.zip`).createReadStream();
        const contents = await unzipCsv(await readLimited(stream, 50 * 1024 * 1024));
        if (!contents.length) throw new Error("GOOGLE_SALES_UNAVAILABLE");
        return parseSales(contents);
      });
    } catch { return null; }
  })));
  const grossRevenueByCurrency = {}, grossRevenueByCountry = {}, purchaseEvents = [];
  for (const row of results.flatMap(rows => rows || []))
    if (row.packageName === packageName && row.date >= range.startDate && row.date <= range.endDate) {
      if (row.kind) purchaseEvents.push(row);
      grossRevenueByCurrency[row.currency] = (grossRevenueByCurrency[row.currency] || 0) + row.amount;
      if (row.country) {
        const byCurrency = grossRevenueByCountry[row.country] ||= {};
        byCurrency[row.currency] = (byCurrency[row.currency] || 0) + row.amount;
      }
    }
  return { grossRevenueByCurrency, grossRevenueByCountry, revenueAvailable: results.some(Boolean),
    ...(results.some(Boolean) ? { purchases: summarizePurchases(purchaseEvents) } : {}),
    revenueStatus: results.every(Boolean) ? "available" : results.some(Boolean) ? "partial" : "unavailable" };
}
module.exports = { getGoogleSales, parseSales, unzipCsv };
