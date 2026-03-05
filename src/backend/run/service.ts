import { ensureRunTables } from "./storage";
import type { AgentRun, AgentRunEvent, AgentRunEventType, CreateAgentRunInput } from "./types";
import type { RuntimeInputPart , RuntimeEngine } from "../contracts/runtime";
import { sqlite } from "../db/client";
import { getSessionById } from "../db/repository";
import { RuntimeContinuationDetachedError, RuntimeSessionQueuedError } from "../runtime/errors";

interface AgentRunRow {
  id: string;
  session_id: string;
  state: AgentRun["state"];
  content: string;
  metadata_json: string;
  idempotency_key: string | null;
  result_json: string | null;
  error_json: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

interface AgentRunEventRow {
  id: string;
  run_id: string;
  seq: number;
  type: AgentRunEventType;
  payload_json: string;
  created_at: number;
}

const nowMs = () => Date.now();
const toIso = (ms: number) => new Date(ms).toISOString();
const RUN_ID_PREFIX = "run";
const RUN_PARTS_METADATA_KEY = "__inputParts";
type RunEventListener = (event: AgentRunEvent) => void;

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeRuntimeInputParts(value: unknown): RuntimeInputPart[] {
  if (!Array.isArray(value)) return [];
  const parts: RuntimeInputPart[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    if (record.type === "text") {
      const text = typeof record.text === "string" ? record.text : "";
      if (!text.trim()) continue;
      parts.push({
        type: "text",
        text,
      });
      continue;
    }
    if (record.type === "file") {
      const mime = typeof record.mime === "string" ? record.mime.trim() : "";
      const url = typeof record.url === "string" ? record.url.trim() : "";
      const filename = typeof record.filename === "string" ? record.filename.trim() || undefined : undefined;
      if (!mime || !url) continue;
      parts.push({
        type: "file",
        mime,
        filename,
        url,
      });
    }
  }
  return parts;
}

function rowToRun(row: AgentRunRow): AgentRun {
  const metadata = normalizeMetadata(parseJson(row.metadata_json));
  const parts = normalizeRuntimeInputParts(metadata[RUN_PARTS_METADATA_KEY]);
  delete metadata[RUN_PARTS_METADATA_KEY];
  return {
    id: row.id,
    sessionId: row.session_id,
    state: row.state,
    content: row.content,
    parts: parts.length > 0 ? parts : undefined,
    metadata,
    idempotencyKey: row.idempotency_key,
    result: parseJson(row.result_json),
    error: parseJson(row.error_json),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    startedAt: row.started_at ? toIso(row.started_at) : null,
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
  };
}

function rowToRunEvent(row: AgentRunEventRow): AgentRunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    seq: row.seq,
    type: row.type,
    payload: parseJson(row.payload_json),
    at: toIso(row.created_at),
  };
}

function createRunId() {
  return `${RUN_ID_PREFIX}-${crypto.randomUUID().slice(0, 12)}`;
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? {});
}

function nextRunEventSeq(runId: string) {
  const row = sqlite
    .query(
      `
      SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
      FROM agent_run_events
      WHERE run_id = ?1
    `,
    )
    .get(runId) as { next_seq: number };
  return row.next_seq;
}

export class RunService {
  private dispatchInFlight = false;
  private recoveredPendingRuns = false;
  private listeners = new Set<RunEventListener>();
  private activeRunIds = new Set<string>();
  private activeSessionIds = new Set<string>();
  private readonly maxConcurrentRuns = 8;

  constructor(private runtime: RuntimeEngine) {
    ensureRunTables();
  }

  start() {
    this.ensureRecoveredState();
    void this.kick();
  }

  stop() {
    // no-op for now; run worker is tick-driven and has no timers
  }

  subscribe(onEvent: RunEventListener): () => void {
    this.listeners.add(onEvent);
    return () => {
      this.listeners.delete(onEvent);
    };
  }

  createRun(input: CreateAgentRunInput): { run: AgentRun; deduplicated: boolean } {
    ensureRunTables();
    this.ensureRecoveredState();

    const sessionId = input.sessionId.trim();
    const content = input.content.trim();
    const parts = normalizeRuntimeInputParts(input.parts);
    const session = getSessionById(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    if (!content && parts.length === 0) {
      throw new Error("content or parts is required");
    }

    const idempotencyKey = input.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existing = sqlite
        .query(
          `
          SELECT *
          FROM agent_runs
          WHERE idempotency_key = ?1
          LIMIT 1
        `,
        )
        .get(idempotencyKey) as AgentRunRow | null;
      if (existing) {
        return {
          run: rowToRun(existing),
          deduplicated: true,
        };
      }
    }

    const runId = createRunId();
    const createdAt = nowMs();
    const metadata = normalizeMetadata(input.metadata);
    if (parts.length > 0) {
      metadata[RUN_PARTS_METADATA_KEY] = parts;
    }
    const agent = input.agent?.trim();
    if (agent) {
      metadata.agent = agent;
    }
    const tx = sqlite.transaction(() => {
      sqlite
        .query(
          `
          INSERT INTO agent_runs (
            id, session_id, state, content, metadata_json, idempotency_key,
            result_json, error_json, created_at, updated_at, started_at, completed_at
          )
          VALUES (?1, ?2, 'queued', ?3, ?4, ?5, NULL, NULL, ?6, ?6, NULL, NULL)
        `,
        )
        .run(runId, sessionId, content, safeJson(metadata), idempotencyKey, createdAt);

      this.insertRunEvent(
        runId,
        "run.accepted",
        { sessionId, idempotencyKey, agent: agent ?? null, hasParts: parts.length > 0 },
        createdAt,
      );
    });
    tx();

    const run = this.getRunById(runId);
    if (!run) {
      throw new Error(`Failed to load created run: ${runId}`);
    }

    void this.kick();
    return { run, deduplicated: false };
  }

