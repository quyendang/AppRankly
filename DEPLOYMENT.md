# Deploying AppRankly on Railway

This guide is for a personal, single-owner instance with fewer than 20 apps. Run one service and one replica, with SQLite on one persistent volume. No PostgreSQL or Redis service is needed.

## 1. Prepare the repository and authentication

Select this GitHub repository in Railway and use the **repository root** as the service root. Railway builds the included `Dockerfile`; keep the configured `/usr/local/bin/apprankly-entrypoint` start command. Do not run migrations as a pre-deploy command. Volumes are mounted when the container starts, so initialization and migration happen at startup.

Install the backend dependencies locally to generate a bcrypt hash:

```sh
npm ci --prefix app --ignore-scripts
openssl rand -hex 32
```

Use the random output as `JWT_SECRET`. Generate a bcrypt hash of a password containing 12–256 characters without putting the password in shell history. In Bash:

```sh
read -r -s -p 'Admin password: ' apprankly_password
printf '\n' >&2
printf '%s' "$apprankly_password" | node app/cli.js hash-password
unset apprankly_password
```

In Zsh (the default macOS shell), use:

```sh
read -r -s 'apprankly_password?Admin password: '
printf '\n' >&2
printf '%s' "$apprankly_password" | node app/cli.js hash-password
unset apprankly_password
```

Copy only the resulting bcrypt hash into `ADMIN_PASSWORD_HASH`. Keep the actual password in your password manager. Treat the hash as sensitive configuration. Do not enter real keys or passwords into GitHub issues, commit messages, notes, screenshots, or AI prompts.

## 2. Configure the service and persistent volume

1. Create a Railway service from the repository. Configure the variables below before starting it.
2. Attach **one volume** and set its mount path to **`/app/data`**.
3. Keep **one replica** and disable **Serverless/application sleep** so scheduled synchronization continues to run.
4. Generate a Railway public HTTPS domain or configure your custom domain. Copy its exact origin into `APP_ORIGIN`, for example `https://your-service.up.railway.app`, without a trailing slash or path. Redeploy if this changes.
5. Keep `/usr/local/bin/apprankly-entrypoint` as the start command. It creates the data directory, corrects ownership when started as root, and then runs Node as user `node`. Do not set a Railway user override that prevents this volume initialization.

`railway.json` requires `/app/data`, configures `/readyz`, uses a 120-second readiness timeout, disables sleep, sets one replica, and allows 20 seconds between SIGTERM and SIGKILL. The application's own shutdown timeout is 15 seconds. A volume-backed redeploy may cause a short interruption; do not promise zero downtime.

## 3. Set Railway Variables

Paste values directly into the service's **Variables** panel. Do not create `VITE_*` equivalents: those would be exposed to browser builds. The [.env.example](.env.example) file documents names and local defaults, and contains no usable credentials.

### Required authentication and runtime variables

| Variable | Value / behavior |
| --- | --- |
| `NODE_ENV` | `production` on Railway; Docker sets it by default. Enables Secure cookies and production CSP. |
| `DATA_DIR` | `/app/data`; Docker sets it by default. Keep this aligned with the volume mount. |
| `APP_ORIGIN` | Exact public HTTPS origin; no trailing slash, path, query, or fragment. Required in production. |
| `ADMIN_PASSWORD_HASH` | Your bcrypt hash, generated above. The application will not start without a valid hash. |
| `JWT_SECRET` | Your random secret, at least 32 characters. Sample/insecure defaults are rejected. |
| `PORT` | Supplied by Railway. Local default: `3000`. Do not hardcode a different Railway listening port. |
| `DB_PATH` | Optional absolute path for an existing SQLite file **inside the mounted volume**. Default: `$DATA_DIR/database.sqlite`. |

### Google Play reports — optional

