# AppRankly v2 · two new prototypes

Two interactive prototypes built from scratch. They reuse no layout, color, or component from `designs/apprankly-redesign/` or `app/frontend`. Both cover every function the current app has, use one synthetic dataset, and run against a mock API whose latency you can change.

```sh
python3 -m http.server 4320 --bind 127.0.0.1 --directory designs/apprankly-v2
```

- Comparison page: http://127.0.0.1:4320/
- A · Leaderboard: http://127.0.0.1:4320/leaderboard/
- B · Today: http://127.0.0.1:4320/today/

Any password of 4+ characters signs in. The **Giả lập / Simulate** button (bottom right) sets network speed (fast/normal/slow), switches scenario (normal/empty/error/late reports), makes writes fail, and resets the sample data.

## Directions

| | A · Leaderboard | B · Today |
|---|---|---|
| Home answers | Which app leads, which just moved? | What needs me today? |
| Signature motion | Lanes re-sort with FLIP and show “up 2 / down 1”; numbers count to their new value | App card expands into its detail page (View Transitions shared element); inbox items tick off |
| Palette | Ultramarine #3B3BF5, sun #FFC53D on cool white #F3F5FF | Magenta #D61F70, sky #2F8CFF on white |
| Type | Unbounded + Hanken Grotesk | Bricolage Grotesque + Readex Pro |
| Navigation | Pill nav (desktop), floating bottom bar (mobile) | ⌘K / `/` command palette, bottom tab bar (mobile) |

## Function parity with the app

Portfolio (platform/period/search/sort, KPIs, USD total with original currencies and rates, anomalies, comparison, trend chart, CSV/JSON export, sync, stale/source-error banners), app details with 8 tabs (overview + events, countries + country revenue, versions, store listing + AI audit, keywords + rank check + rank history, competitors, reviews with filter/reply/AI draft/bulk reply/templates, campaigns), settings (connection status/test, env var help, manual Google packages, theme, language, sync interval, notifications, digest/threshold, digest preview/send, test notification), notifications, login/logout, AI preview → consent → run (editing clears consent), light/dark/system, Vietnamese/English.

## Loading and motion

- Sources load in parallel and render as each one arrives; every source has its own status.
- Changing period keeps old numbers dimmed and tweens to new ones; no skeleton flash. Periods are cached and prefetched on hover; apps are prefetched on hover.
- Shape-matched skeletons on first load only; entrance motion plays once per element.
- Keyword/campaign/event/review-reply writes are optimistic with undo and rollback on failure.
- AI review drafts stream in. `prefers-reduced-motion` disables motion.

## New features (labelled “Mới / New”)

Action center (low-rated unanswered reviews, waiting reviews, install spikes/drops, rank drops, failing or late sources, with deep links, dismiss, undo), release impact (7 days before vs after each release), per-source sync progress. B adds a command palette.

## Files and checks

`shared/` holds data, mock API, feature layer, chart, icons (Lucide, ISC), fonts (OFL, self-hosted), locales and base CSS. Each prototype folder holds only its shell, layout and tokens.

```sh
node designs/apprankly-v2/verify.mjs      # locale parity, no network APIs, self-hosted assets, feature presence
node designs/apprankly-v2/behaviour.mjs   # streaming, FLIP, cache, optimistic writes, consent, view transitions, ⌘K
node designs/apprankly-v2/audit.mjs today # DOM layout + contrast audit (also: leaderboard)
node designs/apprankly-v2/shot.mjs        # screenshots in screenshots/, console + overflow check
```

The browser scripts need a local Playwright and Chromium; set `PLAYWRIGHT` / edit the path in the script. All data is synthetic, and the pages' CSP blocks every outbound request.
