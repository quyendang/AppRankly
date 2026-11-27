CREATE TABLE review_source (
  app_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE INDEX review_archive_page ON review_archive (
  app_id, COALESCE(json_extract(payload,'$.date'),'') DESC, review_id DESC
);

CREATE TABLE review_reply_operation (
  app_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL,
  result TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, operation_id)
);
CREATE INDEX review_reply_active ON review_reply_operation(app_id, review_id, state);
