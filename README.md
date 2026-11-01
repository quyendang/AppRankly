# AppRankly — personal app portfolio

A single-owner dashboard for your own Google Play and App Store apps. Compare your portfolio, inspect analytics, track ASO keywords and competitors, review public listings, maintain notes and releases, export data, and optionally receive notifications. AI requests require a server-generated payload preview and explicit confirmation.

The Spectrum interface uses warm accents, self-hosted fonts, English/Vietnamese localization, and light/dark/system appearance. The application runs as one Express service serving a React/Vite frontend, with Chart.js and SQLite.

## Quick links

- [Railway deployment guide](DEPLOYMENT.md)
- [Environment variable template](.env.example)
- [Security model and limitations](SECURITY.md)
- [Implementation verification](designs/apprankly-redesign/PRODUCTION-VERIFICATION.md)

## Deploy on Railway

Use the repository root as the service root, the included Dockerfile, **one replica**, and **one persistent volume mounted at `/app/data`**. Set the authentication variables before starting the service. Railway supplies `PORT`; the app listens on `0.0.0.0`.

The checked-in `railway.json` specifies the required volume mount path, `/readyz` healthcheck, restart behavior, shutdown drain time, and disabled application sleep. Attaching the volume and configuring Variables still require Railway service configuration. See the [step-by-step deployment guide](DEPLOYMENT.md) for credentials, domains, backups, migration, and troubleshooting.

Store and AI credentials belong only in server environment variables. The UI displays configuration status and can test store connections; it never accepts, returns, or edits secrets. Notifications start disabled. Store credentials are optional at startup, so you can verify login and the empty dashboard before connecting your accounts.

## Local development

Use a current **Node.js 22 LTS release, at least 22.13**, and npm. The backend requires the built-in `node:sqlite` module.

```sh
npm ci --prefix app --ignore-scripts
npm ci --prefix app/frontend --ignore-scripts
npm run build --prefix app/frontend
npm test --prefix app
```

For local checks, build the frontend before running the tests so the bundle canary check also runs.

Copy `.env.example` to `.env` in the repository root, generate your own `JWT_SECRET` and `ADMIN_PASSWORD_HASH`, and set `APP_ORIGIN=http://localhost:3000` and `NODE_ENV=development`. Remove optional empty variables or leave them blank. Start from the repository root:

```sh
node app/server.js
```

Open `http://localhost:3000`. The frontend build is written to `app/public`; production serves the frontend and API from the same origin. Do not commit `.env`, database files, analytics exports, or keys.

For frontend development, run `npm run dev --prefix app/frontend` in another terminal. Set `APP_ORIGIN` to that development server's exact origin while using the Vite proxy; restart the backend after changing environment variables.

## Data and privacy

- `DATA_DIR` contains SQLite, caches, downloaded reports, notes, releases, and settings. Its local default is `app/data`; Railway uses `/app/data`.
- Database migrations run at startup and preserve legacy tables. Back up existing data before upgrading; see [migration instructions](DEPLOYMENT.md#migrating-an-existing-installation).
- Sessions last 12 hours in an HttpOnly cookie. Production adds Secure; SameSite is Strict. Changing the password hash or JWT secret invalidates existing sessions.
- Team APIs, public setup, raw configuration APIs, Git synchronization, public demo generation, and AI-generated SQL execution have been removed.
- OpenAI- and Anthropic-compatible proxies are supported through server-only `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL`; see the [proxy configuration guide](DEPLOYMENT.md#custom-openai--anthropic-proxy-endpoints). The configured destination receives the selected AI key and approved payload.
- AI does not run automatically in the background. Private analytics and notes are excluded unless you select them and approve the preview.
- Revenue stays grouped by its original currency. Missing or unsupported measurements are shown as unavailable rather than fabricated zeros.

## Verification

The test suite uses synthetic credentials and temporary storage. It covers authentication, Origin checks, removed routes, credential sanitization, note symlinks, AI consent, currency handling, concurrency, readiness failures, shutdown, and persistence across restart. Set `LIVE_STORE_TESTS=1` to enable the optional public-store integration test.

For an isolated UI preview with synthetic data only:

```sh
node app/test/preview-server.js
```

Open `http://127.0.0.1:3002` and use `preview-only-password`. This test server is excluded from the production image. The three design prototypes under `designs/apprankly-redesign/` are also excluded.

Local checks are not a claim of successful Railway deployment. Real store access, provider billing behavior, outbound notifications, Docker execution, and Railway backup/restore must be validated in your deployment environment. See the [verification record](designs/apprankly-redesign/PRODUCTION-VERIFICATION.md).

## License

[AGPL-3.0-only](LICENSE). Third-party font licenses are included in `app/frontend/public/licenses` and served at `/licenses`.
