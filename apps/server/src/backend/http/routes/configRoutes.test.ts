import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { createConfigRoutes as CreateConfigRoutesType } from "./configRoutes";
import type * as ConfigStoreModuleType from "../../config/store";
import type * as ClientModuleType from "../../db/client";
import type * as ManagedConfigModuleType from "../../opencode/managedConfig";

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

const testRoot = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-config-routes-test-"));
const testConfigPath = path.join(testRoot, "agent-mockingbird.config-routes.config.json");
const testDbPath = path.join(testRoot, "agent-mockingbird.config-routes.test.db");
const testWorkspacePath = path.join(testRoot, "workspace");

process.env.NODE_ENV = "test";
process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = testConfigPath;
process.env.AGENT_MOCKINGBIRD_DB_PATH = testDbPath;
process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR = testWorkspacePath;
process.env.AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER = "none";

type CreateConfigRoutesFn = typeof CreateConfigRoutesType;
type ConfigStoreModule = typeof ConfigStoreModuleType;
type ClientModule = typeof ClientModuleType;
type ManagedConfigModule = typeof ManagedConfigModuleType;

let createConfigRoutes: CreateConfigRoutesFn;
let configStore: ConfigStoreModule;
let client: ClientModule;
let managedConfig: ManagedConfigModule;

beforeAll(async () => {
  ({ createConfigRoutes } = await import("./configRoutes"));
  configStore = await import("../../config/store");
  client = await import("../../db/client");
  managedConfig = await import("../../opencode/managedConfig");
});

beforeEach(() => {
  const snapshot = configStore.getConfigSnapshot();
  configStore.persistConfigSnapshot(snapshot.path, {
    ...snapshot.config,
    ui: {
      ...snapshot.config.ui,
      mcps: [],
      mcpServers: [],
    },
  });
  rmSync(path.join(testRoot, "opencode-config"), { recursive: true, force: true });
});

afterAll(() => {
  client.sqlite.close(false);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("AGENT_MOCKINGBIRD_CONFIG_PATH", originalConfigPath);
  restoreEnv("AGENT_MOCKINGBIRD_DB_PATH", originalDbPath);
  restoreEnv("AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR", originalWorkspacePath);
  restoreEnv("AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER", originalEmbedProvider);
  rmSync(testRoot, { recursive: true, force: true });
});

describe("config routes MCP integration", () => {
  test("GET /api/config returns effective MCP state from managed OpenCode config", async () => {
    const snapshot = configStore.getConfigSnapshot();
    await managedConfig.patchManagedOpencodeConfig(snapshot.config, {
      mcp: {
        executor: {
          type: "remote",
          enabled: true,
          url: "http://127.0.0.1:8788/mcp",
        },
      },
    });

    const routes = createConfigRoutes({ publish: () => {} } as never);
    const response = await routes["/api/config"].GET();
    const payload = await response.json() as {
      config: { ui: { mcpServers: unknown[]; mcps: string[] } };
      effective: {
        mcp: {
          source: string;
          enabled: string[];
          servers: Array<{ id: string; enabled: boolean; type: string; url?: string }>;
          statusError?: string;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(payload.config.ui.mcpServers).toEqual([]);
    expect(payload.config.ui.mcps).toEqual([]);
    expect(payload.effective.mcp.source).toBe("opencode-managed-config");
    expect(payload.effective.mcp.enabled).toEqual(["executor"]);
    expect(payload.effective.mcp.servers).toMatchObject([
      {
        id: "executor",
        type: "remote",
        enabled: true,
        url: "http://127.0.0.1:8788/mcp",
      },
    ]);
    expect(typeof payload.effective.mcp.statusError).toBe("string");
  });

  test("PUT /api/config/mcps toggles MCP state from managed OpenCode config instead of ui.mcpServers", async () => {
    const snapshot = configStore.getConfigSnapshot();
    await managedConfig.patchManagedOpencodeConfig(snapshot.config, {
      mcp: {
        executor: {
          type: "remote",
          enabled: true,
          url: "http://127.0.0.1:8788/mcp",
        },
      },
    });

    const routes = createConfigRoutes({ publish: () => {} } as never);
    const response = await routes["/api/config/mcps"].PUT(
      new Request("http://localhost/api/config/mcps", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mcps: [],
          expectedHash: snapshot.hash,
        }),
      }),
    );

    const payload = await response.json() as {
      mcps: string[];
      servers: Array<{ id: string; enabled: boolean }>;
      source: string;
    };
    const reloadedSnapshot = configStore.getConfigSnapshot();
    const reloadedManagedConfig = managedConfig.readManagedOpencodeConfig(reloadedSnapshot.config) as {
      mcp?: Record<string, { enabled?: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(payload.source).toBe("opencode-managed-config");
    expect(payload.mcps).toEqual([]);
    expect(payload.servers).toMatchObject([
      {
        id: "executor",
        enabled: false,
      },
    ]);
    expect(reloadedSnapshot.config.ui.mcpServers).toEqual([]);
    expect(reloadedSnapshot.config.ui.mcps).toEqual([]);
    expect(reloadedManagedConfig.mcp?.executor?.enabled).toBe(false);
  });
});
