import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    requestCountDelta: integer("request_count_delta").notNull().default(0),
    inputTokensDelta: integer("input_tokens_delta").notNull().default(0),
    outputTokensDelta: integer("output_tokens_delta").notNull().default(0),
    estimatedCostUsdDelta: integer("estimated_cost_usd_delta_micros").notNull().default(0),
    source: text("source", { enum: ["api", "runtime", "scheduler", "system"] }).notNull().default("system"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  table => [index("usage_events_created_idx").on(table.createdAt)],
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
