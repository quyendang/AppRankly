const { db } = require("./db");
const { getSettings } = require("./config");
const { listApps, appStats } = require("./portfolio");
const { broadcastAlert } = require("./notifier");
const { redact } = require("./runtime");
const { checkRanks } = require("./aso/rankTracker");

const DAY = 86400000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const sum = (list) => list.reduce((a, b) => a + b, 0);
const money = (v) => (Math.round(v * 100) / 100).toLocaleString("en-US");
const strings = {
  vi: { daily: "Bản tin hằng ngày", weekly: "Bản tin hằng tuần", installs: "lượt cài", revenue: "doanh thu",
    alerts: "Cảnh báo", reviews: "Đánh giá mới", unanswered: "chưa trả lời", ranks: "Từ khóa đổi hạng",
    none: "Chưa có dữ liệu", up: "tăng", down: "giảm", vs: "so với", nodata: "không có báo cáo",
    rankLine: (t, c, a, b) => `${t} (${c.toUpperCase()}): ${a} → ${b}`, out: ">100" },
  en: { daily: "Daily digest", weekly: "Weekly digest", installs: "installs", revenue: "revenue",
    alerts: "Alerts", reviews: "New reviews", unanswered: "unanswered", ranks: "Keyword movers",
    none: "No data yet", up: "up", down: "down", vs: "vs", nodata: "no report",
    rankLine: (t, c, a, b) => `${t} (${c.toUpperCase()}): ${a} → ${b}`, out: ">100" },
};
const str = (locale) => strings[locale] || strings.vi;

// Latest value against the mean of the previous 7 values; null when too little signal.
function detectSeriesAnomaly(values, { threshold = 30, minBaseline = 10 } = {}) {
  const latest = values.at(-1);
  const base = values.slice(-8, -1).filter(Number.isFinite);
  if (!Number.isFinite(latest) || base.length < 3) return null;
  const avg = sum(base) / base.length;
  if (avg < minBaseline) return null;
  const change = (latest / avg - 1) * 100;
  return Math.abs(change) >= threshold ? { latest, avg, change } : null;
}
function appAnomalies(app, trends, threshold) {
  const days = trends.filter((d) => d.date);
  if (!days.length) return [];
  const date = days.at(-1).date, found = [];
  const push = (kind, hit, extra = {}) =>
    hit && found.push({ appId: app.id, name: app.name, platform: app.platform, kind, date,
      direction: hit.change > 0 ? "up" : "down", change: hit.change, latest: hit.latest, avg: hit.avg,
      key: [app.id, kind, extra.currency || "", date].join("|"), ...extra });
  push("installs", detectSeriesAnomaly(days.map((d) => d.installs), { threshold, minBaseline: 10 }));
  const currencies = new Set(days.flatMap((d) => Object.keys(d.revenueByCurrency || {})));
  for (const currency of currencies)
    push("revenue", detectSeriesAnomaly(days.map((d) => d.revenueByCurrency?.[currency] ?? 0), { threshold, minBaseline: 1 }), { currency });
  return found;
}
// Rank history rows (newest first per keyword+market) -> moves between the last two checks.
function rankMoves(rows, minMove = 10) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.keyword_id + ":" + r.country;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const moves = [];
  for (const [, [cur, prev]] of groups) {
    if (!prev || (cur.rank == null && prev.rank == null)) continue;
    const move = (prev.rank ?? 101) - (cur.rank ?? 101);
    if (Math.abs(move) >= minMove)
      moves.push({ keywordId: cur.keyword_id, term: cur.term, country: cur.country, from: prev.rank, to: cur.rank, move, date: cur.checked_at.slice(0, 10) });
  }
  return moves;
}
function appRankMoves(app) {
  const rows = db.prepare(
    `SELECT r.keyword_id,k.term,r.country,r.rank,r.checked_at FROM aso_rank_history r JOIN aso_keyword k ON k.id=r.keyword_id
     WHERE r.package_name=? AND r.platform=? ORDER BY r.keyword_id,r.country,r.checked_at DESC`,
  ).all(app.packageName, app.platform === "google" ? "play" : "apple");
  return rankMoves(rows);
}
function localParts(now, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday };
}
function digestDue(settings, parts, lastSent) {
  if (settings.digest === "off" || parts.hour < settings.digestHour || lastSent === parts.date) return false;
  return settings.digest === "daily" || parts.weekday === "Mon";
}
const getState = (key) => db.prepare("SELECT value FROM insight_state WHERE key=?").get(key)?.value;
const setState = (key, value) => db.prepare(
  "INSERT INTO insight_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')").run(key, String(value));

