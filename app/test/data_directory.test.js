const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const root = path.join(__dirname, "../..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "apprankly-directory-"));
try {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    DATA_DIR: "./app/data",
  };
  const runtime = spawnSync(
    process.execPath,
    ["-e", `require(${JSON.stringify(path.join(root, "app/lib/runtime.js"))})`],
    { cwd: temp, env, encoding: "utf8" },
  );
  assert.notEqual(runtime.status, 0);
  assert.match(runtime.stderr, /DATA_DIR_MUST_BE_ABSOLUTE/);
  assert.equal(fs.existsSync(path.join(temp, "app")), false);
  const wrapper = spawnSync(
    "/bin/sh",
    [path.join(root, "docker-entrypoint.sh")],
    { cwd: temp, env, encoding: "utf8" },
  );
  assert.notEqual(wrapper.status, 0);
  assert.match(wrapper.stderr, /DATA_DIR_MUST_BE_ABSOLUTE/);
  assert.equal(fs.existsSync(path.join(temp, "app")), false);
  const directory = path.join(temp, "volume");
  const absolute = spawnSync(
    process.execPath,
    [
      "-e",
      `require('node:assert/strict').equal(require(${JSON.stringify(path.join(root, "app/lib/runtime.js"))}).DATA_DIR,process.env.DATA_DIR)`,
    ],
    { cwd: temp, env: { ...env, DATA_DIR: directory }, encoding: "utf8" },
  );
  assert.equal(absolute.status, 0, absolute.stderr);
  assert.ok(fs.statSync(directory).isDirectory());
  console.log(
    "PASS: relative production DATA_DIR rejected before filesystem writes; absolute volume directory accepted.",
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