| Variable | Value / behavior |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Complete service-account JSON, pasted as a single environment value. Only service-account credentials with an RSA private key are accepted. Alternate credential endpoints and external-account configuration are not forwarded to the SDK. |
| `GOOGLE_BUCKET_NAME` | Name of the Google Cloud Storage bucket containing your Play Console reports; use the bucket name, without `gs://` or a URL. Required when the Google credential variable is set. |

Grant the service account only the report/bucket permissions needed for your own apps. The application uses the Google Storage SDK with the read-only storage scope. A service-account JSON file alone does not grant access: your Google/Play configuration must authorize it.

Do not mount the original JSON file into the notes directory, add it to the repository, or save it in settings. Leave **both** variables unset if you do not use Google Play.

### App Store Connect — optional

| Variable | Value / behavior |
| --- | --- |
| `APPLE_PRIVATE_KEY` | Complete PEM contents of the App Store Connect `.p8` key. Actual newlines and literal `\n` separators are accepted. Use the contents, not a filesystem path. |
| `APPLE_ISSUER_ID` | App Store Connect issuer ID. |
| `APPLE_KEY_ID` | API key ID corresponding to the private key. |
| `APPLE_VENDOR_ID` | Vendor number used to request Sales Reports. |

Set all four Apple variables together, or leave all four unset. Startup rejects partial configuration or an invalid EC private key. Configure the key's permissions for the app listing and Sales Reports you need. Unsupported Apple metrics remain unavailable; installs are not substituted for active devices or measured retention.

### AI — optional

| Variable | Value / behavior |
| --- | --- |
| `AI_PROVIDER` | `openai` (default), `anthropic`, or `gemini`. Select a provider whose key you configure. |
| `OPENAI_API_KEY` | OpenAI key, or the key issued by your OpenAI-compatible proxy; used only when OpenAI is selected. |
| `OPENAI_BASE_URL` | Optional HTTPS API root; default `https://api.openai.com/v1`. The SDK appends `/chat/completions`. |
| `OPENAI_MODEL` | Default: `gpt-5-nano`. Override with a compatible model available to your account. |
| `ANTHROPIC_API_KEY` | Anthropic key, or the key issued by your Anthropic-compatible proxy. |
| `ANTHROPIC_BASE_URL` | Optional HTTPS API root; default `https://api.anthropic.com`. The SDK appends `/v1/messages`. |
| `ANTHROPIC_MODEL` | Default: `claude-sonnet-4-5`. Override with a compatible model available to your account. |
| `GEMINI_API_KEY` | Gemini API key. |
| `GEMINI_MODEL` | Default: `gemini-2.5-flash`. Override with a compatible model available to your account. |

These are code defaults, not a guarantee of model availability. Calls use official endpoints unless you explicitly configure an OpenAI/Anthropic proxy below. Changing a variable requires redeployment. There is no background paid AI job: the owner must request a preview and explicitly confirm it. Analytics and notes are excluded by default. A confirmed request may incur provider charges.

#### Custom OpenAI / Anthropic proxy endpoints

Set these in Railway Variables, then redeploy. OpenAI-compatible example:

```dotenv
AI_PROVIDER=openai
OPENAI_BASE_URL=https://your-proxy.example/v1
OPENAI_MODEL=your-proxy-model-id
OPENAI_API_KEY=<key-issued-by-your-proxy>
```

Anthropic-compatible example:

```dotenv
AI_PROVIDER=anthropic
ANTHROPIC_BASE_URL=https://your-proxy.example
ANTHROPIC_MODEL=your-proxy-model-id
ANTHROPIC_API_KEY=<key-issued-by-your-proxy>
```

These are illustrative values, not working credentials. Paths/prefixes are preserved: an Anthropic base of `https://your-proxy.example/anthropic` produces `/anthropic/v1/messages`. Do not include the final `/chat/completions` or `/messages` path in the base URL. For Anthropic, do not append `/v1` unless your proxy explicitly requires that prefix in addition to the SDK's `/v1/messages` route.

