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
  createdAt: text("created_at").notNull(),
  contextLength: integer("context_length"),
  maxOutputTokens: integer("max_output_tokens")
});

export const requests = sqliteTable("requests", {
  id: text("id").primaryKey(),
  requestId: text("request_id"),
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

export const chatThreads = sqliteTable("chat_threads", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  adminSessionId: text("admin_session_id"),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  archivedAt: text("archived_at")
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  role: text("role").notNull(),
  contentText: text("content_text").notNull(),
  contentBlocksJson: text("content_blocks_json").notNull().default('{"blocks":[]}'),
  modelAlias: text("model_alias"),
  provider: text("provider"),
  realModel: text("real_model"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  // Branching: null = root message, otherwise points to parent message
  parentMessageId: text("parent_message_id"),
  // Attachments: JSON array of {id, filename, mimeType, size, url} for file/image uploads
  attachmentsJson: text("attachments_json").notNull().default("[]")
});

export const chatRuns = sqliteTable("chat_runs", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  status: text("status").notNull(),
  modelAlias: text("model_alias").notNull(),
  provider: text("provider"),
  realModel: text("real_model"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  latencyMs: integer("latency_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  estimatedCost: real("estimated_cost"),
  error: text("error")
});

export const chatSteps = sqliteTable("chat_steps", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  messageId: text("message_id"),
  type: text("type").notNull(),
  name: text("name").notNull(),
  inputJson: text("input_json").notNull().default("{}"),
  outputJson: text("output_json").notNull().default("{}"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  latencyMs: integer("latency_ms"),
  status: text("status").notNull()
});

export const storedResponses = sqliteTable("responses", {
  id: text("id").primaryKey(),
  apiKeyId: text("api_key_id"),
  modelAlias: text("model_alias").notNull(),
  provider: text("provider"),
  realModel: text("real_model"),
  status: text("status").notNull(),
  requestJson: text("request_json").notNull(),
  responseJson: text("response_json").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
  deletedAt: text("deleted_at")
});

export const responseInputItems = sqliteTable("response_input_items", {
  id: text("id").primaryKey(),
  responseId: text("response_id").notNull(),
  itemIndex: integer("item_index").notNull(),
  itemJson: text("item_json").notNull(),
  createdAt: text("created_at").notNull()
});

export const userPreferences = sqliteTable("user_preferences", {
  id: text("id").primaryKey(),
  themeId: text("theme_id").notNull().default("claude-warm"),
  updatedAt: text("updated_at").notNull()
});

export const healthProbes = sqliteTable("health_probes", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  status: text("status").notNull(), // "operational" | "degraded" | "incident"
  latencyMs: integer("latency_ms"),
  statusCode: integer("status_code"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull()
});
