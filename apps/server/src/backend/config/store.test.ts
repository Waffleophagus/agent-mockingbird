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

test("parseConfig aligns AGENT_MOCKINGBIRD_OPENCODE_DIRECTORY through workspace.pinnedDirectory", () => {
  const previousOpencodeDirectory = process.env.AGENT_MOCKINGBIRD_OPENCODE_DIRECTORY;
  process.env.AGENT_MOCKINGBIRD_OPENCODE_DIRECTORY = "./env-opencode-workspace";
  try {
    const filePath = resolveExampleConfigPath();
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
      workspace?: Record<string, unknown>;
      runtime?: { opencode?: Record<string, unknown>; memory?: Record<string, unknown> };
    };
    if (!raw.workspace || !raw.runtime?.opencode || !raw.runtime.memory) {
      throw new Error("Test fixture missing runtime workspace settings");
    }
    delete raw.workspace.pinnedDirectory;
    delete raw.runtime.opencode.directory;
    delete raw.runtime.memory.workspaceDir;

    const parsed = parseConfig(raw);
    const expected = path.resolve(process.cwd(), "env-opencode-workspace");
    expect(parsed.workspace.pinnedDirectory).toBe(expected);
    expect(parsed.runtime.opencode.directory).toBe(expected);
    expect(parsed.runtime.memory.workspaceDir).toBe(expected);
  } finally {
    if (previousOpencodeDirectory === undefined) {
      delete process.env.AGENT_MOCKINGBIRD_OPENCODE_DIRECTORY;
    } else {
      process.env.AGENT_MOCKINGBIRD_OPENCODE_DIRECTORY = previousOpencodeDirectory;
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

test("parseConfig migrates legacy agent heartbeat blocks into runtime.agentHeartbeats", () => {
  const filePath = resolveExampleConfigPath();
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
    runtime?: Record<string, unknown>;
    ui?: { agentTypes?: Array<Record<string, unknown>> };
  };
  if (!raw.runtime || !raw.ui?.agentTypes?.[0]) {
    throw new Error("Test fixture missing runtime/ui.agentTypes");
  }

  delete raw.runtime.heartbeat;
  raw.ui.agentTypes[0] = {
    ...raw.ui.agentTypes[0],
    id: "build",
    model: "opencode/legacy-heartbeat-model",
    heartbeat: {
      enabled: true,
      interval: "45m",
      prompt: "legacy heartbeat prompt",
      ackMaxChars: 123,
    },
  };

  const parsed = parseConfig(raw);
  expect(parsed.runtime.agentHeartbeats.build?.agentId).toBe("build");
  expect(parsed.runtime.agentHeartbeats.build?.model).toBe("opencode/legacy-heartbeat-model");
  expect(parsed.runtime.agentHeartbeats.build?.interval).toBe("45m");
  expect(parsed.runtime.agentHeartbeats.build?.prompt).toBe("legacy heartbeat prompt");
  expect(parsed.runtime.agentHeartbeats.build?.ackMaxChars).toBe(123);
  expect(parsed.ui.agentTypes[0]?.id).toBe("build");
  expect("heartbeat" in (parsed.ui.agentTypes[0] ?? {})).toBe(false);
});

test("parseConfig preserves multiple legacy agent heartbeat blocks", () => {
  const filePath = resolveExampleConfigPath();
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
    runtime?: Record<string, unknown>;
    ui?: { agentTypes?: Array<Record<string, unknown>> };
  };
  if (!raw.runtime || !raw.ui?.agentTypes) {
    throw new Error("Test fixture missing runtime/ui.agentTypes");
  }

  delete raw.runtime.heartbeat;
  delete raw.runtime.agentHeartbeats;
  raw.ui.agentTypes = [
    {
      id: "build",
      model: "opencode/build-heartbeat-model",
      heartbeat: {
        interval: "45m",
      },
    },
    {
      id: "review",
      model: "opencode/review-heartbeat-model",
      heartbeat: {
        enabled: false,
        interval: "2h",
        prompt: "review heartbeat prompt",
        ackMaxChars: 222,
      },
    },
    {
      model: "opencode/fallback-heartbeat-model",
      heartbeat: {
        interval: "1d",
      },
    },
  ];

  const parsed = parseConfig(raw);
  expect(Object.keys(parsed.runtime.agentHeartbeats).sort()).toEqual(["build", "build-1", "review"]);
  expect(parsed.runtime.agentHeartbeats.build).toMatchObject({
    agentId: "build",
    model: "opencode/build-heartbeat-model",
    interval: "45m",
  });
  expect(parsed.runtime.agentHeartbeats.review).toMatchObject({
    agentId: "review",
    model: "opencode/review-heartbeat-model",
    enabled: false,
    interval: "2h",
    prompt: "review heartbeat prompt",
    ackMaxChars: 222,
  });
  expect(parsed.runtime.agentHeartbeats["build-1"]).toMatchObject({
    agentId: "build",
    model: "opencode/fallback-heartbeat-model",
    interval: "1d",
  });
  expect(parsed.ui.agentTypes.every(agentType => !("heartbeat" in agentType))).toBe(true);
});
