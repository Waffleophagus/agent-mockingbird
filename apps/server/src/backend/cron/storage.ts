import { sqlite } from "../db/client";

function tableHasColumn(tableName: string, columnName: string): boolean {
  const columns = sqlite.query(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: unknown }>;
  return columns.some(column => column.name === columnName);
}

export function ensureCronTables() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS cron_job_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      thread_session_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('at', 'every', 'cron')),
      schedule_expr TEXT,
      every_ms INTEGER,
      at_iso TEXT,
      timezone TEXT,
      run_mode TEXT NOT NULL CHECK (run_mode IN ('background', 'conditional_agent', 'agent')),
      handler_key TEXT,
      condition_module_path TEXT,
      condition_description TEXT,
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

    CREATE TABLE IF NOT EXISTS cron_job_instances (
      id TEXT PRIMARY KEY,
      job_definition_id TEXT NOT NULL REFERENCES cron_job_definitions(id) ON DELETE CASCADE,
      scheduled_for INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('queued', 'leased', 'running', 'completed', 'failed', 'dead')),
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
      id TEXT PRIMARY KEY,
      job_instance_id TEXT NOT NULL REFERENCES cron_job_instances(id) ON DELETE CASCADE,
      step_kind TEXT NOT NULL CHECK (step_kind IN ('background', 'conditional_agent', 'agent')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
      input_json TEXT,
      output_json TEXT,
      error_json TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS cron_job_steps_instance_idx
      ON cron_job_steps(job_instance_id, created_at ASC);
  `);

  if (!tableHasColumn("cron_job_definitions", "condition_module_path")) {
    sqlite.exec("ALTER TABLE cron_job_definitions ADD COLUMN condition_module_path TEXT");
  }
  if (!tableHasColumn("cron_job_definitions", "condition_description")) {
    sqlite.exec("ALTER TABLE cron_job_definitions ADD COLUMN condition_description TEXT");
  }
  if (!tableHasColumn("cron_job_definitions", "thread_session_id")) {
    sqlite.exec("ALTER TABLE cron_job_definitions ADD COLUMN thread_session_id TEXT");
  }
  if (!tableHasColumn("cron_job_instances", "agent_invoked")) {
    sqlite.exec("ALTER TABLE cron_job_instances ADD COLUMN agent_invoked INTEGER NOT NULL DEFAULT 0");
  }
}

export function clearCronTables() {
  ensureCronTables();
  sqlite.query("DELETE FROM cron_job_steps").run();
  sqlite.query("DELETE FROM cron_job_instances").run();
  sqlite.query("DELETE FROM cron_job_definitions").run();
}
