import { CronExecutor } from "./executor";
import {
  definitionRowToModel,
  instanceRowToModel,
  selectAll,
  selectOne,
  stepRowToModel,
} from "./repository";
import type { CronDefinitionRow, CronInstanceRow, CronStepRow } from "./repository";
import { ensureCronTables } from "./storage";
import type {
  CronHealthSnapshot,
  CronJobCreateInput,
  CronJobDefinition,
  CronJobInstance,
  CronJobPatchInput,
  CronJobState,
  CronJobStep,
} from "./types";
import {
  buildNormalizedJobInput,
  computeDueTimesForDefinition,
  createUniqueId,
  nowMs,
  normalizePayload,
  validateMode,
  validateSchedule,
} from "./utils";
import type { RuntimeEngine } from "../contracts/runtime";
import { sqlite } from "../db/client";
import { env } from "../env";
import { resolveRuntimeSessionScope } from "../runtime/sessionScope";

export class CronService {
  private schedulerTimer: Timer | null = null;
  private workerTimer: Timer | null = null;
  private schedulerBusy = false;
  private workerBusy = false;
  private readonly workerId = `agent-mockingbird-${process.pid}`;
  private readonly executor: CronExecutor;

  constructor(private runtime: RuntimeEngine) {
    ensureCronTables();
    this.executor = new CronExecutor(runtime, {
      getJob: (jobId) => this.getJob(jobId),
      setInstanceState: (input) => this.setInstanceState(input),
    });
  }

  start() {
    if (!env.AGENT_MOCKINGBIRD_CRON_ENABLED) return;
    this.schedulerTimer = setInterval(() => {
      void this.schedulerTick();
    }, env.AGENT_MOCKINGBIRD_CRON_SCHEDULER_POLL_MS);
    this.workerTimer = setInterval(() => {
      void this.workerTick();
    }, env.AGENT_MOCKINGBIRD_CRON_WORKER_POLL_MS);
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
    return selectAll<CronDefinitionRow>(
      `
      SELECT *
      FROM cron_job_definitions
      ORDER BY created_at DESC
    `,
    ).map(definitionRowToModel);
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
    const normalized = buildNormalizedJobInput(input);
    if (!normalized.name) throw new Error("name is required");
    if (!normalized.id) throw new Error("id is required");

    validateSchedule(normalized);
    validateMode(normalized);

    sqlite
      .query(
        `
        INSERT INTO cron_job_definitions (
          id, name, thread_session_id, enabled, schedule_kind, schedule_expr, every_ms, at_iso, timezone,
          run_mode, handler_key, condition_module_path, condition_description, agent_prompt_template, agent_model_override,
          max_attempts, retry_backoff_ms, payload_json, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?19)
      `,
      )
      .run(
        normalized.id,
        normalized.name,
        null,
        normalized.enabled ? 1 : 0,
        normalized.scheduleKind,
        normalized.scheduleExpr,
        normalized.everyMs,
        normalized.atIso,
        normalized.timezone,
        normalized.runMode,
        null,
        normalized.conditionModulePath,
        normalized.conditionDescription,
        normalized.agentPromptTemplate,
        normalized.agentModelOverride,
        normalized.maxAttempts,
        normalized.retryBackoffMs,
        JSON.stringify(normalizePayload(normalized.payload)),
        now,
      );

    const created = await this.getJob(normalized.id);
    if (!created) throw new Error("Failed to create cron job");
    return created;
  }

  async upsertJob(input: CronJobCreateInput): Promise<{ created: boolean; job: CronJobDefinition }> {
    const explicitId = input.id?.trim();
    if (!explicitId) {
      throw new Error("upsertJob requires job.id");
    }
    const existing = await this.getJob(explicitId);
    if (!existing) {
      return {
        created: true,
        job: await this.createJob({ ...input, id: explicitId }),
      };
    }

    return {
      created: false,
      job: await this.updateJob(explicitId, input),
    };
  }

