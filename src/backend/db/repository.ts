import type { SQLQueryBindings } from "bun:sqlite";

import { sqlite } from "./client";
import type {
  ChatMessage,
  ChatMessagePart,
  DashboardBootstrap,
  HeartbeatSnapshot,
  MessageMemoryTrace,
  SessionSummary,
  UsageSnapshot,
} from "../../types/dashboard";
import { toLegacySpecialistAgent } from "../agents/service";
import { getConfig as getManagedConfig } from "../config/service";
import { clearCronTables } from "../cron/storage";
import { DEFAULT_SESSIONS } from "../defaults";
import { clearRunTables } from "../run/storage";

type RuntimeEventSource = "api" | "runtime" | "scheduler" | "system";

interface SessionRow {
  id: string;
  title: string;
  model: string;
  status: "active" | "idle";
  message_count: number;
  last_active_at: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
}

interface MessageMemoryTraceRow {
  message_id: string;
  trace_json: string;
}

interface MessagePartsRow {
  message_id: string;
  parts_json: string;
}

interface HeartbeatRow {
  online: number;
  created_at: number;
}

interface UsageAggregateRow {
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
}

interface RuntimeSessionBindingRow {
  runtime: string;
  session_id: string;
  external_session_id: string;
  updated_at: number;
}

interface ExistingMessageIdRow {
  id: string;
  content: string;
}

export interface RuntimeSessionBindingRecord {
  runtime: string;
  sessionId: string;
  externalSessionId: string;
  updatedAt: string;
}

export type BackgroundRunStatus =
  | "created"
  | "running"
  | "retrying"
  | "idle"
  | "completed"
  | "failed"
  | "aborted";

interface BackgroundRunRow {
  id: string;
  runtime: string;
  parent_session_id: string;
  parent_external_session_id: string;
  child_external_session_id: string;
  requested_by: string;
  prompt: string;
  status: BackgroundRunStatus;
  result_summary: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

export interface BackgroundRunRecord {
  id: string;
  runtime: string;
  parentSessionId: string;
  parentExternalSessionId: string;
  childExternalSessionId: string;
  requestedBy: string;
  prompt: string;
  status: BackgroundRunStatus;
  resultSummary: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SessionMessageImportInput {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  parts?: ChatMessagePart[];
}

const nowMs = () => Date.now();
const toIso = (millis: number) => new Date(millis).toISOString();
const toMillisOrNull = (isoTimestamp: string | null) => {
  if (!isoTimestamp) return null;
  const parsed = Date.parse(isoTimestamp);
  return Number.isFinite(parsed) ? parsed : null;
};
const sessionIdPrefix = "session";

function scalar<T>(query: string, ...bindings: SQLQueryBindings[]): T {
  const row = sqlite.query(query).get(...bindings);
  return row as T;
}

function allRows<T>(query: string, ...bindings: SQLQueryBindings[]): T[] {
  return sqlite.query(query).all(...bindings) as T[];
}

function sessionRowToSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    status: row.status,
    lastActiveAt: toIso(row.last_active_at),
    messageCount: row.message_count,
  };
}

function messageRowToMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    at: toIso(row.created_at),
  };
}

function backgroundRunRowToRecord(row: BackgroundRunRow): BackgroundRunRecord {
  return {
    id: row.id,
    runtime: row.runtime,
    parentSessionId: row.parent_session_id,
    parentExternalSessionId: row.parent_external_session_id,
    childExternalSessionId: row.child_external_session_id,
    requestedBy: row.requested_by,
    prompt: row.prompt,
    status: row.status,
    resultSummary: row.result_summary,
    error: row.error,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    startedAt: row.started_at ? toIso(row.started_at) : null,
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
  };
}

function runtimeSessionBindingRowToRecord(row: RuntimeSessionBindingRow): RuntimeSessionBindingRecord {
  return {
    runtime: row.runtime,
    sessionId: row.session_id,
    externalSessionId: row.external_session_id,
    updatedAt: toIso(row.updated_at),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function normalizeChatMessagePart(raw: unknown): ChatMessagePart | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const type = typeof raw.type === "string" ? raw.type : "";
  if (!id || !type) return null;

  if (type === "thinking") {
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!text) return null;
    return {
      id,
      type: "thinking",
      text,
      startedAt: normalizeIsoTimestamp(raw.startedAt),
      endedAt: normalizeIsoTimestamp(raw.endedAt),
      observedAt: normalizeIsoTimestamp(raw.observedAt),
    };
  }

  if (type === "tool_call") {
    const toolCallId = typeof raw.toolCallId === "string" ? raw.toolCallId.trim() : "";
    const tool = typeof raw.tool === "string" ? raw.tool.trim() : "";
    const status = typeof raw.status === "string" ? raw.status : "";
    if (!toolCallId || !tool || (status !== "pending" && status !== "running" && status !== "completed" && status !== "error")) {
      return null;
    }
    const output = typeof raw.output === "string" ? raw.output : undefined;
    const error = typeof raw.error === "string" ? raw.error : undefined;
    return {
      id,
      type: "tool_call",
      toolCallId,
      tool,
      status,
      input: isRecord(raw.input) ? raw.input : undefined,
      output,
      error,
      startedAt: normalizeIsoTimestamp(raw.startedAt),
      endedAt: normalizeIsoTimestamp(raw.endedAt),
      observedAt: normalizeIsoTimestamp(raw.observedAt),
    };
  }

  return null;
}

