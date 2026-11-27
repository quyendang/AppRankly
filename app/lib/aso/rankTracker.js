const { db } = require("../db");
const { createLimiter } = require("../utils/concurrency");
const scraper = require("./scraper");
const markets = { us: "en", vn: "vi", gb: "en", jp: "ja", kr: "ko", de: "de", fr: "fr" };
const storeOf = (app) => (app.platform === "google" ? "play" : "apple");
const searchLimit = createLimiter(2);

// Legacy callers keep the strict behavior. Mobile keeps successful checks when an individual source fails.
async function checkRanks(app, country, { partial = false } = {}) {
  if (typeof country !== "string" || !Object.hasOwn(markets, country)) throw new Error("INVALID_MARKET");
  const language = markets[country], platform = storeOf(app);
  const selected = db.prepare(partial
    ? `SELECT k.id,k.term FROM aso_keyword k LEFT JOIN aso_rank_attempt a
      ON a.keyword_id=k.id AND a.country=?
      WHERE k.package_name=? AND k.platform=? AND k.tracked=1
      ORDER BY COALESCE(a.checked_at,(SELECT MAX(h.checked_at) FROM aso_rank_history h
        WHERE h.keyword_id=k.id AND h.store=k.platform AND h.country=?),'') ASC,k.id ASC LIMIT 20`
    : "SELECT id,term FROM aso_keyword WHERE package_name=? AND platform=? AND tracked=1 LIMIT 20"
  ).all(...(partial ? [country, app.packageName, platform, country] : [app.packageName, platform]));

  async function rank(kw) {
    try {
      const hits = app.platform === "google"
        ? await scraper.getPlaySearch(kw.term, 100, country, language, { strict: true })
        : await scraper.getAppleSearch(kw.term, country, 100, { strict: true });
      const index = hits.findIndex(x => (x.appId || x.bundleId) === app.packageName ||
        (app.appId != null && String(x.id) === String(app.appId)));
      return { keywordId: kw.id, term: kw.term, rank: index < 0 ? null : index + 1, country, language, topN: hits.length };
    } catch (error) {
      if (!partial || error.message !== "RANK_SOURCE_FAILED") throw error;
      return { keywordId: kw.id, failed: true };
    }
  }

  const checks = [];
  if (partial) checks.push(...await Promise.all(selected.map(kw => searchLimit(() => rank(kw)))));
  else for (const kw of selected) checks.push(await rank(kw));

  const ranks = [], failed = [];
  db.exec("BEGIN");
  try {
    const exists = db.prepare("SELECT 1 FROM aso_keyword WHERE id=? AND package_name=? AND platform=? AND tracked=1");
    const insert = db.prepare(`INSERT INTO aso_rank_history(keyword_id,package_name,platform,store,country,rank,top_n,checked_at,language)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(keyword_id,store,country,checked_at)
      DO UPDATE SET rank=excluded.rank,top_n=excluded.top_n,language=excluded.language`);
    const attempt = db.prepare(`INSERT INTO aso_rank_attempt(keyword_id,country,checked_at,failed) VALUES(?,?,?,?)
      ON CONFLICT(keyword_id,country) DO UPDATE SET checked_at=excluded.checked_at,failed=excluded.failed`);
    const checkedAt = new Date().toISOString();
    for (const r of checks) {
      // A keyword can be removed while its store check is running.
      if (!exists.get(r.keywordId, app.packageName, platform)) continue;
      attempt.run(r.keywordId, country, checkedAt, r.failed ? 1 : 0);
      if (r.failed) failed.push(r.keywordId);
      else {
        insert.run(r.keywordId, app.packageName, platform, platform, country, r.rank, r.topN, checkedAt, language);
        ranks.push(r);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ranks, country, language, source: "public_store_search", ...(partial ? { failed } : {}) };
}
module.exports = { checkRanks, markets, storeOf };
