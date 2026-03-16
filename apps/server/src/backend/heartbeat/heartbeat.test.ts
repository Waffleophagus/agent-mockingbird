import { describe, expect, test } from "bun:test";

import { isActiveHours } from "./activeHours";
import { HEARTBEAT_SYSTEM_JOB_ID, migrateLegacyHeartbeatJobs, seedDefaultHeartbeatJob } from "./defaultJob";
import { DEFAULT_HEARTBEAT_PROMPT, parseInterval } from "./service";
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
      ackMaxChars: 300,
    };
    expect(isActiveHours(config)).toBe(true);
  });

  test("returns true for always-on config (00:00-23:59)", () => {
    const config: HeartbeatConfig = {
      enabled: true,
      interval: "30m",
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

describe("default heartbeat cron", () => {
  test("seeds the reserved heartbeat-system cron with OpenClaw defaults", () => {
    clearCronTables();
    const createdAt = Date.now();
    seedDefaultHeartbeatJob(createdAt);

    const row = sqlite
      .query(
        `
        SELECT id, name, enabled, schedule_kind, every_ms, run_mode, handler_key, agent_prompt_template, payload_json
        FROM cron_job_definitions
        WHERE id = ?1
      `,
      )
      .get(HEARTBEAT_SYSTEM_JOB_ID) as
      | {
          id: string;
          name: string;
          enabled: number;
          schedule_kind: string;
          every_ms: number;
          run_mode: string;
          handler_key: string | null;
          agent_prompt_template: string | null;
          payload_json: string;
        }
      | null;

    expect(row).not.toBeNull();
    expect(row?.name).toBe("Heartbeat");
    expect(row?.enabled).toBe(1);
    expect(row?.schedule_kind).toBe("every");
    expect(row?.every_ms).toBe(parseInterval("30m"));
    expect(row?.run_mode).toBe("agent");
    expect(row?.handler_key).toBeNull();
    expect(row?.agent_prompt_template).toBe(DEFAULT_HEARTBEAT_PROMPT);
    expect(JSON.parse(row?.payload_json ?? "{}")).toEqual({
      agentId: "build",
    });
  });

  test("migrates legacy heartbeat-* jobs to the reserved heartbeat-system job once", () => {
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

    const result = migrateLegacyHeartbeatJobs();
    expect(result).toEqual({
      migrated: true,
      removedLegacy: 1,
      createdDefault: true,
    });

    const rows = sqlite
      .query(
        `
        SELECT id, run_mode, handler_key, agent_prompt_template
        FROM cron_job_definitions
        ORDER BY id
      `,
      )
      .all() as Array<{ id: string; run_mode: string; handler_key: string | null; agent_prompt_template: string | null }>;
    expect(rows).toEqual([
      {
        id: HEARTBEAT_SYSTEM_JOB_ID,
        run_mode: "agent",
        handler_key: null,
        agent_prompt_template: DEFAULT_HEARTBEAT_PROMPT,
      },
    ]);
  });
});
