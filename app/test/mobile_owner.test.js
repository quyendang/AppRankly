const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { install, apple, google, range } = require("./mobile_analytics_fixture");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "apprankly-owner-test-"));
process.env.DATA_DIR = directory;
process.env.DB_PATH = path.join(directory, "database.sqlite");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync("mobile-owner-fixture", 4);
delete process.env.NTFY_TOPIC;
delete process.env.SLACK_WEBHOOK_URL;
delete process.env.DISCORD_WEBHOOK_URL;
delete process.env.TELEGRAM_BOT_TOKEN;
install();

const notifier = require("../lib/notifier");
const ai = require("../lib/ai");
const drafts = require("../lib/reviewDraft");
const { db } = require("../lib/db");
const { createApp } = require("../server");
const scheduler = require("../lib/scheduler");

require("../lib/insights").buildDigest = async period => ({ title: "Example digest", message: period });
require("../lib/aso/catalog").listing = async () => ({ title: "Fixture listing" });
drafts.destination = () => ({ provider: "fixture", model: "fixture-model" });
let forwarded;
ai.generateJSON = async ({ prompt }) => {
  forwarded = JSON.parse(prompt);
  return { provider: "fixture", model: "fixture-model", data: { summary: "Example audit" } };
};
let finishSync;
scheduler.checkAndNotifyStats = () => new Promise(resolve => { finishSync = resolve; });
notifier.broadcastAlert = async () => { assert.fail("No real notifications should be sent"); };

(async () => {
  const server = createApp().listen(0, "127.0.0.1");
  try {
    await new Promise((resolve, reject) => server.once("listening", resolve).once("error", reject));
    const origin = "http://127.0.0.1:" + server.address().port;
    process.env.APP_ORIGIN = origin;
    const request = (route, method = "GET", body, token) => fetch(origin + "/api/v1" + route, {
      method, headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      }, body: JSON.stringify(body),
    });
    const login = await request("/auth/login", "POST", { password: "mobile-owner-fixture" });
    assert.equal(login.status, 200);
    const token = (await login.json()).accessToken;
    const send = async (route, expected = 200, method, body) => {
      const response = await request(route, method, body, token);
      assert.equal(response.status, expected, route);
      return response.headers.get("content-type")?.startsWith("text/csv") ? response.text() : response.json();
    };
    const apples = "/apps/" + encodeURIComponent(apple.id);
    const googles = "/apps/" + encodeURIComponent(google.id);

    for (const route of ["/settings", "/integrations", "/sync", "/notifications", "/digest", "/export", apples + "/events", apples + "/ai/latest"])
      assert.equal((await request(route)).status, 401, route);

    assert.equal((await send("/settings", 400, "PUT", { googlePackages: [] })).error.code, "INVALID_SETTINGS");
    assert.equal((await send("/settings", 400, "PUT", { digestHour: 99 })).error.code, "INVALID_SETTINGS");
    assert.equal((await send("/settings", 200, "PUT", { digestHour: 7, digestLocale: "en" })).digestHour, 7);
    assert.deepEqual((await send("/apps/google", 201, "POST", { packageName: "example.extra" })).googlePackages, ["example.extra"]);
    assert.deepEqual((await send("/apps/google/example.extra", 200, "DELETE")).googlePackages, []);
    assert.equal((await send("/integrations")).notifications.configured, false);

    const sync = await send("/sync", 202, "POST", {});
    assert.equal(sync.state, "running");
    assert.equal((await send("/sync", 202, "POST", {})).id, sync.id);
    const sources = { google: { attempted: 1, withReports: 0 } };
    finishSync({ status: "completed", appsChecked: 0, sources });
    assert.deepEqual(await send("/sync/" + sync.id), { id: sync.id, state: "completed", appsChecked: 0, sources });
    assert.equal((await send("/sync/unknown", 404)).error.code, "SYNC_NOT_FOUND");

    notifier.addNotificationRecord(directory, { title: "Example", message: "New report" });
    const feed = await send("/notifications");
    assert.equal(feed.unreadCount, 1);
    const id = feed.notifications[0].id;
    await send("/notifications/read", 200, "POST", { id });
    assert.equal((await send("/notifications")).unreadCount, 0);
    await send("/notifications/" + id, 200, "DELETE");
    assert.deepEqual(await send("/notifications"), { notifications: [], unreadCount: 0 });
    assert.equal((await send("/digest?period=weekly")).message, "weekly");
    assert.equal((await send("/digest/send", 400, "POST", { confirmed: false })).error.code, "PREVIEW_REQUIRED");
    assert.equal((await send("/notifications/test", 403, "POST", { confirmed: true })).error.code, "NOTIFICATIONS_DISABLED");

    const event = await send(apples + "/events", 201, "POST", { label: "Fixture release", date: range.startDate });
    assert.equal((await send(apples + "/events")).events[0].id, event.id);
    await send(googles + "/events/" + event.id, 404, "DELETE");
    await send(apples + "/events/" + event.id, 200, "DELETE");
    assert.equal((await send(apples + "/events")).events.length, 0);

    const query = "?from=" + range.startDate + "&to=" + range.endDate;
    const exported = await send("/export" + query + "&appId=" + encodeURIComponent(apple.id));
    assert.deepEqual(exported.apps.map(app => app.id), [apple.id]);
    assert.equal(exported.apps[0].installs, 385);
    const csv = await send("/export" + query + "&format=csv");
    assert.match(csv, /"Chậm","google","193","148000","VND"/);
    const { portfolioCSV } = await import("../lib/portfolioCSV.mjs");
    assert.match(portfolioCSV([{ name: "=formula", platform: "apple" }], ["App"], () => ""), /"'=formula"/);

    const preview = await send("/ai/previews", 200, "POST", { kind: "audit", appId: apple.id, locale: "en", includeMetrics: true, range });
    assert.deepEqual(JSON.parse(preview.payloadJSON), preview.payload);
    assert.equal(preview.payload.metrics.installs, 385);
    await send("/ai/runs", 400, "POST", { previewId: preview.previewId });
    assert.equal(forwarded, undefined);
    const result = await send("/ai/runs", 200, "POST", { previewId: preview.previewId, confirmed: true });
    assert.deepEqual(forwarded, preview.payload);
    assert.deepEqual((await send(apples + "/ai/latest")).result, result.result);
    assert.equal((await send(googles + "/ai/latest")).result, null);
    await send("/ai/runs", 400, "POST", { previewId: preview.previewId, confirmed: true });
    console.log("PASS mobile owner settings, sync, notifications, digest, scoped events and export, AI consent and persistence");
  } finally {
    server.close();
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write(String(error.stack || error) + "\n");
  process.exitCode = 1;
});
