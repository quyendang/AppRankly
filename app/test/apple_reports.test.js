const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const axiosPath = require.resolve("axios");
let status = 200,
  requests = [];
const originalAxios = require.cache[axiosPath];
const tsv =
  "Apple Identifier\tBegin Date\tProduct Type Identifier\tUnits\tDeveloper Proceeds\tCurrency of Proceeds\tSKU\tParent Identifier\n9001\t10/20/2026\tIAY\t2\t3.5\tUSD\tsub-monthly\tapp-alpha\n111\t10/20/2026\t1F\t7\t0\tUSD\tapp-alpha\t\n222\t10/20/2026\t1\t3\t2\tEUR\tapp-beta\t\n9001\t10/20/2026\tIAY\t-1\t3.5\tUSD\tsub-monthly\tapp-alpha\n9002\t10/20/2026\tIA1\t1\t1\tEUR\tcoins\tapp-alpha\n9003\t10/20/2026\tIAY\t1\t99\tUSD\tother-sub\tapp-other\n";
const fakeAxios = async (options) => {
  requests.push(options);
  if (status !== 200) {
    const error = new Error("Synthetic");
    error.response = { status };
    throw error;
  }
  return { data: require("node:zlib").gzipSync(tsv) };
};
require.cache[axiosPath] = {
  id: axiosPath,
  filename: axiosPath,
  loaded: true,
  exports: fakeAxios,
};
const Viewer = require("../lib/AppleAppStoreStatsViewer");
(async () => {
  const root = require("../lib/runtime").DATA_DIR;
  const viewer = new Viewer({
    appId: "111",
    vendorId: "synthetic-vendor",
    dataDir: path.join(root, "apple-test"),
  });
  viewer.generateToken = () => "synthetic-token";
  const first = await viewer.getAppStats("2026-10-20", "2026-10-20");
  assert.equal(first.dailyTrends[0].dailyInstalls, 7);
  assert.deepEqual(first.dailyTrends[0].revenueByCurrency, { USD: 3.5, EUR: 1 });
  assert.equal(requests[0].params["filter[version]"], "1_0");
  viewer.appId = "222";
  viewer.numericAppId = null;
  const second = await viewer.getAppStats("2026-10-20", "2026-10-20");
  assert.equal(second.dailyTrends[0].dailyInstalls, 3);
  assert.deepEqual(second.dailyTrends[0].revenueByCurrency, { EUR: 6 });
  // A subscription-only period still resolves the parent app SKU from ASC.
  fakeAxios.get = async () => ({ data: { data: { attributes: { sku: "app-alpha" } } } });
  viewer.appId = "111";
  viewer.numericAppId = null;
  viewer.fetchDailySalesReport = async () => tsv.split("\n").filter((line, index) => index === 0 || line.startsWith("9001\t")).join("\n");
  const subscriptionOnly = await viewer.getAppStats("2026-10-20", "2026-10-20");
  assert.equal(subscriptionOnly.dailyTrends[0].dailyInstalls, 0);
  assert.deepEqual(subscriptionOnly.dailyTrends[0].revenueByCurrency, { USD: 3.5 });
  // Missing dates must not be filled with fabricated zero measurements.
  viewer.fetchDailySalesReport = async (date) =>
    date === "2026-10-20" ? tsv : null;
  const partial = await viewer.getAppStats("2026-10-19", "2026-10-21");
  assert.equal(partial.dailyTrends.length, 1);
  viewer.fetchDailySalesReport = async () => null;
  await assert.rejects(
    viewer.getAppStats("2026-10-19", "2026-10-21"),
    /NO_REPORTS/,
  );
  const other = new Viewer({
    appId: "111",
    vendorId: "other-vendor",
    dataDir: path.join(root, "apple-errors"),
  });
  other.generateToken = () => "synthetic-token";
  for (const errorStatus of [400, 401, 403, 429, 500]) {
    status = errorStatus;
    other.vendorId = "error-vendor-" + status;
    await assert.rejects(
      other.fetchDailySalesReport("2026-10-20"),
      (error) =>
        error.message === "APPLE_REPORTS_UNAVAILABLE" &&
        error.statusCode === errorStatus,
    );
    assert.equal(
      fs.existsSync(path.join(other.cacheDir, "sales_2026-10-20.txt")),
      false,
    );
  }
  status = 404;
  other.vendorId = "missing-vendor";
  assert.equal(await other.fetchDailySalesReport("2026-10-20"), null);
  status = 200;
  fs.utimesSync(
    path.join(other.cacheDir, "sales_2026-10-20.txt"),
    new Date(0),
    new Date(0),
  );
  require("../lib/resolver").clearCache();
  assert.ok(await other.fetchDailySalesReport("2026-10-20"));
  require("../lib/db").db.close();
  console.log(
    "PASS: Apple required report version, distinct numeric app IDs, currencies, missing-day gaps, source errors and recovery from negative cache.",
  );
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (originalAxios) require.cache[axiosPath] = originalAxios;
    else delete require.cache[axiosPath];
  });
