const assert = require("node:assert/strict");
const fs = require("node:fs");
const main = require("../lib/scraper");
const fixture = {
  title: "Public fixture",
  subtitle: "Turn Reels into Itineraries",
  description: "Public listing text",
  developer: "Synthetic studio",
};
fs.writeFileSync(
  main.PLAYSTORE_CACHE_FILE,
  JSON.stringify({ "example.public": { data: fixture } }),
);
fs.writeFileSync(
  main.APPSTORE_CACHE_FILE,
  JSON.stringify({ "example.public": { data: fixture } }),
);
(async () => {
  assert.equal(
    main.getCachedStoreData("example.public", "google").title,
    fixture.title,
  );
  assert.equal(main.getCachedStoreData("example.missing", "apple"), null);
  const apple =
    await require("../lib/aso/scraper").getAppleLookup("example.public");
  assert.equal(apple.subtitle, fixture.subtitle);
  const prompt = require("../lib/ai/prompts").buildAuditUserPrompt({
    platform: "apple",
    metadata: apple,
    packageName: "example.public",
  });
  assert.ok(
    prompt.includes("Turn Reels into Itineraries [Length: 27/30 characters]"),
  );
  const { withTimeout } = require("../lib/utils/timeout");
  assert.equal(await withTimeout(Promise.resolve("ok"), 100), "ok");
  await assert.rejects(
    withTimeout(new Promise((r) => setTimeout(r, 30)), 5, "Synthetic timeout"),
    /Synthetic timeout/,
  );
  require("../lib/db").db.close();
  console.log(
    "PASS: public store cache and subtitle fallback, bounded scraper timeout; no live store or AI calls.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
