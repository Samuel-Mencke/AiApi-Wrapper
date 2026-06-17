import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../env.js";
import * as schema from "./schema.js";

const databaseFile = path.resolve(env.root, env.databasePath);
fs.mkdirSync(path.dirname(databaseFile), { recursive: true });

export const sqlite = new Database(databaseFile);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
// Performance pragmas — safe for WAL mode, dramatic speedup for concurrent reads
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("cache_size = -64000"); // 64MB page cache
sqlite.pragma("mmap_size = 268435456"); // 256MB memory-mapped I/O

export const db = drizzle(sqlite, { schema });

function ensureColumn(table: string, column: string, definition: string): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

export function migrate(): void {
  sqlite.exec(`
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
    CREATE TABLE IF NOT EXISTS chat_threads (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      admin_session_id TEXT,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content_text TEXT NOT NULL,
      content_blocks_json TEXT NOT NULL DEFAULT '{"blocks":[]}',
      model_alias TEXT,
      provider TEXT,
      real_model TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      status TEXT NOT NULL,
      model_alias TEXT NOT NULL,
      provider TEXT,
      real_model TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      latency_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      estimated_cost REAL,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS chat_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      message_id TEXT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      latency_ms INTEGER,
      status TEXT NOT NULL
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
    CREATE TABLE IF NOT EXISTS user_preferences (
      id TEXT PRIMARY KEY,
      theme_id TEXT NOT NULL DEFAULT 'claude-warm',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created ON chat_messages(thread_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_runs_thread_started ON chat_runs(thread_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_chat_steps_run_started ON chat_steps(run_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_responses_api_key_created ON responses(api_key_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_response_input_items_response ON response_input_items(response_id, item_index);
  `);
  ensureColumn("requests", "request_id", "request_id TEXT");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_requests_request_id ON requests(request_id)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_requests_api_key_created ON requests(api_key_id, created_at)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_requests_model_alias ON requests(model_alias)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_quota_settings_provider ON quota_settings(provider)");
}
