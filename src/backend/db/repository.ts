import type { SQLQueryBindings } from "bun:sqlite";

import type {
  ChatMessage,
  DashboardBootstrap,
  HeartbeatSnapshot,
  MessageMemoryTrace,
  SessionSummary,
  SpecialistAgent,
  UsageSnapshot,
} from "../../types/dashboard";
import { clearCronTables } from "../cron/storage";
import { DEFAULT_AGENTS, DEFAULT_MCPS, DEFAULT_SESSIONS, DEFAULT_SKILLS } from "../defaults";
import { env } from "../env";
import { sqlite } from "./client";
import { clearRunTables } from "../run/storage";

type RuntimeConfigKey = "skills" | "mcps" | "agents" | "sessionBindings";
type RuntimeEventSource = "api" | "runtime" | "scheduler" | "system";
type RuntimeSessionBindings = Record<string, string>;

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

interface ConfigRow {
  value_json: string;
}

const nowMs = () => Date.now();
const toIso = (millis: number) => new Date(millis).toISOString();
const normalizeStringList = (values: string[]) =>
  [...new Set(values.map(value => value.trim()).filter(Boolean))];
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
  `);
}

ensureAuxiliaryTables();

function readConfig<T>(key: RuntimeConfigKey, fallback: T): T {
  const row = scalar<ConfigRow | null>("SELECT value_json FROM runtime_config WHERE key = ?1", key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

function writeConfig(key: RuntimeConfigKey, value: unknown, updatedAt: number) {
  sqlite
    .query(
      `
      INSERT INTO runtime_config (key, value_json, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `,
    )
    .run(key, JSON.stringify(value), updatedAt);
}

function setConfig(key: RuntimeConfigKey, values: string[]) {
  writeConfig(key, normalizeStringList(values), nowMs());
}

function getDefaultSessionModel() {
  const provider = env.WAFFLEBOT_OPENCODE_PROVIDER_ID.trim();
  const model = env.WAFFLEBOT_OPENCODE_MODEL_ID.trim();
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

  writeConfig("skills", DEFAULT_SKILLS, createdAt);
  writeConfig("mcps", DEFAULT_MCPS, createdAt);
  writeConfig("agents", DEFAULT_AGENTS, createdAt);

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
    let id = `${sessionIdPrefix}-${crypto.randomUUID().slice(0, 8)}`;
    while (scalar<{ count: number }>("SELECT COUNT(*) as count FROM sessions WHERE id = ?1", id).count > 0) {
      id = `${sessionIdPrefix}-${crypto.randomUUID().slice(0, 8)}`;
    }

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
    sqlite.query("DELETE FROM messages").run();
    sqlite.query("DELETE FROM usage_events").run();
    sqlite.query("DELETE FROM heartbeat_events").run();
    sqlite.query("DELETE FROM runtime_config").run();
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

  return messages.map(message => ({
    ...message,
    memoryTrace: traceMap.get(message.id),
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
  return {
    skills: readConfig<string[]>("skills", DEFAULT_SKILLS),
    mcps: readConfig<string[]>("mcps", DEFAULT_MCPS),
    agents: readConfig<SpecialistAgent[]>("agents", DEFAULT_AGENTS),
  };
}

export function setSkillsConfig(skills: string[]) {
  setConfig("skills", skills);
  return readConfig<string[]>("skills", DEFAULT_SKILLS);
}

export function setMcpsConfig(mcps: string[]) {
  setConfig("mcps", mcps);
  return readConfig<string[]>("mcps", DEFAULT_MCPS);
}

function getSessionBindings() {
  return readConfig<RuntimeSessionBindings>("sessionBindings", {});
}

export function getRuntimeSessionBinding(runtime: string, sessionId: string): string | null {
  const bindings = getSessionBindings();
  return bindings[`${runtime}:${sessionId}`] ?? null;
}

export function getLocalSessionIdByRuntimeBinding(runtime: string, externalSessionId: string): string | null {
  const bindings = getSessionBindings();
  const prefix = `${runtime}:`;
  for (const [key, value] of Object.entries(bindings)) {
    if (!key.startsWith(prefix)) continue;
    if (value !== externalSessionId) continue;
    return key.slice(prefix.length);
  }
  return null;
}

export function setRuntimeSessionBinding(runtime: string, sessionId: string, externalSessionId: string) {
  const bindings = getSessionBindings();
  bindings[`${runtime}:${sessionId}`] = externalSessionId;
  writeConfig("sessionBindings", bindings, nowMs());
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
