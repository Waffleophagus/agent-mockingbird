import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseConfig } from "./store";
import { resolveExampleConfigPath } from "./testFixtures";
import { ConfigApplyError } from "./types";

test("parseConfig reports a clear error when AGENT_MOCKINGBIRD_CONFIG_PATH points to OpenCode config.json", () => {
  expect(() =>
    parseConfig({
      $schema: "https://opencode.ai/config.json",
      model: "anthropic/claude-opus-4-5",
    }),
  ).toThrowError(
    new ConfigApplyError(
      "schema",
      "Config file appears to be OpenCode config.json, not Agent Mockingbird config. Set AGENT_MOCKINGBIRD_CONFIG_PATH to an Agent Mockingbird config file (default: ./data/agent-mockingbird.config.json).",
    ),
  );
});

test("parseConfig uses AGENT_MOCKINGBIRD_OPENCODE_* env vars as runtime fallbacks when fields are unset", () => {
  const previousModelId = process.env.AGENT_MOCKINGBIRD_OPENCODE_MODEL_ID;
  process.env.AGENT_MOCKINGBIRD_OPENCODE_MODEL_ID = "env-only-model";
  try {
    const filePath = resolveExampleConfigPath();
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
      runtime?: { opencode?: Record<string, unknown> };
    };
    if (!raw.runtime?.opencode) {
      throw new Error("Test fixture missing runtime.opencode");
    }
    delete raw.runtime.opencode.modelId;
    expect(parseConfig(raw).runtime.opencode.modelId).toBe("env-only-model");
  } finally {
    if (previousModelId === undefined) {
      delete process.env.AGENT_MOCKINGBIRD_OPENCODE_MODEL_ID;
    } else {
      process.env.AGENT_MOCKINGBIRD_OPENCODE_MODEL_ID = previousModelId;
    }
  }
});

test("parseConfig aligns runtime workspace paths to workspace.pinnedDirectory", () => {
  const filePath = resolveExampleConfigPath();
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
    workspace?: Record<string, unknown>;
  };
  if (!raw.workspace) {
    throw new Error("Test fixture missing workspace settings");
  }

  raw.workspace.pinnedDirectory = "./custom-workspace";
  const parsed = parseConfig(raw);
  const expected = path.resolve(process.cwd(), "custom-workspace");
  expect(parsed.workspace.pinnedDirectory).toBe(expected);
  expect(parsed.runtime.opencode.directory).toBe(expected);
  expect(parsed.runtime.memory.workspaceDir).toBe(expected);
});

test("parseConfig ignores legacy mismatched runtime workspace fields in favor of workspace.pinnedDirectory", () => {
  const filePath = resolveExampleConfigPath();
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
    workspace?: Record<string, unknown>;
    runtime?: { opencode?: Record<string, unknown>; memory?: Record<string, unknown> };
  };
  if (!raw.workspace || !raw.runtime?.opencode || !raw.runtime.memory) {
    throw new Error("Test fixture missing runtime workspace settings");
  }

  raw.workspace.pinnedDirectory = "/tmp/pinned-workspace";
  raw.runtime.opencode.directory = "/tmp/opencode-workspace";
  raw.runtime.memory.workspaceDir = "/tmp/memory-workspace";
  const parsed = parseConfig(raw);
  expect(parsed.workspace.pinnedDirectory).toBe("/tmp/pinned-workspace");
  expect(parsed.runtime.opencode.directory).toBe("/tmp/pinned-workspace");
  expect(parsed.runtime.memory.workspaceDir).toBe("/tmp/pinned-workspace");
});

test("example config no longer ships heartbeat config on the default build agent", () => {
  const filePath = resolveExampleConfigPath();
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
    ui?: { agentTypes?: Array<{ id?: string; heartbeat?: unknown }> };
  };

  const buildAgent = raw.ui?.agentTypes?.find(agent => agent.id === "build");
  expect(buildAgent).toBeDefined();
  expect(buildAgent?.heartbeat).toBeUndefined();
});
