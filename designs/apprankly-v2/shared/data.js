// Synthetic, fictional portfolio shared by both prototypes. Every name, number and review is invented.
// Shapes follow the AppRankly API (/api/portfolio, /api/aso/app/:id, /api/dimension, ...) so the flows are realistic.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DAY = 86400000;
export const TODAY = '2026-11-12';
export const iso = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d, n) => iso(Date.parse(d + 'T00:00:00Z') + n * DAY);
export const LAST = addDays(TODAY, -1);

export const RATES = { USD: 1, EUR: 1.0842, GBP: 1.2671, JPY: 0.00652, VND: 0.0000394, KRW: 0.000716 };
export const RATES_DATE = addDays(TODAY, -1);

export const APPS = [
  { id: 'luma-ios', name: 'Luma Notes', platform: 'apple', color: '#5B5BF0', glyph: 'note', category: 'Productivity', store: 'studio.luma.notes', base: 420, trend: 0.004, rating: 4.8, ratings: 12480, rpi: 0.14, mix: { USD: 0.58, EUR: 0.24, GBP: 0.18 }, lag: 0,
    countries: [['US', 34], ['VN', 18], ['GB', 11], ['DE', 9], ['JP', 8], ['FR', 6], ['CA', 5], ['AU', 4]],
    versions: [['2.6.0', -64], ['2.7.0', -38], ['2.7.1', -27], ['2.8.0', -9]] },
  { id: 'habit-android', name: 'Habit Garden', platform: 'google', color: '#16A34A', glyph: 'leaf', category: 'Health & Fitness', store: 'studio.example.habitgarden', base: 300, trend: 0.003, rating: 4.7, ratings: 8630, rpi: 0.09, mix: { USD: 0.5, VND: 0.3, EUR: 0.2 }, lag: 0, revenueStatus: 'available',
    countries: [['VN', 29], ['US', 21], ['IN', 14], ['ID', 10], ['BR', 8], ['DE', 6], ['PH', 6], ['MX', 6]],
    versions: [['1.5.4', -70], ['1.6.0', -41], ['1.6.2', -16]] },
  { id: 'tide-ios', name: 'Tide Timer', platform: 'apple', color: '#0EA5E9', glyph: 'wave', category: 'Productivity', store: 'studio.tide.timer', base: 210, trend: -0.002, rating: 4.6, ratings: 4210, rpi: 0.2, mix: { USD: 0.7, GBP: 0.3 }, lag: 2,
    countries: [['US', 41], ['GB', 19], ['CA', 9], ['AU', 9], ['DE', 8], ['NL', 6], ['SE', 4], ['VN', 4]],
    versions: [['3.0.0', -80], ['3.1.0', -33]] },
  { id: 'scan-android', name: 'Pocket Scan', platform: 'google', color: '#F97316', glyph: 'scan', category: 'Business', store: 'studio.example.pocketscan', base: 170, trend: 0.006, rating: 4.5, ratings: 3180, rpi: 0.07, mix: { USD: 0.6, EUR: 0.4 }, lag: 0, revenueStatus: 'partial',
    countries: [['US', 26], ['IN', 18], ['BR', 12], ['DE', 10], ['VN', 9], ['FR', 9], ['ES', 8], ['IT', 8]],
    versions: [['1.8.0', -55], ['1.9.0', -12]] },
  { id: 'budget-ios', name: 'Sora Budget', platform: 'apple', color: '#E11D74', glyph: 'coin', category: 'Finance', store: 'studio.sora.budget', base: 120, trend: 0.001, rating: 4.4, ratings: 2290, rpi: 0.31, mix: { JPY: 0.55, USD: 0.3, KRW: 0.15 }, lag: 0,
    countries: [['JP', 44], ['US', 19], ['KR', 14], ['TW', 8], ['VN', 6], ['SG', 5], ['HK', 4]],
    versions: [['4.2.0', -47], ['4.3.0', -20]] },
  { id: 'kanji-android', name: 'Kanji Drop', platform: 'google', color: '#8B5CF6', glyph: 'kanji', category: 'Education', store: 'studio.example.kanjidrop', base: 95, trend: 0.008, rating: 4.8, ratings: 1560, rpi: 0.05, mix: { USD: 1 }, lag: 1, revenueStatus: 'unavailable',
    countries: [['VN', 24], ['US', 20], ['ID', 14], ['TH', 12], ['BR', 10], ['PH', 10], ['FR', 10]],
    versions: [['0.9.0', -60], ['1.0.0', -24]] },
  { id: 'cardio-ios', name: 'CardioLoop', platform: 'apple', color: '#EF4444', glyph: 'pulse', category: 'Health & Fitness', store: 'studio.cardio.loop', base: 60, trend: -0.006, rating: 4.2, ratings: 980, rpi: 0.42, mix: { USD: 0.8, EUR: 0.2 }, lag: 0,
    countries: [['US', 48], ['DE', 14], ['GB', 12], ['CA', 10], ['AU', 8], ['FR', 8]],
    versions: [['5.0.0', -66], ['5.1.0', -30], ['5.1.1', -5]] },
  { id: 'maple-android', name: 'Mapleaf Reader', platform: 'google', color: '#B45309', glyph: 'book', category: 'Books & Reference', store: 'com.example.mapleaf', base: 80, trend: 0.002, rating: 4.3, ratings: 740, rpi: 0.06, mix: { USD: 1 }, lag: 0, revenueStatus: 'unavailable', sourceError: true,
    countries: [['US', 30], ['GB', 20], ['IN', 20], ['CA', 15], ['AU', 15]],
    versions: [['2.0.0', -50]] },
];

