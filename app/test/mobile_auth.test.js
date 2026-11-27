const assert = require("node:assert/strict");
const { createHash, randomBytes } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const bcrypt = require("bcryptjs");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "apprankly-mobile-test-"));
const password = "local-test-owner";
process.env.DATA_DIR = directory;
process.env.DB_PATH = path.join(directory, "database.sqlite");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = randomBytes(32).toString("hex");
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(password, 4);

const { createApp } = require("../server");
const { db } = require("../lib/db");
const hash = value => createHash("sha256").update(value).digest("hex");

(async () => {
  let server;
  try {
    server = createApp().listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => server.once("listening", resolve).once("error", reject));
    const origin = "http://127.0.0.1:" + server.address().port;
    process.env.APP_ORIGIN = origin;

    const request = (route, { body, raw, method = body === undefined && raw === undefined ? "GET" : "POST", headers = {}, accessToken } = {}) =>
      fetch(origin + route, {
        method,
        headers: {
          ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}),
          ...headers,
        },
        body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
    const mobile = (route, args) => request("/api/v1/auth/" + route, args);
    const expectFailure = async (response, status, code) => {
      assert.equal(response.status, status);
      const result = await response.json();
      assert.equal(result.error.code, code);
      assert.match(result.error.requestId, /^[a-f0-9-]{36}$/);
      assert.equal(response.headers.get("x-request-id"), result.error.requestId);
    };

    const web = await request("/api/auth/login", { body: { password }, headers: { Origin: origin } });
    assert.equal(web.status, 200);
    const cookie = web.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    await expectFailure(await mobile("me", { headers: { Cookie: cookie } }), 401, "AUTH_REQUIRED");
    await expectFailure(await mobile("login", { raw: "{" }), 400, "INVALID_INPUT");
    await expectFailure(await mobile("login", { body: { password: "wrong" } }), 401, "INVALID_LOGIN");

    const first = await mobile("login", { body: { password } });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("set-cookie"), null);
    assert.equal(first.headers.get("cache-control"), "no-store");
    const original = await first.json();
    assert.equal(original.expiresIn, 900);
    assert.deepEqual(await (await mobile("me", original)).json(), { owner: true });
    assert.equal((await request("/api/auth/me", original)).status, 401);
    await expectFailure(await request("/api/v1/unknown", original), 404, "NOT_FOUND");
    const [stored] = db.prepare("SELECT * FROM mobile_session").all();
    assert.equal(stored.access_hash, hash(original.accessToken));
    assert.equal(stored.refresh_hash, hash(original.refreshToken));
    assert.ok(!JSON.stringify(stored).includes(original.refreshToken));

    const parallel = await Promise.all(Array.from({ length: 2 }, () =>
      mobile("refresh", { body: { refreshToken: original.refreshToken } })));
    assert.deepEqual(parallel.map(response => response.status).sort(), [200, 401]);
    const rotated = await parallel.find(response => response.ok).json();
    assert.notEqual(original.refreshToken, rotated.refreshToken);
    await expectFailure(await mobile("me", original), 401, "AUTH_REQUIRED");
    await expectFailure(await mobile("refresh", { body: { refreshToken: original.refreshToken } }), 401, "AUTH_REQUIRED");

    const other = await (await mobile("login", { body: { password } })).json();
    assert.equal((await mobile("logout", { ...rotated, method: "POST" })).status, 204);
    await expectFailure(await mobile("me", rotated), 401, "AUTH_REQUIRED");
    await expectFailure(await mobile("refresh", { body: { refreshToken: rotated.refreshToken } }), 401, "AUTH_REQUIRED");
    assert.equal((await mobile("me", other)).status, 200);
    db.prepare("UPDATE mobile_session SET access_expires_at=0 WHERE access_hash=?").run(hash(other.accessToken));
    await expectFailure(await mobile("me", other), 401, "AUTH_REQUIRED");
    const refreshed = await (await mobile("refresh", { body: { refreshToken: other.refreshToken } })).json();

    process.env.NODE_ENV = "production";
    try {
      await expectFailure(await mobile("me", refreshed), 400, "HTTPS_REQUIRED");
      assert.equal((await mobile("me", { ...refreshed, headers: { "X-Forwarded-Proto": "https" } })).status, 200);
    } finally {
      process.env.NODE_ENV = "test";
    }
    process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync("new-synthetic-password", 4);
    await expectFailure(await mobile("me", refreshed), 401, "AUTH_REQUIRED");
    await expectFailure(await mobile("refresh", { body: { refreshToken: refreshed.refreshToken } }), 401, "AUTH_REQUIRED");

    for (let i = 0; i < 6; i++)
      await expectFailure(await mobile("login", { body: { password: "wrong" } }), 401, "INVALID_LOGIN");
    await expectFailure(await mobile("login", { body: { password: "wrong" } }), 429, "LOGIN_RATE_LIMIT");
    const throttledWeb = await request("/api/auth/login", { body: { password }, headers: { Origin: origin } });
    assert.equal(throttledWeb.status, 429);
    assert.deepEqual(await throttledWeb.json(), { error: "LOGIN_RATE_LIMIT" });
    console.log("PASS mobile sessions, rotation, expiration, revocation, HTTPS and web isolation");
  } finally {
    server?.close();
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write(String(error.stack || error) + "\n");
  process.exitCode = 1;
});
