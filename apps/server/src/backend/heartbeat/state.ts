import type { HeartbeatLastResult, HeartbeatRuntimeState } from "./types";
import { sqlite } from "../db/client";

interface HeartbeatRuntimeStateRow {
  id: string;
  session_id: string | null;
  background_run_id: string | null;
  parent_session_id: string | null;
  external_session_id: string | null;
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
  `);
  const columns = sqlite
    .query("PRAGMA table_info(heartbeat_runtime_state)")
    .all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map(column => column.name));
  if (!columnNames.has("background_run_id")) {
    sqlite.run("ALTER TABLE heartbeat_runtime_state ADD COLUMN background_run_id TEXT");
  }
  if (!columnNames.has("parent_session_id")) {
    sqlite.run("ALTER TABLE heartbeat_runtime_state ADD COLUMN parent_session_id TEXT");
  }
  if (!columnNames.has("external_session_id")) {
    sqlite.run("ALTER TABLE heartbeat_runtime_state ADD COLUMN external_session_id TEXT");
  }
}

function rowToState(row: HeartbeatRuntimeStateRow | null): HeartbeatRuntimeState {
  if (!row) {
    return {
      sessionId: null,
      backgroundRunId: null,
      parentSessionId: null,
      externalSessionId: null,
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
    backgroundRunId: row.background_run_id,
    parentSessionId: row.parent_session_id,
    externalSessionId: row.external_session_id,
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
      SELECT
        id, session_id, background_run_id, parent_session_id, external_session_id,
        running, last_run_at, last_result, last_response, last_error, updated_at
      FROM heartbeat_runtime_state
      WHERE id = ?1
      LIMIT 1
    `,
    )
    .get(STATE_ID) as HeartbeatRuntimeStateRow | null;
  return rowToState(row);
}

export function getReservedHeartbeatSessionId(): string | null {
  return getHeartbeatRuntimeState().sessionId;
}

export function isActiveHeartbeatSession(sessionId: string): boolean {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return false;
  return getReservedHeartbeatSessionId() === normalizedSessionId;
}

export function patchHeartbeatRuntimeState(
  patch: Partial<{
    sessionId: string | null;
    backgroundRunId: string | null;
    parentSessionId: string | null;
    externalSessionId: string | null;
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
        id, session_id, background_run_id, parent_session_id, external_session_id,
        running, last_run_at, last_result, last_response, last_error, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
      ON CONFLICT(id) DO UPDATE SET
        session_id = excluded.session_id,
        background_run_id = excluded.background_run_id,
        parent_session_id = excluded.parent_session_id,
        external_session_id = excluded.external_session_id,
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
      patch.backgroundRunId !== undefined ? patch.backgroundRunId : existing.backgroundRunId,
      patch.parentSessionId !== undefined ? patch.parentSessionId : existing.parentSessionId,
      patch.externalSessionId !== undefined ? patch.externalSessionId : existing.externalSessionId,
      (patch.running !== undefined ? patch.running : existing.running) ? 1 : 0,
      patch.lastRunAt !== undefined ? patch.lastRunAt : existing.lastRunAt ? Date.parse(existing.lastRunAt) : null,
      patch.lastResult !== undefined ? patch.lastResult : existing.lastResult,
      patch.lastResponse !== undefined ? patch.lastResponse : existing.lastResponse,
      patch.lastError !== undefined ? patch.lastError : existing.lastError,
      updatedAt,
    );
  return getHeartbeatRuntimeState();
}
