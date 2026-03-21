import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { createRuntimeRoutes as CreateRuntimeRoutesType } from "./runtimeRoutes";
import type * as ConfigStoreModuleType from "../../config/store";
import type * as ClientModuleType from "../../db/client";

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

const testRoot = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-runtime-routes-test-"));
const testConfigPath = path.join(testRoot, "agent-mockingbird.runtime-routes.config.json");
const testDbPath = path.join(testRoot, "agent-mockingbird.runtime-routes.test.db");
const testWorkspacePath = path.join(testRoot, "workspace");

process.env.NODE_ENV = "test";
process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = testConfigPath;
process.env.AGENT_MOCKINGBIRD_DB_PATH = testDbPath;
process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR = testWorkspacePath;
process.env.AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER = "none";

type CreateRuntimeRoutesFn = typeof CreateRuntimeRoutesType;
type ConfigStoreModule = typeof ConfigStoreModuleType;
type ClientModule = typeof ClientModuleType;

let createRuntimeRoutes: CreateRuntimeRoutesFn;
let configStore: ConfigStoreModule;
let client: ClientModule;

beforeAll(async () => {
  ({ createRuntimeRoutes } = await import("./runtimeRoutes"));
  configStore = await import("../../config/store");
  client = await import("../../db/client");
});

beforeEach(() => {
  const snapshot = configStore.getConfigSnapshot();
  configStore.persistConfigSnapshot(snapshot.path, snapshot.config);
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

describe("runtime routes", () => {
  test("GET /api/mockingbird/runtime/config returns the full config snapshot", async () => {
    const routes = createRuntimeRoutes({ cronService: {} as never });
    const snapshot = configStore.getConfigSnapshot();

    const response = await routes["/api/mockingbird/runtime/config"].GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      hash: snapshot.hash,
      path: snapshot.path,
      config: snapshot.config,
    });
  });

  test("POST /api/mockingbird/runtime/config/replace can round-trip the GET payload without dropping hidden config", async () => {
    const routes = createRuntimeRoutes({ cronService: {} as never });
    const before = configStore.getConfigSnapshot();

    const getResponse = await routes["/api/mockingbird/runtime/config"].GET();
    const payload = (await getResponse.json()) as {
      config: unknown;
      hash: string;
    };

    const replaceResponse = await routes["/api/mockingbird/runtime/config/replace"].POST(
      new Request("http://localhost/api/mockingbird/runtime/config/replace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          config: payload.config,
          expectedHash: payload.hash,
        }),
      }),
    );

    expect(replaceResponse.status).toBe(200);

    const after = configStore.getConfigSnapshot();
    expect(after.config).toEqual(before.config);
    expect(after.config.ui).toEqual(before.config.ui);
    expect(after.config.version).toBe(before.config.version);
  });
});
