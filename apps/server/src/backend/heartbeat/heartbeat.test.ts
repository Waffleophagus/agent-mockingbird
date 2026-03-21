import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isActiveHours } from "./activeHours";
import type { HeartbeatConfig } from "./types";

const originalDbPath = process.env.AGENT_MOCKINGBIRD_DB_PATH;
const originalNodeEnv = process.env.NODE_ENV;
const testRoot = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-heartbeat-test-"));
const testDbPath = path.join(testRoot, "agent-mockingbird.heartbeat.test.db");

process.env.NODE_ENV = "test";
process.env.AGENT_MOCKINGBIRD_DB_PATH = testDbPath;

type SqliteDb = {
  close?: () => void;
  query: (sql: string) => {
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown;
    run: (...args: unknown[]) => { changes: number };
  };
};

let parseInterval: (interval: string) => number;
let clearCronTables: () => void;
let seedDefaultHeartbeatJob: (createdAt: number) => void;
let deleteLegacyHeartbeatJobs: () => number;
let HEARTBEAT_SYSTEM_JOB_ID: string;
let sqlite: SqliteDb;

beforeAll(async () => {
  await import("../db/migrate");
  ({ parseInterval } = await import("./service"));
  ({ clearCronTables } = await import("../cron/storage"));
  ({ seedDefaultHeartbeatJob, deleteLegacyHeartbeatJobs, HEARTBEAT_SYSTEM_JOB_ID } = await import("./defaultJob"));
  ({ sqlite } = await import("../db/client") as unknown as { sqlite: SqliteDb });
});

beforeEach(() => {
  clearCronTables();
});

afterAll(() => {
  sqlite.close?.();
  process.env.AGENT_MOCKINGBIRD_DB_PATH = originalDbPath;
  process.env.NODE_ENV = originalNodeEnv;
  rmSync(testRoot, { recursive: true, force: true });
});

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
