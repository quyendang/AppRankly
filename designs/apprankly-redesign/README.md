# AppRankly — three interactive UI prototypes

These are standalone **stage-one design prototypes**, using synthetic data only. They do not connect to production APIs, real credentials, AI providers, or deployment services. Spectrum was approved with terracotta, amber, and red-brown accents and stronger typography; the production implementation is now in `app/frontend/src`.

## Open the prototypes

Run from the repository root:

```sh
python3 -m http.server 4312 --bind 127.0.0.1 --directory designs/apprankly-redesign
```

- [Comparison gallery](http://127.0.0.1:4312/index.html)
- [Pulse](http://127.0.0.1:4312/pulse.html)
- [Spectrum](http://127.0.0.1:4312/spectrum.html)
- [Focus](http://127.0.0.1:4312/focus.html)

Use HTTP because the prototypes load ES modules. No npm install or build is required. If the port is occupied, choose another port and update the URLs.

## Review interactions

Each prototype includes Portfolio, App details, ASO Studio, Journal, and Settings. Try platform/time filters, app search, Spectrum's drawer, Focus's app list, themes, English/Vietnamese, and the simulated state selector for loading, empty, error, and stale data.

ASO includes public listing content, keywords, competitors, reviews, and an AI preview dialog. Confirmation is required before the simulated run; changing the selected content clears confirmation. No AI request is sent. Journal supports notes and releases. Prototype edits are stored only in each concept's localStorage; Settings → Reset sample data restores the shared fixtures. User-entered note text is preserved when changing languages.

CSV export uses the filtered apps. USD/EUR values remain separate; unsupported measurements remain unavailable rather than becoming zero.

## Files and checks

- Four HTML entries: comparison gallery and three independent concepts.
- `app.js`: new prototype interactions and three distinct layouts.
- `data.js`: shared synthetic fixtures, SVG app icons, and English/Vietnamese copy.
- `prototype.css`: design tokens, responsive layouts, and themes.
- `assets/fonts/`: self-hosted fonts and OFL licenses.
- `screenshots/`: desktop/mobile reference and production UI captures.
- `_d_meta.json`: design artifact metadata.

```sh
node designs/apprankly-redesign/verify.mjs
```

Prototype browser coverage and limitations are recorded in `verification.json`. Production implementation checks are recorded separately in [PRODUCTION-VERIFICATION.md](PRODUCTION-VERIFICATION.md). Neither record proves a live Railway deployment or real provider access.

These files are excluded from the production Docker image. For deployment and environment variables, use the root [deployment guide](../../DEPLOYMENT.md).