// 180 days of daily installs + revenue (USD) per app, deterministic.
const SPAN = 180;
export const TIMELINE = {};
APPS.forEach((app, ai) => {
  const r = rng(1000 + ai * 77);
  const releaseDays = new Map(app.versions.map(([v, off]) => [addDays(TODAY, off), v]));
  let bump = 0;
  const rows = [];
  for (let i = SPAN; i >= 1; i--) {
    const d = addDays(TODAY, -i);
    const t = SPAN - i;
    if (releaseDays.has(d)) bump = 0.22 + r() * 0.18;
    bump *= 0.9;
    const dow = new Date(d + 'T12:00:00Z').getUTCDay();
    const weekly = dow === 0 || dow === 6 ? 1.12 : dow === 3 ? 0.94 : 1;
    const level = app.base * Math.exp(app.trend * (t - SPAN)) * (1 + 0.08 * Math.sin(t / 11 + ai));
    const installs = Math.max(1, Math.round(level * weekly * (1 + bump) * (0.86 + r() * 0.28)));
    const usd = installs * app.rpi * (0.75 + r() * 0.5);
    rows.push({ date: d, installs, usd });
  }
  // Recent dip for CardioLoop and a spike for Kanji Drop so insights have something real to point at.
  if (app.id === 'cardio-ios') rows.slice(-2).forEach((x) => { x.installs = Math.round(x.installs * 0.52); x.usd *= 0.5; });
  if (app.id === 'kanji-android') rows.slice(-1).forEach((x) => { x.installs = Math.round(x.installs * 1.9); });
  TIMELINE[app.id] = rows;
});

