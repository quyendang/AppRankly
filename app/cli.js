#!/usr/bin/env node
require("dotenv").config();
const fs = require("node:fs");
const command = process.argv[2];
if (command === "hash-password") {
  const password = fs.readFileSync(0, "utf8").replace(/\r?\n$/, "");
  if (password.length < 12 || password.length > 256)
    throw new Error("Use a password of 12–256 characters.");
  process.stdout.write(require("bcryptjs").hashSync(password, 12) + "\n");
} else {
  const { protectLogs, DATA_DIR } = require("./lib/runtime");
  protectLogs();
  const { db, migrate } = require("./lib/db");
  if (command === "migrate") {
    migrate();
    db.close();
  } else if (command === "status") {
    console.log({
      dataDirectory: DATA_DIR,
      sqlite: !!db,
      settings: require("./lib/config").getSettings().name,
    });
    db?.close();
  } else if (command === "cache-clear") {
    require("./lib/resolver").clearCache();
    db?.close();
  } else if (command === "sync") {
    const config = require("./lib/config");
    config.validateCredentials();
    const viewers = require("./lib/viewerFactory");
    require("./lib/scheduler")
      .checkAndNotifyStats(
        { getBaseConfig: config.getBaseConfig, DATA_DIR, ...viewers },
        { force: true },
      )
      .then(() => db?.close())
      .catch(() => {
        console.error("SYNC_FAILED");
        db?.close();
        process.exitCode = 1;
      });
  } else {
    console.log(
      "Commands: hash-password (reads stdin), migrate, status, cache-clear, sync",
    );
    db?.close();
  }
}
