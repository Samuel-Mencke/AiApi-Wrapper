CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  monthly_limit INTEGER,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  base_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_routes (
  id TEXT PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  real_model TEXT NOT NULL,
  fallback_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  api_key_id TEXT,
  model_alias TEXT NOT NULL,
  provider TEXT NOT NULL,
  real_model TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost REAL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quota_settings (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_alias TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  window_hours INTEGER NOT NULL DEFAULT 5,
  request_limit INTEGER,
  token_limit INTEGER,
  concurrency_limit INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, model_alias)
);

CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  api_key_id TEXT,
  model_alias TEXT NOT NULL,
  provider TEXT,
  real_model TEXT,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS response_input_items (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL,
  item_index INTEGER NOT NULL,
  item_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
