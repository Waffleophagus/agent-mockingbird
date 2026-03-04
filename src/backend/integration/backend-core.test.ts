import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const testRoot = mkdtempSync(path.join(tmpdir(), "wafflebot-backend-test-"));
const testDbPath = path.join(testRoot, "wafflebot.test.db");
const testWorkspacePath = path.join(testRoot, "workspace");
const testConfigPath = path.join(testRoot, "wafflebot.test.config.json");

process.env.NODE_ENV = "test";
process.env.WAFFLEBOT_DB_PATH = testDbPath;
process.env.WAFFLEBOT_CONFIG_PATH = testConfigPath;
process.env.WAFFLEBOT_MEMORY_WORKSPACE_DIR = testWorkspacePath;
process.env.WAFFLEBOT_MEMORY_EMBED_PROVIDER = "none";
process.env.WAFFLEBOT_MEMORY_ENABLED = "true";
process.env.WAFFLEBOT_CRON_ENABLED = "true";

interface SessionSummaryLite {
  id: string;
}

interface UsageSnapshotLite {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

interface HeartbeatSnapshotLite {
  online: boolean;
  at: string;
}

interface RepositoryApi {
  ensureSeedData: () => void;
  resetDatabaseToDefaults: () => unknown;
  createSession: (input?: { title?: string; model?: string }) => SessionSummaryLite;
  getSessionById: (sessionId: string) => { id: string; model: string } | null;
  getUsageSnapshot: () => UsageSnapshotLite;
  getHeartbeatSnapshot: () => HeartbeatSnapshotLite;
}

interface MemoryWriteEventLite {
  status: "accepted" | "rejected";
  sessionId: string | null;
}

interface MemoryRememberResultLite {
  accepted: boolean;
}

interface MemoryServiceApi {
  initializeMemory: () => Promise<void>;
  rememberMemory: (input: {
    source: "user" | "assistant" | "system";
    content: string;
    sessionId?: string;
    confidence?: number;
  }) => Promise<MemoryRememberResultLite>;
  listMemoryWriteEvents: (limit?: number) => Promise<MemoryWriteEventLite[]>;
}

interface RuntimeStub {
  sendUserMessage: (input: {
    sessionId: string;
    content: string;
    agent?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<unknown>;
  subscribe: (_listener: (event: unknown) => void) => () => void;
  syncSessionMessages?: (sessionId: string) => Promise<void>;
  checkHealth?: (_input?: { force?: boolean }) => Promise<{
    ok: boolean;
    error: { name: string; message: string } | null;
    fromCache: boolean;
  }>;
  abortSession?: (sessionId: string) => Promise<boolean>;
  compactSession?: (sessionId: string) => Promise<boolean>;
  spawnBackgroundSession?: (input: {
    parentSessionId: string;
    title?: string;
    requestedBy?: string;
    prompt?: string;
  }) => Promise<{
    runId: string;
    parentSessionId: string;
    parentExternalSessionId: string;
    childExternalSessionId: string;
    childSessionId: string | null;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
  }>;
  promptBackgroundAsync?: (input: {
    runId: string;
    content: string;
    model?: string;
    system?: string;
    agent?: string;
    noReply?: boolean;
  }) => Promise<{
    runId: string;
    parentSessionId: string;
    parentExternalSessionId: string;
    childExternalSessionId: string;
    childSessionId: string | null;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
  }>;
  getBackgroundStatus?: (runId: string) => Promise<{
    runId: string;
    parentSessionId: string;
    parentExternalSessionId: string;
    childExternalSessionId: string;
    childSessionId: string | null;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
  } | null>;
  listBackgroundRuns?: (input?: {
    parentSessionId?: string;
    limit?: number;
    inFlightOnly?: boolean;
  }) => Promise<
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
  abortBackground?: (runId: string) => Promise<boolean>;
}

interface CronJobDefinitionLite {
  id: string;
  name?: string;
  everyMs?: number | null;
}

interface CronJobInstanceLite {
  id: string;
  agentInvoked?: boolean;
  state: "queued" | "leased" | "running" | "completed" | "failed" | "dead";
  attempt: number;
}

interface CronServiceInstance {
  createJob: (input: {
    id?: string;
    name: string;
    enabled?: boolean;
    scheduleKind: "at" | "every" | "cron";
    scheduleExpr?: string | null;
    everyMs?: number | null;
    atIso?: string | null;
    timezone?: string | null;
    runMode: "background" | "agent" | "conditional_agent";
    handlerKey?: string | null;
    conditionModulePath?: string | null;
    agentPromptTemplate?: string | null;
    maxAttempts?: number;
    retryBackoffMs?: number;
    payload?: Record<string, unknown>;
  }) => Promise<CronJobDefinitionLite>;
  upsertJob: (input: {
    id: string;
    name: string;
    enabled?: boolean;
    scheduleKind: "at" | "every" | "cron";
    scheduleExpr?: string | null;
    everyMs?: number | null;
    atIso?: string | null;
    timezone?: string | null;
    runMode: "background" | "agent" | "conditional_agent";
    handlerKey?: string | null;
    conditionModulePath?: string | null;
    agentPromptTemplate?: string | null;
    maxAttempts?: number;
    retryBackoffMs?: number;
    payload?: Record<string, unknown>;
  }) => Promise<{ created: boolean; job: CronJobDefinitionLite }>;
  updateJob: (jobId: string, patch: { enabled?: boolean }) => Promise<{ enabled: boolean }>;
  getJob: (jobId: string) => Promise<{ enabled: boolean } | null>;
  runJobNow: (jobId: string) => Promise<{ queued: boolean; instanceId: string | null }>;
  listJobs: () => Promise<CronJobDefinitionLite[]>;
  listInstances: (input?: { jobId?: string; limit?: number }) => Promise<CronJobInstanceLite[]>;
  listSteps: (instanceId: string) => Promise<Array<{ stepKind: string; status: string }>>;
}

type CronServiceCtor = new (runtime: RuntimeStub) => CronServiceInstance;
type RuntimeSessionNotFoundErrorCtor = new (sessionId: string) => Error;
type RuntimeSessionQueuedErrorCtor = new (sessionId: string, depth: number) => Error;
type RuntimeContinuationDetachedErrorCtor = new (sessionId: string, childRunCount: number) => Error;

type RouteHandler = (req: Request) => Response | Promise<Response>;
type RouteMethods = {
  GET?: RouteHandler;
  POST?: RouteHandler;
  PUT?: RouteHandler;
  PATCH?: RouteHandler;
  DELETE?: RouteHandler;
};
type RouteTable = Record<string, RouteHandler | RouteMethods>;

interface RuntimeEventStreamApi {
  publish: (_event: unknown) => void;
  route: {
    GET: () => Response;
  };
}

interface AgentRunLite {
  id: string;
  state: "queued" | "running" | "completed" | "failed";
}

interface RunServiceInstance {
  start: () => void;
  stop: () => void;
  createRun: (input: {
    sessionId: string;
    content: string;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
  }) => { run: AgentRunLite; deduplicated: boolean };
  getRunById: (runId: string) => AgentRunLite | null;
}

type RunServiceCtor = new (runtime: RuntimeStub) => RunServiceInstance;

type CreateApiRoutesFn = (input: {
  runtime: RuntimeStub;
  cronService: CronServiceInstance;
  eventStream: RuntimeEventStreamApi;
  runService: RunServiceInstance;
  signalService: {
    getStatus: () => unknown;
    listPairingRequests: () => unknown[];
    listStoredAllowlist: () => unknown[];
    approvePairing: (input: { code?: string; senderId?: string }) => unknown;
    rejectPairing: (input: { code?: string; senderId?: string }) => boolean;
  };
}) => RouteTable;

type CreateRuntimeEventStreamFn = (input: {
  getHeartbeatSnapshot: () => HeartbeatSnapshotLite;
  getUsageSnapshot: () => UsageSnapshotLite;
}) => RuntimeEventStreamApi;

type ToSseFrameFn = (event: {
  id: string;
  type: string;
  source: string;
  at: string;
  payload: unknown;
}) => string;

type StreamChunk = Uint8Array | string;

interface SqliteDb {
  query: (sql: string) => {
    run: (...bindings: Array<string | number | null>) => unknown;
  };
}

let repository: RepositoryApi;
let memoryService: MemoryServiceApi;
let createApiRoutes: CreateApiRoutesFn;
let createRuntimeEventStream: CreateRuntimeEventStreamFn;
let toSseFrame: ToSseFrameFn;
let CronService: CronServiceCtor;
let RunService: RunServiceCtor;
let RuntimeSessionNotFoundError: RuntimeSessionNotFoundErrorCtor;
let RuntimeSessionQueuedError: RuntimeSessionQueuedErrorCtor;
let RuntimeContinuationDetachedError: RuntimeContinuationDetachedErrorCtor;
let sqlite: SqliteDb;

beforeAll(async () => {
  await import("../db/migrate");
  repository = (await import("../db/repository")) as unknown as RepositoryApi;
  memoryService = (await import("../memory/service")) as unknown as MemoryServiceApi;
  ({ createApiRoutes } = (await import("../http/routes")) as unknown as {
    createApiRoutes: CreateApiRoutesFn;
  });
  ({ createRuntimeEventStream, toSseFrame } = (await import("../http/sse")) as unknown as {
    createRuntimeEventStream: CreateRuntimeEventStreamFn;
    toSseFrame: ToSseFrameFn;
  });
  ({ CronService } = (await import("../cron/service")) as unknown as {
    CronService: CronServiceCtor;
  });
  ({ RunService } = (await import("../run/service")) as unknown as {
    RunService: RunServiceCtor;
  });
  ({
    RuntimeSessionNotFoundError,
    RuntimeSessionQueuedError,
    RuntimeContinuationDetachedError,
  } = (await import("../runtime/errors")) as unknown as {
    RuntimeSessionNotFoundError: RuntimeSessionNotFoundErrorCtor;
    RuntimeSessionQueuedError: RuntimeSessionQueuedErrorCtor;
    RuntimeContinuationDetachedError: RuntimeContinuationDetachedErrorCtor;
  });
  ({ sqlite } = (await import("../db/client")) as unknown as {
    sqlite: SqliteDb;
  });

  repository.ensureSeedData();
  await memoryService.initializeMemory();
});

beforeEach(async () => {
  repository.resetDatabaseToDefaults();
  rmSync(testWorkspacePath, { recursive: true, force: true });
  await memoryService.initializeMemory();
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function createRuntimeStub(
  impl: (input: {
    sessionId: string;
    content: string;
    agent?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<unknown>,
  options?: {
    checkHealth?: RuntimeStub["checkHealth"];
  },
) {
  return {
    sendUserMessage: impl,
    subscribe: () => () => {},
    checkHealth: options?.checkHealth,
    abortSession: async () => true,
    compactSession: async () => true,
  };
}

function createRouteHarness(
  runtimeImpl: (input: {
    sessionId: string;
    content: string;
    agent?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<unknown>,
  options?: {
    checkHealth?: RuntimeStub["checkHealth"];
  },
) {
  const runtime = createRuntimeStub(runtimeImpl, options);
  const cronService = new CronService(runtime);
  const runService = new RunService(runtime);
  runService.start();
  const eventStream = createRuntimeEventStream({
    getHeartbeatSnapshot: repository.getHeartbeatSnapshot,
    getUsageSnapshot: repository.getUsageSnapshot,
  });
  const routes = createApiRoutes({
    runtime,
    cronService,
    eventStream,
    runService,
    signalService: {
      getStatus: () => ({
        running: false,
        enabled: false,
        connected: false,
        baseUrl: "http://127.0.0.1:8080",
        account: null,
        lastEventAt: null,
        lastError: null,
      }),
      listPairingRequests: () => [],
      listStoredAllowlist: () => [],
      approvePairing: () => null,
      rejectPairing: () => false,
    } as never,
  });
  return { routes, cronService, eventStream, runService };
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<StreamChunk>,
  timeoutMs: number,
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<StreamChunk>["read"]>>> {
  return await Promise.race([
    reader.read(),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("stream read timed out")), timeoutMs);
    }),
  ]);
}

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

describe("chat routes", () => {
  test("POST /api/chat returns messages for known session", async () => {
    const session = repository.createSession({ title: "Route Test Session" });
    const now = new Date().toISOString();
    const { routes } = createRouteHarness(async input => ({
      sessionId: input.sessionId,
      messages: [
        { id: "user-1", role: "user", content: input.content, at: now },
        { id: "assistant-1", role: "assistant", content: "ack", at: now },
      ],
    }));

    const route = routes["/api/chat"] as { POST: (req: Request) => Promise<Response> };
    const response = await route.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, content: "hello runtime" }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { messages: Array<{ id: string }>; session: { id: string } };
    expect(payload.session.id).toBe(session.id);
    expect(payload.messages.length).toBe(2);
  });

  test("POST /api/chat returns 404 for unknown session from runtime", async () => {
    const { routes } = createRouteHarness(async input => {
      throw new RuntimeSessionNotFoundError(input.sessionId);
    });

    const route = routes["/api/chat"] as { POST: (req: Request) => Promise<Response> };
    const response = await route.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "missing-session", content: "hello runtime" }),
      }),
    );

    expect(response.status).toBe(404);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toBe("Unknown session");
  });

