import { sqlite } from "../db/client";

export function ensureRunTables() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed')),
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT,
      result_json TEXT,
      error_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );

    CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_idempotency_idx
      ON agent_runs(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS agent_runs_state_created_idx
      ON agent_runs(state, created_at ASC);
    CREATE INDEX IF NOT EXISTS agent_runs_session_created_idx
      ON agent_runs(session_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS agent_run_events (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(run_id, seq)
    );

    CREATE INDEX IF NOT EXISTS agent_run_events_run_seq_idx
      ON agent_run_events(run_id, seq ASC);
  `);
}

export function clearRunTables() {
  ensureRunTables();
  sqlite.query("DELETE FROM agent_run_events").run();
  sqlite.query("DELETE FROM agent_runs").run();
}
