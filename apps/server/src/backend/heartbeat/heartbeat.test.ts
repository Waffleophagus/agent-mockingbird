import { describe, expect, test } from "bun:test";

import { isActiveHours } from "./activeHours";
import { deleteLegacyHeartbeatJobs, HEARTBEAT_SYSTEM_JOB_ID, seedDefaultHeartbeatJob } from "./defaultJob";
import { parseInterval } from "./service";
import type { HeartbeatConfig } from "./types";
import { clearCronTables } from "../cron/storage";
import { sqlite } from "../db/client";

describe("parseInterval", () => {
  test("parses minutes", () => {
    expect(parseInterval("30m")).toBe(30 * 60 * 1000);
  });

  test("parses hours", () => {
    expect(parseInterval("1h")).toBe(60 * 60 * 1000);
  });

  test("parses days", () => {
    expect(parseInterval("1d")).toBe(24 * 60 * 60 * 1000);
  });

  test("parses zero minutes", () => {
    expect(parseInterval("0m")).toBe(0);
  });

  test("rejects invalid format", () => {
    expect(() => parseInterval("invalid")).toThrow();
  });

  test("rejects missing unit", () => {
    expect(() => parseInterval("30")).toThrow();
  });
});

describe("isActiveHours", () => {
  test("returns true if no active hours config", () => {
    const config: HeartbeatConfig = {
      enabled: true,
      interval: "30m",
      prompt: "heartbeat",
      ackMaxChars: 300,
    };
    expect(isActiveHours(config)).toBe(true);
  });

  test("returns true for always-on config (00:00-23:59)", () => {
    const config: HeartbeatConfig = {
      enabled: true,
      interval: "30m",
      prompt: "heartbeat",
      ackMaxChars: 300,
      activeHours: {
        start: "00:00",
        end: "23:59",
        timezone: "UTC",
      },
    };
    expect(isActiveHours(config)).toBe(true);
  });
});

describe("legacy heartbeat cron cleanup", () => {
  test("removes the reserved heartbeat cron job", () => {
    clearCronTables();
    const createdAt = Date.now();
    seedDefaultHeartbeatJob(createdAt);

    expect(deleteLegacyHeartbeatJobs()).toBe(1);
    const remaining = sqlite
      .query(
        `
        SELECT COUNT(*) as count
        FROM cron_job_definitions
        WHERE id = ?1
      `,
      )
      .get(HEARTBEAT_SYSTEM_JOB_ID) as { count: number };
    expect(remaining.count).toBe(0);
  });

  test("removes legacy heartbeat-prefixed jobs", () => {
    clearCronTables();
    sqlite
      .query(
        `
        INSERT INTO cron_job_definitions (
          id, name, thread_session_id, enabled, schedule_kind, schedule_expr, every_ms, at_iso, timezone,
          run_mode, handler_key, condition_module_path, condition_description, agent_prompt_template, agent_model_override,
          max_attempts, retry_backoff_ms, payload_json, last_enqueued_for, created_at, updated_at
        )
        VALUES (?1, ?2, NULL, 1, 'every', NULL, ?3, NULL, NULL, 'background', 'heartbeat.check', NULL, NULL, NULL, NULL, 3, 30000, '{}', NULL, ?4, ?4)
      `,
      )
      .run("heartbeat-build", "Heartbeat: build", parseInterval("30m"), Date.now());

    expect(deleteLegacyHeartbeatJobs()).toBe(1);

    const rows = sqlite
      .query(
        `
        SELECT id
        FROM cron_job_definitions
        ORDER BY id
      `,
      )
      .all() as Array<{ id: string }>;
    expect(rows).toEqual([]);
  });
});