const LISTINGS = {
  'luma-ios': ['Luma Notes: Quick Journal', 'Notes, lists & daily journal', 'Capture ideas in a second. Luma Notes keeps your notes, lists and a daily journal in one calm place, synced across iPhone, iPad and Mac. Widgets, tags and offline search included.'],
  'habit-android': ['Habit Garden – Habit Tracker', 'Grow habits like plants', 'Build routines that stick. Every habit you keep grows a plant in your garden. Reminders, streaks, statistics and a home-screen widget. No account required.'],
  'tide-ios': ['Tide Timer – Focus & Pomodoro', 'Calm focus sessions', 'Work in tides: focused sessions followed by gentle breaks. Live Activities, Focus filters and session history. Designed for deep work and study.'],
  'scan-android': ['Pocket Scan – PDF Scanner', 'Scan documents to PDF', 'Turn paper into clean PDFs. Automatic edge detection, OCR in 40 languages, signatures and quick sharing. Works offline.'],
  'budget-ios': ['Sora Budget – 家計簿', 'Simple budget & expenses', 'A quiet budget app. Track expenses in seconds, set monthly envelopes and see where your money goes. Supports JPY, KRW, USD and more.'],
  'kanji-android': ['Kanji Drop – Learn Japanese', 'JLPT kanji in 5 minutes a day', 'Learn kanji with falling-tile puzzles. JLPT N5 to N1 decks, stroke order, spaced repetition and offline mode.'],
  'cardio-ios': ['CardioLoop – Heart Zones', 'Heart-rate zone training', 'Train in the right zone. CardioLoop reads Apple Watch heart rate and guides intervals with haptics. Weekly load, recovery and trends.'],
  'maple-android': ['Mapleaf Reader', 'EPUB & PDF reader', 'A clean reader for EPUB and PDF with themes, highlights and notes export.'],
};
const KEYWORDS = {
  'luma-ios': [['notes', { us: 38, vn: 7, gb: 44 }], ['journal app', { us: 21, vn: 4, gb: 19 }], ['quick notes', { us: 9, vn: 2, gb: 12 }], ['daily journal', { us: 14, vn: 3, gb: 17 }], ['todo list', { us: null, vn: 31, gb: null }]],
  'habit-android': [['habit tracker', { us: 17, vn: 3 }], ['routine planner', { us: 33, vn: 8 }], ['streak', { us: 52, vn: 12 }]],
  'tide-ios': [['pomodoro', { us: 26, gb: 18 }], ['focus timer', { us: 11, gb: 9 }], ['study timer', { us: 40, gb: 35 }]],
  'scan-android': [['pdf scanner', { us: 46, vn: 15 }], ['document scanner', { us: 58, vn: 21 }], ['ocr', { us: null, vn: 44 }]],
  'budget-ios': [['budget', { us: 72, jp: 14 }], ['家計簿', { jp: 9 }], ['expense tracker', { us: 64, jp: 22 }]],
  'kanji-android': [['kanji', { us: 8, vn: 2 }], ['jlpt', { us: 12, vn: 5 }], ['learn japanese', { us: 39, vn: 9 }]],
  'cardio-ios': [['heart rate zones', { us: 7, gb: 6 }], ['zone 2', { us: 15, gb: 11 }], ['cardio', { us: 61, gb: 48 }]],
  'maple-android': [['epub reader', { us: 70 }]],
};
const REVIEW_POOL = [
  ['vi', 5, 'Ứng dụng rất mượt, widget tiện. Mong có thêm chế độ khoá bằng Face ID.'],
  ['vi', 2, 'Bản cập nhật mới hay bị đồng bộ chậm, mất ghi chú hôm qua.'],
  ['en', 5, 'Exactly what I needed. Clean, fast, and the widget is great.'],
  ['en', 3, 'Good app but the subscription price is a bit high for what it does.'],
  ['en', 1, 'Crashes every time I open it after the last update. Please fix.'],
  ['en', 4, 'Love it. Would be perfect with a dark icon option.'],
  ['ja', 5, 'シンプルで使いやすいです。毎日使っています。'],
  ['ja', 2, '最新バージョンで同期が遅くなりました。'],
  ['de', 4, 'Sehr gute App, aber die Benachrichtigungen kommen manchmal zu spät.'],
  ['en', 5, 'Five stars. The new design in this version is lovely.'],
  ['vi', 4, 'Dùng ổn, giao diện đẹp. Nên thêm xuất file CSV.'],
  ['en', 2, 'Lost my streak because reminders did not fire on Android 15.'],
];
const NAMES = ['Minh Anh', 'Jordan P.', 'Hana', 'Lukas', 'Thảo Vy', 'Priya', 'Kenji', 'Sam R.', 'Linh', 'Alex', 'Marta', 'Quốc Bảo', 'Yuki', 'Chris'];

