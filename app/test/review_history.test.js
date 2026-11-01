const assert = require("node:assert/strict");
const { parseReviewCsv } = require("../lib/googleReviewHistory");
(async () => {
  const csv = "Package Name,Review Text,Star Rating,Review Submit Date and Time,Developer Reply Text,Review Link\n" +
    "com.example.app,Useful,5,2026-09-01T10:00:00Z,Thanks!,https://play.google.com/apps/publish/?dev_acc=123#ReviewPlace:id=old-review\n" +
    "com.example.app,Good app,4,invalid,Thank you,\n" +
    "com.other.app,Other app,1,2026-09-01,,\n";
  const rows = await parseReviewCsv(csv, "com.example.app");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "old-review");
  assert.equal(rows[0].replyText, "Thanks!");
  assert.equal(rows[0].canReply, true);
  assert.equal(rows[1].canReply, false);
  assert.equal(rows[1].date, null);
  console.log("PASS: historical Google CSV replies, owned package filtering, review links and read-only fallback without a review ID.");
})().catch(error => { console.error(error); process.exitCode = 1; });
