import {
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  DEFAULT_HEARTBEAT_PROMPT,
  parseInterval,
} from "./service";
import { ensureCronTables } from "../cron/storage";
import { sqlite } from "../db/client";
import { DEFAULT_AGENT_TYPES } from "../defaults";

export const HEARTBEAT_SYSTEM_JOB_ID = "heartbeat-system";
const HEARTBEAT_SYSTEM_JOB_NAME = "Heartbeat";
const MAIN_SESSION_ID = "main";
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
    sessionId: MAIN_SESSION_ID,
    prompt: DEFAULT_HEARTBEAT_PROMPT,
    ackMaxChars: DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  };
}

export function seedDefaultHeartbeatJob(createdAt: number) {
  ensureCronTables();
  sqlite
    .query(
      `
      INSERT OR IGNORE INTO cron_job_definitions (
        id, name, thread_session_id, enabled, schedule_kind, schedule_expr, every_ms, at_iso, timezone,
        run_mode, handler_key, condition_module_path, condition_description, agent_prompt_template, agent_model_override,
        max_attempts, retry_backoff_ms, payload_json, last_enqueued_for, created_at, updated_at
      )
      VALUES (?1, ?2, NULL, 1, 'every', NULL, ?3, NULL, NULL, 'background', 'heartbeat.check', NULL, NULL, NULL, NULL, ?4, ?5, ?6, NULL, ?7, ?7)
    `,
    )
    .run(
      HEARTBEAT_SYSTEM_JOB_ID,
      HEARTBEAT_SYSTEM_JOB_NAME,
      parseInterval(DEFAULT_HEARTBEAT_INTERVAL),
      3,
      30_000,
      JSON.stringify(buildDefaultHeartbeatPayload()),
      createdAt,
    );
}

export function migrateLegacyHeartbeatJobs() {
  ensureCronTables();
  const legacyRows = sqlite
    .query(
      `
      SELECT id
      FROM cron_job_definitions
      WHERE id LIKE 'heartbeat-%'
        AND id != ?1
    `,
    )
    .all(HEARTBEAT_SYSTEM_JOB_ID) as Array<{ id: string }>;
  if (legacyRows.length === 0) {
    return { migrated: false, removedLegacy: 0, createdDefault: false };
  }

  const tx = sqlite.transaction(() => {
    const hasDefault =
      sqlite
        .query(
          `
          SELECT COUNT(*) as count
          FROM cron_job_definitions
          WHERE id = ?1
        `,
        )
        .get(HEARTBEAT_SYSTEM_JOB_ID) as { count: number } | null;
    const createdDefault = (hasDefault?.count ?? 0) < 1;
    if (createdDefault) {
      seedDefaultHeartbeatJob(Date.now());
    }

    sqlite
      .query(
        `
        DELETE FROM cron_job_definitions
        WHERE id LIKE 'heartbeat-%'
          AND id != ?1
      `,
      )
      .run(HEARTBEAT_SYSTEM_JOB_ID);

    return {
      migrated: true,
      removedLegacy: legacyRows.length,
      createdDefault,
    };
  });

  return tx();
}