  getRunById(runId: string): AgentRun | null {
    ensureRunTables();
    const row = sqlite
      .query(
        `
        SELECT *
        FROM agent_runs
        WHERE id = ?1
      `,
      )
      .get(runId) as AgentRunRow | null;
    return row ? rowToRun(row) : null;
  }

  listRunEvents(input: {
    runId: string;
    afterSeq?: number;
    limit?: number;
  }): { events: AgentRunEvent[]; hasMore: boolean; nextAfterSeq: number } {
    ensureRunTables();
    const afterSeq = Math.max(0, Math.floor(input.afterSeq ?? 0));
    const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
    const rows = sqlite
      .query(
        `
        SELECT *
        FROM agent_run_events
        WHERE run_id = ?1
          AND seq > ?2
        ORDER BY seq ASC
        LIMIT ?3
      `,
      )
      .all(input.runId, afterSeq, limit + 1) as AgentRunEventRow[];
    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const events = trimmed.map(rowToRunEvent);
    const nextAfterSeq = events.length ? events[events.length - 1]!.seq : afterSeq;
    return { events, hasMore, nextAfterSeq };
  }

  private ensureRecoveredState() {
    if (this.recoveredPendingRuns) return;
    this.recoveredPendingRuns = true;

    const runningRows = sqlite
      .query(
        `
        SELECT id
        FROM agent_runs
        WHERE state = 'running'
      `,
      )
      .all() as Array<{ id: string }>;
    if (!runningRows.length) return;

    const recoveredAt = nowMs();
    const tx = sqlite.transaction(() => {
      sqlite
        .query(
          `
          UPDATE agent_runs
          SET state = 'queued', updated_at = ?1, started_at = NULL
          WHERE state = 'running'
        `,
        )
        .run(recoveredAt);
      for (const row of runningRows) {
        this.insertRunEvent(row.id, "run.recovered", { reason: "service restart" }, recoveredAt);
      }
    });
    tx();
  }

  private async kick() {
    if (this.dispatchInFlight) return;
    this.dispatchInFlight = true;
    try {
      while (true) {
        if (this.activeRunIds.size >= this.maxConcurrentRuns) break;
        const claimed = this.claimNextQueuedRun(this.activeSessionIds);
        if (!claimed) break;
        this.activeRunIds.add(claimed.id);
        this.activeSessionIds.add(claimed.session_id);
        void this.executeRun(claimed)
          .catch(() => {
            // executeRun persists failures; dispatch loop only needs cleanup.
          })
          .finally(() => {
            this.activeRunIds.delete(claimed.id);
            this.activeSessionIds.delete(claimed.session_id);
            void this.kick();
          });
      }
    } finally {
      this.dispatchInFlight = false;
      if (this.hasRunnableQueuedRuns()) {
        void this.kick();
      }
    }
  }

  private hasRunnableQueuedRuns() {
    if (this.activeRunIds.size >= this.maxConcurrentRuns) return false;
    if (this.activeSessionIds.size === 0) {
      const row = sqlite
        .query(
          `
          SELECT COUNT(*) as count
          FROM agent_runs
          WHERE state = 'queued'
        `,
        )
        .get() as { count: number };
      return row.count > 0;
    }

    const excludedSessionIds = [...this.activeSessionIds];
    const placeholders = excludedSessionIds.map((_, index) => `?${index + 1}`).join(", ");
    const row = sqlite
      .query(
        `
        SELECT COUNT(*) as count
        FROM agent_runs
        WHERE state = 'queued'
          AND session_id NOT IN (${placeholders})
      `,
      )
      .get(...excludedSessionIds) as { count: number };
    return row.count > 0;
  }

