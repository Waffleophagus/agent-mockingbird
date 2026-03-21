import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { parse as parseJsonc } from "jsonc-parser";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type * as OpencodeConfigModule from "./opencodeConfig";
import { resolveExampleConfigPath } from "../config/testFixtures";

const testRoot = mkdtempSync(
  path.join(tmpdir(), "agent-mockingbird-opencode-config-"),
);
const testConfigPath = path.join(testRoot, "agent-mockingbird.config.json");
const testWorkspacePath = path.join(testRoot, "workspace");
const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  AGENT_MOCKINGBIRD_CONFIG_PATH: process.env.AGENT_MOCKINGBIRD_CONFIG_PATH,
  AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR: process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR,
  AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER: process.env.AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER,
};

function restoreEnvValue(key: keyof typeof originalEnv, value: string | undefined) {
  if (typeof value === "undefined") {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

process.env.NODE_ENV = "test";
process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = testConfigPath;
process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR = testWorkspacePath;
process.env.AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER = "none";

mock.module("@opencode-ai/sdk/client", () => ({
  createOpencodeClient: ({ directory }: { directory?: string }) => ({
    config: {
      get: async () => {
        const configPath = path.join(directory ?? "", "opencode.jsonc");
        const raw = readFileSync(configPath, "utf8");
        return { data: parseJsonc(raw) };
      },
      providers: async () => ({ data: { providers: [] } }),
    },
    instance: {
      dispose: async () => undefined,
    },
  }),
}));

mock.module("@opencode-ai/sdk/v2/client", () => ({
  createOpencodeClient: () => ({}),
}));

let opencodeConfigModule: typeof OpencodeConfigModule;

beforeAll(async () => {
  const raw = JSON.parse(readFileSync(resolveExampleConfigPath(), "utf8")) as {
    workspace?: { pinnedDirectory?: string };
  };
  raw.workspace = {
    ...raw.workspace,
    pinnedDirectory: testWorkspacePath,
  };
  writeFileSync(testConfigPath, JSON.stringify(raw, null, 2), "utf8");

  opencodeConfigModule = await import("./opencodeConfig");

  const storage = opencodeConfigModule.getOpencodeAgentStorageInfo();
  mkdirSync(storage.configDirectory, { recursive: true });
  writeFileSync(
    storage.configFilePath,
    `{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "worker": {
      "model": "demo/model",
      "queueMode": "followup"
    }
  }
}
`,
    "utf8",
  );
});

afterAll(() => {
  restoreEnvValue("NODE_ENV", originalEnv.NODE_ENV);
  restoreEnvValue("AGENT_MOCKINGBIRD_CONFIG_PATH", originalEnv.AGENT_MOCKINGBIRD_CONFIG_PATH);
  restoreEnvValue(
    "AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR",
    originalEnv.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR,
  );
  restoreEnvValue(
    "AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER",
    originalEnv.AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER,
  );
  mock.restore();
  rmSync(testRoot, { recursive: true, force: true });
});

test("listOpencodeAgentTypes preserves queueMode from managed OpenCode config", async () => {
  const payload = await opencodeConfigModule.listOpencodeAgentTypes();
  expect(payload.agentTypes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "build",
        mode: "primary",
        hidden: false,
      }),
      expect.objectContaining({
        id: "plan",
        mode: "primary",
        hidden: false,
      }),
      expect.objectContaining({
        id: "worker",
        queueMode: "followup",
      }),
    ]),
  );
});

test("patchOpencodeAgentTypes writes queueMode back to managed OpenCode config", async () => {
  const before = await opencodeConfigModule.listOpencodeAgentTypes();

  const result = await opencodeConfigModule.patchOpencodeAgentTypes({
    upserts: [
      {
        id: "worker",
        mode: "subagent",
        hidden: false,
        disable: false,
        options: {},
        queueMode: "replace",
      },
    ],
    deletes: [],
    expectedHash: before.hash,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Patch failed: ${result.error}`);
  }
  expect(result.agentTypes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "worker",
        queueMode: "replace",
      }),
    ]),
  );

  const raw = readFileSync(result.applied.configFilePath, "utf8");
  expect(raw).toContain('"queueMode": "replace"');
});