Both variables require HTTPS by default and reject embedded username/password, query strings, and fragments. Empty values restore official defaults. Invalid URLs cause startup to fail. Public HTTP and localhost HTTP are not supported. Railway private HTTP requires the explicit option described below. API requests cannot override these URLs; only the server operator can change them. Gemini continues to use its official endpoint.

OpenAI requests use bearer authorization and Chat Completions, with `json_schema` for recognized modern OpenAI model IDs and `json_object` for other IDs. Anthropic requests use `x-api-key`, `anthropic-version`, Messages, and `output_config` with a JSON schema. The proxy/model must support these request fields and return the corresponding provider response format. A service that only offers the OpenAI Responses API, plain text completion, or unsupported structured-output fields is not automatically compatible. Check the proxy's documented model IDs and API compatibility.

OpenAI/Anthropic requests reject redirects, use a 60-second SDK timeout, and disable automatic retries and provider fallback. An error is returned for an unsuccessful request; the app does not silently resend it to an official endpoint or another provider.

**The selected AI API key and the approved prompt are sent to the configured proxy.** Use a proxy-issued key rather than forwarding an official provider key unless you intend to give that proxy access to it. The preview displays the destination origin and model before confirmation; paths are not exposed there. Google Play/App Store credentials remain outside AI payloads. Analytics and notes are still excluded unless explicitly selected and approved. Review the proxy's retention and access policies before sending private data.

#### CLIProxyAPI in the same Railway project/environment

