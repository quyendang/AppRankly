const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { install, apple, google, missing, range, currencies } = require("./mobile_analytics_fixture");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "apprankly-analytics-test-"));
process.env.DATA_DIR = directory;
process.env.DB_PATH = path.join(directory, "database.sqlite");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync("analytics-test-owner", 4);
const requests = install();
const { createApp } = require("../server");
const { merge } = require("../lib/countryRevenue");
const { db } = require("../lib/db");

(async () => {
  const server = createApp().listen(0, "127.0.0.1");
  try {
    await new Promise((resolve, reject) => server.once("listening", resolve).once("error", reject));
    const host = "http://127.0.0.1:" + server.address().port;
    process.env.APP_ORIGIN = host;
    const request = (path, options) => fetch(host + "/api/v1" + path, options);
    const loginBody = { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "analytics-test-owner" }) };
    const auth = await (await request("/auth/login", loginBody)).json();
    const headers = { Authorization: "Bearer " + auth.accessToken };
    const read = path => request(path, { headers });
    const get = async path => {
      const response = await read(path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("cache-control"), "no-store");
      return response.json();
    };
    const query = "?from=" + range.startDate + "&to=" + range.endDate;
    const overviewPath = "/overview" + query;
    const target = "/apps/" + encodeURIComponent(apple.id) + "/analytics";

    for (const route of ["/apps", overviewPath, target, target + "/purchases", "/exchange-rates"])
      assert.equal((await request(route)).status, 401);
    const catalog = await get("/apps");
    assert.deepEqual(catalog.apps.map(app => app.id), [apple.id, google.id, missing.id]);
    assert.equal(catalog.apps[1].iconAvailable, false);
    assert.equal(catalog.apps[1].rating, null);
    const artwork = await read("/apps/" + encodeURIComponent(apple.id) + "/icon");
    assert.equal(artwork.headers.get("content-type"), "image/png");
    assert.ok((await artwork.arrayBuffer()).byteLength > 0);

    const overview = await get(overviewPath);
    assert.equal(requests[0].catalog, requests[1].catalog, "both periods share app discovery");
    assert.deepEqual(overview.range, range);
    assert.deepEqual(overview.previousRange, { startDate: "2026-11-07", endDate: "2026-11-13" });
    const [appleReport, googleReport, unavailable] = overview.current;
    assert.equal(appleReport.installs, 385);
    assert.deepEqual(appleReport.daily.slice(0, 3).map(day => day.installs), [72, 0, null]);
    assert.equal(appleReport.activeDevices, null);
    assert.equal(appleReport.revenue.basis, "estimated_developer_proceeds");
    assert.deepEqual(appleReport.revenue.byCurrency, currencies);
    assert.equal(googleReport.revenue.basis, "gross_buyer_payments_including_tax");
    assert.deepEqual(googleReport.revenue.byCurrency, { VND: 148000 });
    assert.equal(googleReport.revenue.status, "partial");
    assert.equal(unavailable.error, "NO_REPORTS");
    assert.equal(unavailable.installs, null);
    assert.deepEqual((await get(overviewPath + "&platform=apple")).current, [appleReport]);

    const cookieLogin = await fetch(host + "/api/auth/login", { ...loginBody, headers: { ...loginBody.headers, Origin: host } });
    const web = await fetch(host + "/api/portfolio", {
      method: "POST", headers: { ...loginBody.headers, Origin: host, Cookie: cookieLogin.headers.get("set-cookie") },
      body: JSON.stringify(range),
    });
    assert.equal(web.status, 200);
    const webReport = (await web.json()).apps[0];
    assert.equal(webReport.installs, appleReport.installs);
    assert.deepEqual(webReport.revenueByCurrency, appleReport.revenue.byCurrency);

    assert.equal((await get(target + query)).current[0].app.id, apple.id);
    assert.deepEqual((await get(target + "/versions" + query)).rows.map(row => row.installs), [0, 32, null]);
    assert.deepEqual((await get(target + "/countries" + query)).rows.map(row => row.installs), [0, null, 51]);
    assert.equal(merge([], { US: { USD: 1 } }, null)[0].installs, null);
    assert.equal(merge([], { US: { USD: 1 } })[0].installs, 0);
    assert.equal((await get(target + "/purchases" + query)).purchases.products[0].refunds, 1);
    assert.equal((await get(target + "/releases")).releases[0].id, "29");
    assert.equal((await get("/exchange-rates")).rates.EUR.rate, 1.2);

    const malformed = await read("/overview?from=not-a-date&to=2026-11-14");
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, "INVALID_DATE_RANGE");
    assert.equal((await read("/overview?from=2026-11-14")).status, 400);
    assert.equal((await read(overviewPath + "&platform=other")).status, 400);
    assert.equal((await read("/apps/apple%3Aunowned/analytics" + query)).status, 404);
    assert.equal((await read("/apps/" + encodeURIComponent(missing.id) + "/analytics/purchases" + query)).status, 404);
    console.log("PASS mobile analytics catalog, date comparison, missing data, revenue, drill-down and web parity");
  } finally {
    server.close();
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write(String(error.stack || error) + "\n");
  process.exitCode = 1;
});
