import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type * as ManagedConfigModuleType from "./managedConfig";
import type * as ConfigStoreModuleType from "../config/store";
import { resolveOpencodeConfigDir } from "../workspace/resolve";

const originalNodeEnv = process.env.NODE_ENV;
const originalConfigPath = process.env.AGENT_MOCKINGBIRD_CONFIG_PATH;
const originalDbPath = process.env.AGENT_MOCKINGBIRD_DB_PATH;
const originalWorkspacePath = process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR;
const originalEmbedProvider = process.env.AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER;

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

const testRoot = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-managed-config-test-"));
const testConfigPath = path.join(testRoot, "agent-mockingbird.managed-config.json");
const testDbPath = path.join(testRoot, "agent-mockingbird.managed-config.db");
const testWorkspacePath = path.join(testRoot, "workspace");

process.env.NODE_ENV = "test";
process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = testConfigPath;
process.env.AGENT_MOCKINGBIRD_DB_PATH = testDbPath;
process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR = testWorkspacePath;
process.env.AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER = "none";

type ConfigStoreModule = typeof ConfigStoreModuleType;
type ManagedConfigModule = typeof ManagedConfigModuleType;

let configStore: ConfigStoreModule;
let managedConfig: ManagedConfigModule;
let baseConfig: ReturnType<ConfigStoreModule["getConfigSnapshot"]>["config"];

beforeAll(async () => {
  configStore = await import("../config/store");
  managedConfig = await import("./managedConfig");
  baseConfig = configStore.getConfigSnapshot().config;
});

beforeEach(() => {
  const snapshot = configStore.persistConfigSnapshot(testConfigPath, baseConfig);
  rmSync(resolveOpencodeConfigDir(snapshot.config), { recursive: true, force: true });
});

afterAll(() => {
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("AGENT_MOCKINGBIRD_CONFIG_PATH", originalConfigPath);
  restoreEnv("AGENT_MOCKINGBIRD_DB_PATH", originalDbPath);
  restoreEnv("AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR", originalWorkspacePath);
  restoreEnv("AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER", originalEmbedProvider);
  rmSync(testRoot, { recursive: true, force: true });
});

test("ensureExecutorMcpServerConfigured uses the default executor mount path", async () => {
  const snapshot = configStore.getConfigSnapshot();
  await managedConfig.ensureExecutorMcpServerConfigured(snapshot.config);

  const reloaded = managedConfig.readManagedOpencodeConfig(snapshot.config) as {
    mcp?: Record<string, { url?: string; enabled?: boolean }>;
  };

  expect(reloaded.mcp?.executor?.url).toBe("http://127.0.0.1:8788/executor/mcp");
  expect(reloaded.mcp?.executor?.enabled).toBe(true);
});

test("ensureExecutorMcpServerConfigured supports a custom executor mount path", async () => {
  const snapshot = configStore.getConfigSnapshot();
  const candidate = configStore.parseConfig({
    ...snapshot.config,
    runtime: {
      ...snapshot.config.runtime,
      executor: {
        ...snapshot.config.runtime.executor,
        uiMountPath: "/custom",
      },
    },
  });

  await managedConfig.ensureExecutorMcpServerConfigured(candidate);

  const reloaded = managedConfig.readManagedOpencodeConfig(candidate) as {
    mcp?: Record<string, { url?: string }>;
  };

  expect(reloaded.mcp?.executor?.url).toBe("http://127.0.0.1:8788/custom/mcp");
});

test("ensureExecutorMcpServerConfigured uses /mcp when the executor mount path is root", async () => {
  const snapshot = configStore.getConfigSnapshot();
  const candidate = configStore.parseConfig({
    ...snapshot.config,
    runtime: {
      ...snapshot.config.runtime,
      executor: {
        ...snapshot.config.runtime.executor,
        uiMountPath: "/",
      },
    },
  });

  await managedConfig.ensureExecutorMcpServerConfigured(candidate);

  const reloaded = managedConfig.readManagedOpencodeConfig(candidate) as {
    mcp?: Record<string, { url?: string }>;
  };

  expect(reloaded.mcp?.executor?.url).toBe("http://127.0.0.1:8788/mcp");
});

test("ensureExecutorMcpServerConfigured preserves the corrected path when executor is disabled", async () => {
  const snapshot = configStore.getConfigSnapshot();
  const candidate = configStore.parseConfig({
    ...snapshot.config,
    runtime: {
      ...snapshot.config.runtime,
      executor: {
        ...snapshot.config.runtime.executor,
        enabled: false,
      },
    },
  });

  await managedConfig.ensureExecutorMcpServerConfigured(candidate);

  const reloaded = managedConfig.readManagedOpencodeConfig(candidate) as {
    mcp?: Record<string, { url?: string; enabled?: boolean }>;
  };

  expect(reloaded.mcp?.executor?.url).toBe("http://127.0.0.1:8788/executor/mcp");
  expect(reloaded.mcp?.executor?.enabled).toBe(false);
});