async function statsFor(app, days) {
  const end = isoDay(Date.now() - DAY);
  return appStats(app, { startDate: isoDay(Date.now() - days * DAY), endDate: end });
}
async function collectAnomalies() {
  const threshold = getSettings().anomalyThreshold, list = [];
  const { apps } = await listApps();
  for (const app of apps) {
    try {
      list.push(...appAnomalies(app, (await statsFor(app, 16)).dailyTrends, threshold));
    } catch { /* app without reports yet */ }
    for (const m of appRankMoves(app))
      list.push({ appId: app.id, name: app.name, platform: app.platform, kind: "rank", date: m.date,
        direction: m.move > 0 ? "up" : "down", change: m.move, term: m.term, country: m.country, from: m.from, to: m.to,
        key: [app.id, "rank", m.keywordId, m.country, m.date].join("|") });
  }
  return list;
}
function describe(a, locale) {
  const s = str(locale), dir = a.direction === "up" ? "▲" : "▼";
  if (a.kind === "rank") return `${dir} ${a.name}: ${s.rankLine(a.term, a.country, a.from ?? s.out, a.to ?? s.out)}`;
  const what = a.kind === "installs" ? s.installs : `${s.revenue} ${a.currency}`;
  return `${dir} ${a.name}: ${what} ${Math.round(a.change)}% ${s.vs} 7d (${money(a.latest)} / ${money(a.avg)})`;
}
function usdTotal(byCurrency, rates) {
  let total = 0;
  for (const [c, v] of Object.entries(byCurrency)) {
    if (!v) continue;
    const rate = c === "USD" ? 1 : rates?.[c]?.rate;
    if (!rate) return null;
    total += v * rate;
  }
  return total;
}
const sumCurrencies = (days) => days.reduce((acc, d) => {
  for (const [c, v] of Object.entries(d.revenueByCurrency || {})) acc[c] = (acc[c] || 0) + v;
  return acc;
}, {});
const pct = (a, b) => (b > 0 ? ` (${a >= b ? "+" : ""}${Math.round((a / b - 1) * 100)}%)` : "");

async function buildDigest(period = "daily") {
  const settings = getSettings(), s = str(settings.digestLocale), n = period === "weekly" ? 7 : 1;
  const rates = (await require("./exchangeRates").getExchangeRates().catch(() => null))?.rates;
  const { apps } = await listApps(), lines = [], anomalies = [];
  let totalInstalls = 0, hasInstalls = false;
  for (const app of apps) {
    let stats;
    try { stats = await statsFor(app, 2 * n + 1); } catch { lines.push(`• ${app.name}: ${s.nodata}`); continue; }
    const days = stats.dailyTrends;
    const cur = days.slice(-n), prev = days.slice(-2 * n, -n);
    const installs = sum(cur.map((d) => d.installs || 0)), before = sum(prev.map((d) => d.installs || 0));
    const rev = sumCurrencies(cur), usd = usdTotal(rev, rates);
    const revText = usd != null ? `${money(usd)} USD` : Object.entries(rev).map(([c, v]) => `${money(v)} ${c}`).join(" · ") || "0";
    totalInstalls += installs; hasInstalls = true;
    lines.push(`• ${app.name}: ${money(installs)} ${s.installs}${pct(installs, before)} · ${s.revenue} ${revText}`);
    anomalies.push(...appAnomalies(app, days, settings.anomalyThreshold));
  }
  const since = new Date(Date.now() - n * DAY).toISOString();
  const archive = db.prepare("SELECT payload FROM review_archive").all().map((r) => JSON.parse(r.payload));
  const fresh = archive.filter((r) => r.date && r.date >= since);
  const open = archive.filter((r) => !r.replyText && r.canReply).length;
  const avg = fresh.length ? sum(fresh.map((r) => r.rating || 0)) / fresh.length : null;
  const moves = apps.flatMap((app) => appRankMoves(app).map((m) => ({ app, m })))
    .sort((a, b) => Math.abs(b.m.move) - Math.abs(a.m.move)).slice(0, 5);
  const parts = [lines.join("\n") || s.none];
  if (anomalies.length) parts.push(`${s.alerts}:\n` + anomalies.map((a) => describe(a, settings.digestLocale)).join("\n"));
  parts.push(`${s.reviews}: ${fresh.length}${avg != null ? ` (${avg.toFixed(1)}★)` : ""} · ${open} ${s.unanswered}`);
  if (moves.length) parts.push(`${s.ranks}:\n` + moves.map(({ app, m }) => describe({ ...m, kind: "rank", name: app.name, direction: m.move > 0 ? "up" : "down" }, settings.digestLocale)).join("\n"));
  return { period, title: `AppRankly · ${s[period]} · ${isoDay(Date.now() - DAY)}`, message: parts.join("\n\n"), totalInstalls: hasInstalls ? totalInstalls : null };
}

