CREATE TABLE aso_rank_attempt (
  keyword_id INTEGER NOT NULL REFERENCES aso_keyword(id) ON DELETE CASCADE,
  country TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  failed INTEGER NOT NULL CHECK (failed IN (0, 1)),
  PRIMARY KEY (keyword_id, country)
) WITHOUT ROWID;
