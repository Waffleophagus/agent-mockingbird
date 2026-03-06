import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseConfig } from "./store";
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
      "Config file appears to be OpenCode config.json, not agent-mockingbird config. Set AGENT_MOCKINGBIRD_CONFIG_PATH to a agent-mockingbird config file (default: ./data/agent-mockingbird.config.json).",
    ),
  );
});

test("parseConfig does not use AGENT_MOCKINGBIRD_OPENCODE_* env vars as runtime fallbacks", () => {
  const previousModelId = process.env.AGENT_MOCKINGBIRD_OPENCODE_MODEL_ID;
  process.env.AGENT_MOCKINGBIRD_OPENCODE_MODEL_ID = "env-only-model";
  try {
    const filePath = path.resolve(process.cwd(), "agent-mockingbird.config.example.json");
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
      runtime?: { opencode?: Record<string, unknown> };
    };
    if (!raw.runtime?.opencode) {
      throw new Error("Test fixture missing runtime.opencode");
    }
    delete raw.runtime.opencode.modelId;
    expect(() => parseConfig(raw)).toThrowError(ConfigApplyError);
  } finally {
    if (previousModelId === undefined) {
      delete process.env.AGENT_MOCKINGBIRD_OPENCODE_MODEL_ID;
    } else {
      process.env.AGENT_MOCKINGBIRD_OPENCODE_MODEL_ID = previousModelId;
    }
  }
});

test("parseConfig auto-fills opencode directory from memory workspace when unset", () => {
  const filePath = path.resolve(process.cwd(), "agent-mockingbird.config.example.json");
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
    runtime?: { opencode?: Record<string, unknown>; memory?: Record<string, unknown> };
  };
  if (!raw.runtime?.opencode || !raw.runtime.memory) {
    throw new Error("Test fixture missing runtime workspace settings");
  }

  raw.runtime.opencode.directory = null;
  raw.runtime.memory.workspaceDir = "./custom-workspace";
  const parsed = parseConfig(raw);
  const expected = path.resolve(process.cwd(), "custom-workspace");
  expect(parsed.runtime.opencode.directory).toBe(expected);
  expect(parsed.runtime.memory.workspaceDir).toBe(expected);
});

test("parseConfig auto-aligns mismatched memory workspace to explicit opencode directory", () => {
  const filePath = path.resolve(process.cwd(), "agent-mockingbird.config.example.json");
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
    runtime?: { opencode?: Record<string, unknown>; memory?: Record<string, unknown> };
  };
  if (!raw.runtime?.opencode || !raw.runtime.memory) {
    throw new Error("Test fixture missing runtime workspace settings");
  }

  raw.runtime.opencode.directory = "/tmp/opencode-workspace";
  raw.runtime.memory.workspaceDir = "/tmp/memory-workspace";
  const parsed = parseConfig(raw);
  expect(parsed.runtime.opencode.directory).toBe("/tmp/opencode-workspace");
  expect(parsed.runtime.memory.workspaceDir).toBe("/tmp/opencode-workspace");
});

test("example config ships a default build heartbeat", () => {
  const filePath = path.resolve(process.cwd(), "agent-mockingbird.config.example.json");
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
    ui?: { agentTypes?: Array<{ id?: string; heartbeat?: { enabled?: boolean; interval?: string; ackMaxChars?: number } }> };
  };

  const buildAgent = raw.ui?.agentTypes?.find(agent => agent.id === "build");
  expect(buildAgent).toBeDefined();
  expect(buildAgent?.heartbeat?.enabled).toBe(true);
  expect(buildAgent?.heartbeat?.interval).toBe("30m");
  expect(buildAgent?.heartbeat?.ackMaxChars).toBe(300);
});
