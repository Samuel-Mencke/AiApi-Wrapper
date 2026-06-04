import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  monthlyLimit: integer("monthly_limit"),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at")
});

export const providers = sqliteTable("providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type").notNull(),
  baseUrl: text("base_url"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull()
});

export const modelRoutes = sqliteTable("model_routes", {
  id: text("id").primaryKey(),
  alias: text("alias").notNull().unique(),
  provider: text("provider").notNull(),
  realModel: text("real_model").notNull(),
  fallbackJson: text("fallback_json").notNull().default("[]"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull()
});

export const requests = sqliteTable("requests", {
  id: text("id").primaryKey(),
  apiKeyId: text("api_key_id"),
  modelAlias: text("model_alias").notNull(),
  provider: text("provider").notNull(),
  realModel: text("real_model").notNull(),
  status: text("status").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  estimatedCost: real("estimated_cost"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull()
});

export const quotaSettings = sqliteTable("quota_settings", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  modelAlias: text("model_alias").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  windowHours: integer("window_hours").notNull().default(5),
  requestLimit: integer("request_limit"),
  tokenLimit: integer("token_limit"),
  concurrencyLimit: integer("concurrency_limit"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});
