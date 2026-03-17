import type { SQLQueryBindings } from "bun:sqlite";

import type {
  CronJobDefinition,
  CronJobInstance,
  CronJobState,
  CronJobStep,
  CronScheduleKind,
  CronStepKind,
  CronStepStatus,
} from "./types";
import { nowMs, parseJson, toIso, createUniqueId } from "./utils";
import { sqlite } from "../db/client";

export interface CronDefinitionRow {
  id: string;
  name: string;
  thread_session_id: string | null;
  enabled: number;
  schedule_kind: CronScheduleKind;
  schedule_expr: string | null;
  every_ms: number | null;
  at_iso: string | null;
  timezone: string | null;
  run_mode: "background" | "conditional_agent" | "agent";
  handler_key: string | null;
  condition_module_path: string | null;
  condition_description: string | null;
  agent_prompt_template: string | null;
  agent_model_override: string | null;
  max_attempts: number;
  retry_backoff_ms: number;
  payload_json: string;
  last_enqueued_for: number | null;
  created_at: number;
  updated_at: number;
}

export interface CronInstanceRow {
  id: string;
  job_definition_id: string;
  scheduled_for: number;
  agent_invoked: number;
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

export interface CronStepRow {
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

export function definitionRowToModel(row: CronDefinitionRow): CronJobDefinition {
  return {
    id: row.id,
    name: row.name,
    threadSessionId: row.thread_session_id,
    enabled: row.enabled === 1,
    scheduleKind: row.schedule_kind,
    scheduleExpr: row.schedule_expr,
    everyMs: row.every_ms,
    atIso: row.at_iso,
    timezone: row.timezone,
    runMode: row.run_mode,
    conditionModulePath: row.condition_module_path,
    conditionDescription: row.condition_description,
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

export function instanceRowToModel(row: CronInstanceRow): CronJobInstance {
  return {
    id: row.id,
    jobDefinitionId: row.job_definition_id,
    scheduledFor: toIso(row.scheduled_for) ?? new Date(0).toISOString(),
    agentInvoked: row.agent_invoked === 1,
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

export function stepRowToModel(row: CronStepRow): CronJobStep {
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

export function selectOne<T>(query: string, ...args: SQLQueryBindings[]): T | null {
  const row = sqlite.query(query).get(...args);
  return (row as T | null) ?? null;
}

export function selectAll<T>(query: string, ...args: SQLQueryBindings[]): T[] {
  return sqlite.query(query).all(...args) as T[];
}

export function insertStep(input: {
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