  private claimNextQueuedRun(excludedSessionIds: Set<string>): AgentRunRow | null {
    ensureRunTables();
    const excluded = [...excludedSessionIds];
    const notInClause =
      excluded.length > 0
        ? `AND session_id NOT IN (${excluded.map((_, index) => `?${index + 1}`).join(", ")})`
        : "";
    const tx = sqlite.transaction(() => {
      const next = sqlite
        .query(
          `
          SELECT *
          FROM agent_runs
          WHERE state = 'queued'
          ${notInClause}
          ORDER BY created_at ASC
          LIMIT 1
        `,
        )
        .get(...excluded) as AgentRunRow | null;
      if (!next) return null;

      const claimedAt = nowMs();
      sqlite
        .query(
          `
          UPDATE agent_runs
          SET state = 'running', started_at = COALESCE(started_at, ?2), updated_at = ?2
          WHERE id = ?1
            AND state = 'queued'
        `,
        )
        .run(next.id, claimedAt);
      const changed = sqlite.query("SELECT changes() as count").get() as { count: number };
      if (changed.count < 1) return null;

      const claimed = sqlite
        .query(
          `
          SELECT *
          FROM agent_runs
          WHERE id = ?1
        `,
        )
        .get(next.id) as AgentRunRow | null;
      return claimed;
    });
    return tx();
  }

  private async executeRun(run: AgentRunRow) {
    const metadata = normalizeMetadata(parseJson(run.metadata_json));
    const parts = normalizeRuntimeInputParts(metadata[RUN_PARTS_METADATA_KEY]);
    delete metadata[RUN_PARTS_METADATA_KEY];
    const agent = typeof metadata.agent === "string" ? metadata.agent.trim() : "";
    const startedAt = nowMs();
    this.insertRunEvent(run.id, "run.started", { sessionId: run.session_id, agent: agent || null }, startedAt);

    try {
      const ack = await this.runtime.sendUserMessage({
        sessionId: run.session_id,
        content: run.content,
        parts,
        agent: agent || undefined,
        metadata,
      });

      const completedAt = nowMs();
      const result = {
        sessionId: ack.sessionId,
        messageCount: ack.messages.length,
        messageIds: ack.messages.map(message => message.id),
      };

      const tx = sqlite.transaction(() => {
        sqlite
          .query(
            `
            UPDATE agent_runs
            SET
              state = 'completed',
              updated_at = ?2,
              completed_at = ?2,
              result_json = ?3,
              error_json = NULL
            WHERE id = ?1
          `,
          )
          .run(run.id, completedAt, safeJson(result));
        this.insertRunEvent(run.id, "run.completed", result, completedAt);
      });
      tx();
    } catch (error) {
      if (error instanceof RuntimeContinuationDetachedError) {
        const completedAt = nowMs();
        const result = {
          sessionId: run.session_id,
          detached: true,
          childRunCount: error.childRunCount,
        };
        const tx = sqlite.transaction(() => {
          sqlite
            .query(
              `
              UPDATE agent_runs
              SET
                state = 'completed',
                updated_at = ?2,
                completed_at = ?2,
                result_json = ?3,
                error_json = NULL
              WHERE id = ?1
            `,
            )
            .run(run.id, completedAt, safeJson(result));
          this.insertRunEvent(run.id, "run.completed", result, completedAt);
        });
        tx();
        return;
      }

      if (error instanceof RuntimeSessionQueuedError) {
        const completedAt = nowMs();
        const result = {
          sessionId: run.session_id,
          queued: true,
          queueDepth: error.depth,
        };
        const tx = sqlite.transaction(() => {
          sqlite
            .query(
              `
              UPDATE agent_runs
              SET
                state = 'completed',
                updated_at = ?2,
                completed_at = ?2,
                result_json = ?3,
                error_json = NULL
              WHERE id = ?1
            `,
            )
            .run(run.id, completedAt, safeJson(result));
          this.insertRunEvent(run.id, "run.completed", result, completedAt);
        });
        tx();
        return;
      }

      const failedAt = nowMs();
      const details = {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : "Run execution failed",
      };
      const tx = sqlite.transaction(() => {
        sqlite
          .query(
            `
            UPDATE agent_runs
            SET
              state = 'failed',
              updated_at = ?2,
              completed_at = ?2,
              error_json = ?3
            WHERE id = ?1
          `,
          )
          .run(run.id, failedAt, safeJson(details));
        this.insertRunEvent(run.id, "run.failed", details, failedAt);
      });
      tx();
    }
  }

  private insertRunEvent(runId: string, type: AgentRunEventType, payload: unknown, createdAt = nowMs()) {
    const seq = nextRunEventSeq(runId);
    const eventId = crypto.randomUUID();
    sqlite
      .query(
        `
        INSERT INTO agent_run_events (
          id, run_id, seq, type, payload_json, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      `,
      )
      .run(eventId, runId, seq, type, safeJson(payload), createdAt);

    const event: AgentRunEvent = {
      id: eventId,
      runId,
      seq,
      type,
      payload,
      at: toIso(createdAt),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Best-effort only; listener failures should not affect run execution.
      }
    }
  }
}
