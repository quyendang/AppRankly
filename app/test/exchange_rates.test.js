const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const date = new Date().toISOString().slice(0, 10);
let calls = 0;
axios.get = async (url, options) => {
  calls++;
  assert.equal(url, "https://api.frankfurter.dev/v2/rates");
  assert.deepEqual(options.params, { base: "USD" });
  assert.equal(options.headers, undefined);
  return { data: [
    { base: "USD", quote: "GBP", rate: 0.8, date },
    { base: "USD", quote: "NZD", rate: 2, date },
    { base: "USD", quote: "BAD", rate: -1, date },
    { base: "EUR", quote: "USD", rate: 2, date },
  ] };
};
(async () => {
  const modulePath = require.resolve("../lib/exchangeRates");
  const { getExchangeRates } = require(modulePath);
  const results = await Promise.all([getExchangeRates(), getExchangeRates()]);
  assert.equal(calls, 1);
  assert.equal(results[0].rates.GBP.rate, 1.25);
  assert.equal(results[0].rates.NZD.rate, 0.5);
  assert.equal(results[0].rates.USD.rate, 1);
  assert.equal(results[0].rates.BAD, undefined);
  const file = path.join(require("../lib/runtime").DATA_DIR, "exchange-rates-usd.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  saved.fetchedAt = new Date(Date.now() - 7200000).toISOString();
  fs.writeFileSync(file, JSON.stringify(saved));
  delete require.cache[modulePath];
  axios.get = async () => { throw new Error("Synthetic unavailable"); };
  assert.equal((await require(modulePath).getExchangeRates()).status, "stale");
  saved.fetchedAt = new Date(Date.now() - 8 * 86400000).toISOString();
  fs.writeFileSync(file, JSON.stringify(saved));
  delete require.cache[modulePath];
  assert.equal((await require(modulePath).getExchangeRates()).status, "unavailable");
  const { usdSummary } = await import("../frontend/src/revenue.js");
  const apps = [{ platform: "apple", revenueByCurrency: { GBP: 2, USD: -1 } },
    { platform: "google", grossRevenueByCurrency: { NZD: 10 }, revenueAvailable: true }];
  assert.equal(usdSummary(apps, results[0]).total, 6.5);
  assert.equal(usdSummary(apps, null).total, null);
  assert.deepEqual(usdSummary(apps, null).missing, ["GBP", "NZD"]);
  assert.equal(usdSummary([{ platform: "apple", revenueByCurrency: { USD: 3 } }], null).total, 3);
  assert.equal(usdSummary([{ platform: "google", revenueAvailable: true }], null).total, 0);
  assert.equal(usdSummary([{}], results[0]).total, null);
  console.log("PASS: USD conversion, inverse rates, mixed bases, refunds, missing currencies, cached rates, expiry and no private data sent to rate source.");
})().catch(error => { console.error(error); process.exitCode = 1; });
