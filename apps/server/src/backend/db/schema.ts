import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

const nowMs = sql`(strftime('%s', 'now') * 1000)`;

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    model: text("model").notNull(),
    status: text("status", { enum: ["active", "idle"] }).notNull().default("idle"),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    lastActiveAt: integer("last_active_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  table => [index("sessions_last_active_idx").on(table.lastActiveAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  table => [index("messages_session_created_idx").on(table.sessionId, table.createdAt)],
);

export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    providerId: text("provider_id"),
    modelId: text("model_id"),
    requestCountDelta: integer("request_count_delta").notNull().default(0),
    inputTokensDelta: integer("input_tokens_delta").notNull().default(0),
    outputTokensDelta: integer("output_tokens_delta").notNull().default(0),
    estimatedCostUsdDelta: integer("estimated_cost_usd_delta_micros").notNull().default(0),
    source: text("source", { enum: ["api", "runtime", "scheduler", "system"] }).notNull().default("system"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  table => [
    index("usage_events_created_idx").on(table.createdAt),
    index("usage_events_provider_created_idx").on(table.providerId, table.createdAt),
    index("usage_events_provider_model_created_idx").on(table.providerId, table.modelId, table.createdAt),
  ],
);

export const heartbeatEvents = sqliteTable(
  "heartbeat_events",
  {
    id: text("id").primaryKey(),
    online: integer("online", { mode: "boolean" }).notNull().default(true),
    source: text("source", { enum: ["api", "runtime", "scheduler", "system"] }).notNull().default("system"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  table => [index("heartbeat_events_created_idx").on(table.createdAt)],
);

export const runtimeConfig = sqliteTable("runtime_config", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export const runtimeSessionBindings = sqliteTable(
  "runtime_session_bindings",
  {
    runtime: text("runtime").notNull(),
    sessionId: text("session_id").notNull(),
    externalSessionId: text("external_session_id").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  table => [
    primaryKey({ columns: [table.runtime, table.sessionId] }),
    index("runtime_session_bindings_external_idx").on(table.runtime, table.externalSessionId),
    index("runtime_session_bindings_updated_idx").on(table.updatedAt),
  ],
);

export const backgroundRuns = sqliteTable(
  "background_runs",
  {
    id: text("id").primaryKey(),
    runtime: text("runtime").notNull(),
    parentSessionId: text("parent_session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    parentExternalSessionId: text("parent_external_session_id").notNull(),
    childExternalSessionId: text("child_external_session_id").notNull(),
    requestedBy: text("requested_by").notNull().default("system"),
    prompt: text("prompt").notNull().default(""),
    status: text("status").notNull().default("created"),
    resultSummary: text("result_summary"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  table => [
    index("background_runs_child_external_idx").on(table.runtime, table.childExternalSessionId),
    index("background_runs_parent_created_idx").on(table.parentSessionId, table.createdAt),
    index("background_runs_status_updated_idx").on(table.status, table.updatedAt),
  ],
);
