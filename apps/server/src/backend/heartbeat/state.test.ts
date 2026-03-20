import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { patchHeartbeatRuntimeState, isActiveHeartbeatSession } from "./state";

const testRoot = mkdtempSync(
  path.join(tmpdir(), "agent-mockingbird-heartbeat-state-test-"),
);
const testDbPath = path.join(
  testRoot,
  "agent-mockingbird.heartbeat-state.test.db",
);
const testConfigPath = path.join(
  testRoot,
  "agent-mockingbird.heartbeat-state.config.json",
);
const testWorkspacePath = path.join(testRoot, "workspace");

process.env.NODE_ENV = "test";
process.env.AGENT_MOCKINGBIRD_DB_PATH = testDbPath;
process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = testConfigPath;
process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR = testWorkspacePath;
process.env.AGENT_MOCKINGBIRD_MEMORY_ENABLED = "false";

let resetDatabaseToDefaults: () => unknown;

beforeAll(async () => {
  await import("../db/migrate");
  ({ resetDatabaseToDefaults } = await import("../db/repository"));
});

beforeEach(() => {
  resetDatabaseToDefaults();
});

describe("heartbeat state helpers", () => {
  test("identifies the active heartbeat session from runtime state", () => {
    expect(isActiveHeartbeatSession("session-heartbeat")).toBe(false);

    patchHeartbeatRuntimeState({
      sessionId: "session-heartbeat",
      backgroundRunId: "bg-heartbeat-1",
      parentSessionId: "main",
      externalSessionId: "ext-heartbeat-1",
    });

    expect(isActiveHeartbeatSession("session-heartbeat")).toBe(true);
    expect(isActiveHeartbeatSession("other-session")).toBe(false);
  });
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});
