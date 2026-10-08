CREATE TABLE IF NOT EXISTS ai_decisions (
  id TEXT PRIMARY KEY,
  estimate_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  item_id TEXT,
  item_code TEXT,
  question_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  confidence REAL NOT NULL,
  threshold REAL NOT NULL,
  status TEXT NOT NULL,
  actor TEXT NOT NULL,
  proposal TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ai_decisions_estimate ON ai_decisions (estimate_id, created_at);