function build() {
  const db = { listings: {}, keywords: [], ranks: [], competitors: [], reviews: {}, campaigns: [], events: [], templates: [], seq: 1000 };
  APPS.forEach((app, ai) => {
    const r = rng(500 + ai);
    const [title, subtitle, description] = LISTINGS[app.id];
    db.listings[app.id] = { title, subtitle, description };
    KEYWORDS[app.id].forEach(([term, ranks], ki) => {
      const kid = app.id + ':k' + ki;
      db.keywords.push({ id: kid, appId: app.id, term });
      Object.entries(ranks).forEach(([country, rank]) => {
        const hist = [];
        let cur = rank == null ? 100 + Math.round(r() * 20) : rank;
        // History walks backwards from today's rank. One keyword per app recently dropped.
        const dropped = ki === 1 && country === 'us';
        for (let i = 0; i < 30; i++) {
          const d = addDays(TODAY, -1 - i);
          hist.unshift({ date: d, rank: cur > 100 ? null : cur });
          const drift = dropped && i < 4 ? -2 - Math.round(r() * 2) : Math.round((r() - 0.5) * 4);
          cur = Math.max(1, cur + drift);
        }
        db.ranks.push({ keywordId: kid, country, rank, top_n: 100, checked_at: addDays(TODAY, -1) + 'T06:00:00Z', history: hist });
      });
    });
    db.competitors.push(
      { id: app.id + ':c1', appId: app.id, competitor_key: 'trk', title: ['Notely', 'Streaks Pro', 'FocusFlow', 'ScanIt', 'Moneyful', 'KanjiKing', 'ZoneCoach', 'ReadEra Lite'][ai], score: 4.6 },
      { id: app.id + ':c2', appId: app.id, competitor_key: 'trk', title: ['Bear Pad', 'Rootine', 'Pomo Bloom', 'DocSnap', 'Yen Log', 'NihonGo!', 'PulseFit', 'Pageturn'][ai], score: 4.3 },
    );
    const count = app.sourceError ? 4 : 7 + Math.round(r() * 6);
    db.reviews[app.id] = Array.from({ length: count }, (_, i) => {
      const [lang, rating, text] = REVIEW_POOL[(ai * 5 + i * 3) % REVIEW_POOL.length];
      const replied = i % 3 === 2 || (i > 6 && i % 2 === 0);
      return {
        id: app.id + ':r' + i, author: NAMES[(ai + i * 5) % NAMES.length], rating, text, lang,
        date: addDays(TODAY, -1 - Math.round(i * 2.3 + r() * 2)),
        replyText: replied ? (lang === 'vi' ? 'Cảm ơn bạn đã góp ý! Chúng tôi đang xử lý vấn đề này trong bản tới.' : 'Thanks for the feedback! We are working on this for the next update.') : '',
        replyDate: replied ? addDays(TODAY, -1 - i) : null,
        canReply: !(app.platform === 'google' && i === count - 1),
        version: app.versions.at(-1)[0],
      };
    });
    if (ai < 4) db.campaigns.push({ id: db.seq++, appId: app.id, name: ['Launch tweet', 'Newsletter Oct', 'Reddit post', 'Product Hunt'][ai], source: ['x', 'email', 'reddit', 'producthunt'][ai], slug: 'c' + (ai + 11), clicks: 40 + Math.round(r() * 900) });
    app.versions.forEach(([v, off]) => db.events.push({ id: db.seq++, appId: app.id, date: addDays(TODAY, off), type: 'release', label: 'v' + v, source: 'auto' }));
  });
  db.events.push({ id: db.seq++, appId: 'luma-ios', date: addDays(TODAY, -19), type: 'manual', label: 'Featured in “Apps we love”', source: 'manual' });
  db.events.push({ id: db.seq++, appId: 'luma-ios', date: addDays(TODAY, -44), type: 'campaign', label: 'Launch tweet', source: 'auto' });
  db.templates.push(
    { id: 1, name: 'Cảm ơn (5★)', body: 'Cảm ơn {name} đã dành {rating} sao cho {app}! Chúc bạn một ngày tốt lành.' },
    { id: 2, name: 'Bug follow-up', body: 'Hi {name}, sorry about this. We fixed it in the latest {app} update — could you try again and let us know?' },
  );
  return db;
}

export function freshDB() { return build(); }

export const DEFAULT_SETTINGS = {
  refreshIntervalHours: 6, timezone: 'Asia/Ho_Chi_Minh', notificationsEnabled: false,
  digest: 'weekly', digestHour: 8, digestLocale: 'vi', anomalyThreshold: 30, googlePackages: ['com.example.mapleaf'],
};
export const INTEGRATIONS = {
  google: { configured: true }, apple: { configured: true },
  ai: { defaultProvider: 'OpenAI-compatible', providers: [{ name: 'openai', available: true }] },
  notifications: { configured: true },
};
export const NOTIFICATIONS = [
  { id: 1, title: 'CardioLoop', message: 'Installs fell 48% vs 7-day average.', timestamp: addDays(TODAY, -1) + 'T07:10:00Z', read: false },
  { id: 2, title: 'Weekly digest', message: '8 apps · 41,9k installs · +6.2% week over week.', timestamp: addDays(TODAY, -3) + 'T01:00:00Z', read: false },
  { id: 3, title: 'Mapleaf Reader', message: 'Google Play report download failed (HTTP 403).', timestamp: addDays(TODAY, -4) + 'T03:00:00Z', read: true },
];