  test("POST /api/chat fails fast when runtime preflight is unhealthy", async () => {
    const session = repository.createSession({ title: "Preflight Failure Session" });
    let sendCalled = false;
    const { routes } = createRouteHarness(
      async () => {
        sendCalled = true;
        return { sessionId: session.id, messages: [] };
      },
      {
        checkHealth: async () => ({
          ok: false,
          fromCache: false,
          error: {
            name: "RuntimeProviderAuthError",
            message: "Provider authentication failed. Check API key or provider credentials.",
          },
        }),
      },
    );

    const route = routes["/api/chat"] as { POST: (req: Request) => Promise<Response> };
    const response = await route.POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, content: "hello runtime" }),
      }),
    );

    expect(response.status).toBe(502);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("Runtime preflight failed");
    expect(sendCalled).toBe(false);
  });

  test("POST /api/chat/:id/abort returns aborted=true", async () => {
    const session = repository.createSession({ title: "Abort Session" });
    const { routes } = createRouteHarness(async () => ({ sessionId: session.id, messages: [] }));

    const route = routes["/api/chat/:id/abort"] as {
      POST: (req: Request & { params: { id: string } }) => Promise<Response>;
    };
    const response = await route.POST(
      Object.assign(new Request(`http://localhost/api/chat/${session.id}/abort`, { method: "POST" }), {
        params: { id: session.id },
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { aborted: boolean };
    expect(payload.aborted).toBe(true);
  });

  test("POST /api/chat/:id/compact returns compacted=true", async () => {
    const session = repository.createSession({ title: "Compact Session" });
    const { routes } = createRouteHarness(async () => ({ sessionId: session.id, messages: [] }));

    const route = routes["/api/chat/:id/compact"] as {
      POST: (req: Request & { params: { id: string } }) => Promise<Response>;
    };
    const response = await route.POST(
      Object.assign(new Request(`http://localhost/api/chat/${session.id}/compact`, { method: "POST" }), {
        params: { id: session.id },
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { compacted: boolean };
    expect(payload.compacted).toBe(true);
  });

  test("PUT /api/sessions/:id/model updates session model even when runtime-default patch fails", async () => {
    const session = repository.createSession({ title: "Model Route Session", model: "opencode/old-model" });
    const { routes } = createRouteHarness(async () => ({ sessionId: session.id, messages: [] }));

    const route = routes["/api/sessions/:id/model"] as {
      PUT: (req: Request & { params: { id: string } }) => Promise<Response>;
    };
    const response = await route.PUT(
      Object.assign(new Request(`http://localhost/api/sessions/${session.id}/model`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "opencode/new-model" }),
      }), {
        params: { id: session.id },
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      session?: { id: string; model: string };
      configError?: string;
    };
    expect(payload.session?.id).toBe(session.id);
    expect(payload.session?.model).toBe("opencode/new-model");
    const persisted = repository.getSessionById(session.id);
    expect(persisted?.model).toBe("opencode/new-model");
    if (typeof payload.configError === "string") {
      expect(payload.configError.length).toBeGreaterThan(0);
    }
  });

  test("PUT /api/sessions/:id/model returns 404 for unknown session", async () => {
    const { routes } = createRouteHarness(async () => ({ sessionId: "main", messages: [] }));
    const route = routes["/api/sessions/:id/model"] as {
      PUT: (req: Request & { params: { id: string } }) => Promise<Response>;
    };
    const response = await route.PUT(
      Object.assign(new Request("http://localhost/api/sessions/missing/model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "opencode/new-model" }),
      }), {
        params: { id: "missing" },
      }),
    );

    expect(response.status).toBe(404);
  });

  test("PUT /api/runtime/default-model updates runtime default model", async () => {
    const { routes } = createRouteHarness(async () => ({ sessionId: "main", messages: [] }));
    const route = routes["/api/runtime/default-model"] as {
      PUT: (req: Request) => Promise<Response>;
    };
    const response = await route.PUT(
      new Request("http://localhost/api/runtime/default-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "opencode/runtime-default-updated" }),
      }),
    );

    expect([200, 422]).toContain(response.status);
    const payload = (await response.json()) as {
      runtimeDefaultModel?: string;
      configHash?: string;
      error?: string;
    };
    if (response.status === 200) {
      expect(payload.runtimeDefaultModel).toBe("opencode/runtime-default-updated");
      expect(typeof payload.configHash).toBe("string");

      const { getConfigSnapshot } = (await import("../config/service")) as unknown as {
        getConfigSnapshot: () => { config: { runtime: { opencode: { providerId: string; modelId: string } } } };
      };
      const snapshot = getConfigSnapshot();
      expect(snapshot.config.runtime.opencode.providerId).toBe("opencode");
      expect(snapshot.config.runtime.opencode.modelId).toBe("runtime-default-updated");
      return;
    }

    expect(typeof payload.error).toBe("string");
  });
});

describe("runtime health route", () => {
  test("GET /api/runtime/health returns probe snapshot", async () => {
    let receivedForce = false;
    const { routes } = createRouteHarness(
      async () => ({ sessionId: "main", messages: [] }),
      {
        checkHealth: async (input) => {
          receivedForce = input?.force === true;
          return {
            ok: true,
            fromCache: false,
            error: null,
          };
        },
      },
    );

    const route = routes["/api/runtime/health"] as { GET: (req: Request) => Promise<Response> };
    const response = await route.GET(new Request("http://localhost/api/runtime/health?force=1"));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { health: { ok: boolean } };
    expect(payload.health.ok).toBe(true);
    expect(receivedForce).toBe(true);
  });

  test("GET /api/runtime/health returns 503 for unhealthy runtime", async () => {
    const { routes } = createRouteHarness(
      async () => ({ sessionId: "main", messages: [] }),
      {
        checkHealth: async () => ({
          ok: false,
          fromCache: false,
          error: {
            name: "RuntimeProviderQuotaError",
            message: "Provider quota exceeded. Add credits or switch provider/model.",
          },
        }),
      },
    );

    const route = routes["/api/runtime/health"] as { GET: (req: Request) => Promise<Response> };
    const response = await route.GET(new Request("http://localhost/api/runtime/health"));

    expect(response.status).toBe(503);
    const payload = (await response.json()) as { health: { ok: boolean } };
    expect(payload.health.ok).toBe(false);
  });

  test("GET /api/runtime/info returns opencode metadata", async () => {
    const { routes } = createRouteHarness(async () => ({ sessionId: "main", messages: [] }));
    const route = routes["/api/runtime/info"] as { GET: (req: Request) => Promise<Response> };
    const response = await route.GET(new Request("http://localhost/api/runtime/info"));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      configAuthority?: { source?: string; path?: string; hash?: string };
      opencode?: { baseUrl?: string; directory?: string; effectiveConfigPath?: string };
    };
    expect(payload.configAuthority?.source).toBe("wafflebot-config-json");
    expect(typeof payload.configAuthority?.path).toBe("string");
    expect(typeof payload.configAuthority?.hash).toBe("string");
    expect(typeof payload.opencode?.baseUrl).toBe("string");
    expect(typeof payload.opencode?.directory).toBe("string");
    expect(typeof payload.opencode?.effectiveConfigPath).toBe("string");
  });
});