function normalizeChatMessageParts(value: unknown): ChatMessagePart[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(part => normalizeChatMessagePart(part))
    .filter((part): part is ChatMessagePart => Boolean(part));
}

function ensureAuxiliaryTables() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS message_memory_traces (
      message_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      trace_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS message_memory_traces_session_idx
      ON message_memory_traces(session_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS message_parts (
      message_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      parts_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS message_parts_session_updated_idx
      ON message_parts(session_id, updated_at DESC);
  `);
}

ensureAuxiliaryTables();

function getDefaultSessionModel() {
  const runtimeConfig = getManagedConfig();
  const provider = runtimeConfig.runtime.opencode.providerId.trim();
  const model = runtimeConfig.runtime.opencode.modelId.trim();
  if (provider && model) {
    return `${provider}/${model}`;
  }
  return DEFAULT_SESSIONS[0]?.model ?? "default";
}

function createSessionRecord(input: {
  id: string;
  title: string;
  model: string;
  status?: SessionRow["status"];
  messageCount?: number;
  createdAt?: number;
}) {
  const createdAt = input.createdAt ?? nowMs();
  sqlite
    .query(
      `
      INSERT INTO sessions (
        id, title, model, status, message_count, created_at, updated_at, last_active_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
    `,
    )
    .run(input.id, input.title, input.model, input.status ?? "idle", input.messageCount ?? 0, createdAt);
}

function allocateSessionId() {
  let id = `${sessionIdPrefix}-${crypto.randomUUID().slice(0, 8)}`;
  while (scalar<{ count: number }>("SELECT COUNT(*) as count FROM sessions WHERE id = ?1", id).count > 0) {
    id = `${sessionIdPrefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return id;
}

function seedDefaultState(createdAt: number) {
  const defaultModel = getDefaultSessionModel();

  for (const session of DEFAULT_SESSIONS) {
    createSessionRecord({
      id: session.id,
      title: session.title,
      model: defaultModel,
      createdAt,
      status: "idle",
      messageCount: 0,
    });
  }

  sqlite
    .query(
      `
      INSERT INTO heartbeat_events (id, online, source, created_at)
      VALUES (?1, 1, 'system', ?2)
    `,
    )
    .run(crypto.randomUUID(), createdAt);
}

export function ensureSeedData() {
  const seeded = scalar<{ count: number }>("SELECT COUNT(*) as count FROM sessions").count > 0;
  if (seeded) return;

  const seed = sqlite.transaction(() => {
    seedDefaultState(nowMs());
  });

  seed();
}

export function createSession(input?: { title?: string; model?: string }): SessionSummary {
  const inserted = sqlite.transaction(() => {
    const totalSessions = scalar<{ count: number }>("SELECT COUNT(*) as count FROM sessions").count;
    const title = input?.title?.trim() || `Session ${totalSessions + 1}`;
    const model = input?.model?.trim() || getDefaultSessionModel();
    const id = allocateSessionId();

    createSessionRecord({
      id,
      title,
      model,
      status: "idle",
      messageCount: 0,
    });
    return id;
  });

  const sessionId = inserted();
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error(`Failed to load newly created session ${sessionId}`);
  }
  return session;
}

export function resetDatabaseToDefaults(): DashboardBootstrap {
  const reset = sqlite.transaction(() => {
    clearCronTables();
    clearRunTables();
    sqlite.query("DELETE FROM message_memory_traces").run();
    sqlite.query("DELETE FROM message_parts").run();
    sqlite.query("DELETE FROM messages").run();
    sqlite.query("DELETE FROM usage_events").run();
    sqlite.query("DELETE FROM heartbeat_events").run();
    sqlite.query("DELETE FROM runtime_config").run();
    sqlite.query("DELETE FROM runtime_session_bindings").run();
    sqlite.query("DELETE FROM background_runs").run();
    sqlite.query("DELETE FROM sessions").run();
    seedDefaultState(nowMs());
  });
  reset();
  return getDashboardBootstrap();
}

export function listSessions(): SessionSummary[] {
  const rows = allRows<SessionRow>(
    `
      SELECT id, title, model, status, message_count, last_active_at
      FROM sessions
      ORDER BY last_active_at DESC
    `,
  );
  return rows.map(sessionRowToSummary);
}

export function getSessionById(sessionId: string): SessionSummary | null {
  const row = scalar<SessionRow | null>(
    `
      SELECT id, title, model, status, message_count, last_active_at
      FROM sessions
      WHERE id = ?1
    `,
    sessionId,
  );
  return row ? sessionRowToSummary(row) : null;
}

export function setSessionModel(sessionId: string, model: string): SessionSummary | null {
  const normalized = model.trim();
  if (!normalized) return null;
  const updatedAt = nowMs();
  sqlite
    .query(
      `
      UPDATE sessions
      SET model = ?2, updated_at = ?3
      WHERE id = ?1
    `,
    )
    .run(sessionId, normalized, updatedAt);

  return getSessionById(sessionId);
}

export function setSessionTitle(sessionId: string, title: string): SessionSummary | null {
  const normalized = title.trim();
  if (!normalized) return null;
  const updatedAt = nowMs();
  sqlite
    .query(
      `
      UPDATE sessions
      SET title = ?2, updated_at = ?3
      WHERE id = ?1
    `,
    )
    .run(sessionId, normalized, updatedAt);

  return getSessionById(sessionId);
}

export function listMessagesForSession(sessionId: string): ChatMessage[] {
  const rows = allRows<MessageRow>(
    `
      SELECT id, session_id, role, content, created_at
      FROM messages
      WHERE session_id = ?1
      ORDER BY created_at ASC
    `,
    sessionId,
  );

  const messages = rows.map(messageRowToMessage);
  if (!messages.length) return messages;

  const messageIds = messages.map(message => message.id);
  const placeholders = messageIds.map(() => "?").join(", ");
  const traceRows = sqlite
    .query(
      `
      SELECT message_id, trace_json
      FROM message_memory_traces
      WHERE session_id = ?1
        AND message_id IN (${placeholders})
    `,
    )
    .all(sessionId, ...messageIds) as MessageMemoryTraceRow[];
  const traceMap = new Map<string, MessageMemoryTrace>();
  for (const row of traceRows) {
    try {
      traceMap.set(row.message_id, JSON.parse(row.trace_json) as MessageMemoryTrace);
    } catch {
      // ignore malformed trace rows
    }
  }

  const partRows = sqlite
    .query(
      `
      SELECT message_id, parts_json
      FROM message_parts
      WHERE session_id = ?1
        AND message_id IN (${placeholders})
    `,
    )
    .all(sessionId, ...messageIds) as MessagePartsRow[];
  const partMap = new Map<string, ChatMessagePart[]>();
  for (const row of partRows) {
    try {
      const parsed = JSON.parse(row.parts_json) as unknown;
      const parts = normalizeChatMessageParts(parsed);
      if (parts.length > 0) {
        partMap.set(row.message_id, parts);
      }
    } catch {
      // ignore malformed part rows
    }
  }

  return messages.map(message => ({
    ...message,
    memoryTrace: traceMap.get(message.id),
    parts: partMap.get(message.id),
  }));
}

export function setMessageMemoryTrace(input: {
  sessionId: string;
  messageId: string;
  trace: MessageMemoryTrace;
  createdAt?: number;
}) {
  ensureAuxiliaryTables();
  const createdAt = input.createdAt ?? nowMs();
  sqlite
    .query(
      `
      INSERT INTO message_memory_traces (message_id, session_id, trace_json, created_at)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(message_id) DO UPDATE SET
        session_id = excluded.session_id,
        trace_json = excluded.trace_json,
        created_at = excluded.created_at
    `,
    )
    .run(input.messageId, input.sessionId, JSON.stringify(input.trace), createdAt);
}

export function setMessageParts(input: {
  sessionId: string;
  messageId: string;
  parts: ChatMessagePart[];
  createdAt?: number;
  updatedAt?: number;
}) {
  ensureAuxiliaryTables();
  const createdAt = input.createdAt ?? nowMs();
  const updatedAt = input.updatedAt ?? createdAt;
  const parts = normalizeChatMessageParts(input.parts);
  sqlite
    .query(
      `
      INSERT INTO message_parts (message_id, session_id, parts_json, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(message_id) DO UPDATE SET
        session_id = excluded.session_id,
        parts_json = excluded.parts_json,
        updated_at = excluded.updated_at
    `,
    )
    .run(input.messageId, input.sessionId, JSON.stringify(parts), createdAt, updatedAt);
}

export function getUsageSnapshot(): UsageSnapshot {
  const row = scalar<UsageAggregateRow>(
    `
      SELECT
        COALESCE(SUM(request_count_delta), 0) AS request_count,
        COALESCE(SUM(input_tokens_delta), 0) AS input_tokens,
        COALESCE(SUM(output_tokens_delta), 0) AS output_tokens,
        COALESCE(SUM(estimated_cost_usd_delta_micros), 0) AS cost_micros
      FROM usage_events
    `,
  );

  return {
    requestCount: row.request_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    estimatedCostUsd: row.cost_micros / 1_000_000,
  };
}

export function recordUsageDelta(input: {
  sessionId?: string;
  requestCountDelta: number;
  inputTokensDelta: number;
  outputTokensDelta: number;
  estimatedCostUsdDelta: number;
  source: RuntimeEventSource;
  createdAt?: number;
}) {
  const createdAt = input.createdAt ?? nowMs();
  sqlite
    .query(
      `
      INSERT INTO usage_events (
        id, session_id, request_count_delta, input_tokens_delta,
        output_tokens_delta, estimated_cost_usd_delta_micros, source, created_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `,
    )
    .run(
      crypto.randomUUID(),
      input.sessionId ?? null,
      input.requestCountDelta,
      input.inputTokensDelta,
      input.outputTokensDelta,
      Math.round(input.estimatedCostUsdDelta * 1_000_000),
      input.source,
      createdAt,
    );
}

export function getHeartbeatSnapshot(): HeartbeatSnapshot {
  const row = scalar<HeartbeatRow | null>(
    `
      SELECT online, created_at
      FROM heartbeat_events
      ORDER BY created_at DESC
      LIMIT 1
    `,
  );

  if (!row) {
    return { online: true, at: toIso(nowMs()) };
  }

  return {
    online: row.online === 1,
    at: toIso(row.created_at),
  };
}

export function recordHeartbeat(source: RuntimeEventSource, online = true, createdAt = nowMs()): HeartbeatSnapshot {
  sqlite
    .query(
      `
      INSERT INTO heartbeat_events (id, online, source, created_at)
      VALUES (?1, ?2, ?3, ?4)
    `,
    )
    .run(crypto.randomUUID(), online ? 1 : 0, source, createdAt);

  return {
    online,
    at: toIso(createdAt),
  };
}

export function getConfig() {
  const managedConfig = getManagedConfig();
  const agents =
    managedConfig.ui.agents.length > 0
      ? managedConfig.ui.agents
      : managedConfig.ui.agentTypes.map(toLegacySpecialistAgent);
  return {
    skills: managedConfig.ui.skills,
    mcps: managedConfig.ui.mcps,
    agents,
  };
}

export function getRuntimeSessionBinding(runtime: string, sessionId: string): string | null {
  const normalizedRuntime = runtime.trim();
  const normalizedSessionId = sessionId.trim();
  if (!normalizedRuntime || !normalizedSessionId) return null;
  const row = scalar<{ external_session_id: string } | null>(
    `
      SELECT external_session_id
      FROM runtime_session_bindings
      WHERE runtime = ?1
        AND session_id = ?2
      LIMIT 1
    `,
    normalizedRuntime,
    normalizedSessionId,
  );
  return row?.external_session_id ?? null;
}

export function getLocalSessionIdByRuntimeBinding(runtime: string, externalSessionId: string): string | null {
  const normalizedRuntime = runtime.trim();
  const normalizedExternalSessionId = externalSessionId.trim();
  if (!normalizedRuntime || !normalizedExternalSessionId) return null;
  const row = scalar<{ session_id: string } | null>(
    `
      SELECT session_id
      FROM runtime_session_bindings
      WHERE runtime = ?1
        AND external_session_id = ?2
      LIMIT 1
    `,
    normalizedRuntime,
    normalizedExternalSessionId,
  );
  return row?.session_id ?? null;
}

export function setRuntimeSessionBinding(runtime: string, sessionId: string, externalSessionId: string) {
  const normalizedRuntime = runtime.trim();
  const normalizedSessionId = sessionId.trim();
  const normalizedExternalSessionId = externalSessionId.trim();
  if (!normalizedRuntime || !normalizedSessionId || !normalizedExternalSessionId) {
    return;
  }
  const updatedAt = nowMs();
  sqlite
    .query(
      `
      INSERT INTO runtime_session_bindings (runtime, session_id, external_session_id, updated_at)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(runtime, session_id) DO UPDATE SET
        external_session_id = excluded.external_session_id,
        updated_at = excluded.updated_at
    `,
    )
    .run(normalizedRuntime, normalizedSessionId, normalizedExternalSessionId, updatedAt);
}

export function ensureSessionForRuntimeBinding(input: {
  runtime: string;
  externalSessionId: string;
  title?: string;
  model?: string;
  createdAt?: number;
}): SessionSummary | null {
  const normalizedRuntime = input.runtime.trim();
  const normalizedExternalSessionId = input.externalSessionId.trim();
  if (!normalizedRuntime || !normalizedExternalSessionId) return null;

  const tx = sqlite.transaction(() => {
    const existingSessionId = getLocalSessionIdByRuntimeBinding(normalizedRuntime, normalizedExternalSessionId);
    const normalizedTitle = input.title?.trim();
    const normalizedModel = input.model?.trim();
    if (existingSessionId) {
      if (normalizedTitle) {
        sqlite
          .query(
            `
            UPDATE sessions
            SET title = ?2, updated_at = ?3
            WHERE id = ?1
          `,
          )
          .run(existingSessionId, normalizedTitle, input.createdAt ?? nowMs());
      }
      if (normalizedModel) {
        sqlite
          .query(
            `
            UPDATE sessions
            SET model = ?2, updated_at = ?3
            WHERE id = ?1
          `,
          )
          .run(existingSessionId, normalizedModel, input.createdAt ?? nowMs());
      }
      return existingSessionId;
    }

    const totalSessions = scalar<{ count: number }>("SELECT COUNT(*) as count FROM sessions").count;
    const title = normalizedTitle || `Session ${totalSessions + 1}`;
    const model = normalizedModel || getDefaultSessionModel();
    const id = allocateSessionId();
    const createdAt = input.createdAt ?? nowMs();

    createSessionRecord({
      id,
      title,
      model,
      status: "idle",
      messageCount: 0,
      createdAt,
    });
    setRuntimeSessionBinding(normalizedRuntime, id, normalizedExternalSessionId);
    return id;
  });

  const sessionId = tx();
  return sessionId ? getSessionById(sessionId) : null;
}

export function listRuntimeSessionBindings(runtime: string, limit = 500): Array<RuntimeSessionBindingRecord> {
  const normalizedRuntime = runtime.trim();
  if (!normalizedRuntime) return [];
  const normalizedLimit = Math.max(1, Math.min(2_000, Math.floor(limit)));
  const rows = allRows<RuntimeSessionBindingRow>(
    `
      SELECT runtime, session_id, external_session_id, updated_at
      FROM runtime_session_bindings
      WHERE runtime = ?1
      ORDER BY updated_at DESC
      LIMIT ?2
    `,
    normalizedRuntime,
    normalizedLimit,
  );
  return rows.map(runtimeSessionBindingRowToRecord);
}

export function createBackgroundRun(input: {
  runtime: string;
  parentSessionId: string;
  parentExternalSessionId: string;
  childExternalSessionId: string;
  requestedBy?: string;
  prompt?: string;
  status?: BackgroundRunStatus;
  createdAt?: number;
}): BackgroundRunRecord | null {
  const normalizedRuntime = input.runtime.trim();
  const normalizedParentSessionId = input.parentSessionId.trim();
  const normalizedParentExternalSessionId = input.parentExternalSessionId.trim();
  const normalizedChildExternalSessionId = input.childExternalSessionId.trim();
  if (
    !normalizedRuntime ||
    !normalizedParentSessionId ||
    !normalizedParentExternalSessionId ||
    !normalizedChildExternalSessionId
  ) {
    return null;
  }

  const createdAt = input.createdAt ?? nowMs();
  const runId = `bg-${crypto.randomUUID().slice(0, 12)}`;

  sqlite
    .query(
      `
      INSERT INTO background_runs (
        id, runtime, parent_session_id, parent_external_session_id,
        child_external_session_id, requested_by, prompt, status,
        result_summary, error, created_at, updated_at, started_at, completed_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, ?9, ?9, NULL, NULL)
      ON CONFLICT(runtime, child_external_session_id) DO UPDATE SET
        parent_session_id = excluded.parent_session_id,
        parent_external_session_id = excluded.parent_external_session_id,
        requested_by = excluded.requested_by,
        prompt = CASE
          WHEN trim(excluded.prompt) <> '' THEN excluded.prompt
          ELSE background_runs.prompt
        END,
        status = CASE
          WHEN background_runs.status IN ('completed', 'failed', 'aborted') THEN background_runs.status
          ELSE excluded.status
        END,
        updated_at = excluded.updated_at
    `,
    )
    .run(
      runId,
      normalizedRuntime,
      normalizedParentSessionId,
      normalizedParentExternalSessionId,
      normalizedChildExternalSessionId,
      input.requestedBy?.trim() || "system",
      input.prompt ?? "",
      input.status ?? "created",
      createdAt,
    );

  return getBackgroundRunByChildExternalSessionId(normalizedRuntime, normalizedChildExternalSessionId);
}

export function getBackgroundRunById(runId: string): BackgroundRunRecord | null {
  const normalizedRunId = runId.trim();
  if (!normalizedRunId) return null;
  const row = scalar<BackgroundRunRow | null>(
    `
      SELECT *
      FROM background_runs
      WHERE id = ?1
      LIMIT 1
    `,
    normalizedRunId,
  );
  return row ? backgroundRunRowToRecord(row) : null;
}

export function getBackgroundRunByChildExternalSessionId(
  runtime: string,
  childExternalSessionId: string,
): BackgroundRunRecord | null {
  const normalizedRuntime = runtime.trim();
  const normalizedChildExternalSessionId = childExternalSessionId.trim();
  if (!normalizedRuntime || !normalizedChildExternalSessionId) return null;
  const row = scalar<BackgroundRunRow | null>(
    `
      SELECT *
      FROM background_runs
      WHERE runtime = ?1
        AND child_external_session_id = ?2
      LIMIT 1
    `,
    normalizedRuntime,
    normalizedChildExternalSessionId,
  );
  return row ? backgroundRunRowToRecord(row) : null;
}

export function listBackgroundRunsForParentSession(sessionId: string, limit = 50): Array<BackgroundRunRecord> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return [];
  const normalizedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = allRows<BackgroundRunRow>(
    `
      SELECT *
      FROM background_runs
      WHERE parent_session_id = ?1
      ORDER BY created_at DESC
      LIMIT ?2
    `,
    normalizedSessionId,
    normalizedLimit,
  );
  return rows.map(backgroundRunRowToRecord);
}

export function listInFlightBackgroundRuns(runtime: string, limit = 250): Array<BackgroundRunRecord> {
  const normalizedRuntime = runtime.trim();
  if (!normalizedRuntime) return [];
  const normalizedLimit = Math.max(1, Math.min(2_000, Math.floor(limit)));
  const rows = allRows<BackgroundRunRow>(
    `
      SELECT *
      FROM background_runs
      WHERE runtime = ?1
        AND status IN ('created', 'running', 'retrying', 'idle')
      ORDER BY updated_at ASC
      LIMIT ?2
    `,
    normalizedRuntime,
    normalizedLimit,
  );
  return rows.map(backgroundRunRowToRecord);
}

export function listRecentBackgroundRuns(runtime: string, limit = 250): Array<BackgroundRunRecord> {
  const normalizedRuntime = runtime.trim();
  if (!normalizedRuntime) return [];
  const normalizedLimit = Math.max(1, Math.min(2_000, Math.floor(limit)));
  const rows = allRows<BackgroundRunRow>(
    `
      SELECT *
      FROM background_runs
      WHERE runtime = ?1
      ORDER BY created_at DESC
      LIMIT ?2
    `,
    normalizedRuntime,
    normalizedLimit,
  );
  return rows.map(backgroundRunRowToRecord);
}

export function listBackgroundRunsPendingAnnouncement(runtime: string, limit = 250): Array<BackgroundRunRecord> {
  const normalizedRuntime = runtime.trim();
  if (!normalizedRuntime) return [];
  const normalizedLimit = Math.max(1, Math.min(2_000, Math.floor(limit)));
  const rows = allRows<BackgroundRunRow>(
    `
      SELECT *
      FROM background_runs
      WHERE runtime = ?1
        AND status = 'completed'
        AND (result_summary IS NULL OR trim(result_summary) = '')
      ORDER BY updated_at ASC
      LIMIT ?2
    `,
    normalizedRuntime,
    normalizedLimit,
  );
  return rows.map(backgroundRunRowToRecord);
}

export function setBackgroundRunStatus(input: {
  runId: string;
  status: BackgroundRunStatus;
  updatedAt?: number;
  startedAt?: number | null;
  completedAt?: number | null;
  prompt?: string | null;
  resultSummary?: string | null;
  error?: string | null;
}): BackgroundRunRecord | null {
  const existing = getBackgroundRunById(input.runId);
  if (!existing) return null;

  const updatedAt = input.updatedAt ?? nowMs();
  const startedAt =
    typeof input.startedAt === "undefined"
      ? toMillisOrNull(existing.startedAt)
      : input.startedAt;
  const completedAt =
    typeof input.completedAt === "undefined"
      ? toMillisOrNull(existing.completedAt)
      : input.completedAt;
  const prompt = typeof input.prompt === "undefined" ? existing.prompt : input.prompt ?? "";
  const resultSummary =
    typeof input.resultSummary === "undefined" ? existing.resultSummary : input.resultSummary;
  const error = typeof input.error === "undefined" ? existing.error : input.error;

  sqlite
    .query(
      `
      UPDATE background_runs
      SET
        status = ?2,
        prompt = ?3,
        result_summary = ?4,
        error = ?5,
        updated_at = ?6,
        started_at = ?7,
        completed_at = ?8
      WHERE id = ?1
    `,
    )
    .run(existing.id, input.status, prompt, resultSummary, error, updatedAt, startedAt, completedAt);

  return getBackgroundRunById(existing.id);
}

export function getDashboardBootstrap(): DashboardBootstrap {
  const config = getConfig();
  return {
    sessions: listSessions(),
    skills: config.skills,
    mcps: config.mcps,
    agents: config.agents,
    usage: getUsageSnapshot(),
    heartbeat: getHeartbeatSnapshot(),
  };
}

export function appendChatExchange(input: {
  sessionId: string;
  userContent: string;
  assistantContent: string;
  assistantParts?: ChatMessagePart[];
  source: RuntimeEventSource;
  createdAt?: number;
  userMessageId?: string;
  assistantMessageId?: string;
  usage: {
    requestCountDelta: number;
    inputTokensDelta: number;
    outputTokensDelta: number;
    estimatedCostUsdDelta: number;
  };
}): {
  session: SessionSummary;
  messages: ChatMessage[];
  usage: UsageSnapshot;
  heartbeat: HeartbeatSnapshot;
} | null {
  const tx = sqlite.transaction(() => {
    const session = scalar<{ id: string } | null>("SELECT id FROM sessions WHERE id = ?1", input.sessionId);
    if (!session) return null;

    const createdAt = input.createdAt ?? nowMs();
    const assistantParts = normalizeChatMessageParts(input.assistantParts);
    const userMessage: ChatMessage = {
      id: input.userMessageId ?? crypto.randomUUID(),
      role: "user",
      content: input.userContent,
      at: toIso(createdAt),
    };
    const assistantMessage: ChatMessage = {
      id: input.assistantMessageId ?? crypto.randomUUID(),
      role: "assistant",
      content: input.assistantContent,
      at: toIso(createdAt),
      parts: assistantParts.length > 0 ? assistantParts : undefined,
    };

    sqlite
      .query(
        `
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `,
      )
      .run(userMessage.id, input.sessionId, userMessage.role, userMessage.content, createdAt);

    sqlite
      .query(
        `
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `,
      )
      .run(assistantMessage.id, input.sessionId, assistantMessage.role, assistantMessage.content, createdAt);

    if (assistantMessage.parts && assistantMessage.parts.length > 0) {
      setMessageParts({
        sessionId: input.sessionId,
        messageId: assistantMessage.id,
        parts: assistantMessage.parts,
        createdAt,
        updatedAt: createdAt,
      });
    }

    sqlite
      .query(
        `
        UPDATE sessions
        SET
          status = 'active',
          message_count = message_count + 2,
          updated_at = ?2,
          last_active_at = ?2
        WHERE id = ?1
      `,
      )
      .run(input.sessionId, createdAt);

    recordUsageDelta({
      sessionId: input.sessionId,
      requestCountDelta: input.usage.requestCountDelta,
      inputTokensDelta: input.usage.inputTokensDelta,
      outputTokensDelta: input.usage.outputTokensDelta,
      estimatedCostUsdDelta: input.usage.estimatedCostUsdDelta,
      source: input.source,
      createdAt,
    });

    const heartbeat = recordHeartbeat(input.source, true, createdAt);
    const sessionSummary = getSessionById(input.sessionId);
    if (!sessionSummary) return null;

    return {
      session: sessionSummary,
      messages: [userMessage, assistantMessage],
      usage: getUsageSnapshot(),
      heartbeat,
    };
  });

  return tx();
}

export function appendAssistantMessage(input: {
  sessionId: string;
  content: string;
  parts?: ChatMessagePart[];
  source: RuntimeEventSource;
  createdAt?: number;
  messageId?: string;
}): {
  session: SessionSummary;
  message: ChatMessage;
  usage: UsageSnapshot;
  heartbeat: HeartbeatSnapshot;
} | null {
  const tx = sqlite.transaction(() => {
    const session = scalar<{ id: string } | null>("SELECT id FROM sessions WHERE id = ?1", input.sessionId);
    if (!session) return null;

    const createdAt = input.createdAt ?? nowMs();
    const messageParts = normalizeChatMessageParts(input.parts);
    const message: ChatMessage = {
      id: input.messageId ?? crypto.randomUUID(),
      role: "assistant",
      content: input.content,
      at: toIso(createdAt),
      parts: messageParts.length > 0 ? messageParts : undefined,
    };

    sqlite
      .query(
        `
        INSERT INTO messages (id, session_id, role, content, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `,
      )
      .run(message.id, input.sessionId, message.role, message.content, createdAt);

    if (message.parts && message.parts.length > 0) {
      setMessageParts({
        sessionId: input.sessionId,
        messageId: message.id,
        parts: message.parts,
        createdAt,
        updatedAt: createdAt,
      });
    }

    sqlite
      .query(
        `
        UPDATE sessions
        SET
          status = 'active',
          message_count = message_count + 1,
          updated_at = ?2,
          last_active_at = ?2
        WHERE id = ?1
      `,
      )
      .run(input.sessionId, createdAt);

    const heartbeat = recordHeartbeat(input.source, true, createdAt);
    const sessionSummary = getSessionById(input.sessionId);
    if (!sessionSummary) return null;

    return {
      session: sessionSummary,
      message,
      usage: getUsageSnapshot(),
      heartbeat,
    };
  });

  return tx();
}

export function upsertSessionMessages(input: {
  sessionId: string;
  messages: Array<SessionMessageImportInput>;
  touchedAt?: number;
}): {
  session: SessionSummary;
  inserted: ChatMessage[];
} | null {
  const sessionId = input.sessionId.trim();
  if (!sessionId) return null;

  const tx = sqlite.transaction(() => {
    const sessionExists = scalar<{ id: string } | null>("SELECT id FROM sessions WHERE id = ?1", sessionId);
    if (!sessionExists) return null;

    const deduped = new Map<string, SessionMessageImportInput>();
    for (const message of input.messages) {
      const id = message.id.trim();
      if (!id) continue;
      const role = message.role;
      if (role !== "user" && role !== "assistant") continue;
      const createdAt = Number.isFinite(message.createdAt) ? Math.floor(message.createdAt) : nowMs();
      deduped.set(id, {
        id,
        role,
        content: message.content,
        createdAt,
        parts: message.parts,
      });
    }
    const candidates = [...deduped.values()];
    if (!candidates.length) {
      const session = getSessionById(sessionId);
      return session ? { session, inserted: [] as ChatMessage[] } : null;
    }

    const messageIds = candidates.map(message => message.id);
    const placeholders = messageIds.map(() => "?").join(", ");
    const existingRows = sqlite
      .query(
        `
        SELECT id, content
        FROM messages
        WHERE session_id = ?1
          AND id IN (${placeholders})
      `,
      )
      .all(sessionId, ...messageIds) as ExistingMessageIdRow[];
    const existingContentById = new Map(existingRows.map(row => [row.id, row.content] as const));
    const existingIds = new Set(existingContentById.keys());

    const updatedInputs = candidates.filter(message => {
      const existingContent = existingContentById.get(message.id);
      if (typeof existingContent !== "string") return false;
      return !existingContent.trim() && Boolean(message.content.trim());
    });
    for (const message of updatedInputs) {
      sqlite
        .query(
          `
          UPDATE messages
          SET content = ?3
          WHERE session_id = ?1
            AND id = ?2
        `,
        )
        .run(sessionId, message.id, message.content);
    }

    const messagePartsToUpsert = candidates.filter(message => message.parts !== undefined);
    for (const message of messagePartsToUpsert) {
      setMessageParts({
        sessionId,
        messageId: message.id,
        parts: message.parts ?? [],
        createdAt: message.createdAt,
        updatedAt: nowMs(),
      });
    }

    const insertedInputs = candidates
      .filter(message => !existingIds.has(message.id))
      .sort((left, right) => left.createdAt - right.createdAt);
    if (insertedInputs.length > 0) {
      for (const message of insertedInputs) {
        sqlite
          .query(
            `
            INSERT INTO messages (id, session_id, role, content, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
          `,
          )
          .run(message.id, sessionId, message.role, message.content, message.createdAt);
      }

      const touchedAt = Math.max(
        input.touchedAt ?? 0,
        insertedInputs[insertedInputs.length - 1]?.createdAt ?? 0,
        nowMs(),
      );
      sqlite
        .query(
          `
          UPDATE sessions
          SET
            status = 'active',
            message_count = (
              SELECT COUNT(*)
              FROM messages
              WHERE session_id = ?1
            ),
            updated_at = ?2,
            last_active_at = CASE
              WHEN last_active_at > ?2 THEN last_active_at
              ELSE ?2
            END
          WHERE id = ?1
        `,
        )
        .run(sessionId, touchedAt);
    }

    const session = getSessionById(sessionId);
    if (!session) return null;
    const inserted = insertedInputs.map(message => {
      const parts = message.parts ? normalizeChatMessageParts(message.parts) : [];
      return {
        id: message.id,
        role: message.role,
        content: message.content,
        at: toIso(message.createdAt),
        parts: parts.length > 0 ? parts : undefined,
      };
    });
    return { session, inserted };
  });

  return tx();
}
