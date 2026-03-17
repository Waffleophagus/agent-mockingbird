import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveExampleConfigPath } from "./testFixtures";

test("applyConfigPatch skips OpenCode semantic validation for memory-only changes", async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-config-service-"));
  const configPath = path.join(tempRoot, "agent-mockingbird.config.json");
  const workspacePath = path.join(tempRoot, "workspace");
  const fixturePath = resolveExampleConfigPath();
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    runtime?: {
      configPolicy?: Record<string, unknown>;
    };
  };

  const previousConfigPath = process.env.AGENT_MOCKINGBIRD_CONFIG_PATH;
  const previousWorkspacePath = process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousFetch = globalThis.fetch;
  const blockingFetch = Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      void input;
      void init;
      throw new Error("semantic validation should not call fetch for memory-only patches");
    },
    previousFetch,
  );

  writeFileSync(configPath, JSON.stringify(raw, null, 2), "utf8");
  process.env.NODE_ENV = "test";
  process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = configPath;
  process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR = workspacePath;
  globalThis.fetch = blockingFetch;

  try {
    const { getConfigSnapshot, applyConfigPatch } = await import("./service");
    getConfigSnapshot();
    const result = await applyConfigPatch({
      runSmokeTest: false,
      patch: {
        runtime: {
          memory: {
            enabled: true,
            embedProvider: "ollama",
            embedModel: "granite-embedding:278m",
            ollamaBaseUrl: "http://172.16.1.100:11434",
          },
        },
      },
    });

    expect(result.snapshot.config.runtime.memory.ollamaBaseUrl).toBe("http://172.16.1.100:11434");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousConfigPath === undefined) {
      delete process.env.AGENT_MOCKINGBIRD_CONFIG_PATH;
    } else {
      process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = previousConfigPath;
    }
    if (previousWorkspacePath === undefined) {
      delete process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR;
    } else {
      process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR = previousWorkspacePath;
    }
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
