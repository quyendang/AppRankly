const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "apprankly-security-"));
process.env.DATA_DIR = temp;
process.env.DB_PATH = path.join(temp, "database.sqlite");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.ADMIN_PASSWORD_HASH = require("bcryptjs").hashSync(
  "synthetic-password-only",
  10,
);
process.env.OPENAI_API_KEY = "synthetic-api-key-canary-never-disclose";
const fakeApp = {
  id: "apple:example.app",
  platform: "apple",
  packageName: "example.app",
  name: "Synthetic app",
  appId: "123",
};
const portfolio = require("../lib/portfolio");
portfolio.ownedApp = async (id) => {
  if (id !== fakeApp.id) throw new Error("APP_NOT_FOUND");
  return fakeApp;
};
portfolio.listApps = async () => ({ apps: [fakeApp], warnings: [] });
portfolio.appStats = async () => ({
  installs: 123,
  revenueByCurrency: { USD: 10, EUR: 5 },
  dailyTrends: [],
});
const scraper = require("../lib/aso/scraper");
scraper.getAppleLookup = async () => ({
  title: "Public listing",
  description: "Public description",
});
scraper.getAppleReviewsRSS = async () => [];
const ai = require("../lib/ai");
let calls = 0,
  lastPayload = "";
ai.generateJSON = async (input) => {
  calls++;
  lastPayload = input.prompt;
  return {
    data: { summary: "Safe result", recommendations: [], candidates: [] },
    provider: "openai",
    model: "synthetic",
    usage: { inputTokens: 1, outputTokens: 1 },
  };
};
process.env.OPENAI_BASE_URL = "https://proxy.synthetic.invalid/private-route";
const { createApp } = require("../server");
(async () => {
  let server;
  try {
    const secret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "change_this_to_a_secure_random_string";
    assert.throws(createApp, /SET_STRONG/);
    process.env.JWT_SECRET = secret;
    const hash = process.env.ADMIN_PASSWORD_HASH;
    delete process.env.ADMIN_PASSWORD_HASH;
    assert.throws(createApp, /SET_ADMIN/);
    process.env.ADMIN_PASSWORD_HASH = hash;
    server = createApp().listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const origin = "http://127.0.0.1:" + server.address().port;
    process.env.APP_ORIGIN = origin;
    const request = (
      url,
      method = "GET",
      body,
      cookie,
      requestOrigin = origin,
    ) =>
      fetch(origin + url, {
        method,
        headers: {
          Origin: requestOrigin,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    assert.equal((await request("/readyz")).status, 200);
    fs.renameSync(temp, temp + "-offline");
    try {
      assert.equal((await request("/readyz")).status, 503);
    } finally {
      fs.renameSync(temp + "-offline", temp);
    }
    const secureCookie = require("node:child_process").spawnSync(
      process.execPath,
      [
        "-e",
        `const a=require('node:assert/strict');require('./lib/auth').login({body:{password:'synthetic-password-only'}},{cookie:(name,value,options)=>{a.equal(options.secure,true);a.equal(options.httpOnly,true);a.equal(options.sameSite,'strict');return {json:()=>{}};}}).catch(()=>process.exit(1));`,
      ],
      {
        cwd: path.join(__dirname, ".."),
        env: { ...process.env, NODE_ENV: "production" },
        encoding: "utf8",
      },
    );
    assert.equal(secureCookie.status, 0, secureCookie.stderr);
    for (const url of [
      "/api/settings",
      "/api/notes",
      "/api/projects",
      "/api/config",
    ])
      assert.equal((await request(url)).status, 401);
    assert.equal(
      (
        await request(
          "/api/auth/login",
          "POST",
          { password: "synthetic-password-only" },
          null,
          "https://attacker.invalid",
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("/api/auth/login", "POST", { password: "wrong" })).status,
      401,
    );
    const login = await request("/api/auth/login", "POST", {
      password: "synthetic-password-only",
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Max-Age=43200/);
    assert.equal((await login.text()).includes("token"), false);
    assert.equal(
      (await request("/api/auth/me", "GET", null, cookie)).status,
      200,
    );
    for (const url of [
      "/api/config",
      "/api/team/members",
      "/api/notes/setup-git",
      "/api/ai/ask-sql",
      "/api/auth/setup",
    ])
      assert.equal((await request(url, "POST", {}, cookie)).status, 404);
    assert.equal(
      (
        await request(
          "/api/settings",
          "PUT",
          { keyJson: { private_key: "CANARY" } },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/api/settings",
          "PUT",
          { refreshIntervalHours: 3, notificationsEnabled: false },
          cookie,
        )
      ).status,
      200,
    );
    const integrations = await (
      await request("/api/integrations", "GET", null, cookie)
    ).text();
    assert.ok(!integrations.includes(process.env.OPENAI_API_KEY));
    assert.ok(!integrations.includes("maskedKey"));
    const key = path.join(temp, "synthetic-key.p8");
    fs.writeFileSync(key, "SYNTHETIC_PRIVATE_FILE_CONTENT");
    fs.mkdirSync(path.join(temp, "notes", "nested"), { recursive: true });
    fs.symlinkSync(key, path.join(temp, "notes", "nested", "leak.md"));
    const notesResponse = await request("/api/notes", "GET", null, cookie);
    assert.equal(notesResponse.status, 200);
    assert.ok(
      !(await notesResponse.text()).includes("SYNTHETIC_PRIVATE_FILE_CONTENT"),
    );
    const note = await (
      await request(
        "/api/notes",
        "POST",
        { title: "My note", content: "Private content" },
        cookie,
      )
    ).json();
    assert.ok(note.id);
    assert.equal(
      (
        await request(
          "/api/notes",
          "POST",
          {
            title: "Key",
            content:
              "-----BEGIN PRIVATE KEY-----\nSYNTHETIC\n-----END PRIVATE KEY-----",
          },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/api/notes/" + note.id,
          "PUT",
          { title: "Updated", content: "Kept private" },
          cookie,
        )
      ).status,
      200,
    );
    const first = await (
      await request(
        "/api/ai/preview",
        "POST",
        {
          appId: fakeApp.id,
          kind: "audit",
          baseURL: "https://untrusted.invalid",
        },
        cookie,
      )
    ).json();
    assert.ok(first.previewId);
    assert.equal(first.destination.origin, "https://proxy.synthetic.invalid");
    assert.equal(first.destination.provider, "openai");
    assert.ok(!JSON.stringify(first).includes("/private-route"));
    assert.ok(!JSON.stringify(first).includes("https://untrusted.invalid"));
    assert.ok(!first.payload.metrics && !first.payload.notes);
    assert.ok(!JSON.stringify(first).includes(process.env.OPENAI_API_KEY));
    assert.equal(calls, 0);
    assert.equal(
      (
        await request(
          "/api/ai/run",
          "POST",
          { previewId: first.previewId, confirmed: false },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(calls, 0);
    const second = await (
      await request(
        "/api/ai/preview",
        "POST",
        { appId: fakeApp.id, includeMetrics: true, noteIds: [note.id] },
        cookie,
      )
    ).json();
    assert.equal(second.payload.metrics.installs, 123);
    assert.equal(second.payload.notes[0].content, "Kept private");
    assert.equal(
      (
        await request(
          "/api/ai/run",
          "POST",
          {
            previewId: second.previewId,
            confirmed: true,
            prompt: process.env.OPENAI_API_KEY,
          },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(calls, 1);
    assert.ok(!lastPayload.includes(process.env.OPENAI_API_KEY));
    assert.equal(
      (
        await request(
          "/api/ai/run",
          "POST",
          { previewId: second.previewId, confirmed: true },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(calls, 1);
    assert.equal(
      (await request("/api/notes/" + note.id, "DELETE", null, cookie)).status,
      200,
    );
    const release = await (
      await request(
        "/api/releases",
        "POST",
        {
          appId: fakeApp.id,
          version: "1.0",
          date: "2026-10-20",
          notes: "First",
        },
        cookie,
      )
    ).json();
    assert.ok(release.id);
    assert.equal(
      (
        await request(
          "/api/releases",
          "POST",
          {
            id: release.id,
            appId: fakeApp.id,
            version: "1.1",
            date: "2026-10-21",
            notes: "Updated",
          },
          cookie,
        )
      ).status,
      200,
    );
    const savedReleases = await (
      await request("/api/releases", "GET", null, cookie)
    ).json();
    assert.equal(savedReleases.length, 1);
    assert.equal(savedReleases[0].version, "1.1");
    assert.equal(
      (
        await request(
          "/api/releases",
          "POST",
          {
            appId: fakeApp.id,
            version: "1.2",
            date: "2026-02-31",
            notes: "Invalid date",
          },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/api/notes",
          "POST",
          {
            title: "Title\npackageName: injected",
            content: "Invalid frontmatter",
          },
          cookie,
        )
      ).status,
      400,
    );
    const aso = await (
      await request(
        "/api/aso/app/" + encodeURIComponent(fakeApp.id),
        "GET",
        null,
        cookie,
      )
    ).json();
    assert.equal(aso.aiResult.summary, "Safe result");
    const { redact } = require("../lib/runtime");
    assert.equal(
      redact("failure " + process.env.OPENAI_API_KEY),
      "failure [REDACTED]",
    );
    if (fs.existsSync(path.join(__dirname, "../public/assets")))
      for (const file of fs
        .readdirSync(path.join(__dirname, "../public/assets"))
        .filter((file) => /\.(js|css)$/.test(file)))
        assert.ok(
          !fs
            .readFileSync(
              path.join(__dirname, "../public/assets", file),
              "utf8",
            )
            .includes(process.env.OPENAI_API_KEY),
        );
    const logout = await request("/api/auth/logout", "POST", {}, cookie);
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/i);
    const { getSettings } = require("../lib/config");
    assert.equal(getSettings().refreshIntervalHours, 3);
    const disk = fs.readFileSync(path.join(temp, "settings.json"), "utf8");
    assert.ok(!disk.includes(process.env.OPENAI_API_KEY));
    console.log(
      "PASS: fail-closed auth, cookie/Origin protection, removed routes, secret filtering, symlink rejection, notes persistence, explicit one-use AI previews.",
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    require("../lib/db").db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
