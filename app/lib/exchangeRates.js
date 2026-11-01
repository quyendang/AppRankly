const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const { DATA_DIR } = require("./runtime");
const cacheFile = path.join(DATA_DIR, "exchange-rates-usd.json");
let cached, pending, retryAfter = 0;
function valid(value) {
  return value?.base === "USD" && Number.isFinite(Date.parse(value.fetchedAt)) &&
    value.rates?.USD?.rate === 1 && Object.entries(value.rates).every(([currency, item]) =>
      /^[A-Z]{3}$/.test(currency) && Number.isFinite(item.rate) && item.rate > 0 &&
      (currency === "USD" || /^\d{4}-\d{2}-\d{2}$/.test(item.date || "")));
}
function fallback() {
  if (cached && Date.now() - Date.parse(cached.fetchedAt) <= 7 * 86400000)
    return { ...cached, status: "stale" };
  return { base: "USD", source: "Frankfurter", status: "unavailable", rates: { USD: { rate: 1, date: null } } };
}
async function getExchangeRates() {
  if (!cached) {
    try {
      if (!fs.lstatSync(cacheFile).isSymbolicLink()) {
        const saved = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
        if (valid(saved)) cached = saved;
      }
    } catch {}
  }
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 3600000) return { ...cached, status: "available" };
  if (Date.now() < retryAfter) return fallback();
  if (pending) return pending;
  pending = (async () => {
    try {
      const { data } = await axios.get("https://api.frankfurter.dev/v2/rates", {
        params: { base: "USD" }, timeout: 10000, maxRedirects: 0, maxContentLength: 1024 * 1024,
      });
      if (!Array.isArray(data)) throw new Error("INVALID_RATES");
      const rates = { USD: { rate: 1, date: null } };
      for (const item of data) {
        if (item.base === "USD" && /^[A-Z]{3}$/.test(item.quote || "") && item.quote !== "USD" &&
            Number.isFinite(item.rate) && item.rate > 0 && /^\d{4}-\d{2}-\d{2}$/.test(item.date || "") &&
            Date.now() - Date.parse(item.date) < 7 * 86400000 && Date.parse(item.date) <= Date.now())
          rates[item.quote] = { rate: 1 / item.rate, date: item.date };
      }
      if (Object.keys(rates).length < 2) throw new Error("INVALID_RATES");
      cached = { base: "USD", source: "Frankfurter", fetchedAt: new Date().toISOString(), rates };
      const temp = cacheFile + ".tmp";
      try {
        fs.writeFileSync(temp, JSON.stringify(cached), { mode: 0o600, flag: "wx" });
        fs.renameSync(temp, cacheFile);
      } catch { try { fs.unlinkSync(temp); } catch {} }
      return { ...cached, status: "available" };
    } catch {
      retryAfter = Date.now() + 60000;
      return fallback();
    } finally { pending = null; }
  })();
  return pending;
}
module.exports = { getExchangeRates };
