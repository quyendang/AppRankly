const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "apprankly-tests-"));
try {
  for (const file of fs
    .readdirSync(__dirname)
    .filter((x) => x.endsWith(".test.js"))
    .sort()) {
    if (
      file === "keyword_hints.test.js" &&
      process.env.LIVE_STORE_TESTS !== "1"
    ) {
      console.log("SKIP live store integration (set LIVE_STORE_TESTS=1)");
      continue;
    }
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (
        /^(GOOGLE_|APPLE_|OPENAI_|ANTHROPIC_|GEMINI_|NTFY_|DISCORD_|SLACK_|TELEGRAM_|AI_PROVIDER|ADMIN_PASSWORD_HASH|JWT_SECRET|APP_ORIGIN)/.test(
          key,
        )
      )
        delete env[key];
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
      stdio: "inherit",
      env: {
        ...env,
        DATA_DIR: temp,
        DB_PATH: path.join(temp, "database.sqlite"),
      },
    });
    if (result.status !== 0) {
      process.exitCode = 1;
      break;
    }
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
