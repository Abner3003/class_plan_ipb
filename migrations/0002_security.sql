CREATE TABLE IF NOT EXISTS rate_limits (
  key_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  window_bucket INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key_hash, action, window_bucket)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_bucket);
