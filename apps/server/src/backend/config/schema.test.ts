import { expect, test } from "bun:test";

import { agentMockingbirdConfigSchema, agentTypeDefinitionSchema } from "./schema";

test("agent type schema rejects legacy heartbeat config blocks", () => {
  const parsed = agentTypeDefinitionSchema.safeParse({
    id: "agent-1",
    heartbeat: {
      enabled: true,
      interval: "30m",
      ackMaxChars: 300,
    },
  });
  expect(parsed.success).toBe(false);
});

test("config schema rejects non-path executor mount values", () => {
  const baseConfig = {
    version: 2,
    workspace: { pinnedDirectory: "./data/workspace" },
    runtime: {
      opencode: {
        baseUrl: "http://127.0.0.1:4096",
        providerId: "openai",
        modelId: "gpt-5",
        fallbackModels: [],
        imageModel: null,
        smallModel: "gpt-5-mini",
        timeoutMs: 30_000,
        promptTimeoutMs: 30_000,
      },
      executor: {
        enabled: true,
        baseUrl: "http://127.0.0.1:8788",
        workspaceDir: "./data/executor-workspace",
        dataDir: "./data/executor",
        uiMountPath: "executor",
      },
      embeddedServices: {
        executor: {
          enabled: true,
          mountPath: "executor",
          baseUrl: "http://127.0.0.1:8788",
          healthcheckPath: "/executor?health=1",
          mode: "embedded-patched",
        },
      },
      smokeTest: {
        prompt: "ping",
        expectedResponsePattern: "pong",
      },
    },
    ui: {},
  };

  const parsed = agentMockingbirdConfigSchema.safeParse(baseConfig);
  expect(parsed.success).toBe(false);
});

test("config schema supplies executor defaults when runtime.executor is omitted", () => {
  const parsed = agentMockingbirdConfigSchema.parse({
    version: 2,
    workspace: { pinnedDirectory: "./data/workspace" },
    runtime: {
      opencode: {
        baseUrl: "http://127.0.0.1:4096",
        providerId: "openai",
        modelId: "gpt-5",
        fallbackModels: [],
        imageModel: null,
        smallModel: "gpt-5-mini",
        timeoutMs: 30_000,
        promptTimeoutMs: 30_000,
      },
      embeddedServices: {
        executor: {
          enabled: true,
          mountPath: "/executor",
          baseUrl: "http://127.0.0.1:8788",
          healthcheckPath: "/executor",
          mode: "embedded-patched",
        },
      },
      smokeTest: {
        prompt: "ping",
        expectedResponsePattern: "pong",
      },
    },
    ui: {},
  });

  expect(parsed.runtime.executor).toEqual({
    enabled: true,
    baseUrl: "http://127.0.0.1:8788",
    workspaceDir: "./data/executor-workspace",
    dataDir: "./data/executor",
    uiMountPath: "/executor",
  });
});
