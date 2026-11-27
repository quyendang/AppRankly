const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");

const folder = mkdtempSync(join(tmpdir(), "mobile-reviews-"));
process.env.DATA_DIR = folder;
process.env.DB_PATH = join(folder, "test.sqlite");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = randomBytes(32).toString("hex");
const password = "test-only-mobile-reviews";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(password, 4);
const fixture = require("./mobile_review_fixture").install();
const { createApp } = require("../server");

(async () => {
  const server = createApp().listen(0, "127.0.0.1");
  try {
    await new Promise((resolve, reject) => server.once("listening", resolve).once("error", reject));
    const host = "http://127.0.0.1:" + server.address().port;
    process.env.APP_ORIGIN = host;
    const request = async (path, { token, body, method = body === undefined ? "GET" : "POST" } = {}) => {
      const response = await fetch(host + "/api/v1" + path, { method, headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, ...(await response.json()) };
    };
    const { accessToken: token } = await request("/auth/login", { body: { password } });
    const call = (path, body, method) => request(path, { token, body, method });
    const appPath = app => "/apps/" + encodeURIComponent(app.id) + "/reviews";
    const path = appPath(fixture.apple);
    const get = async (id, app = fixture.apple) => (await call(appPath(app) + "/" + id)).review;
    const attempt = (review, text) => ({ text, expectedRevision: review.revision, operationId: randomUUID(), confirmed: true });
    const send = (id, body, app = fixture.apple) => call(appPath(app) + "/" + id + "/reply", body, "PUT");

    for (const route of ["/reviews", "/review-templates", "/inbox", path]) {
      assert.equal((await request(route)).status, 401);
    }
    let cursor = null;
    const identifiers = [];
    do {
      const result = await call("/reviews?limit=1" + (cursor ? "&cursor=" + cursor : ""));
      assert.equal(result.status, 200);
      identifiers.push(result.reviews[0].app.id + "/" + result.reviews[0].id);
      cursor = result.nextCursor;
      assert.ok(identifiers.length <= 6);
    } while (cursor);
    assert.equal(new Set(identifiers).size, 6);
    assert.equal((await call(path + "?stars=5")).reviews[0].canReply, false);
    assert.equal((await call(path + "?status=answered")).reviews.length, 0);
    assert.equal((await call(path + "?cursor=bad")).status, 400);
    assert.equal((await call(path + "/google-review")).status, 404);
    assert.equal((await call("/reviews/refresh", { appId: fixture.apple.id })).sources[0].status, "available");
    const inbox = (await call("/inbox")).tasks;
    assert.ok(inbox.some(item => item.kind === "lowReview" && item.sample.id));
    assert.ok(inbox.some(item => item.kind === "drop" && item.app.id === fixture.apple.id));

    const apple = await get("apple-review");
    const original = attempt(apple, "Store accepted this before timeout");
    assert.equal((await send(apple.id, { ...original, confirmed: false })).error.code, "PREVIEW_REQUIRED");
    assert.equal(fixture.seen.length, 0);
    assert.equal((await send(apple.id, original)).error.code, "REVIEW_REPLY_UNCERTAIN");
    const reconciled = await send(apple.id, original);
    assert.equal(reconciled.review.replyState, "pending");
    assert.equal((await send(apple.id, original)).review.replyText, original.text);
    assert.equal(fixture.seen.length, 1, "same operation never submits again");
    assert.equal((await send(apple.id, { ...original, text: "different" })).error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal((await send(apple.id, attempt(apple, "stale write"))).error.code, "REVIEW_REPLY_CONFLICT");
    assert.equal((await call(path + "?status=answered")).reviews.length, 1);
    const readOnly = await get("public");
    assert.equal((await send(readOnly.id, attempt(readOnly, "blocked"))).status, 403);

    const delayed = await get("second");
    const one = attempt(delayed, "Slow reply");
    const two = attempt(delayed, "Another reply");
    const concurrent = await Promise.all([send(delayed.id, one), send(delayed.id, two)]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
    const absent = await get("absent");
    const lost = attempt(absent, "Did not reach");
    assert.equal((await send(absent.id, lost)).error.code, "REVIEW_REPLY_UNCERTAIN");
    assert.equal((await send(absent.id, lost)).error.code, "REVIEW_REPLY_UNCERTAIN");
    fixture.db.prepare("UPDATE review_reply_operation SET updated_at=0 WHERE operation_id=?").run(lost.operationId);
    assert.equal((await send(absent.id, lost)).error.code, "REVIEW_REPLY_NOT_VERIFIED");

    const bulk = await call(path + "/bulk-replies", { confirmed: true, items: [
      { ...attempt(absent, "Confirmed bulk response"), reviewId: absent.id },
      { ...attempt(apple, "Stale bulk response"), reviewId: apple.id },
    ] });
    assert.equal(bulk.results[0].review.replyText, "Confirmed bulk response");
    assert.equal(bulk.results[1].error, "REVIEW_REPLY_CONFLICT");
    const largeBulk = await call(path + "/bulk-replies", { confirmed: true, items: Array.from({ length: 20 }, (_, i) => ({
      ...attempt(absent, "é".repeat(5900)), reviewId: "unknown-" + i,
    })) });
    assert.equal(largeBulk.status, 200);
    assert.ok(largeBulk.results.every(row => row.error === "REVIEW_NOT_FOUND"));
    const play = await get("google-review", fixture.google);
    assert.equal((await send(play.id, attempt(play, "🙂".repeat(176)), fixture.google)).error.code, "INVALID_REVIEW_REPLY");

    const template = await call("/review-templates", { name: "Cảm ơn", body: "Chào {name}" });
    assert.equal(template.status, 201);
    assert.equal((await call("/review-templates")).templates[0].body, "Chào {name}");
    await call("/review-templates/" + template.id, undefined, "DELETE");
    assert.equal((await call("/review-templates")).templates.length, 0);

    const { previewId, payload, destination } = await call("/ai/previews", {
      kind: "reviewReply", appId: fixture.google.id, reviewId: play.id,
    });
    assert.equal(destination.provider, "stub");
    assert.equal(payload.review.text, play.text);
    assert.ok(!Object.keys(payload.review).includes("author"));
    const confirmed = { previewId, confirmed: true };
    assert.equal((await call("/ai/runs", { ...confirmed, confirmed: false })).status, 400);
    const other = await request("/auth/login", { body: { password } });
    assert.equal((await request("/ai/runs", { token: other.accessToken, body: confirmed })).status, 400);
    const before = fixture.seen.length;
    assert.ok((await call("/ai/runs", confirmed)).text);
    assert.equal(fixture.drafts(), 1);
    assert.equal((await call("/ai/runs", confirmed)).status, 400);
    assert.equal(fixture.seen.length, before, "generating a draft never publishes");
    console.log("PASS mobile review archive, inbox, draft consent, bulk rejection, idempotency, timeout reconciliation and conflicts");
  } finally {
    server.close();
    fixture.db.close();
    rmSync(folder, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write(String(error.stack || error) + "\n");
  process.exitCode = 1;
});