describe("config routes", () => {
  test("GET /api/opencode/agents is exposed", async () => {
    const { routes } = createRouteHarness(async () => ({ sessionId: "main", messages: [] }));
    const route = routes["/api/opencode/agents"] as { GET: (req: Request) => Promise<Response> };
    const response = await route.GET(new Request("http://localhost/api/opencode/agents"));
    expect([200, 502]).toContain(response.status);
  });

  test("POST /api/opencode/agents/validate reports invalid upserts", async () => {
    const { routes } = createRouteHarness(async () => ({ sessionId: "main", messages: [] }));
    const route = routes["/api/opencode/agents/validate"] as {
      POST: (req: Request) => Promise<Response>;
    };
    const response = await route.POST(
      new Request("http://localhost/api/opencode/agents/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upserts: [
            {
              id: "",
              name: "Broken",
            },
          ],
          deletes: [],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      ok?: boolean;
      issues?: Array<{ message?: string }>;
    };
    expect(payload.ok).toBe(false);
    expect((payload.issues ?? []).length).toBeGreaterThan(0);
  });

  test("PATCH /api/opencode/agents requires expectedHash", async () => {
    const { routes } = createRouteHarness(async () => ({ sessionId: "main", messages: [] }));
    const route = routes["/api/opencode/agents"] as {
      PATCH: (req: Request) => Promise<Response>;
    };
    const response = await route.PATCH(
      new Request("http://localhost/api/opencode/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upserts: [],
          deletes: [],
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  test("POST /api/config/patch-safe requires expectedHash", async () => {
    const { routes } = createRouteHarness(async () => ({ sessionId: "main", messages: [] }));
    const route = routes["/api/config/patch-safe"] as {
      POST: (req: Request) => Promise<Response>;
    };
    const response = await route.POST(
      new Request("http://localhost/api/config/patch-safe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: {
            runtime: {
              runStream: {
                heartbeatMs: 16000,
              },
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      stage?: string;
      error?: string;
    };
    expect(payload.stage).toBe("request");
    expect(typeof payload.error).toBe("string");
  });

  test("POST /api/config/patch-safe rejects denylisted paths", async () => {
    const { routes } = createRouteHarness(async () => ({ sessionId: "main", messages: [] }));
    const configRoute = routes["/api/config"] as { GET: (req: Request) => Response };
    const configResponse = configRoute.GET(new Request("http://localhost/api/config"));
    const snapshot = (await configResponse.json()) as { hash: string };

    const route = routes["/api/config/patch-safe"] as {
      POST: (req: Request) => Promise<Response>;
    };
    const response = await route.POST(
      new Request("http://localhost/api/config/patch-safe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedHash: snapshot.hash,
          runSmokeTest: false,
          patch: {
            runtime: {
              smokeTest: {
                prompt: "override prompt",
              },
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(422);
    const payload = (await response.json()) as {
      stage?: string;
      details?: { rejectedPaths?: string[] };
    };
    expect(payload.stage).toBe("policy");
    expect(Array.isArray(payload.details?.rejectedPaths)).toBe(true);
    expect(payload.details?.rejectedPaths?.some(path => path.startsWith("runtime.smokeTest"))).toBe(true);
  });

  test("POST /api/config/opencode/bootstrap/import-openclaw migrates workspace content in one step", async () => {
    const { routes } = createRouteHarness(async () => ({ sessionId: "main", messages: [] }));

    const sourceDir = path.join(testRoot, "openclaw-source");
    const targetDir = path.join(testRoot, "openclaw-target");
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(path.join(sourceDir, "memory"), { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(sourceDir, "AGENTS.md"), "# Agents\n- imported\n", "utf8");
    writeFileSync(path.join(sourceDir, "memory", "notes.md"), "# Memory\nhello\n", "utf8");
    writeFileSync(path.join(sourceDir, "README.txt"), "not markdown", "utf8");
    writeFileSync(path.join(targetDir, "AGENTS.md"), "# Agents\n- existing\n", "utf8");

    const importRoute = routes["/api/config/opencode/bootstrap/import-openclaw"] as {
      POST: (req: Request) => Promise<Response>;
    };
    const importResponse = await importRoute.POST(
      new Request("http://localhost/api/config/opencode/bootstrap/import-openclaw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: {
            mode: "local",
            path: sourceDir,
          },
          targetDirectory: targetDir,
        }),
      }),
    );
    expect(importResponse.status).toBe(200);
    const importPayload = (await importResponse.json()) as {
      migration?: {
        copied?: Array<{ relativePath?: string }>;
        merged?: Array<{ relativePath?: string }>;
        skippedExisting?: Array<{ relativePath?: string }>;
      };
      memorySync?: { attempted?: boolean; completed?: boolean; error?: string | null };
    };
    expect(importPayload.migration?.copied?.some(file => file.relativePath === "memory/notes.md")).toBe(true);
    expect(importPayload.migration?.merged?.some(file => file.relativePath === "AGENTS.md")).toBe(false);
    expect(importPayload.migration?.skippedExisting?.some(file => file.relativePath === "AGENTS.md")).toBe(true);
    expect(readFileSync(path.join(targetDir, "AGENTS.md"), "utf8")).toContain("existing");
    expect(readFileSync(path.join(targetDir, "memory", "notes.md"), "utf8")).toContain("hello");
    expect(importPayload.memorySync?.attempted).toBe(true);
    expect(importPayload.memorySync?.completed).toBe(true);
  });

  test("POST /api/config/opencode/bootstrap/import-openclaw defaults target to workspace", async () => {
    const { routes } = createRouteHarness(async () => ({ sessionId: "main", messages: [] }));

    const sourceDir = path.join(testRoot, "openclaw-source-default-target");
    rmSync(sourceDir, { recursive: true, force: true });
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, "IMPORT_TEST.md"), "# Imported default target\n", "utf8");

    const importRoute = routes["/api/config/opencode/bootstrap/import-openclaw"] as {
      POST: (req: Request) => Promise<Response>;
    };
    const importResponse = await importRoute.POST(
      new Request("http://localhost/api/config/opencode/bootstrap/import-openclaw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: {
            mode: "local",
            path: sourceDir,
          },
        }),
      }),
    );
    expect(importResponse.status).toBe(200);
    const importPayload = (await importResponse.json()) as {
      migration?: {
        targetDirectory?: string;
      };
    };
    const targetDirectory = importPayload.migration?.targetDirectory;
    expect(typeof targetDirectory).toBe("string");
    expect(readFileSync(path.join(targetDirectory as string, "IMPORT_TEST.md"), "utf8")).toContain("Imported default target");
  });
});

describe("run routes", () => {
  test("POST /api/runs accepts and completes asynchronously", async () => {
    const session = repository.createSession({ title: "Run Session" });
    const now = new Date().toISOString();
    const { routes } = createRouteHarness(async input => ({
      sessionId: input.sessionId,
      messages: [
        { id: "run-user-1", role: "user", content: input.content, at: now },
        { id: "run-assistant-1", role: "assistant", content: "run ack", at: now },
      ],
    }));

    const createRoute = routes["/api/runs"] as { POST: (req: Request) => Promise<Response> };
    const createResponse = await createRoute.POST(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, content: "ship it" }),
      }),
    );

    expect(createResponse.status).toBe(202);
    const createPayload = (await createResponse.json()) as {
      accepted: boolean;
      runId: string;
      run: { id: string; state: string };
    };
    expect(createPayload.accepted).toBe(true);
    expect(createPayload.runId).toBeTruthy();
    expect(createPayload.run.id).toBe(createPayload.runId);

    const runRoute = routes["/api/runs/:id"] as {
      GET: (req: Request & { params: { id: string } }) => Promise<Response>;
    };

    let latestRunState = createPayload.run.state;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const runResponse = await runRoute.GET(
        Object.assign(new Request(`http://localhost/api/runs/${createPayload.runId}`), {
          params: { id: createPayload.runId },
        }),
      );
      expect(runResponse.status).toBe(200);
      const runPayload = (await runResponse.json()) as {
        run: { state: string; result?: { messageCount?: number; messageIds?: string[] } };
      };
      latestRunState = runPayload.run.state;
      if (latestRunState === "completed") {
        expect(runPayload.run.result?.messageCount).toBe(2);
        expect(runPayload.run.result?.messageIds?.length).toBe(2);
        break;
      }
      await sleep(20);
    }
    expect(latestRunState).toBe("completed");

    const eventsRoute = routes["/api/runs/:id/events"] as {
      GET: (req: Request & { params: { id: string } }) => Promise<Response>;
    };
    const eventsResponse = await eventsRoute.GET(
      Object.assign(new Request(`http://localhost/api/runs/${createPayload.runId}/events?afterSeq=0&limit=20`), {
        params: { id: createPayload.runId },
      }),
    );
    expect(eventsResponse.status).toBe(200);
    const eventsPayload = (await eventsResponse.json()) as {
      events: Array<{ seq: number; type: string }>;
      hasMore: boolean;
      nextAfterSeq: number;
    };
    const eventTypes = eventsPayload.events.map(event => event.type);
    expect(eventTypes).toContain("run.accepted");
    expect(eventTypes).toContain("run.started");
    expect(eventTypes).toContain("run.completed");
    expect(eventsPayload.hasMore).toBe(false);
    expect(eventsPayload.nextAfterSeq).toBeGreaterThan(0);
  });

  test("POST /api/runs forwards optional agent to runtime", async () => {
    const session = repository.createSession({ title: "Agent Run Session" });
    let seenAgent: string | undefined;
    const { routes } = createRouteHarness(async input => {
      seenAgent = input.agent;
      return { sessionId: input.sessionId, messages: [] };
    });

    const createRoute = routes["/api/runs"] as { POST: (req: Request) => Promise<Response> };
    const createResponse = await createRoute.POST(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          content: "run with agent",
          agent: "planner",
        }),
      }),
    );
    expect(createResponse.status).toBe(202);

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(seenAgent).toBe("planner");
  });

  test("POST /api/runs deduplicates by idempotencyKey", async () => {
    const session = repository.createSession({ title: "Run Dedupe Session" });
    const { routes } = createRouteHarness(async input => ({
      sessionId: input.sessionId,
      messages: [
        { id: "run-user-2", role: "user", content: input.content, at: new Date().toISOString() },
        { id: "run-assistant-2", role: "assistant", content: "done", at: new Date().toISOString() },
      ],
    }));
    const route = routes["/api/runs"] as { POST: (req: Request) => Promise<Response> };

    const first = await route.POST(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          content: "dedupe me",
          idempotencyKey: "idem-run-1",
        }),
      }),
    );
    expect(first.status).toBe(202);
    const firstPayload = (await first.json()) as { runId: string; deduplicated: boolean };
    expect(firstPayload.deduplicated).toBe(false);

    const second = await route.POST(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          content: "dedupe me",
          idempotencyKey: "idem-run-1",
        }),
      }),
    );
    expect(second.status).toBe(200);
    const secondPayload = (await second.json()) as { runId: string; deduplicated: boolean };
    expect(secondPayload.deduplicated).toBe(true);
    expect(secondPayload.runId).toBe(firstPayload.runId);
  });

  test("POST /api/runs treats queued runtime result as run.completed (not failure)", async () => {
    const session = repository.createSession({ title: "Queued Run Session" });
    const { routes } = createRouteHarness(async input => {
      throw new RuntimeSessionQueuedError(input.sessionId, 2);
    });

    const createRoute = routes["/api/runs"] as { POST: (req: Request) => Promise<Response> };
    const createResponse = await createRoute.POST(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, content: "queue me" }),
      }),
    );

    expect(createResponse.status).toBe(202);
    const createPayload = (await createResponse.json()) as { runId: string };
    const runRoute = routes["/api/runs/:id"] as {
      GET: (req: Request & { params: { id: string } }) => Promise<Response>;
    };

    let latestState = "queued";
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await runRoute.GET(
        Object.assign(new Request(`http://localhost/api/runs/${createPayload.runId}`), {
          params: { id: createPayload.runId },
        }),
      );
      const payload = (await response.json()) as {
        run: { state: string; result?: { queued?: boolean; queueDepth?: number } };
      };
      latestState = payload.run.state;
      if (latestState === "completed") {
        expect(payload.run.result?.queued).toBe(true);
        expect(payload.run.result?.queueDepth).toBe(2);
        break;
      }
      await sleep(20);
    }
    expect(latestState).toBe("completed");
  });

  test("POST /api/runs treats detached runtime continuation as run.completed (not failure)", async () => {
    const session = repository.createSession({ title: "Detached Run Session" });
    const { routes } = createRouteHarness(async input => {
      throw new RuntimeContinuationDetachedError(input.sessionId, 3);
    });

    const createRoute = routes["/api/runs"] as { POST: (req: Request) => Promise<Response> };
    const createResponse = await createRoute.POST(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, content: "detach me" }),
      }),
    );

    expect(createResponse.status).toBe(202);
    const createPayload = (await createResponse.json()) as { runId: string };
    const runRoute = routes["/api/runs/:id"] as {
      GET: (req: Request & { params: { id: string } }) => Promise<Response>;
    };

    let latestState = "queued";
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await runRoute.GET(
        Object.assign(new Request(`http://localhost/api/runs/${createPayload.runId}`), {
          params: { id: createPayload.runId },
        }),
      );
      const payload = (await response.json()) as {
        run: { state: string; result?: { detached?: boolean; childRunCount?: number } };
      };
      latestState = payload.run.state;
      if (latestState === "completed") {
        expect(payload.run.result?.detached).toBe(true);
        expect(payload.run.result?.childRunCount).toBe(3);
        break;
      }
      await sleep(20);
    }
    expect(latestState).toBe("completed");
  });

  test("GET /api/runs/:id/events/stream replays and streams run events", async () => {
    const session = repository.createSession({ title: "Run Stream Session" });
    const { routes } = createRouteHarness(async input => ({
      sessionId: input.sessionId,
      messages: [
        { id: "run-user-stream", role: "user", content: input.content, at: new Date().toISOString() },
        { id: "run-assistant-stream", role: "assistant", content: "stream ack", at: new Date().toISOString() },
      ],
    }));

    const createRoute = routes["/api/runs"] as { POST: (req: Request) => Promise<Response> };
    const createResponse = await createRoute.POST(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, content: "stream it" }),
      }),
    );
    expect(createResponse.status).toBe(202);
    const createPayload = (await createResponse.json()) as { runId: string };

    const streamRoute = routes["/api/runs/:id/events/stream"] as {
      GET: (req: Request & { params: { id: string } }) => Response;
    };
    const streamResponse = await streamRoute.GET(
      Object.assign(new Request(`http://localhost/api/runs/${createPayload.runId}/events/stream?afterSeq=0`), {
        params: { id: createPayload.runId },
      }),
    );

    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type")).toContain("text/event-stream");
    expect(streamResponse.body).toBeTruthy();

    const reader = streamResponse.body!.getReader();
    const decoder = new TextDecoder();
    let frames = "";

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const chunk = await readWithTimeout(reader, 1_000);
      if (chunk.done) break;
      const text = typeof chunk.value === "string" ? chunk.value : decoder.decode(chunk.value, { stream: true });
      frames += text;
      if (frames.includes("\"type\":\"run.completed\"")) {
        break;
      }
    }

    expect(frames).toContain("event: run-event");
    expect(frames).toContain("\"type\":\"run.accepted\"");
    expect(frames).toContain("\"type\":\"run.completed\"");

    await reader.cancel();
  });
});

