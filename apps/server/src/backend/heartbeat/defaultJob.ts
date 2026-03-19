import { DEFAULT_HEARTBEAT_PROMPT, parseInterval } from "./service";
import { ensureCronTables } from "../cron/storage";
import { sqlite } from "../db/client";
import { DEFAULT_AGENT_TYPES } from "../defaults";

export const HEARTBEAT_SYSTEM_JOB_ID = "heartbeat-system";
const HEARTBEAT_SYSTEM_JOB_NAME = "Heartbeat";
const DEFAULT_HEARTBEAT_INTERVAL = "30m";

function resolveDefaultHeartbeatAgentId() {
  return (
    DEFAULT_AGENT_TYPES.find(agent => agent.mode === "primary" && !agent.disable)?.id ??
    DEFAULT_AGENT_TYPES[0]?.id ??
    "build"
  );
}

function buildDefaultHeartbeatPayload() {
  return {
    agentId: resolveDefaultHeartbeatAgentId(),
  };
}

export function seedDefaultHeartbeatJob(createdAt: number) {
  ensureCronTables();
  sqlite
    .query(
      `
      INSERT INTO cron_job_definitions (
        id, name, thread_session_id, enabled, schedule_kind, schedule_expr, every_ms, at_iso, timezone,
        run_mode, handler_key, condition_module_path, condition_description, agent_prompt_template, agent_model_override,
        max_attempts, retry_backoff_ms, payload_json, last_enqueued_for, created_at, updated_at
      )
      VALUES (?1, ?2, NULL, 1, 'every', NULL, ?3, NULL, NULL, 'agent', NULL, NULL, NULL, ?4, NULL, ?5, ?6, ?7, NULL, ?8, ?8)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        enabled = excluded.enabled,
        schedule_kind = excluded.schedule_kind,
        schedule_expr = excluded.schedule_expr,
        every_ms = excluded.every_ms,
        at_iso = excluded.at_iso,
        timezone = excluded.timezone,
        run_mode = excluded.run_mode,
        handler_key = excluded.handler_key,
        condition_module_path = excluded.condition_module_path,
        condition_description = excluded.condition_description,
        agent_prompt_template = excluded.agent_prompt_template,
        agent_model_override = excluded.agent_model_override,
        max_attempts = excluded.max_attempts,
        retry_backoff_ms = excluded.retry_backoff_ms,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `,
    )
    .run(
      HEARTBEAT_SYSTEM_JOB_ID,
      HEARTBEAT_SYSTEM_JOB_NAME,
      parseInterval(DEFAULT_HEARTBEAT_INTERVAL),
      DEFAULT_HEARTBEAT_PROMPT,
      3,
      30_000,
      JSON.stringify(buildDefaultHeartbeatPayload()),
      createdAt,
    );
}

export function deleteLegacyHeartbeatJobs() {
  ensureCronTables();
  sqlite
    .query(
      `
      DELETE FROM cron_job_instances
      WHERE job_definition_id = ?1
         OR job_definition_id LIKE 'heartbeat-%'
    `,
    )
    .run(HEARTBEAT_SYSTEM_JOB_ID);
  const deleted = sqlite
    .query(
      `
      DELETE FROM cron_job_definitions
      WHERE id = ?1
         OR id LIKE 'heartbeat-%'
    `,
    )
    .run(HEARTBEAT_SYSTEM_JOB_ID).changes;
  return deleted;
}
