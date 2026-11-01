const { db } = require("../db");
const scraper = require("./scraper");
const markets = { us: "en", vn: "vi", gb: "en", jp: "ja", kr: "ko", de: "de", fr: "fr" };
const storeOf = (app) => (app.platform === "google" ? "play" : "apple");
// Checks every tracked keyword of one app in one market and appends to aso_rank_history.
async function checkRanks(app, country) {
  const language = markets[country];
  if (!language) throw new Error("INVALID_MARKET");
  const platform = storeOf(app);
  const keywords = db
    .prepare("SELECT * FROM aso_keyword WHERE package_name=? AND platform=? AND tracked=1 LIMIT 20")
    .all(app.packageName, platform);
  const ranks = [];
  for (const kw of keywords) {
    const hits =
      app.platform === "google"
        ? await scraper.getPlaySearch(kw.term, 100, country, language, { strict: true })
        : await scraper.getAppleSearch(kw.term, country, 100, { strict: true });
    const idx = hits.findIndex(
      (x) =>
        (x.appId || x.bundleId) === app.packageName ||
        (app.appId != null && String(x.id) === String(app.appId)),
    );
    ranks.push({ keywordId: kw.id, term: kw.term, rank: idx < 0 ? null : idx + 1, country, language, topN: hits.length });
  }
  db.exec("BEGIN");
  try {
    const insert = db.prepare(
      `INSERT INTO aso_rank_history(keyword_id,package_name,platform,store,country,rank,top_n,checked_at,language) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(keyword_id,store,country,checked_at) DO UPDATE SET rank=excluded.rank,top_n=excluded.top_n,language=excluded.language`,
    );
    const checkedAt = new Date().toISOString();
    for (const r of ranks)
      insert.run(r.keywordId, app.packageName, platform, platform, country, r.rank, r.topN, checkedAt, language);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ranks, country, language, source: "public_store_search" };
}
module.exports = { checkRanks, markets, storeOf };