  async updateJob(jobId: string, patch: CronJobPatchInput): Promise<CronJobDefinition> {
    ensureCronTables();
    const existing = await this.getJob(jobId);
    if (!existing) throw new Error(`Unknown cron job: ${jobId}`);

    const merged = buildNormalizedJobInput({ ...patch, id: jobId }, existing);
    validateSchedule(merged);
    validateMode(merged);

    sqlite
      .query(
        `
        UPDATE cron_job_definitions
        SET
          name = ?2,
          thread_session_id = ?3,
          enabled = ?4,
          schedule_kind = ?5,
          schedule_expr = ?6,
          every_ms = ?7,
          at_iso = ?8,
          timezone = ?9,
          run_mode = ?10,
          handler_key = ?11,
          condition_module_path = ?12,
          condition_description = ?13,
          agent_prompt_template = ?14,
          agent_model_override = ?15,
          max_attempts = ?16,
          retry_backoff_ms = ?17,
          payload_json = ?18,
          updated_at = ?19
        WHERE id = ?1
      `,
      )
      .run(
        jobId,
        merged.name,
        existing.threadSessionId,
        merged.enabled ? 1 : 0,
        merged.scheduleKind,
        merged.scheduleExpr,
        merged.everyMs,
        merged.atIso,
        merged.timezone,
        merged.runMode,
        null,
        merged.conditionModulePath,
        merged.conditionDescription,
        merged.agentPromptTemplate,
        merged.agentModelOverride,
        merged.maxAttempts,
        merged.retryBackoffMs,
        JSON.stringify(merged.payload),
        nowMs(),
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
          SELECT
            i.*,
            EXISTS(
              SELECT 1
              FROM cron_job_steps s
              WHERE s.job_instance_id = i.id
                AND s.step_kind = 'agent'
            ) AS agent_invoked
          FROM cron_job_instances i
          WHERE i.job_definition_id = ?1
          ORDER BY i.created_at DESC
          LIMIT ?2
        `,
          input.jobId,
          limit,
        )
      : selectAll<CronInstanceRow>(
          `
          SELECT
            i.*,
            EXISTS(
              SELECT 1
              FROM cron_job_steps s
              WHERE s.job_instance_id = i.id
                AND s.step_kind = 'agent'
            ) AS agent_invoked
          FROM cron_job_instances i
          ORDER BY i.created_at DESC
          LIMIT ?1
        `,
          limit,
        );
    return rows.map(instanceRowToModel);
  }

  async listSteps(instanceId: string): Promise<CronJobStep[]> {
    ensureCronTables();
    return selectAll<CronStepRow>(
      `
      SELECT *
      FROM cron_job_steps
      WHERE job_instance_id = ?1
      ORDER BY created_at ASC
    `,
      instanceId,
    ).map(stepRowToModel);
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
    const jobs =
      selectOne<{ total: number; enabled: number }>(
        `
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END), 0) AS enabled
        FROM cron_job_definitions
      `,
      ) ?? { total: 0, enabled: 0 };

    const instances =
      selectOne<{
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
      enabled: env.AGENT_MOCKINGBIRD_CRON_ENABLED,
      schedulerPollMs: env.AGENT_MOCKINGBIRD_CRON_SCHEDULER_POLL_MS,
      workerPollMs: env.AGENT_MOCKINGBIRD_CRON_WORKER_POLL_MS,
      leaseMs: env.AGENT_MOCKINGBIRD_CRON_LEASE_MS,
      jobs,
      instances,
    };
  }

  describeContract() {
    return {
      runModes: {
        background: {
          requires: ["conditionModulePath"],
          optional: ["conditionDescription"],
          forbids: ["agentPromptTemplate"],
          moduleContract: {
            contextKeys: ["nowMs", "payload", "job", "instance"],
            resultShape: "CronHandlerResult",
            forbids: ["invokeAgent"],
          },
        },
        agent: {
          requires: ["agentPromptTemplate"],
          forbids: ["conditionModulePath", "conditionDescription"],
        },
        conditional_agent: {
          requires: ["conditionModulePath"],
          optional: ["conditionDescription", "agentPromptTemplate"],
          moduleContract: {
            contextKeys: ["nowMs", "payload", "job", "instance"],
            resultShape: "CronHandlerResult",
          },
        },
      },
    };
  }

  getJobByThreadSessionId(sessionId: string): CronJobDefinition | null {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) return null;
    const row = selectOne<CronDefinitionRow>(
      `
      SELECT *
      FROM cron_job_definitions
      WHERE thread_session_id = ?1
      LIMIT 1
    `,
      normalizedSessionId,
    );
    return row ? definitionRowToModel(row) : null;
  }

  async notifyMainThread(input: {
    runtimeSessionId: string;
    prompt: string;
    severity?: "info" | "warn" | "critical";
  }): Promise<{
    delivered: true;
    threadSessionId: string;
    sourceKind: "cron" | "heartbeat";
    cronJobId?: string;
  }> {
    const runtimeSessionId = input.runtimeSessionId.trim();
    const prompt = input.prompt.trim();
    if (!runtimeSessionId) throw new Error("runtimeSessionId is required");
    if (!prompt) throw new Error("prompt is required");

    const scope = resolveRuntimeSessionScope(runtimeSessionId, this);
    const threadSessionId = scope.localSessionId;
    if (!threadSessionId) throw new Error("Unknown runtime session");
    if (!scope.mayNotifyMain) {
      throw new Error("notify_main_thread is only available from cron or heartbeat threads");
    }

    const severity = input.severity ?? "info";
    const heading =
      scope.kind === "cron"
        ? `Cron escalation from ${scope.cronJobName ?? scope.cronJobId ?? "cron"} (${scope.cronJobId ?? "cron"})`
        : "Heartbeat escalation";
    await this.runtime.sendUserMessage({
      sessionId: "main",
      content: [heading, `Severity: ${severity}`, "", prompt].join("\n"),
      metadata: {
        source: scope.kind,
        cronJobId: scope.cronJobId,
        cronThreadSessionId: scope.kind === "cron" ? threadSessionId : undefined,
        heartbeatThreadSessionId: scope.kind === "heartbeat" ? threadSessionId : undefined,
        severity,
      },
    });

    const result: {
      delivered: true,
      threadSessionId: string;
      sourceKind: "cron" | "heartbeat";
      cronJobId?: string;
    } = {
      delivered: true,
      threadSessionId,
      sourceKind: scope.kind === "heartbeat" ? "heartbeat" : "cron",
    };
    if (scope.cronJobId) {
      result.cronJobId = scope.cronJobId;
    }
    return result;
  }

  private async schedulerTick() {
    if (!env.AGENT_MOCKINGBIRD_CRON_ENABLED || this.schedulerBusy) return;
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
        const dueTimes = computeDueTimesForDefinition(
          row,
          now,
          env.AGENT_MOCKINGBIRD_CRON_MAX_ENQUEUE_PER_JOB_TICK,
        );
        if (!dueTimes.length) continue;
        let lastEnqueued = row.last_enqueued_for ?? null;
        for (const scheduledFor of dueTimes) {
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
            .run(createUniqueId("ins"), row.id, scheduledFor, now);
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
        .run(now, this.workerId, now + env.AGENT_MOCKINGBIRD_CRON_LEASE_MS, candidate.id);
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
    if (!env.AGENT_MOCKINGBIRD_CRON_ENABLED || this.workerBusy) return;
    this.workerBusy = true;
    try {
      const claimed = this.claimNextInstance(nowMs());
      if (!claimed) return;

      const definitionRow = this.loadDefinitionById(claimed.job_definition_id);
      if (!definitionRow) {
        this.setInstanceState({
          instanceId: claimed.id,
          state: "dead",
          error: { message: `missing job definition ${claimed.job_definition_id}` },
        });
        return;
      }

      await this.executor.executeInstance(
        claimed,
        definitionRowToModel(definitionRow),
        instanceRowToModel(claimed),
      );
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
        nowMs(),
      );
  }
}
