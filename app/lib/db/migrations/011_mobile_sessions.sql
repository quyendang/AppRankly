CREATE TABLE mobile_session (
  id TEXT PRIMARY KEY,
  access_hash TEXT NOT NULL UNIQUE,
  refresh_hash TEXT NOT NULL UNIQUE,
  credential_version TEXT NOT NULL,
  access_expires_at INTEGER NOT NULL,
  refresh_expires_at INTEGER NOT NULL
);
CREATE INDEX mobile_session_expiry ON mobile_session(refresh_expires_at);
