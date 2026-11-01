const assert = require("node:assert/strict");
const gplayModule = require("google-play-scraper"),
  gplay = gplayModule.default || gplayModule;
const axios = require("axios");
const scraper = require("../lib/aso/scraper");
(async () => {
  const play = gplay.search,
    get = axios.get;
  try {
    gplay.search = async () => {
      throw new Error("Synthetic store failure");
    };
    axios.get = async () => {
      throw new Error("Synthetic store failure");
    };
    await assert.rejects(
      scraper.getPlaySearch("test", 100, "vn", "vi", { strict: true }),
      /RANK_SOURCE_FAILED/,
    );
    await assert.rejects(
      scraper.getAppleSearch("test", "vn", 100, { strict: true }),
      /RANK_SOURCE_FAILED/,
    );
    gplay.search = async ({ country, lang }) => {
      assert.equal(country, "vn");
      assert.equal(lang, "vi");
      return [];
    };
    assert.deepEqual(
      await scraper.getPlaySearch("test", 100, "vn", "vi", { strict: true }),
      [],
    );
    console.log(
      "PASS: strict public-search errors differ from valid empty results; Google market parameters are forwarded.",
    );
  } finally {
    gplay.search = play;
    axios.get = get;
    require("../lib/db").db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
