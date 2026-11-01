const assert = require("node:assert/strict");
const { GoogleAuth } = require("google-auth-library");
const { discoverGoogleApps } = require("../lib/googleAppDiscovery");
(async () => {
  const original = GoogleAuth.prototype.request;
  try {
    const requests = [];
    GoogleAuth.prototype.request = async function(options) {
      requests.push(options);
      assert.deepEqual(this.scopes, ["https://www.googleapis.com/auth/playdeveloperreporting"]);
      return { data: options.params.pageToken ? {
        apps: [{ packageName: "com.example.new", displayName: "New app" }],
      } : {
        apps: [{ packageName: "com.example.old", displayName: "Old app" }, { packageName: "../bad" }],
        nextPageToken: "page2",
      } };
    };
    assert.deepEqual(await discoverGoogleApps({}), [
      { packageName: "com.example.old", name: "Old app" },
      { packageName: "com.example.new", name: "New app" },
    ]);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].params.pageToken, "page2");
    assert.equal(requests[0].url, "https://playdeveloperreporting.googleapis.com/v1beta1/apps:search");
    const Viewer = require("../lib/GooglePlayStoreStatsViewer");
    const resolver = require("../lib/resolver");
    resolver.clearCache("google:app-discovery");
    const viewer = new Viewer({ keyJson: {}, bucketName: "synthetic-discovery" });
    viewer.initializeStorage = async () => {
      viewer.packageUtils.authenticatedStorageObj = { bucket: () => ({
        getFiles: async () => [[{ name: "stats/installs/installs_com.example.old_202610_overview.csv" }]],
      }) };
    };
    const apps = await viewer.listPackages();
    assert.equal(apps.length, 2);
    assert.ok(apps.some(app => app.packageName === "com.example.new"));
    resolver.clearCache("google:app-discovery");
    GoogleAuth.prototype.request = async () => { throw new Error("Synthetic forbidden"); };
    assert.equal((await viewer.listPackages()).length, 1);
    resolver.clearCache("google:app-discovery");
    GoogleAuth.prototype.request = async () => ({ data: { nextPageToken: "repeat" } });
    await assert.rejects(discoverGoogleApps({}), /PAGINATION_FAILED/);
    console.log("PASS: authenticated Google app discovery paginates, merges reports, rejects invalid packages and retains fallback on API failure.");
  } finally { GoogleAuth.prototype.request = original; }
})().catch(error => { console.error(error); process.exitCode = 1; });