describe("background routes", () => {
  test("spawn, list, steer, and abort background runs", async () => {
    const session = repository.createSession({ title: "Background API Session" });

    const runs = new Map<
      string,
      {
        runId: string;
        parentSessionId: string;
        parentExternalSessionId: string;
        childExternalSessionId: string;
        childSessionId: string | null;
        status: string;
        startedAt: string | null;
        completedAt: string | null;
        error: string | null;
      }
    >();
    const runtime: RuntimeStub = {
      ...createRuntimeStub(async () => ({ sessionId: session.id, messages: [] })),
      spawnBackgroundSession: async (input) => {
        const runId = "bg-route-1";
        const run = {
          runId,
          parentSessionId: input.parentSessionId,
          parentExternalSessionId: "ext-parent-1",
          childExternalSessionId: "ext-child-1",
          childSessionId: "session-bg-route-1",
          status: "created",
          startedAt: null,
          completedAt: null,
          error: null,
        };
        runs.set(runId, run);
        return run;
      },
      promptBackgroundAsync: async (input) => {
        const run = runs.get(input.runId);
        if (!run) throw new Error("Unknown run");
        const next = {
          ...run,
          status: "running",
          startedAt: run.startedAt ?? new Date().toISOString(),
          completedAt: null,
          error: null,
        };
        runs.set(input.runId, next);
        return next;
      },
      getBackgroundStatus: async (runId) => runs.get(runId) ?? null,
      listBackgroundRuns: async (input) => {
        const values = [...runs.values()];
        if (!input?.parentSessionId) return values;
        return values.filter((run) => run.parentSessionId === input.parentSessionId);
      },
      abortBackground: async (runId) => {
        const run = runs.get(runId);
        if (!run) return false;
        runs.set(runId, {
          ...run,
          status: "aborted",
          completedAt: new Date().toISOString(),
        });
        return true;
      },
    };

    const cronService = new CronService(runtime);
    const runService = new RunService(runtime);
    runService.start();
    const eventStream = createRuntimeEventStream({
      getHeartbeatSnapshot: repository.getHeartbeatSnapshot,
      getUsageSnapshot: repository.getUsageSnapshot,
    });
    const routes = createApiRoutes({
      runtime,
      cronService,
      eventStream,
      runService,
      signalService: {
        getStatus: () => ({
          running: false,
          enabled: false,
          connected: false,
          baseUrl: "http://127.0.0.1:8080",
          account: null,
          lastEventAt: null,
          lastError: null,
        }),
        listPairingRequests: () => [],
        listStoredAllowlist: () => [],
        approvePairing: () => null,
        rejectPairing: () => false,
      } as never,
    });

    const spawnRoute = routes["/api/background"] as { POST: (req: Request) => Promise<Response> };
    const spawnResponse = await spawnRoute.POST(
      new Request("http://localhost/api/background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          title: "Child worker",
          prompt: "Run analysis",
        }),
      }),
    );
    expect(spawnResponse.status).toBe(202);
    const spawnPayload = (await spawnResponse.json()) as { run: { runId: string; status: string } };
    expect(spawnPayload.run.runId).toBe("bg-route-1");
    expect(spawnPayload.run.status).toBe("running");

    const listSessionRoute = routes["/api/sessions/:id/background"] as {
      GET: (req: Request & { params: { id: string } }) => Promise<Response>;
    };
    const listSessionResponse = await listSessionRoute.GET(
      Object.assign(new Request(`http://localhost/api/sessions/${session.id}/background`), {
        params: { id: session.id },
      }),
    );
    expect(listSessionResponse.status).toBe(200);
    const listSessionPayload = (await listSessionResponse.json()) as { runs: Array<{ runId: string }> };
    expect(listSessionPayload.runs.some((run) => run.runId === "bg-route-1")).toBe(true);

    const steerRoute = routes["/api/background/:id/steer"] as {
      POST: (req: Request & { params: { id: string } }) => Promise<Response>;
    };
    const steerResponse = await steerRoute.POST(
      Object.assign(new Request("http://localhost/api/background/bg-route-1/steer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Do one more pass" }),
      }), {
        params: { id: "bg-route-1" },
      }),
    );
    expect(steerResponse.status).toBe(202);
    const steerPayload = (await steerResponse.json()) as { run: { status: string } };
    expect(steerPayload.run.status).toBe("running");

    const abortRoute = routes["/api/background/:id/abort"] as {
      POST: (req: Request & { params: { id: string } }) => Promise<Response>;
    };
    const abortResponse = await abortRoute.POST(
      Object.assign(new Request("http://localhost/api/background/bg-route-1/abort", { method: "POST" }), {
        params: { id: "bg-route-1" },
      }),
    );
    expect(abortResponse.status).toBe(200);
    const abortPayload = (await abortResponse.json()) as { aborted: boolean };
    expect(abortPayload.aborted).toBe(true);
  });
});

