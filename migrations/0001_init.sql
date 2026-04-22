CREATE TABLE IF NOT EXISTS monitor_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  auth_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  usage_payload_json TEXT,
  summary_json TEXT,
  feishu_message_text TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS monitor_chunks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  account_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  FOREIGN KEY (run_id) REFERENCES monitor_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_monitor_chunks_run_status ON monitor_chunks(run_id, status);

CREATE TABLE IF NOT EXISTS quota_reports (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  auth_index TEXT,
  account_id TEXT,
  name TEXT NOT NULL,
  plan_type TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  windows_json TEXT,
  additional_windows_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES monitor_runs(id),
  FOREIGN KEY (chunk_id) REFERENCES monitor_chunks(id)
);
CREATE INDEX IF NOT EXISTS idx_quota_reports_run ON quota_reports(run_id);

CREATE TABLE IF NOT EXISTS runtime_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
