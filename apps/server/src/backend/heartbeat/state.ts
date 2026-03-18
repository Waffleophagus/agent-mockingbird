import type { HeartbeatLastResult, HeartbeatRuntimeState } from "./types";
import { sqlite } from "../db/client";

interface HeartbeatRuntimeStateRow {
  id: string;
  session_id: string | null;
  running: number;
  last_run_at: number | null;
  last_result: HeartbeatLastResult;
  last_response: string | null;
  last_error: string | null;
  updated_at: number;
}

const STATE_ID = "default";

function nowMs() {
  return Date.now();
}

function toIso(value: number | null) {
  return value == null ? null : new Date(value).toISOString();
}

export function ensureHeartbeatStateTable() {
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS heartbeat_runtime_state (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      running INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER,
      last_result TEXT NOT NULL DEFAULT 'idle',
      last_response TEXT,
      last_error TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
}

function rowToState(row: HeartbeatRuntimeStateRow | null): HeartbeatRuntimeState {
  if (!row) {
    return {
      sessionId: null,
      running: false,
      lastRunAt: null,
      lastResult: "idle",
      lastResponse: null,
      lastError: null,
      updatedAt: new Date(0).toISOString(),
    };
  }

  return {
    sessionId: row.session_id,
    running: row.running === 1,
    lastRunAt: toIso(row.last_run_at),
    lastResult: row.last_result,
    lastResponse: row.last_response,
    lastError: row.last_error,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function getHeartbeatRuntimeState(): HeartbeatRuntimeState {
  ensureHeartbeatStateTable();
  const row = sqlite
    .query(
      `
      SELECT id, session_id, running, last_run_at, last_result, last_response, last_error, updated_at
      FROM heartbeat_runtime_state
      WHERE id = ?1
      LIMIT 1
    `,
    )
    .get(STATE_ID) as HeartbeatRuntimeStateRow | null;
  return rowToState(row);
}

export function patchHeartbeatRuntimeState(
  patch: Partial<{
    sessionId: string | null;
    running: boolean;
    lastRunAt: number | null;
    lastResult: HeartbeatLastResult;
    lastResponse: string | null;
    lastError: string | null;
  }>,
) {
  ensureHeartbeatStateTable();
  const existing = getHeartbeatRuntimeState();
  const updatedAt = nowMs();
  sqlite
    .query(
      `
      INSERT INTO heartbeat_runtime_state (
        id, session_id, running, last_run_at, last_result, last_response, last_error, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ON CONFLICT(id) DO UPDATE SET
        session_id = excluded.session_id,
        running = excluded.running,
        last_run_at = excluded.last_run_at,
        last_result = excluded.last_result,
        last_response = excluded.last_response,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `,
    )
    .run(
      STATE_ID,
      patch.sessionId !== undefined ? patch.sessionId : existing.sessionId,
      (patch.running !== undefined ? patch.running : existing.running) ? 1 : 0,
      patch.lastRunAt !== undefined ? patch.lastRunAt : existing.lastRunAt ? Date.parse(existing.lastRunAt) : null,
      patch.lastResult !== undefined ? patch.lastResult : existing.lastResult,
      patch.lastResponse !== undefined ? patch.lastResponse : existing.lastResponse,
      patch.lastError !== undefined ? patch.lastError : existing.lastError,
      updatedAt,
    );
  return getHeartbeatRuntimeState();
}
