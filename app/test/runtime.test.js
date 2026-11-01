const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { spawnSync } = require("node:child_process");
const { limited } = require("../lib/utils/concurrency");
(async () => {
  let active = 0,
    peak = 0,
    done = 0;
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      limited(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        done++;
        if (i === 3) throw new Error("synthetic");
      }).catch(() => {}),
    ),
  );
  assert.equal(peak, 2);
  assert.equal(done, 12);
  const scheduler = require("../lib/scheduler");
  let release;
  const held = new Promise((r) => (release = r)),
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "apprankly-restart-"));
  const helpers = {
    DATA_DIR: temp,
    getBaseConfig: () => ({ activeStartHour: 0, activeEndHour: 23 }),
    fetchPackagesByPlatform: () => held,
  };
  const job = scheduler.checkAndNotifyStats(helpers, { force: true });
  assert.equal(
    (await scheduler.checkAndNotifyStats(helpers, { force: true })).status,
    "skipped",
  );
  let stopped = false;
  const drain = scheduler.stopPeriodicScheduler().then(() => (stopped = true));
  await Promise.resolve();
  assert.equal(stopped, false);
  release([]);
  await job;
  await drain;
  assert.equal(stopped, true);
  const env = {
    ...process.env,
    DATA_DIR: temp,
    DB_PATH: path.join(temp, "database.sqlite"),
  };
  const write = spawnSync(
    process.execPath,
    [
      "-e",
      `const c=require('./lib/config');c.saveSettings({refreshIntervalHours:3});const n=require('./lib/notes');n.saveNoteToStorage({id:'restart-note',title:'Persist',content:'Keep after restart',packageName:'all',platform:'all',tags:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}).then(()=>{require('./lib/releases').saveReleasesToFile([{id:'r1',version:'1.0',packageName:'example.app'}]);require('./lib/db').db.close();})`,
    ],
    { cwd: path.join(__dirname, ".."), env, encoding: "utf8" },
  );
  assert.equal(write.status, 0, write.stderr);
  const read = spawnSync(
    process.execPath,
    [
      "-e",
      `(async()=>{const a=require('node:assert/strict');a.equal(require('./lib/config').getSettings().refreshIntervalHours,3);a.equal((await require('./lib/notes').getNotesFromStorage())[0].content,'Keep after restart');a.equal(require('./lib/releases').getReleasesFromFile()[0].id,'r1');require('./lib/db').db.close();})()`,
    ],
    { cwd: path.join(__dirname, ".."), env, encoding: "utf8" },
  );
  assert.equal(read.status, 0, read.stderr);
  fs.rmSync(temp, { recursive: true, force: true });
  const { dateRange } = require("../lib/portfolio");
  assert.throws(
    () => dateRange({ startDate: "2026-02-31", endDate: "2026-03-05" }),
    /INVALID/,
  );
  console.log(
    "PASS: two-app limiter, forced sync overlap lock, shutdown drain and database/notes/releases/settings persistence across processes.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
