# Development

See README.md for local setup and Railway deployment. This fork targets a single owner and one SQLite-backed service.

Run `npm test --prefix app` and `npm run build --prefix app/frontend` before submitting changes. Tests use synthetic credentials and temporary data. Never commit real keys, config exports, database files or private analytics. Keep English/Vietnamese translations in sync, preserve keyboard navigation and reduced motion, and test 1440/1280/768/390px layouts.

`example.config.json` documents non-sensitive settings only; it is not loaded automatically. Keep store/AI keys in environment variables. Public setup, Git synchronization, team accounts and AI-generated SQL must not be reintroduced.