describe("memory validation and logging", () => {
  test("duplicate remember writes are rejected and logged in memory_write_events", async () => {
    const { getConfigPath, getConfigSnapshot } = (await import("../config/service")) as unknown as {
      getConfigPath: () => string;
      getConfigSnapshot: () => { hash: string };
    };
    getConfigSnapshot();
    const configPath = getConfigPath();
    if (!existsSync(configPath)) {
      throw new Error(`Expected config path to exist: ${configPath}`);
    }

    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const runtime = (config.runtime ?? {}) as Record<string, unknown>;
    const memory = (runtime.memory ?? {}) as Record<string, unknown>;
    memory.embedProvider = "none";
    runtime.memory = memory;
    config.runtime = runtime;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const first = await memoryService.rememberMemory({
      source: "system",
      content: "Persist this memory value",
      sessionId: "main",
      confidence: 0.95,
    });
    expect(first.accepted).toBe(true);

    const result = await memoryService.rememberMemory({
      source: "system",
      content: "Persist this memory value",
      sessionId: "main",
      confidence: 0.95,
    });

    expect(result.accepted).toBe(false);
    const events = await memoryService.listMemoryWriteEvents(5);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some(event => event.status === "rejected" && event.sessionId === "main")).toBe(true);
  });
});

describe("cron validation and retries", () => {
  test("invalid runMode requirements are rejected", async () => {
    const runtime = createRuntimeStub(async () => ({ sessionId: "main", messages: [] }));
    const cronService = new CronService(runtime);

    await expect(
      cronService.createJob({
        name: "invalid-background",
        scheduleKind: "every",
        everyMs: 5_000,
        runMode: "background",
      }),
    ).rejects.toThrow("runMode=background requires handlerKey");

    await expect(
      cronService.createJob({
        name: "invalid-agent",
        scheduleKind: "every",
        everyMs: 5_000,
        runMode: "agent",
      }),
    ).rejects.toThrow("runMode=agent requires agentPromptTemplate");

    await expect(
      cronService.createJob({
        name: "invalid-conditional",
        scheduleKind: "every",
        everyMs: 5_000,
        runMode: "conditional_agent",
      }),
    ).rejects.toThrow("runMode=conditional_agent requires conditionModulePath");

    await expect(
      cronService.createJob({
        name: "invalid-conditional-handler",
        scheduleKind: "every",
        everyMs: 5_000,
        runMode: "conditional_agent",
        handlerKey: "memory.maintenance",
        conditionModulePath: "cron/check-stock.ts",
      }),
    ).rejects.toThrow("runMode=conditional_agent does not allow handlerKey");
  });

  test("failed agent jobs transition from failed to dead after maxAttempts", async () => {
    const runtime = createRuntimeStub(async () => {
      throw new Error("forced runtime failure");
    });
    const cronService = new CronService(runtime);

    const job = await cronService.createJob({
      name: "retry-agent",
      scheduleKind: "every",
      everyMs: 10_000,
      runMode: "agent",
      agentPromptTemplate: "Run check",
      maxAttempts: 2,
      retryBackoffMs: 1_000,
      payload: { sessionId: "main" },
    });

    const queued = await cronService.runJobNow(job.id);
    expect(queued.queued).toBe(true);
    expect(queued.instanceId).toBeTruthy();

    await (cronService as unknown as { workerTick: () => Promise<void> }).workerTick();
    let instances = await cronService.listInstances({ jobId: job.id, limit: 1 });
    expect(instances[0]?.state).toBe("failed");
    expect(instances[0]?.attempt).toBe(1);

    const instanceId = instances[0]?.id;
    expect(instanceId).toBeTruthy();
    if (!instanceId) return;
    sqlite.query("UPDATE cron_job_instances SET next_attempt_at = ?2 WHERE id = ?1").run(instanceId, 0);
    await (cronService as unknown as { workerTick: () => Promise<void> }).workerTick();

    instances = await cronService.listInstances({ jobId: job.id, limit: 1 });
    expect(instances[0]?.state).toBe("dead");
    expect(instances[0]?.attempt).toBe(2);
  });

  test("conditional_agent module can decide to invoke the agent with per-run context", async () => {
    const captured: Array<{ content: string; sessionId: string }> = [];
    const runtime = createRuntimeStub(async input => {
      captured.push({ content: input.content, sessionId: input.sessionId });
      return {
        sessionId: input.sessionId,
        messages: [{ id: "assistant-1", role: "assistant", content: "noted", at: new Date().toISOString() }],
      };
    });
    const cronService = new CronService(runtime);

    mkdirSync(path.join(testWorkspacePath, "cron"), { recursive: true });
    writeFileSync(
      path.join(testWorkspacePath, "cron", "stock-alert.ts"),
      [
        "export default async function run(ctx) {",
        "  return {",
        "    status: 'ok',",
        "    summary: 'movement detected',",
        "    invokeAgent: {",
        "      shouldInvoke: true,",
        "      prompt: 'Stock {{symbol}} moved {{movePct}}% in {{windowMin}}m',",
        "      context: { symbol: ctx.payload.symbol, movePct: ctx.payload.movePct, windowMin: 10 },",
        "    },",
        "  };",
        "}",
      ].join("\n"),
    );

    const job = await cronService.createJob({
      name: "stock-alert",
      scheduleKind: "every",
      everyMs: 10_000,
      runMode: "conditional_agent",
      conditionModulePath: "cron/stock-alert.ts",
      payload: {
        sessionId: "main",
        symbol: "AAPL",
        movePct: 3.4,
      },
    });

    const queued = await cronService.runJobNow(job.id);
    expect(queued.queued).toBe(true);
    await (cronService as unknown as { workerTick: () => Promise<void> }).workerTick();

    const instances = await cronService.listInstances({ jobId: job.id, limit: 1 });
    expect(instances[0]?.state).toBe("completed");
    expect(instances[0]?.agentInvoked).toBe(true);
    expect(captured.length).toBe(1);
    expect(captured[0]?.content).toContain("Stock AAPL moved 3.4% in 10m");
    expect(captured[0]?.sessionId).toBe("main");

    const instanceId = instances[0]?.id;
    if (!instanceId) return;
    const steps = await cronService.listSteps(instanceId);
    expect(steps.some(step => step.stepKind === "conditional_agent" && step.status === "completed")).toBe(true);
    expect(steps.some(step => step.stepKind === "agent" && step.status === "completed")).toBe(true);
  });

  test("upsertJob is idempotent for stable cron IDs", async () => {
    const runtime = createRuntimeStub(async () => ({ sessionId: "main", messages: [] }));
    const cronService = new CronService(runtime);

    const first = await cronService.upsertJob({
      id: "stable-stock-alert",
      name: "stable-stock-alert",
      scheduleKind: "every",
      everyMs: 5_000,
      runMode: "agent",
      agentPromptTemplate: "Check status",
    });
    const second = await cronService.upsertJob({
      id: "stable-stock-alert",
      name: "stable-stock-alert-updated",
      scheduleKind: "every",
      everyMs: 15_000,
      runMode: "agent",
      agentPromptTemplate: "Check status",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const jobs = await cronService.listJobs();
    const matching = jobs.filter(job => job.id === "stable-stock-alert");
    expect(matching.length).toBe(1);
    expect(matching[0]?.name).toBe("stable-stock-alert-updated");
    expect(matching[0]?.everyMs).toBe(15_000);
  });

  test("conditional_agent instance reports agentInvoked=false when no escalation occurs", async () => {
    const runtime = createRuntimeStub(async () => ({ sessionId: "main", messages: [] }));
    const cronService = new CronService(runtime);

    mkdirSync(path.join(testWorkspacePath, "cron"), { recursive: true });
    writeFileSync(
      path.join(testWorkspacePath, "cron", "no-invoke.ts"),
      [
        "export default async function run() {",
        "  return { status: 'ok', summary: 'no escalation', invokeAgent: { shouldInvoke: false } };",
        "}",
      ].join("\n"),
    );

    const job = await cronService.createJob({
      name: "no-invoke",
      scheduleKind: "every",
      everyMs: 10_000,
      runMode: "conditional_agent",
      conditionModulePath: "cron/no-invoke.ts",
      payload: { sessionId: "main" },
    });

    const queued = await cronService.runJobNow(job.id);
    expect(queued.queued).toBe(true);
    await (cronService as unknown as { workerTick: () => Promise<void> }).workerTick();

    const instances = await cronService.listInstances({ jobId: job.id, limit: 1 });
    expect(instances[0]?.state).toBe("completed");
    expect(instances[0]?.agentInvoked).toBe(false);
  });

  test("jobs can be disabled and re-enabled without deletion", async () => {
    const runtime = createRuntimeStub(async () => ({ sessionId: "main", messages: [] }));
    const cronService = new CronService(runtime);

    const job = await cronService.createJob({
      name: "toggle-me",
      scheduleKind: "every",
      everyMs: 5_000,
      runMode: "agent",
      agentPromptTemplate: "noop",
      enabled: true,
    });

    const disabled = await cronService.updateJob(job.id, { enabled: false });
    expect(disabled.enabled).toBe(false);

    const enabled = await cronService.updateJob(job.id, { enabled: true });
    expect(enabled.enabled).toBe(true);

    const fetched = await cronService.getJob(job.id);
    expect(fetched?.enabled).toBe(true);
  });
});

describe("sse contract", () => {
  test("toSseFrame maps usage.updated to usage event", () => {
    const frame = toSseFrame(
      {
        id: "evt-1",
        type: "usage.updated",
        source: "system",
        at: new Date().toISOString(),
        payload: repository.getUsageSnapshot(),
      },
    );
    expect(frame).toContain("event: usage");
    expect(frame).toContain("data:");
  });

  test("toSseFrame maps session.run.status.updated to session-status event", () => {
    const frame = toSseFrame({
      id: "evt-2",
      type: "session.run.status.updated",
      source: "runtime",
      at: new Date().toISOString(),
      payload: {
        sessionId: "main",
        status: "retry",
        attempt: 1,
        message: "Provider overloaded",
        nextAt: new Date().toISOString(),
      },
    });
    expect(frame).toContain("event: session-status");
    expect(frame).toContain("data:");
  });

  test("toSseFrame maps session.message.part.updated to session-message-part event", () => {
    const frame = toSseFrame({
      id: "evt-part-1",
      type: "session.message.part.updated",
      source: "runtime",
      at: new Date().toISOString(),
      payload: {
        sessionId: "main",
        messageId: "msg-1",
        phase: "update",
        observedAt: new Date().toISOString(),
        part: {
          id: "part-1",
          type: "tool_call",
          toolCallId: "call-1",
          tool: "search",
          status: "running",
          input: { q: "hello" },
        },
      },
    });
    expect(frame).toContain("event: session-message-part");
    expect(frame).toContain("data:");
  });

  test("toSseFrame maps session.message.delta to session-message-delta event", () => {
    const frame = toSseFrame({
      id: "evt-delta-1",
      type: "session.message.delta",
      source: "runtime",
      at: new Date().toISOString(),
      payload: {
        sessionId: "main",
        messageId: "msg-1",
        text: "Hello",
        mode: "append",
        observedAt: new Date().toISOString(),
      },
    });
    expect(frame).toContain("event: session-message-delta");
    expect(frame).toContain("data:");
  });

  test("toSseFrame maps background.run.updated to background-run event", () => {
    const frame = toSseFrame({
      id: "evt-bg-1",
      type: "background.run.updated",
      source: "runtime",
      at: new Date().toISOString(),
      payload: {
        runId: "bg-1",
        parentSessionId: "main",
        parentExternalSessionId: "ses-1",
        childExternalSessionId: "ses-2",
        childSessionId: "session-bg-1",
        requestedBy: "test",
        prompt: "Investigate",
        status: "running",
        resultSummary: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: null,
      },
    });
    expect(frame).toContain("event: background-run");
    expect(frame).toContain("data:");
  });

  test("events stream emits initial heartbeat and usage snapshots", async () => {
    const eventStream = createRuntimeEventStream({
      getHeartbeatSnapshot: repository.getHeartbeatSnapshot,
      getUsageSnapshot: repository.getUsageSnapshot,
    });
    const response = eventStream.route.GET();
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    const reader = response.body?.getReader() as ReadableStreamDefaultReader<StreamChunk> | undefined;
    expect(reader).toBeTruthy();
    if (!reader) return;

    const decoder = new TextDecoder();
    let combined = "";
    for (let i = 0; i < 3; i += 1) {
      const chunk = await readWithTimeout(reader, 250);
      if (chunk.done || !chunk.value) break;
      combined +=
        typeof chunk.value === "string" ? chunk.value : decoder.decode(chunk.value);
      if (combined.includes("event: heartbeat") && combined.includes("event: usage")) {
        break;
      }
    }

    expect(combined).toContain("event: heartbeat");
    expect(combined).toContain("event: usage");
    await reader.cancel();
  });
});
