const { db } = require("../db");
const { redact } = require("../runtime");
const { storeOf, markets } = require("./rankTracker");

const MAX_TERM_LENGTH = 80;

function market(country = "us") {
  if (typeof country !== "string" || !Object.hasOwn(markets, country)) throw new Error("INVALID_MARKET");
  return { country, language: markets[country] };
}

function terms(app) {
  return db.prepare(`SELECT id,term,source,added_at FROM aso_keyword
    WHERE package_name=? AND platform=? AND tracked=1 ORDER BY added_at DESC,id DESC`)
    .all(app.packageName, storeOf(app));
}

function keyword(app, id) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("INVALID_KEYWORD");
  const row = db.prepare("SELECT id,term,source,added_at FROM aso_keyword WHERE id=? AND package_name=? AND platform=? AND tracked=1")
    .get(id, app.packageName, storeOf(app));
  if (!row) throw new Error("KEYWORD_NOT_FOUND");
  return row;
}

function track(app, values, source = "manual") {
  if (!Array.isArray(values) || !values.length || values.length > 25) throw new Error("INVALID_KEYWORD");
  const clean = new Map();
  for (const raw of values) {
    const term = typeof raw === "string" ? raw.trim() : "";
    if (!term || term.length > MAX_TERM_LENGTH || redact(term) !== term) throw new Error("INVALID_KEYWORD");
    const key = term.toLowerCase();
    if (!clean.has(key)) clean.set(key, term);
  }
  const insert = db.prepare(`INSERT INTO aso_keyword(package_name,platform,term,normalized,source,tracked,added_at)
    VALUES(?,?,?,?,?,1,datetime('now')) ON CONFLICT(package_name,platform,normalized) DO UPDATE SET tracked=1`);
  db.exec("BEGIN");
  try {
    for (const [key, term] of clean) insert.run(app.packageName, storeOf(app), term, key, source);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return clean.size;
}

function remove(app, id) {
  keyword(app, id);
  db.prepare("DELETE FROM aso_keyword WHERE id=? AND package_name=? AND platform=?").run(id, app.packageName, storeOf(app));
}

function list(app, country) {
  const platform = storeOf(app);
  return db.prepare(`SELECT k.id,k.term,k.source,k.added_at,h.rank,h.top_n,h.checked_at,
    a.checked_at AS attempted_at, a.failed
    FROM aso_keyword k
    LEFT JOIN aso_rank_history h ON h.keyword_id=k.id AND h.store=? AND h.country=? AND h.checked_at=(
      SELECT MAX(r.checked_at) FROM aso_rank_history r WHERE r.keyword_id=k.id AND r.store=? AND r.country=?
    )
    LEFT JOIN aso_rank_attempt a ON a.keyword_id=k.id AND a.country=?
    WHERE k.package_name=? AND k.platform=? AND k.tracked=1 ORDER BY k.added_at DESC,k.id DESC`)
    .all(platform, country, platform, country, country, app.packageName, platform)
    .map(row => ({
      id: row.id, term: row.term, source: row.source, addedAt: row.added_at,
      rank: row.rank, topN: row.top_n, checkedAt: row.checked_at, attemptedAt: row.attempted_at,
      status: row.failed && (!row.checked_at || row.attempted_at >= row.checked_at) ? "source_failed"
        : !row.checked_at ? "unchecked" : row.rank !== null ? "ranked" : row.top_n > 0 ? "outside" : "no_results",
    }));
}

function history(app, id, country) {
  const target = keyword(app, id);
  const platform = storeOf(app);
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const rows = db.prepare(`SELECT rank,top_n,checked_at FROM aso_rank_history
    WHERE keyword_id=? AND store=? AND country=? AND package_name=? AND platform=? AND checked_at>=?
    ORDER BY checked_at`).all(target.id, platform, country, app.packageName, platform, since);
  // Multiple manual checks that day still represent one point in the chart.
  const days = new Map();
  for (const row of rows) {
    const date = row.checked_at.slice(0, 10);
    days.set(date, { date, rank: row.rank, topN: row.top_n, checkedAt: row.checked_at });
  }
  return { id: target.id, term: target.term, points: [...days.values()] };
}

module.exports = { MAX_TERM_LENGTH, market, terms, keyword, track, remove, list, history };
