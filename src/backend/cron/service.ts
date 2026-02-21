import type { SQLQueryBindings } from "bun:sqlite";
import { CronTime, validateCronExpression } from "cron";

import { getConfigSnapshot } from "../config/service";
import { env } from "../env";
import { getCronHandler, listCronHandlerKeys } from "./handlers";
import { ensureCronTables } from "./storage";
import type {
  CronHandlerResult,
  CronHealthSnapshot,
  CronInvokePolicy,
  CronJobCreateInput,
  CronJobDefinition,
  CronJobInstance,
  CronJobPatchInput,
  CronJobState,
  CronJobStep,
  CronRunMode,
  CronScheduleKind,
  CronStepKind,
  CronStepStatus,
} from "./types";
import type { RuntimeEngine } from "../contracts/runtime";
import { sqlite } from "../db/client";

interface CronDefinitionRow {
  id: string;
  name: string;
  enabled: number;
  schedule_kind: CronScheduleKind;
  schedule_expr: string | null;
  every_ms: number | null;
  at_iso: string | null;
  timezone: string | null;
  run_mode: CronRunMode;
  invoke_policy: CronInvokePolicy;
  handler_key: string | null;
  agent_prompt_template: string | null;
  agent_model_override: string | null;
  max_attempts: number;
  retry_backoff_ms: number;
  payload_json: string;
  last_enqueued_for: number | null;
  created_at: number;
  updated_at: number;
}

interface CronInstanceRow {
  id: string;
  job_definition_id: string;
  scheduled_for: number;
  state: CronJobState;
  attempt: number;
  next_attempt_at: number | null;
  lease_owner: string | null;
  lease_expires_at: number | null;
  last_heartbeat_at: number | null;
  result_summary: string | null;
  error_json: string | null;
  created_at: number;
  updated_at: number;
}

interface CronStepRow {
  id: string;
  job_instance_id: string;
  step_kind: CronStepKind;
  status: CronStepStatus;
  input_json: string | null;
  output_json: string | null;
  error_json: string | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
}

function nowMs() {
  return Date.now();
}

