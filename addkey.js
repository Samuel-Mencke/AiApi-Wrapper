const Database = require("better-sqlite3");
const crypto = require("crypto");

const rawKey = "gw_DrP5OMpLa7yibow1EvVBEv5Nu1tK5wbZ";
const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

const dbPath = process.env.DATABASE_URL?.replace(/^file:/, "") || "/data/gateway.db";
console.log("DB path:", dbPath);

const db = new Database(dbPath);
const now = new Date().toISOString();

const insert = db.prepare(
  "INSERT OR REPLACE INTO api_keys (id, name, key_hash, enabled, monthly_limit, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
insert.run("opencode-perm", "OpenCode Permanent", keyHash, 1, null, now, null);

const row = db.prepare("SELECT * FROM api_keys WHERE id = ?").get("opencode-perm");
console.log("Inserted:", JSON.stringify(row));
db.close();
