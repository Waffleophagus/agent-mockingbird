import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const testRoot = mkdtempSync(path.join(tmpdir(), "wafflebot-ui-routes-test-"));
const testDbPath = path.join(testRoot, "wafflebot.ui-routes.test.db");
const testConfigPath = path.join(testRoot, "wafflebot.ui-routes.config.json");
const testWorkspacePath = path.join(testRoot, "workspace");

process.env.NODE_ENV = "test";
process.env.WAFFLEBOT_DB_PATH = testDbPath;
process.env.WAFFLEBOT_CONFIG_PATH = testConfigPath;
process.env.WAFFLEBOT_MEMORY_WORKSPACE_DIR = testWorkspacePath;
process.env.WAFFLEBOT_MEMORY_EMBED_PROVIDER = "none";

interface RuntimeStub {
  syncSessionMessages: (sessionId: string) => Promise<void>;
  listBackgroundRuns: (input?: { parentSessionId?: string; limit?: number; inFlightOnly?: boolean }) => Promise<
    Array<{
      runId: string;
      parentSessionId: string;
      parentExternalSessionId: string;
      childExternalSessionId: string;
      childSessionId: string | null;
      status: string;
      startedAt: string | null;
      completedAt: string | null;
      error: string | null;
    }>
  >;
}

type CreateUiRoutesFn = typeof import("./uiRoutes").createUiRoutes;
type RepositoryModule = typeof import("../../db/repository");

let createUiRoutes: CreateUiRoutesFn;
let repository: RepositoryModule;

beforeAll(async () => {
  await import("../../db/migrate");
  const uiRoutesModule = await import("./uiRoutes");
  const repositoryModule = await import("../../db/repository");
  createUiRoutes = uiRoutesModule.createUiRoutes;
  repository = repositoryModule;
});

beforeEach(() => {
  repository.resetDatabaseToDefaults();
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function buildRuntimeStub(): RuntimeStub {
  return {
    syncSessionMessages: async () => undefined,
    listBackgroundRuns: async () => [],
  };
}

describe("uiRoutes contracts", () => {
  test("GET /api/ui/session-screen/bootstrap returns screen bootstrap payload", async () => {
    const session = repository.createSession({ title: "UI Routes Test" });
    repository.appendChatExchange({
      sessionId: session.id,
      userContent: "hello",
      assistantContent: "world",
      source: "api",
      usage: {
        requestCountDelta: 1,
        inputTokensDelta: 5,
        outputTokensDelta: 8,
        estimatedCostUsdDelta: 0.001,
      },
    });

    const routes = createUiRoutes(buildRuntimeStub() as never);
    const handler = routes["/api/ui/session-screen/bootstrap"]?.GET;
    expect(handler).toBeDefined();

    const response = await handler!(new Request(`http://localhost/api/ui/session-screen/bootstrap?sessionId=${encodeURIComponent(session.id)}`));
    expect(response.status).toBe(200);

    const payload = await response.json() as Record<string, unknown>;
    expect(Array.isArray(payload.sessions)).toBe(true);
    expect(payload.activeSessionId).toBe(session.id);
    expect(Array.isArray(payload.messages)).toBe(true);
    expect(typeof payload.usage).toBe("object");
    expect(payload.usage).not.toBeNull();
    expect(typeof payload.heartbeat).toBe("object");
    expect(payload.heartbeat).not.toBeNull();
    expect(typeof payload.featureFlags).toBe("object");
    expect(payload.featureFlags).not.toBeNull();
  });

  test("GET /api/ui/sessions/:id/context returns context payload", async () => {
    const session = repository.createSession({ title: "Context Session" });
    repository.appendChatExchange({
      sessionId: session.id,
      userContent: "show me context",
      assistantContent: "sure",
      source: "api",
      usage: {
        requestCountDelta: 1,
        inputTokensDelta: 9,
        outputTokensDelta: 12,
        estimatedCostUsdDelta: 0.0015,
      },
    });

    const routes = createUiRoutes(buildRuntimeStub() as never);
    const handler = routes["/api/ui/sessions/:id/context"]?.GET;
    expect(handler).toBeDefined();

    const request = Object.assign(new Request("http://localhost/api/ui/sessions/id/context"), {
      params: { id: session.id },
    });
    const response = await handler!(request as never);
    expect(response.status).toBe(200);

    const payload = await response.json() as Record<string, unknown>;
    expect(typeof payload.session).toBe("object");
    expect(payload.session).not.toBeNull();
    expect(typeof payload.metrics).toBe("object");
    expect(payload.metrics).not.toBeNull();
    expect(typeof payload.contextBreakdown).toBe("object");
    expect(payload.contextBreakdown).not.toBeNull();

    const metrics = payload.metrics as { totalMessages?: number };
    expect(typeof metrics.totalMessages).toBe("number");
    expect((metrics.totalMessages ?? 0) > 0).toBe(true);
  });

  test("GET /api/ui/sessions/:id/review returns placeholder review contract", async () => {
    const session = repository.createSession({ title: "Review Placeholder" });
    const routes = createUiRoutes(buildRuntimeStub() as never);
    const handler = routes["/api/ui/sessions/:id/review"]?.GET;
    expect(handler).toBeDefined();

    const request = Object.assign(new Request("http://localhost/api/ui/sessions/id/review"), {
      params: { id: session.id },
    });
    const response = await handler!(request as never);
    expect(response.status).toBe(200);

    const payload = await response.json() as {
      enabled?: boolean;
      reason?: string;
      sessionId?: string;
    };

    expect(payload.enabled).toBe(false);
    expect(payload.reason).toBe("review_not_yet_mapped");
    expect(payload.sessionId).toBe(session.id);
  });
});