function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || "") && !isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
function addEvent(app, date, label) {
  label = String(label || "").trim();
  if (!validDate(date) || !label || label.length > 80 || redact(label) !== label) throw new Error("INVALID_EVENT");
  db.prepare("INSERT OR IGNORE INTO app_event(app_id,date,type,label,source) VALUES(?,?, 'custom',?, 'manual')").run(app.id, date, label);
  return db.prepare("SELECT id,date,type,label,source FROM app_event WHERE app_id=? AND date=? AND type='custom' AND label=?").get(app.id, date, label);
}
async function listEvents(app) {
  const events = db.prepare("SELECT id,date,type,label,source FROM app_event WHERE app_id=?").all(app.id);
  try {
    for (const r of require("./releases").getReleasesFromFile())
      if (r.packageName === app.packageName && r.platform === app.platform && (r.date || r.releaseDate))
        events.push({ id: "r-" + r.id, date: r.date || r.releaseDate, type: "release", label: "v" + r.version, source: "file" });
  } catch { /* releases file is optional */ }
  for (const c of require("./aso/campaignLinks").getCampaignLinks(app.packageName) || [])
    if (c.created_at) events.push({ id: "c-" + c.id, date: c.created_at.slice(0, 10), type: "campaign", label: c.name, source: "campaign" });
  return events.sort((a, b) => a.date.localeCompare(b.date));
}
function trackVersions(apps) {
  for (const app of apps) {
    if (!app.version) continue;
    const key = "version:" + app.id, prev = getState(key);
    if (prev && prev !== app.version)
      db.prepare("INSERT OR IGNORE INTO app_event(app_id,date,type,label,source) VALUES(?,?, 'release',?, 'auto')").run(app.id, isoDay(Date.now()), "v" + app.version);
    setState(key, app.version);
  }
}
async function refreshRanks(apps, today) {
  if (getState("ranks:lastRun") === today) return;
  setState("ranks:lastRun", today);
  for (const app of apps) {
    const store = app.platform === "google" ? "play" : "apple";
    const countries = db.prepare("SELECT DISTINCT country FROM aso_rank_history WHERE package_name=? AND platform=?").all(app.packageName, store).map((r) => r.country);
    for (const country of countries.length ? countries : ["us"])
      await checkRanks(app, country).catch((e) => console.warn("[Insights] rank check failed:", e.message));
  }
}
// Called after every scheduler tick; each step is independent and idempotent.
async function runScheduled(now = new Date()) {
  if (!db) return;
  const settings = getSettings(), parts = localParts(now, settings.timezone);
  const { apps } = await listApps();
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.warn(`[Insights] ${name} failed:`, e.message); } };
  await step("versions", () => trackVersions(apps));
  await step("ranks", () => refreshRanks(apps, parts.date));
  await step("alerts", async () => {
    for (const a of await collectAnomalies()) {
      const key = "alert:" + a.key;
      if (getState(key)) continue;
      setState(key, "1");
      await broadcastAlert({ title: `AppRankly · ${a.kind}`, message: describe(a, settings.digestLocale), priority: a.direction === "down" ? "high" : "normal" });
    }
  });
  await step("digest", async () => {
    if (!digestDue(settings, parts, getState("digest:lastSent"))) return;
    setState("digest:lastSent", parts.date);
    const digest = await buildDigest(settings.digest);
    await broadcastAlert({ title: digest.title, message: digest.message });
  });
}
module.exports = { detectSeriesAnomaly, appAnomalies, rankMoves, localParts, digestDue, buildDigest, collectAnomalies,
  addEvent, listEvents, runScheduled };
