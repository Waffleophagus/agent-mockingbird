import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { env } from "../env";
import { resolveDataPath } from "../paths";

let sqliteHandle: Database | null = null;
let openDbPath: string | null = null;

function configureDatabase(db: Database) {
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=NORMAL;");
  db.exec("PRAGMA busy_timeout=5000;");
  db.exec("PRAGMA foreign_keys=ON;");
}

function ensureBootstrapSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      last_active_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS sessions_last_active_idx ON sessions(last_active_at);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS messages_session_created_idx ON messages(session_id, created_at);

    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      provider_id TEXT,
      model_id TEXT,
      request_count_delta INTEGER NOT NULL DEFAULT 0,
      input_tokens_delta INTEGER NOT NULL DEFAULT 0,
      output_tokens_delta INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd_delta_micros INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'system',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS usage_events_created_idx ON usage_events(created_at);
    CREATE INDEX IF NOT EXISTS usage_events_provider_created_idx ON usage_events(provider_id, created_at);
    CREATE INDEX IF NOT EXISTS usage_events_provider_model_created_idx
      ON usage_events(provider_id, model_id, created_at);

    CREATE TABLE IF NOT EXISTS heartbeat_events (
      id TEXT PRIMARY KEY NOT NULL,
      online INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'system',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS heartbeat_events_created_idx ON heartbeat_events(created_at);

    CREATE TABLE IF NOT EXISTS runtime_config (
      key TEXT PRIMARY KEY NOT NULL,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS runtime_session_bindings (
      runtime TEXT NOT NULL,
      session_id TEXT NOT NULL,
      external_session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      PRIMARY KEY(runtime, session_id)
    );
    CREATE INDEX IF NOT EXISTS runtime_session_bindings_external_idx
      ON runtime_session_bindings(runtime, external_session_id);
    CREATE INDEX IF NOT EXISTS runtime_session_bindings_updated_idx ON runtime_session_bindings(updated_at);

    CREATE TABLE IF NOT EXISTS background_runs (
      id TEXT PRIMARY KEY NOT NULL,
      runtime TEXT NOT NULL,
      parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      parent_external_session_id TEXT NOT NULL,
      child_external_session_id TEXT NOT NULL,
      requested_by TEXT NOT NULL DEFAULT 'system',
      prompt TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'created',
      result_summary TEXT,
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      started_at INTEGER,
      completed_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS background_runs_child_external_idx
      ON background_runs(runtime, child_external_session_id);
    CREATE INDEX IF NOT EXISTS background_runs_parent_created_idx
      ON background_runs(parent_session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS background_runs_status_updated_idx
      ON background_runs(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS message_memory_traces (
      message_id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      trace_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS message_memory_traces_session_idx
      ON message_memory_traces(session_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS message_parts (
      message_id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      parts_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS message_parts_session_updated_idx
      ON message_parts(session_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS heartbeat_runtime_state (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT,
      background_run_id TEXT,
      parent_session_id TEXT,
      external_session_id TEXT,
      running INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER,
      last_result TEXT NOT NULL DEFAULT 'idle',
      last_response TEXT,
      last_error TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      state TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      idempotency_key TEXT,
      result_json TEXT,
      error_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS agent_runs_state_created_idx ON agent_runs(state, created_at);
    CREATE INDEX IF NOT EXISTS agent_runs_session_created_idx ON agent_runs(session_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_idempotency_idx
      ON agent_runs(idempotency_key) WHERE idempotency_key IS NOT NULL;

    CREATE TABLE IF NOT EXISTS agent_run_events (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_run_events_run_seq_idx ON agent_run_events(run_id, seq ASC);

    CREATE TABLE IF NOT EXISTS cron_job_definitions (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      schedule_kind TEXT NOT NULL,
      schedule_expr TEXT,
      every_ms INTEGER,
      at_iso TEXT,
      timezone TEXT,
      run_mode TEXT NOT NULL,
      handler_key TEXT,
      condition_module_path TEXT,
      condition_description TEXT,
      thread_session_id TEXT,
      agent_prompt_template TEXT,
      agent_model_override TEXT,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      retry_backoff_ms INTEGER NOT NULL DEFAULT 30000,
      payload_json TEXT NOT NULL DEFAULT '{}',
      last_enqueued_for INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cron_job_definitions_enabled_idx
      ON cron_job_definitions(enabled, schedule_kind);
    CREATE UNIQUE INDEX IF NOT EXISTS cron_job_definitions_thread_session_id_idx
      ON cron_job_definitions(thread_session_id)
      WHERE thread_session_id IS NOT NULL AND TRIM(thread_session_id) <> '';

    CREATE TABLE IF NOT EXISTS cron_job_instances (
      id TEXT PRIMARY KEY NOT NULL,
      job_definition_id TEXT NOT NULL REFERENCES cron_job_definitions(id) ON DELETE CASCADE,
      scheduled_for INTEGER NOT NULL,
      state TEXT NOT NULL,
      agent_invoked INTEGER NOT NULL DEFAULT 0,
      attempt INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER,
      lease_owner TEXT,
      lease_expires_at INTEGER,
      last_heartbeat_at INTEGER,
      result_summary TEXT,
      error_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(job_definition_id, scheduled_for)
    );
    CREATE INDEX IF NOT EXISTS cron_job_instances_ready_idx
      ON cron_job_instances(state, next_attempt_at, scheduled_for);
    CREATE INDEX IF NOT EXISTS cron_job_instances_job_idx
      ON cron_job_instances(job_definition_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS cron_job_steps (
      id TEXT PRIMARY KEY NOT NULL,
      job_instance_id TEXT NOT NULL REFERENCES cron_job_instances(id) ON DELETE CASCADE,
      step_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      error_json TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cron_job_steps_instance_idx
      ON cron_job_steps(job_instance_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS memory_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_files (
      path TEXT PRIMARY KEY NOT NULL,
      source TEXT NOT NULL DEFAULT 'memory',
      hash TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_chunks (
      id TEXT PRIMARY KEY NOT NULL,
      path TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'memory',
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding_json TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memory_chunks_path_idx ON memory_chunks(path);
    CREATE INDEX IF NOT EXISTS memory_chunks_updated_idx ON memory_chunks(updated_at);

    CREATE TABLE IF NOT EXISTS memory_embedding_cache (
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      hash TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      dims INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(provider, model, hash)
    );
    CREATE INDEX IF NOT EXISTS memory_embedding_cache_updated_idx
      ON memory_embedding_cache(updated_at);

    CREATE TABLE IF NOT EXISTS memory_records (
      id TEXT PRIMARY KEY NOT NULL,
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      entities_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      supersedes_json TEXT NOT NULL,
      superseded_by TEXT,
      recorded_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memory_records_path_idx ON memory_records(path);
    CREATE INDEX IF NOT EXISTS memory_records_superseded_idx ON memory_records(superseded_by);

    CREATE TABLE IF NOT EXISTS memory_write_events (
      id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL NOT NULL,
      session_id TEXT,
      topic TEXT,
      record_id TEXT,
      path TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS memory_write_events_created_idx
      ON memory_write_events(created_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
      text,
      chunk_id UNINDEXED,
      path UNINDEXED,
      start_line UNINDEXED,
      end_line UNINDEXED,
      updated_at UNINDEXED
    );

    CREATE TABLE IF NOT EXISTS channel_conversation_bindings (
      channel TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      last_target TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(channel, conversation_key)
    );
    CREATE INDEX IF NOT EXISTS channel_conversation_bindings_session_idx
      ON channel_conversation_bindings(session_id);
    CREATE INDEX IF NOT EXISTS channel_conversation_bindings_updated_idx
      ON channel_conversation_bindings(updated_at);

    CREATE TABLE IF NOT EXISTS channel_pairing_requests (
      channel TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      code TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      meta_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY(channel, sender_id)
    );
    CREATE INDEX IF NOT EXISTS channel_pairing_requests_code_idx
      ON channel_pairing_requests(channel, code);
    CREATE INDEX IF NOT EXISTS channel_pairing_requests_expires_idx
      ON channel_pairing_requests(expires_at);

    CREATE TABLE IF NOT EXISTS channel_allowlist_entries (
      channel TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'pairing',
      created_at INTEGER NOT NULL,
      PRIMARY KEY(channel, sender_id)
    );
    CREATE INDEX IF NOT EXISTS channel_allowlist_entries_channel_idx
      ON channel_allowlist_entries(channel, created_at);

    CREATE TABLE IF NOT EXISTS channel_inbound_dedupe (
      channel TEXT NOT NULL,
      event_id TEXT NOT NULL,
      seen_at INTEGER NOT NULL,
      PRIMARY KEY(channel, event_id)
    );
    CREATE INDEX IF NOT EXISTS channel_inbound_dedupe_seen_idx ON channel_inbound_dedupe(seen_at);
  `);
}

export function getResolvedDbPath() {
  const configuredPath = env.AGENT_MOCKINGBIRD_DB_PATH?.trim();
  return configuredPath ? path.resolve(configuredPath) : resolveDataPath("agent-mockingbird.db");
}

function getSqliteHandle() {
  const resolvedDbPath = getResolvedDbPath();
  if (sqliteHandle && openDbPath !== resolvedDbPath) {
    sqliteHandle.close(false);
    sqliteHandle = null;
    openDbPath = null;
  }
  if (!sqliteHandle) {
    mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
    sqliteHandle = new Database(resolvedDbPath);
    openDbPath = resolvedDbPath;
    configureDatabase(sqliteHandle);
    ensureBootstrapSchema(sqliteHandle);
  }
  return sqliteHandle;
}

export const sqlite = new Proxy({} as Database, {
  get(_target, prop) {
    const db = getSqliteHandle();
    const value = Reflect.get(db as object, prop);
    if (prop === "close" && typeof value === "function") {
      return (...args: unknown[]) => {
        try {
          return (value as (...closeArgs: unknown[]) => unknown).apply(db, args);
        } finally {
          sqliteHandle = null;
          openDbPath = null;
        }
      };
    }
    if (typeof value === "function") {
      return value.bind(db);
    }
    return value;
  },
  set(_target, prop, value) {
    Reflect.set(getSqliteHandle() as object, prop, value);
    return true;
  },
});

export const resolvedDbPath = getResolvedDbPath();
