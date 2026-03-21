import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { createBackgroundRoutes as CreateBackgroundRoutesType } from "./backgroundRoutes";
import type * as RepositoryModuleType from "../../db/repository";

const testRoot = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-background-routes-test-"));
const testDbPath = path.join(testRoot, "agent-mockingbird.background-routes.test.db");
const testConfigPath = path.join(testRoot, "agent-mockingbird.background-routes.config.json");
const testWorkspacePath = path.join(testRoot, "workspace");

process.env.NODE_ENV = "test";
process.env.AGENT_MOCKINGBIRD_DB_PATH = testDbPath;
process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = testConfigPath;
process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR = testWorkspacePath;
process.env.AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER = "none";

type CreateBackgroundRoutesFn = typeof CreateBackgroundRoutesType;
type RepositoryModule = typeof RepositoryModuleType;

let createBackgroundRoutes: CreateBackgroundRoutesFn;
let repository: RepositoryModule;

beforeAll(async () => {
  await import("../../db/migrate");
  ({ createBackgroundRoutes } = await import("./backgroundRoutes"));
  repository = await import("../../db/repository");
});

beforeEach(() => {
  repository.resetDatabaseToDefaults();
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("background routes", () => {
  test("POST /api/background returns 400 for malformed JSON", async () => {
    const routes = createBackgroundRoutes({
      spawnBackgroundSession: async () => {
        throw new Error("should not be called");
      },
    } as never);

    const response = await routes["/api/background"].POST(
      new Request("http://localhost/api/background", {
        method: "POST",
        body: "{",
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Request body must be valid JSON",
    });
  });

  test("POST /api/background rejects prompting when runtime lacks promptBackgroundAsync before spawning", async () => {
    const session = repository.createSession({ title: "Background parent" });
    let spawnCalls = 0;
    const routes = createBackgroundRoutes({
      spawnBackgroundSession: async () => {
        spawnCalls += 1;
        return {
          runId: "run-1",
          parentSessionId: session.id,
          parentExternalSessionId: "parent-ext",
          childExternalSessionId: "child-ext",
          childSessionId: "session-child",
          status: "running",
          startedAt: null,
          completedAt: null,
          error: null,
        };
      },
    } as never);

    const response = await routes["/api/background"].POST(
      new Request("http://localhost/api/background", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          prompt: "continue working",
        }),
      }),
    );

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      error: "Runtime does not support background prompting",
    });
    expect(spawnCalls).toBe(0);
  });

  test("POST /api/background/:id/steer returns 400 for malformed JSON", async () => {
    const routes = createBackgroundRoutes({
      promptBackgroundAsync: async () => {
        throw new Error("should not be called");
      },
    } as never);

    const response = await routes["/api/background/:id/steer"].POST(
      Object.assign(
        new Request("http://localhost/api/background/run-1/steer", {
          method: "POST",
          body: "{",
          headers: { "content-type": "application/json" },
        }),
        {
          params: { id: "run-1" },
        },
      ) as never,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Request body must be valid JSON",
    });
  });
});
