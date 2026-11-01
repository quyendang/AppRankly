const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net"),
  crypto = require("node:crypto");
const { spawn } = require("node:child_process");
(async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "apprankly-startup-"),
  );
  const reservation = net.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => reservation.once("listening", r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const origin = "http://127.0.0.1:" + port;
  const env = {
    ...process.env,
    NODE_ENV: "test",
    DATA_DIR: directory,
    DB_PATH: path.join(directory, "database.sqlite"),
    PORT: String(port),
    APP_ORIGIN: origin,
    JWT_SECRET: crypto.randomBytes(32).toString("hex"),
    ADMIN_PASSWORD_HASH: require("bcryptjs").hashSync(
      "synthetic-startup-password",
      10,
    ),
  };
  for (const key of Object.keys(env))
    if (
      /^(GOOGLE_|APPLE_|OPENAI_|ANTHROPIC_|GEMINI_|NTFY_|DISCORD_|SLACK_|TELEGRAM_)/.test(
        key,
      )
    )
      delete env[key];
  let child;
  async function start() {
    child = spawn(process.execPath, ["server.js"], {
      cwd: path.join(__dirname, ".."),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("STARTUP_TIMEOUT")),
        8000,
      );
      child.stdout.on("data", (data) => {
        if (String(data).includes("AppRankly ready")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error("STARTUP_FAILED_" + code));
      });
    });
  }
  async function stop() {
    const exited = new Promise((r) =>
      child.once("exit", (code, signal) => r({ code, signal })),
    );
    child.kill("SIGTERM");
    const result = await exited;
    child = null;
    assert.equal(result.code, 0);
  }
  const request = (url, method = "GET", body, cookie) =>
    fetch(origin + url, {
      method,
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    await start();
    assert.equal((await request("/readyz")).status, 200);
    assert.equal((await request("/api/settings")).status, 401);
    const login = await request("/api/auth/login", "POST", {
      password: "synthetic-startup-password",
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    const portfolio = await (
      await request("/api/portfolio", "POST", {}, cookie)
    ).json();
    assert.deepEqual(portfolio.apps, []);
    assert.equal(
      (
        await request(
          "/api/settings",
          "PUT",
          { refreshIntervalHours: 6 },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/notes",
          "POST",
          { title: "Restart fixture", content: "Preserve this synthetic note" },
          cookie,
        )
      ).status,
      201,
    );
    await stop();
    await start();
    assert.equal((await request("/readyz")).status, 200);
    assert.equal(
      (await (await request("/api/settings", "GET", null, cookie)).json())
        .refreshIntervalHours,
      6,
    );
    assert.equal(
      (await (await request("/api/notes", "GET", null, cookie)).json())[0]
        .title,
      "Restart fixture",
    );
    await stop();
    console.log(
      "PASS: real server startup without store keys, empty portfolio, cookie session, SIGTERM exit and persisted state after restart.",
    );
  } finally {
    if (child) {
      child.kill("SIGKILL");
      await new Promise((r) => child.once("exit", r));
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