Railway private service traffic uses HTTP inside an encrypted WireGuard network. Both services must be in the same **project and environment**. See [Railway private networking](https://docs.railway.com/networking/private-networking/how-it-works).

For a service named `cli-proxy-api` listening on **8317**, configure these Variables on **AppRankly**:

```dotenv
AI_PROVIDER=openai
AI_ALLOW_RAILWAY_INTERNAL_HTTP=true
OPENAI_BASE_URL=http://cli-proxy-api.railway.internal:8317/v1
OPENAI_API_KEY=<CLIProxyAPI-client-API-key>
OPENAI_MODEL=<exact-model-id-exposed-by-CLIProxyAPI>
```

For the Anthropic Messages format instead:

```dotenv
AI_PROVIDER=anthropic
AI_ALLOW_RAILWAY_INTERNAL_HTTP=true
ANTHROPIC_BASE_URL=http://cli-proxy-api.railway.internal:8317
ANTHROPIC_API_KEY=<CLIProxyAPI-client-API-key>
ANTHROPIC_MODEL=<exact-Claude-model-id-exposed-by-CLIProxyAPI>
```

Replace `8317` with the proxy's actual **listening port**, if different; it is not necessarily AppRankly's `$PORT`. CLIProxyAPI's example configuration uses 8317. Ensure the proxy listener accepts connections from other services (all interfaces, including IPv6 where needed), rather than localhost only. Set the corresponding listener options for the version of CLIProxyAPI you deploy. [CLIProxyAPI configuration reference](https://github.com/router-for-me/CLIProxyAPI/blob/main/config.example.yaml).

Use a **client API key authorized to call CLIProxyAPI**, not its management/admin key or a Google/Apple credential. Keep upstream provider authentication in CLIProxyAPI. Use a model ID returned by the proxy's `/v1/models` endpoint; do not assume AppRankly's default model exists there. The proxy and model must still support the structured request fields documented above.

`AI_ALLOW_RAILWAY_INTERNAL_HTTP` defaults to false. When exactly `true`, it permits HTTP only for a hostname shaped like `service-name.railway.internal`. It does not allow public hosts, localhost, IP literals, nested subdomains, or redirects. AppRankly does not verify project membership via the Railway API; network/environment isolation remains Railway's responsibility. Keep public proxies on HTTPS.

Redeploy AppRankly after updating Variables. Review the destination shown in the AI preview, then run a small request. A `.railway.internal` address is reachable inside Railway's environment, not directly from your MacBook browser. This configuration does not change `APP_ORIGIN`: keep that set to AppRankly's public HTTPS origin.

### Notifications — optional and disabled initially

| Variable | Value / behavior |
| --- | --- |
| `NTFY_TOPIC` | Topic on `https://ntfy.sh`; 8–100 letters, digits, underscores, or hyphens. Use an unguessable topic and consider its access settings. |
| `DISCORD_WEBHOOK_URL` | HTTPS webhook on `discord.com/api/webhooks/...`. |
| `SLACK_WEBHOOK_URL` | HTTPS webhook on `hooks.slack.com/services/...`. |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token. Requires `TELEGRAM_CHAT_ID`. |
| `TELEGRAM_CHAT_ID` | Destination chat ID for the configured Telegram bot. |

Redirects and unsupported webhook hosts are rejected. After adding variables, explicitly enable notifications in Settings and send a test. Destinations receive notification content and may receive private app performance information. Leave notifications off if you do not want that transmission.

## 4. Deploy and validate

Deploy after setting the required variables and attaching the volume. Check the Railway deployment status and logs, then verify the public service:

```sh
curl --fail https://your-service.up.railway.app/healthz
curl --fail https://your-service.up.railway.app/readyz
```

`/healthz` checks the process. `/readyz` checks SQLite and the ability to create/delete a probe file in `DATA_DIR`; it does not require Google or Apple to be online. Both endpoints are public and expose only a small status response.

1. Open the HTTPS dashboard. Confirm unauthenticated API requests return `401`.
2. Log in with your owner password. Verify the empty dashboard before configuring real keys.
3. Add store variables, redeploy, then use Settings → Test connection and run a manual sync.
4. Inspect the portfolio, one app's report, ASO, a saved note, a release, and a CSV export. Verify original currency labels and unavailable metrics.
5. Restart the service and confirm the note/release and settings remain. Repeat after a redeploy.
6. Enable and test notifications only if desired. AI can be verified first by previewing the payload without sending it.

Only call deployment successful after Railway reports success **and** the public service passes these checks. Local build/tests do not establish that.

## Synchronization and shutdown

The default schedule is once per hour, using `Asia/Ho_Chi_Minh` and the full day. Settings store the schedule, lookback window, and non-sensitive preferences under `DATA_DIR`. At most two app statistics jobs run concurrently. Manual sync respects the same overlap lock as scheduled sync.

On SIGTERM, the process stops scheduling new jobs, closes the HTTP listener, waits for the active synchronization job within the shutdown deadline, and closes SQLite. Very long work may be interrupted at the deadline; verify the next sync after redeployment.

## Backups and restore

Enable daily volume backups in Railway. Back up the entire data directory, including SQLite and its WAL/SHM files if present, notes, `releases.json`, settings, downloaded reports, and caches. Prefer a Railway volume snapshot or stop the service before making a filesystem-level copy; copying only a live `database.sqlite` file can miss committed WAL data.

Test restoration into a **separate volume/service** before relying on the backup:

1. Restore the snapshot and mount it at `/app/data`.
2. Configure authentication and store variables separately; they are not stored in the application data backup.
3. Start with notifications disabled and avoid triggering AI requests while validating the restore.
4. Check readiness, notes/releases counts, settings, and database integrity. Confirm a subsequent restart preserves the restored records.

Do not overwrite the only working volume while testing a restore. Railway Variables and account access need their own recovery process.

## Migrating an existing installation

1. Back up the old data and stop the old instance before switching writes to the new one.
2. Restore the existing SQLite database, notes, `releases.json`, caches, and downloaded reports into the new data directory. Set `DB_PATH` if the database has a different filename. Keep all persisted files inside the volume.
3. Move Google, Apple, AI, and notification secrets manually into Railway Variables. Legacy raw config files and AI config files are **not imported automatically**. Reapply non-sensitive preferences in Settings.
4. Startup migrations preserve existing tables. Legacy team-user rows remain for data preservation, but only the environment-configured owner can log in.
5. Verify restored notes and releases before removing old files. After confirming migration, remove credentials from legacy config files and obsolete backups according to your retention policy.
6. If a key was committed to Git, synchronized to an untrusted repository, or otherwise disclosed, revoke/rotate it at its issuer. Deleting it in a new commit does not remove it from Git history.

Git synchronization, team administration, public setup, raw config APIs, public demo generation, and AI-generated SQL execution are intentionally unavailable in this personal fork.

## Troubleshooting

### `EACCES: permission denied, mkdir '/app/app/data'`

A relative local value such as `DATA_DIR=./app/data` resolves under the container working directory `/app`, producing `/app/app/data`. This is different from the persistent volume at `/app/data`. An overridden start command can also bypass the volume ownership initialization.

In the **AppRankly service**:

1. Set `DATA_DIR=/app/data` and `NODE_ENV=production` in Variables. Do not copy the local `.env` defaults unchanged into Railway.
2. Confirm the existing volume's mount path is `/app/data`. Do not delete/recreate the volume to solve this error.
3. If `DB_PATH` is set, ensure it is an absolute path inside that volume (normally `/app/data/database.sqlite`); otherwise leave it unset.
4. Use the latest `railway.json`, which explicitly starts `/usr/local/bin/apprankly-entrypoint`. Remove any old `node server.js` / `npm start` override. This wrapper initializes ownership and then drops to user `node`.
5. Remove a conflicting non-root `RAILWAY_RUN_UID` override, or set `RAILWAY_RUN_UID=0` for the wrapper's initialization; Node itself is still launched as user `node` by the wrapper.
6. Redeploy, check for `AppRankly ready`, and verify `/readyz` returns HTTP 200.

Production now rejects relative `DATA_DIR` values with an explicit setup error before attempting to create a directory. An `EACCES` startup crash means the app never reached its HTTP listener; changing `APP_ORIGIN` or store API keys will not repair this filesystem failure.


| Symptom | Check |
| --- | --- |
| Startup rejects authentication | Generate a valid bcrypt hash and a random JWT secret; confirm the Variables values were pasted exactly. There is no public setup bypass. |
| `SET_HTTPS_APP_ORIGIN` | Use the exact HTTPS origin without a trailing slash or path. |
| `403 INVALID_ORIGIN` | Open the configured domain; update `APP_ORIGIN` after a domain change and redeploy. Keep frontend/API on the same origin. |
| Readiness fails | Confirm the `/app/data` volume is attached, writable, and not full; check the SQLite path and migration logs. Store outages are not a readiness dependency. |
| No apps or store connection failure | Check the complete credential group, report permissions, bucket/vendor values, and availability of reports. SDK details and secrets are deliberately omitted from API errors. |
| Login cookie not retained | Use HTTPS in production and access the configured origin. The cookie is HttpOnly, Secure in production, and SameSite Strict. |
| Scheduled sync does not run | Disable service sleep, keep one replica, and check the saved interval/time zone and active hours. |
| AI unavailable | Set the selected provider's key and a compatible model, redeploy, and create a fresh preview. Preview IDs expire after ten minutes and can be used only once. |
| AI returns an invalid/empty/truncated response | The server returns a specific AI error rather than blaming user input. Proxy requests include the JSON schema in the system prompt as well as the provider's structured-output option; a whole Markdown JSON fence is accepted, but arbitrary prose or incomplete JSON is rejected. Review drafts allow up to 8,192 completion tokens to accommodate reasoning models while still enforcing the store character limit. No automatic paid retry or provider fallback occurs. |
| Data disappears after restart | Verify `DATA_DIR` and `DB_PATH` point inside the attached persistent volume, not the container's ephemeral filesystem. |

## References and verification limits

- [Railway volumes](https://docs.railway.com/volumes)
- [Railway healthchecks](https://docs.railway.com/deployments/healthchecks)
- [Railway configuration as code](https://docs.railway.com/config-as-code/reference)
- [Local verification record](designs/apprankly-redesign/PRODUCTION-VERIFICATION.md)

The repository has been tested locally with synthetic credentials. Docker execution, real store/AI access, external notifications, and Railway volume backup/restore/deployment are not established by those tests. Do not treat the presence of this guide as proof of a live deployment.

## App discovery, icons, reports, and keyword ranks

Google Play apps are discovered through the official [Play Developer Reporting API `apps.search`](https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/apps/search), then merged with filenames in your Play Console report bucket and manually tracked packages. Enable **Google Play Developer Reporting API** (`playdeveloperreporting.googleapis.com`) in the Google Cloud project belonging to the existing service account, and ensure that account has access to the apps in Play Console. No new AppRankly environment variable or key is needed. Discovery uses the read-only `playdeveloperreporting` OAuth scope on the server and handles pagination. If the API is disabled or inaccessible, existing report-based discovery continues; the server logs the stable message `GOOGLE_APP_DISCOVERY_UNAVAILABLE` without credentials or SDK error details.

A newly live app can appear before it has analytics reports. If discovery access is unavailable, **Settings → Add Google Play app** remains a fallback: enter its package name (for example `com.example.app`). This preserves it in `googlePackages`, fetches public listing metadata, and includes it in scheduled sync; it does not create analytics data. Google account permissions and report publication still determine which measurements are available. [Google report exports](https://support.google.com/googleplay/android-developer/answer/6135870?hl=en-EN). App lists are cached briefly; use **Sync** after enabling the API.

Revenue stays separated by original currency. Zero-only reports display one zero state rather than dozens of currency rows; missing reports remain unavailable. Nonzero amounts (including refunds) retain their currency and up to two decimal places. The first two currencies are shown initially, with the rest available through an expandable, scrollable breakdown.

### Subscription revenue and review replies

Apple revenue is estimated developer proceeds from daily Summary Sales reports: `Developer Proceeds × Units`, grouped by Currency of Proceeds. App sales match the numeric Apple ID; subscriptions and other in-app purchases match their Parent Identifier to the parent app's SKU. Negative units deduct refunds. This includes paid sales/renewals reported by Apple, not MRR or a forecast of active subscriptions. Trials may have zero proceeds; daily reports can lag. An app SKU is resolved through App Store Connect if the selected reports have subscription rows but no parent app download row.

Google revenue uses `sales/salesreport_YYYYMM.zip` in `GOOGLE_BUCKET_NAME`. It sums Charged Amount for the selected package and UTC report dates, deducts refund/partial-refund rows, and keeps Currency of Sale. This is **estimated gross buyer payments, including taxes and before Google fees**, not net developer proceeds or an accounting statement. Google and Apple amounts are displayed separately even for the same currency. The service account must have financial-data access in Play Console. Missing or inaccessible monthly files show unavailable/partial coverage rather than a fabricated complete zero. ZIPs are read in memory with size limits; customer/order details are not returned to the frontend or sent to AI.

App details → Reviews displays developer responses and provides All/Unanswered/Answered filters. Google combines its official Reviews API (the last seven days of created/edited reviews), up to the 12 latest monthly CSV exports under `reviews/reviews_PACKAGE_YYYYMM.csv`, up to 100 public US reviews, and a local SQLite archive. CSV exports include older developer responses across review languages; rows without a usable review ID are read-only. This is not a complete historical import. Apple reads App Store Connect reviews with their responses; public RSS is a read-only fallback when the official API is unavailable. Up to 500 archived reviews are displayed per app. Review history persists on the data volume. Click **Refresh reviews** to bypass the short review cache.

Enable **Google Play Android Developer API** (`androidpublisher.googleapis.com`) in the service account's Google Cloud project and grant **Reply to reviews** for the relevant apps in Play Console. Apple review replies require a key with access to customer reviews (for example App Manager or Customer Support). Keys remain server-side; no additional environment variables are required. Manual replies work without an AI key. Click **AI-Generated Response** to call the existing provider/proxy and fill the response field directly. This click authorizes generation using the selected review and public app context; private analytics, notes and credentials are excluded. Drafts follow the review text’s language (not the dashboard language), address its specific feedback, and use a friendly, natural tone. You can edit the result before publishing. Publishing is a separate explicit action with public-post confirmation and store character limits. The application does not automatically post generated replies. A timed-out publish has an uncertain outcome: refresh and verify the store response before retrying.

App icons are fetched by the server from allowlisted Google/Apple image hosts and served through an authenticated same-origin route. No store credential is sent to the image host. Invalid/unsupported images fall back to an initial. Public listing names/ratings/icons use cached metadata, so they may not update instantly.

Apple Sales Reports requests include the required `filter[version]=1_0`. Missing report days remain missing, and authentication/vendor/report errors are surfaced as source failures instead of zero installs. Reports are matched using each app's numeric Apple Identifier, not the title or SKU. Old empty cache entries expire and manual synchronization retries them. No app report history is inferred using a binary search over dates, because daily report availability is not monotonic.

In **App details → Keywords**, the country/language selector controls each new public-store search. The default is **US / English**, independent of the interface language. Supported pairs are US/en, VN/vi, GB/en, JP/ja, KR/ko, DE/de and FR/fr. Previous ranks are displayed for the selected country only, with their check date. Historical records from earlier versions were US/en.

A keyword rank is the app's position in the returned **public search results**, requesting up to 100 results. It is not an AI estimate, an official Play Console/App Analytics measurement, or a guarantee of what every user sees. Google may not strictly honor the country parameter, and server IP, language, personalization and store behavior can affect results. If the app is absent, the UI states the actual number of returned results searched; no rank is invented. If any keyword search fails, the batch is not written and previous ranks are preserved.

The localhost preview server and design prototypes use synthetic data. Do not compare those numbers with a deployed account's real reports.

Apple report failures display a sanitized HTTP status per app when available. HTTP 400 means the report request was rejected (check the vendor number/report configuration); 401 indicates authentication failure; 403 indicates report access was denied; 429 indicates throttling. SDK response bodies, request headers and tokens are not returned. Report downloads have a separate two-request limit and a 30-second per-vendor failure cooldown to avoid repeatedly calling a failing source for every app. A failure cooldown is not saved as an empty report or a zero measurement.


### App details, legacy journal data and USD conversion

The main navigation contains Portfolio, App details and Settings. App details combines analytics (Overview, Countries, Versions) with Store listing, Keywords, Competitors, Reviews and Campaigns. Its heading displays the app logo and platform icon. The old `#aso` URL opens the Store listing tab in App details; `#journal` returns to Portfolio.

Journal, note/release editors and release timelines have been removed from the frontend. Existing notes/releases and their authenticated backend APIs remain intact for data preservation and legacy exports; this update does not delete stored records. New frontend exports contain portfolio data and the exchange-rate snapshot instead of legacy journal content.

Revenue now shows an estimated total converted to USD, with original amounts available under **View original amounts**. USD totals combine available Apple estimated proceeds and Google gross sales, so they are **not net profit**. The original bases remain labeled separately. The service fetches the full public USD rate table from [Frankfurter v2](https://frankfurter.dev/) on the server, with no API key or new environment variable. No app identity, revenue, store credentials or AI credentials are sent to the rate provider. Each conversion uses `amount × currency-to-USD rate`, preserving refunds and rounding only for display. It uses current reference rates rather than transaction-date or payout rates.

Rates are cached for one hour and stored under `$DATA_DIR/exchange-rates-usd.json`. The UI exposes each used rate and its publication date. On an outage, saved snapshots up to seven days old are explicitly marked stale; older snapshots are not used. Missing rates prevent a complete total from being shown, with the missing currencies listed. Original-currency amounts remain readable and USD-only amounts need no external rate. FX source availability does not affect readiness or access to analytics.
