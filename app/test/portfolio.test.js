const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const config = require("../lib/config");
config.getBaseConfig = () => ({
  keyJson: { synthetic: true },
  bucketName: "synthetic",
  ignoredPackages: [],
  googlePackages: ["example.new"],
  appMetadata: {},
});
const { PackageUtils } = require("../lib/PackageUtils");
const utils = new PackageUtils();
const { DATA_DIR } = require("../lib/runtime");
const fixtures = {
  "example.legacy":
    "Date,Daily User Installs,Install Events,Active Device Installs\n2026-10-20,7,10,90\n",
  "example.events": "Date,Install Events,Uninstall Events\n2026-10-20,13,2\n",
};
for (const [name, content] of Object.entries(fixtures))
  fs.writeFileSync(
    path.join(DATA_DIR, name + ".csv"),
    Buffer.from("\ufeff" + content, "utf16le"),
  );
const factory = require("../lib/viewerFactory");
require("../lib/googleAppDiscovery").discoverGoogleApps = async () => [];
require("../lib/googleSales").getGoogleSales = async () => ({ grossRevenueByCurrency: {}, revenueAvailable: false, revenueStatus: "unavailable" });
let failDiscovery = false;
factory.buildGoogleViewer = (cfg, pkg) => {
  const viewer = new (require("../lib/GooglePlayStoreStatsViewer"))({
    keyJson: {},
    packageName: pkg,
    projectID: "synthetic",
    bucketName: "synthetic",
    dataDir: DATA_DIR,
  });
  viewer.initializeStorage = async () => {
    viewer.packageUtils.authenticatedStorageObj = {
      bucket: () => ({
        getFiles: async ({ prefix }) => {
          if (failDiscovery) throw new Error("Synthetic source failure");
          const files = Object.keys(fixtures)
            .map((id) => ({
              name: `stats/installs/installs_${id}_202610_overview.csv`,
            }))
            .filter((file) => file.name.startsWith(prefix));
          return [files];
        },
        file: (name) => ({
          download: async ({ destination }) => {
            const id = Object.keys(fixtures).find((id) => name.includes(id));
            assert.ok(id);
            fs.writeFileSync(
              destination,
              Buffer.from("\ufeff" + fixtures[id], "utf16le"),
            );
          },
        }),
      }),
    };
  };
  return viewer;
};
const scraper = require("../lib/aso/scraper");
scraper.getPlayListing = async (pkg) => ({
  title: "Listing " + pkg,
  score: 4.5,
  icon: "https://play-lh.googleusercontent.com/synthetic-icon",
  version: "1.0",
});
const portfolio = require("../lib/portfolio");
(async () => {
  const result = await portfolio.portfolio({
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  });
  assert.equal(result.apps.length, 3);
  assert.equal(
    result.apps.find((app) => app.packageName === "example.legacy").installs,
    7,
  );
  const events = result.apps.find(
    (app) => app.packageName === "example.events",
  );
  assert.equal(events.installs, 13);
  assert.equal(events.activeDevices, null);
  const fresh = result.apps.find((app) => app.packageName === "example.new");
  assert.equal(fresh.installs, null);
  assert.equal(fresh.error, "NO_REPORTS");
  assert.equal(fresh.iconAvailable, true);
  assert.equal(fresh.name, "Listing example.new");
  require("../lib/resolver").clearCache();
  failDiscovery = true;
  const fallback = await portfolio.listApps();
  assert.equal(fallback.apps.length, 1);
  assert.equal(fallback.apps[0].packageName, "example.new");
  assert.equal(fallback.warnings.length, 1);
  const { validIconURL, fetchIcon } = require("../lib/appIcon");
  assert.equal(
    validIconURL("https://play-lh.googleusercontent.com/icon"),
    true,
  );
  assert.equal(validIconURL("https://is1-ssl.mzstatic.com/image.png"), true);
  for (const url of [
    "http://play-lh.googleusercontent.com/a",
    "https://play-lh.googleusercontent.com.evil.invalid/a",
    "https://127.0.0.1/icon",
    "https://user:secret@play-lh.googleusercontent.com/a",
    "file:///etc/passwd",
  ])
    assert.equal(validIconURL(url), false);
  const axios = require("axios"),
    original = axios.get;
  try {
    axios.get = async (url, opts) => {
      assert.equal(opts.maxRedirects, 0);
      assert.equal(opts.maxContentLength, 2097152);
      return {
        headers: { "content-type": "image/png" },
        data: Buffer.from("synthetic"),
      };
    };
    assert.equal(
      (await fetchIcon("https://play-lh.googleusercontent.com/icon")).type,
      "image/png",
    );
    axios.get = async () => ({
      headers: { "content-type": "image/svg+xml" },
      data: "<svg/>",
    });
    await assert.rejects(
      fetchIcon("https://play-lh.googleusercontent.com/icon"),
      /INVALID_ICON_TYPE/,
    );
  } finally {
    axios.get = original;
  }
  require("../lib/db").db.close();
  console.log(
    "PASS: multiple Google apps, UTF-16 legacy/event report metrics, manual new apps without reports, metadata/icons, discovery failure and icon URL restrictions.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