function toIso(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizePayload(input: Record<string, unknown> | undefined): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function definitionRowToModel(row: CronDefinitionRow): CronJobDefinition {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    scheduleKind: row.schedule_kind,
    scheduleExpr: row.schedule_expr,
    everyMs: row.every_ms,
    atIso: row.at_iso,
    timezone: row.timezone,
    runMode: row.run_mode,
    invokePolicy: row.invoke_policy,
    handlerKey: row.handler_key,
    agentPromptTemplate: row.agent_prompt_template,
    agentModelOverride: row.agent_model_override,
    maxAttempts: row.max_attempts,
    retryBackoffMs: row.retry_backoff_ms,
    payload: (parseJson(row.payload_json) as Record<string, unknown>) ?? {},
    lastEnqueuedFor: toIso(row.last_enqueued_for),
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function instanceRowToModel(row: CronInstanceRow): CronJobInstance {
  return {
    id: row.id,
    jobDefinitionId: row.job_definition_id,
    scheduledFor: toIso(row.scheduled_for) ?? new Date(0).toISOString(),
    state: row.state,
    attempt: row.attempt,
    nextAttemptAt: toIso(row.next_attempt_at),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: toIso(row.lease_expires_at),
    lastHeartbeatAt: toIso(row.last_heartbeat_at),
    resultSummary: row.result_summary,
    error: parseJson(row.error_json),
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function stepRowToModel(row: CronStepRow): CronJobStep {
  return {
    id: row.id,
    jobInstanceId: row.job_instance_id,
    stepKind: row.step_kind,
    status: row.status,
    input: parseJson(row.input_json),
    output: parseJson(row.output_json),
    error: parseJson(row.error_json),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
  };
}

function validateSchedule(input: {
  scheduleKind: CronScheduleKind;
  scheduleExpr: string | null;
  everyMs: number | null;
  atIso: string | null;
}) {
  if (input.scheduleKind === "at") {
    if (!input.atIso) throw new Error("scheduleKind=at requires atIso");
    const parsedAt = Date.parse(input.atIso);
    if (!Number.isFinite(parsedAt)) throw new Error("atIso must be a valid ISO timestamp");
  } else if (input.scheduleKind === "every") {
    if (typeof input.everyMs !== "number" || !Number.isFinite(input.everyMs) || input.everyMs < 1_000) {
      throw new Error("scheduleKind=every requires everyMs >= 1000");
    }
  } else if (input.scheduleKind === "cron") {
    const expr = input.scheduleExpr?.trim();
    if (!expr) throw new Error("scheduleKind=cron requires scheduleExpr");
    const valid = validateCronExpression(expr);
    if (!valid.valid) {
      throw new Error(`invalid cron expression: ${valid.error?.message ?? "parse failed"}`);
    }
  }
}

function validateMode(input: {
  runMode: CronRunMode;
  invokePolicy: CronInvokePolicy;
  handlerKey: string | null;
  agentPromptTemplate: string | null;
}) {
  if (input.runMode === "system") {
    if (!input.handlerKey) throw new Error("runMode=system requires handlerKey");
    if (!listCronHandlerKeys().includes(input.handlerKey)) {
      throw new Error(`unknown handlerKey: ${input.handlerKey}`);
    }
    if (input.invokePolicy !== "never") {
      throw new Error("runMode=system requires invokePolicy=never");
    }
    return;
  }

  if (input.runMode === "agent") {
    if (!input.agentPromptTemplate?.trim()) {
      throw new Error("runMode=agent requires agentPromptTemplate");
    }
    if (input.invokePolicy !== "always") {
      throw new Error("runMode=agent requires invokePolicy=always");
    }
    return;
  }

  if (!input.handlerKey) throw new Error("runMode=script requires handlerKey");
  if (!listCronHandlerKeys().includes(input.handlerKey)) {
    throw new Error(`unknown handlerKey: ${input.handlerKey}`);
  }
}

function computeBackoffMs(base: number, attempt: number): number {
  const cappedAttempt = Math.max(1, Math.min(10, attempt));
  return Math.min(base * 2 ** (cappedAttempt - 1), getConfigSnapshot().config.runtime.cron.retryBackoffCapMs);
}

function renderTemplate(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_full, key: string) => {
    const raw = ctx[key];
    if (raw === undefined || raw === null) return "";
    if (typeof raw === "string") return raw;
    if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
    return JSON.stringify(raw);
  });
}

function createUniqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function definitionPayloadContext(definition: CronJobDefinition, extra?: Record<string, unknown>) {
  return {
    ...definition.payload,
    jobId: definition.id,
    jobName: definition.name,
    ...(extra ?? {}),
  };
}

function computeDueTimesForDefinition(row: CronDefinitionRow, now: number, maxPerTick: number): number[] {
  const due: number[] = [];
  const lastEnqueued = row.last_enqueued_for ?? null;

  if (row.schedule_kind === "at") {
    if (!row.at_iso) return due;
    const atMs = Date.parse(row.at_iso);
    if (!Number.isFinite(atMs)) return due;
    if (atMs <= now && (lastEnqueued === null || lastEnqueued < atMs)) {
      due.push(atMs);
    }
    return due;
  }

  if (row.schedule_kind === "every") {
    const everyMs = row.every_ms ?? 0;
    if (!Number.isFinite(everyMs) || everyMs <= 0) return due;
    let cursor = lastEnqueued ?? row.created_at;
    for (let i = 0; i < maxPerTick; i += 1) {
      const next = cursor + everyMs;
      if (next > now) break;
      due.push(next);
      cursor = next;
    }
    return due;
  }

  const expr = row.schedule_expr?.trim();
  if (!expr) return due;
  try {
    const cronTime = new CronTime(expr, row.timezone ?? undefined);
    let cursor = lastEnqueued ?? row.created_at - 1_000;
    for (let i = 0; i < maxPerTick; i += 1) {
      const nextDate = cronTime.getNextDateFrom(new Date(cursor));
      const nextMs = nextDate.toMillis();
      if (!Number.isFinite(nextMs)) break;
      if (nextMs > now) break;
      if (nextMs <= cursor) break;
      due.push(nextMs);
      cursor = nextMs + 1_000;
    }
  } catch {
    // Invalid cron expressions should have been validated at write-time.
  }
  return due;
}

function selectOne<T>(query: string, ...args: SQLQueryBindings[]): T | null {
  const row = sqlite.query(query).get(...args);
  return (row as T | null) ?? null;
}

function selectAll<T>(query: string, ...args: SQLQueryBindings[]): T[] {
  return sqlite.query(query).all(...args) as T[];
}

function insertStep(input: {
  instanceId: string;
  stepKind: CronStepKind;
  status: CronStepStatus;
  input: unknown;
  output?: unknown;
  error?: unknown;
  startedAt?: number | null;
  finishedAt?: number | null;
}) {
  const createdAt = nowMs();
  sqlite
    .query(
      `
      INSERT INTO cron_job_steps (
        id, job_instance_id, step_kind, status, input_json, output_json, error_json,
        started_at, finished_at, created_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    `,
    )
    .run(
      createUniqueId("step"),
      input.instanceId,
      input.stepKind,
      input.status,
      JSON.stringify(input.input ?? {}),
      input.output === undefined ? null : JSON.stringify(input.output),
      input.error === undefined ? null : JSON.stringify(input.error),
      input.startedAt ?? null,
      input.finishedAt ?? null,
      createdAt,
    );
}

export class CronService {
  private schedulerTimer: Timer | null = null;
  private workerTimer: Timer | null = null;
  private schedulerBusy = false;
  private workerBusy = false;
  private readonly workerId = `wafflebot-${process.pid}`;

  constructor(private runtime: RuntimeEngine) {
    ensureCronTables();
  }

  start() {
    if (!env.WAFFLEBOT_CRON_ENABLED) return;
    this.schedulerTimer = setInterval(() => {
      void this.schedulerTick();
    }, env.WAFFLEBOT_CRON_SCHEDULER_POLL_MS);
    this.workerTimer = setInterval(() => {
      void this.workerTick();
    }, env.WAFFLEBOT_CRON_WORKER_POLL_MS);
    void this.schedulerTick();
    void this.workerTick();
  }

  stop() {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    if (this.workerTimer) clearInterval(this.workerTimer);
    this.schedulerTimer = null;
    this.workerTimer = null;
  }

  async listJobs(): Promise<CronJobDefinition[]> {
    ensureCronTables();
    const rows = selectAll<CronDefinitionRow>(
      `
      SELECT *
      FROM cron_job_definitions
      ORDER BY created_at DESC
    `,
    );
    return rows.map(definitionRowToModel);
  }

  async getJob(jobId: string): Promise<CronJobDefinition | null> {
    ensureCronTables();
    const row = selectOne<CronDefinitionRow>(
      `
      SELECT *
      FROM cron_job_definitions
      WHERE id = ?1
    `,
      jobId,
    );
    return row ? definitionRowToModel(row) : null;
  }

  async createJob(input: CronJobCreateInput): Promise<CronJobDefinition> {
    ensureCronTables();
    const now = nowMs();
    const name = input.name.trim();
    if (!name) throw new Error("name is required");

    const normalized = {
      id: createUniqueId("cron"),
      name,
      enabled: input.enabled ?? true,
      scheduleKind: input.scheduleKind,
      scheduleExpr: input.scheduleExpr?.trim() ?? null,
      everyMs: input.everyMs ?? null,
      atIso: input.atIso?.trim() ?? null,
      timezone: input.timezone?.trim() ?? null,
      runMode: input.runMode,
      invokePolicy: input.invokePolicy,
      handlerKey: input.handlerKey?.trim() ?? null,
      agentPromptTemplate: input.agentPromptTemplate?.trim() ?? null,
      agentModelOverride: input.agentModelOverride?.trim() ?? null,
      maxAttempts: Math.max(1, input.maxAttempts ?? getConfigSnapshot().config.runtime.cron.defaultMaxAttempts),
      retryBackoffMs: Math.max(1_000, input.retryBackoffMs ?? getConfigSnapshot().config.runtime.cron.defaultRetryBackoffMs),
      payload: normalizePayload(input.payload),
    };

    validateSchedule(normalized);
    validateMode(normalized);

    sqlite
      .query(
        `
        INSERT INTO cron_job_definitions (
          id, name, enabled, schedule_kind, schedule_expr, every_ms, at_iso, timezone,
          run_mode, invoke_policy, handler_key, agent_prompt_template, agent_model_override,
          max_attempts, retry_backoff_ms, payload_json, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17)
      `,
      )
      .run(
        normalized.id,
        normalized.name,
        normalized.enabled ? 1 : 0,
        normalized.scheduleKind,
        normalized.scheduleExpr,
        normalized.everyMs,
        normalized.atIso,
        normalized.timezone,
        normalized.runMode,
        normalized.invokePolicy,
        normalized.handlerKey,
        normalized.agentPromptTemplate,
        normalized.agentModelOverride,
        normalized.maxAttempts,
        normalized.retryBackoffMs,
        JSON.stringify(normalized.payload),
        now,
      );

    const created = await this.getJob(normalized.id);
    if (!created) throw new Error("Failed to create cron job");
    return created;
  }

  async updateJob(jobId: string, patch: CronJobPatchInput): Promise<CronJobDefinition> {
    ensureCronTables();
    const existing = await this.getJob(jobId);
    if (!existing) throw new Error(`Unknown cron job: ${jobId}`);

    const merged = {
      ...existing,
      name: patch.name?.trim() ?? existing.name,
      enabled: patch.enabled ?? existing.enabled,
      scheduleKind: patch.scheduleKind ?? existing.scheduleKind,
      scheduleExpr: patch.scheduleExpr !== undefined ? patch.scheduleExpr?.trim() ?? null : existing.scheduleExpr,
      everyMs: patch.everyMs !== undefined ? patch.everyMs : existing.everyMs,
      atIso: patch.atIso !== undefined ? patch.atIso?.trim() ?? null : existing.atIso,
      timezone: patch.timezone !== undefined ? patch.timezone?.trim() ?? null : existing.timezone,
      runMode: patch.runMode ?? existing.runMode,
      invokePolicy: patch.invokePolicy ?? existing.invokePolicy,
      handlerKey: patch.handlerKey !== undefined ? patch.handlerKey?.trim() ?? null : existing.handlerKey,
      agentPromptTemplate:
        patch.agentPromptTemplate !== undefined
          ? patch.agentPromptTemplate?.trim() ?? null
          : existing.agentPromptTemplate,
      agentModelOverride:
        patch.agentModelOverride !== undefined
          ? patch.agentModelOverride?.trim() ?? null
          : existing.agentModelOverride,
      maxAttempts: Math.max(1, patch.maxAttempts ?? existing.maxAttempts),
      retryBackoffMs: Math.max(1_000, patch.retryBackoffMs ?? existing.retryBackoffMs),
      payload: patch.payload !== undefined ? normalizePayload(patch.payload) : existing.payload,
    };

    validateSchedule(merged);
    validateMode(merged);

    const updatedAt = nowMs();
    sqlite
      .query(
        `
        UPDATE cron_job_definitions
        SET
          name = ?2,
          enabled = ?3,
          schedule_kind = ?4,
          schedule_expr = ?5,
          every_ms = ?6,
          at_iso = ?7,
          timezone = ?8,
          run_mode = ?9,
          invoke_policy = ?10,
          handler_key = ?11,
          agent_prompt_template = ?12,
          agent_model_override = ?13,
          max_attempts = ?14,
          retry_backoff_ms = ?15,
          payload_json = ?16,
          updated_at = ?17
        WHERE id = ?1
      `,
      )
      .run(
        jobId,
        merged.name,
        merged.enabled ? 1 : 0,
        merged.scheduleKind,
        merged.scheduleExpr,
        merged.everyMs,
        merged.atIso,
        merged.timezone,
        merged.runMode,
        merged.invokePolicy,
        merged.handlerKey,
        merged.agentPromptTemplate,
        merged.agentModelOverride,
        merged.maxAttempts,
        merged.retryBackoffMs,
        JSON.stringify(merged.payload),
        updatedAt,
      );

    const updated = await this.getJob(jobId);
    if (!updated) throw new Error(`Unknown cron job: ${jobId}`);
    return updated;
  }

  async deleteJob(jobId: string): Promise<{ removed: boolean }> {
    ensureCronTables();
    const changes = sqlite
      .query("DELETE FROM cron_job_definitions WHERE id = ?1")
      .run(jobId).changes;
    return { removed: changes > 0 };
  }

  async listInstances(input?: { jobId?: string; limit?: number }): Promise<CronJobInstance[]> {
    ensureCronTables();
    const limit = Math.max(1, Math.min(500, input?.limit ?? 100));
    const rows = input?.jobId
      ? selectAll<CronInstanceRow>(
          `
          SELECT *
          FROM cron_job_instances
          WHERE job_definition_id = ?1
          ORDER BY created_at DESC
          LIMIT ?2
        `,
          input.jobId,
          limit,
        )
      : selectAll<CronInstanceRow>(
          `
          SELECT *
          FROM cron_job_instances
          ORDER BY created_at DESC
          LIMIT ?1
        `,
          limit,
        );
    return rows.map(instanceRowToModel);
  }

  async listSteps(instanceId: string): Promise<CronJobStep[]> {
    ensureCronTables();
    const rows = selectAll<CronStepRow>(
      `
      SELECT *
      FROM cron_job_steps
      WHERE job_instance_id = ?1
      ORDER BY created_at ASC
    `,
      instanceId,
    );
    return rows.map(stepRowToModel);
  }

  async runJobNow(jobId: string): Promise<{ queued: boolean; instanceId: string | null }> {
    ensureCronTables();
    const definition = await this.getJob(jobId);
    if (!definition) throw new Error(`Unknown cron job: ${jobId}`);

    const baseScheduled = nowMs();
    for (let offset = 0; offset < 10; offset += 1) {
      const scheduledFor = baseScheduled + offset;
      const instanceId = createUniqueId("ins");
      const inserted = sqlite
        .query(
          `
          INSERT INTO cron_job_instances (
            id, job_definition_id, scheduled_for, state, attempt, next_attempt_at,
            lease_owner, lease_expires_at, last_heartbeat_at,
            result_summary, error_json, created_at, updated_at
          )
          VALUES (?1, ?2, ?3, 'queued', 0, NULL, NULL, NULL, NULL, NULL, NULL, ?4, ?4)
          ON CONFLICT(job_definition_id, scheduled_for) DO NOTHING
        `,
        )
        .run(instanceId, jobId, scheduledFor, baseScheduled);
      if (inserted.changes > 0) {
        return { queued: true, instanceId };
      }
    }
    return { queued: false, instanceId: null };
  }

  async getHealth(): Promise<CronHealthSnapshot> {
    ensureCronTables();
    const jobs = selectOne<{ total: number; enabled: number }>(
      `
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END), 0) AS enabled
      FROM cron_job_definitions
    `,
    ) ?? { total: 0, enabled: 0 };

    const instances = selectOne<{
      queued: number;
      leased: number;
      running: number;
      completed: number;
      failed: number;
      dead: number;
    }>(
      `
      SELECT
        COALESCE(SUM(CASE WHEN state = 'queued' THEN 1 ELSE 0 END), 0) AS queued,
        COALESCE(SUM(CASE WHEN state = 'leased' THEN 1 ELSE 0 END), 0) AS leased,
        COALESCE(SUM(CASE WHEN state = 'running' THEN 1 ELSE 0 END), 0) AS running,
        COALESCE(SUM(CASE WHEN state = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
        COALESCE(SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
        COALESCE(SUM(CASE WHEN state = 'dead' THEN 1 ELSE 0 END), 0) AS dead
      FROM cron_job_instances
    `,
    ) ?? {
      queued: 0,
      leased: 0,
      running: 0,
      completed: 0,
      failed: 0,
      dead: 0,
    };

    return {
      enabled: env.WAFFLEBOT_CRON_ENABLED,
      schedulerPollMs: env.WAFFLEBOT_CRON_SCHEDULER_POLL_MS,
      workerPollMs: env.WAFFLEBOT_CRON_WORKER_POLL_MS,
      leaseMs: env.WAFFLEBOT_CRON_LEASE_MS,
      jobs,
      instances,
    };
  }

  private async schedulerTick() {
    if (!env.WAFFLEBOT_CRON_ENABLED || this.schedulerBusy) return;
    this.schedulerBusy = true;
    try {
      ensureCronTables();
      const now = nowMs();
      const definitions = selectAll<CronDefinitionRow>(
        `
        SELECT *
        FROM cron_job_definitions
        WHERE enabled = 1
      `,
      );

      for (const row of definitions) {
        const dueTimes = computeDueTimesForDefinition(row, now, env.WAFFLEBOT_CRON_MAX_ENQUEUE_PER_JOB_TICK);
        if (!dueTimes.length) continue;
        let lastEnqueued = row.last_enqueued_for ?? null;
        for (const scheduledFor of dueTimes) {
          const instanceId = createUniqueId("ins");
          sqlite
            .query(
              `
              INSERT INTO cron_job_instances (
                id, job_definition_id, scheduled_for, state, attempt, next_attempt_at,
                lease_owner, lease_expires_at, last_heartbeat_at,
                result_summary, error_json, created_at, updated_at
              )
              VALUES (?1, ?2, ?3, 'queued', 0, NULL, NULL, NULL, NULL, NULL, NULL, ?4, ?4)
              ON CONFLICT(job_definition_id, scheduled_for) DO NOTHING
            `,
            )
            .run(instanceId, row.id, scheduledFor, now);
          if (lastEnqueued === null || scheduledFor > lastEnqueued) {
            lastEnqueued = scheduledFor;
          }
        }
        if (lastEnqueued !== null && lastEnqueued !== row.last_enqueued_for) {
          sqlite
            .query(
              `
              UPDATE cron_job_definitions
              SET last_enqueued_for = ?2, updated_at = ?3
              WHERE id = ?1
            `,
            )
            .run(row.id, lastEnqueued, now);
        }
      }
    } finally {
      this.schedulerBusy = false;
    }
  }

  private reclaimExpiredLeases(now: number) {
    sqlite
      .query(
        `
        UPDATE cron_job_instances
        SET
          state = 'queued',
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_heartbeat_at = NULL,
          updated_at = ?2
        WHERE id IN (
          SELECT id
          FROM cron_job_instances
          WHERE state IN ('leased', 'running')
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at <= ?1
        )
      `,
      )
      .run(now, now);
  }

  private claimNextInstance(now: number): CronInstanceRow | null {
    const tx = sqlite.transaction(() => {
      this.reclaimExpiredLeases(now);

      const candidate = selectOne<CronInstanceRow>(
        `
        SELECT *
        FROM cron_job_instances
        WHERE (state = 'queued' OR state = 'failed')
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?1)
        ORDER BY scheduled_for ASC
        LIMIT 1
      `,
        now,
      );
      if (!candidate) return null;

      const claimed = sqlite
        .query(
          `
          UPDATE cron_job_instances
          SET
            state = 'leased',
            lease_owner = ?2,
            lease_expires_at = ?3,
            last_heartbeat_at = ?1,
            updated_at = ?1
          WHERE id = ?4
            AND (state = 'queued' OR state = 'failed')
        `,
        )
        .run(now, this.workerId, now + env.WAFFLEBOT_CRON_LEASE_MS, candidate.id);
      if (claimed.changes < 1) return null;

      return selectOne<CronInstanceRow>(
        `
        SELECT *
        FROM cron_job_instances
        WHERE id = ?1
      `,
        candidate.id,
      );
    });
    return tx();
  }

  private async workerTick() {
    if (!env.WAFFLEBOT_CRON_ENABLED || this.workerBusy) return;
    this.workerBusy = true;
    try {
      const now = nowMs();
      const claimed = this.claimNextInstance(now);
      if (!claimed) return;
      await this.executeInstance(claimed);
    } finally {
      this.workerBusy = false;
    }
  }

  private loadDefinitionById(jobId: string): CronDefinitionRow | null {
    return selectOne<CronDefinitionRow>(
      `
      SELECT *
      FROM cron_job_definitions
      WHERE id = ?1
    `,
      jobId,
    );
  }

  private setInstanceState(input: {
    instanceId: string;
    state: CronJobState;
    attempt?: number;
    nextAttemptAt?: number | null;
    resultSummary?: string | null;
    error?: unknown;
  }) {
    const updatedAt = nowMs();
    sqlite
      .query(
        `
        UPDATE cron_job_instances
        SET
          state = ?2,
          attempt = COALESCE(?3, attempt),
          next_attempt_at = ?4,
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_heartbeat_at = NULL,
          result_summary = ?5,
          error_json = ?6,
          updated_at = ?7
        WHERE id = ?1
      `,
      )
      .run(
        input.instanceId,
        input.state,
        input.attempt ?? null,
        input.nextAttemptAt ?? null,
        input.resultSummary ?? null,
        input.error === undefined ? null : JSON.stringify(input.error),
        updatedAt,
      );
  }

  private async invokeAgent(input: {
    definition: CronJobDefinition;
    instance: CronJobInstance;
    prompt: string;
    context?: Record<string, unknown>;
  }): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
    const promptText = input.prompt.trim();
    if (!promptText) return { ok: false, error: "agent prompt was empty" };

    const targetSession =
      (typeof input.definition.payload.sessionId === "string" && input.definition.payload.sessionId.trim()) ||
      "main";

    const context = input.context ?? {};
    const agentFromPayload =
      typeof input.definition.payload.agentId === "string"
        ? input.definition.payload.agentId.trim()
        : typeof input.definition.payload.agent === "string"
          ? input.definition.payload.agent.trim()
          : "";
    const expanded = renderTemplate(promptText, {
      ...definitionPayloadContext(input.definition),
      ...context,
      instanceId: input.instance.id,
      scheduledFor: input.instance.scheduledFor,
    });

    try {
      const ack = await this.runtime.sendUserMessage({
        sessionId: targetSession,
        content: expanded,
        agent: agentFromPayload || undefined,
      });
      const assistant = [...ack.messages].reverse().find(message => message.role === "assistant");
      return {
        ok: true,
        summary: assistant?.content?.slice(0, 300) ?? "agent invocation completed",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "agent invocation failed";
      return { ok: false, error: message };
    }
  }

  private async runSystemOrScriptStep(
    definition: CronJobDefinition,
    instance: CronJobInstance,
  ): Promise<CronHandlerResult> {
    const handlerKey = definition.handlerKey;
    if (!handlerKey) {
      return {
        status: "error",
        summary: "missing handlerKey",
      };
    }

    const handler = getCronHandler(handlerKey);
    if (!handler) {
      return {
        status: "error",
        summary: `unknown handlerKey: ${handlerKey}`,
      };
    }

    return await handler({
      nowMs: nowMs(),
      payload: definition.payload,
      job: definition,
      instance,
    });
  }

  private async executeInstance(claimed: CronInstanceRow) {
    const definitionRow = this.loadDefinitionById(claimed.job_definition_id);
    if (!definitionRow) {
      this.setInstanceState({
        instanceId: claimed.id,
        state: "dead",
        error: { message: `missing job definition ${claimed.job_definition_id}` },
      });
      return;
    }
    const definition = definitionRowToModel(definitionRow);
    const instance = instanceRowToModel(claimed);
    const attempt = claimed.attempt + 1;
    const startedAt = nowMs();

    sqlite
      .query(
        `
        UPDATE cron_job_instances
        SET
          state = 'running',
          attempt = ?2,
          last_heartbeat_at = ?3,
          updated_at = ?3
        WHERE id = ?1
      `,
      )
      .run(claimed.id, attempt, startedAt);

    let finalSummary = "";
    try {
      if (definition.runMode === "agent") {
        insertStep({
          instanceId: claimed.id,
          stepKind: "agent",
          status: "running",
          input: {
            promptTemplate: definition.agentPromptTemplate,
            payload: definition.payload,
          },
          startedAt,
        });
        const template = definition.agentPromptTemplate ?? "";
        const prompt = renderTemplate(template, definitionPayloadContext(definition));
        const agentResult = await this.invokeAgent({
          definition,
          instance,
          prompt,
        });
        if (!agentResult.ok) {
          insertStep({
            instanceId: claimed.id,
            stepKind: "agent",
            status: "failed",
            input: { promptTemplate: template },
            error: { message: agentResult.error },
            startedAt,
            finishedAt: nowMs(),
          });
          throw new Error(agentResult.error);
        }
        finalSummary = agentResult.summary;
        insertStep({
          instanceId: claimed.id,
          stepKind: "agent",
          status: "completed",
          input: { promptTemplate: template },
          output: { summary: agentResult.summary },
          startedAt,
          finishedAt: nowMs(),
        });
      } else {
        const stepKind: CronStepKind = definition.runMode === "system" ? "system" : "script";
        insertStep({
          instanceId: claimed.id,
          stepKind,
          status: "running",
          input: { payload: definition.payload, handlerKey: definition.handlerKey },
          startedAt,
        });
        const deterministicResult = await this.runSystemOrScriptStep(definition, instance);
        if (deterministicResult.status !== "ok") {
          insertStep({
            instanceId: claimed.id,
            stepKind,
            status: "failed",
            input: { payload: definition.payload, handlerKey: definition.handlerKey },
            output: deterministicResult,
            error: { message: deterministicResult.summary ?? "handler failed" },
            startedAt,
            finishedAt: nowMs(),
          });
          throw new Error(deterministicResult.summary ?? "deterministic handler failed");
        }
        finalSummary = deterministicResult.summary ?? "deterministic step completed";
        insertStep({
          instanceId: claimed.id,
          stepKind,
          status: "completed",
          input: { payload: definition.payload, handlerKey: definition.handlerKey },
          output: deterministicResult,
          startedAt,
          finishedAt: nowMs(),
        });

        const shouldInvokeAgent =
          definition.runMode === "script" &&
          (definition.invokePolicy === "always" ||
            (definition.invokePolicy === "on_condition" && deterministicResult.invokeAgent?.shouldInvoke === true));

        if (shouldInvokeAgent) {
          const template = deterministicResult.invokeAgent?.prompt ?? definition.agentPromptTemplate ?? "";
          const prompt = renderTemplate(template, {
            ...definitionPayloadContext(definition),
            ...(deterministicResult.invokeAgent?.context ?? {}),
          });
          const agentStartedAt = nowMs();
          insertStep({
            instanceId: claimed.id,
            stepKind: "agent",
            status: "running",
            input: {
              promptTemplate: template,
              invokePolicy: definition.invokePolicy,
              invokeAgent: deterministicResult.invokeAgent ?? null,
            },
            startedAt: agentStartedAt,
          });
          const agentResult = await this.invokeAgent({
            definition,
            instance,
            prompt,
            context: deterministicResult.invokeAgent?.context,
          });
          if (!agentResult.ok) {
            insertStep({
              instanceId: claimed.id,
              stepKind: "agent",
              status: "failed",
              input: {
                promptTemplate: template,
                invokePolicy: definition.invokePolicy,
              },
              error: { message: agentResult.error },
              startedAt: agentStartedAt,
              finishedAt: nowMs(),
            });
            throw new Error(agentResult.error);
          }
          finalSummary = `${finalSummary}; ${agentResult.summary}`;
          insertStep({
            instanceId: claimed.id,
            stepKind: "agent",
            status: "completed",
            input: {
              promptTemplate: template,
              invokePolicy: definition.invokePolicy,
            },
            output: { summary: agentResult.summary },
            startedAt: agentStartedAt,
            finishedAt: nowMs(),
          });
        }
      }

      this.setInstanceState({
        instanceId: claimed.id,
        state: "completed",
        attempt,
        resultSummary: finalSummary || "completed",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "job execution failed";
      const canRetry = attempt < definition.maxAttempts;
      if (canRetry) {
        this.setInstanceState({
          instanceId: claimed.id,
          state: "failed",
          attempt,
          nextAttemptAt: nowMs() + computeBackoffMs(definition.retryBackoffMs, attempt),
          error: { message },
        });
      } else {
        this.setInstanceState({
          instanceId: claimed.id,
          state: "dead",
          attempt,
          error: { message },
        });
      }
    }
  }
}
