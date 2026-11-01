CREATE TABLE IF NOT EXISTS review_archive (
  app_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(app_id, review_id)
);
