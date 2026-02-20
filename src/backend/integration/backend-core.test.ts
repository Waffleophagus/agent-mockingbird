import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
process.env.WAFFLEBOT_OPENCODE_PROVIDER_ID = "test-provider";
process.env.WAFFLEBOT_OPENCODE_MODEL_ID = "test-model";

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
  sendUserMessage: (input: { sessionId: string; content: string; metadata?: Record<string, unknown> }) => Promise<unknown>;
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
}

interface CronJobInstanceLite {
  id: string;
  state: "queued" | "leased" | "running" | "completed" | "failed" | "dead";
  attempt: number;
}

interface CronServiceInstance {
  createJob: (input: {
    name: string;
    scheduleKind: "at" | "every" | "cron";
    scheduleExpr?: string | null;
    everyMs?: number | null;
    atIso?: string | null;
    timezone?: string | null;
    runMode: "system" | "agent" | "script";
    invokePolicy: "never" | "always" | "on_condition";
    handlerKey?: string | null;
    agentPromptTemplate?: string | null;
    maxAttempts?: number;
    retryBackoffMs?: number;
    payload?: Record<string, unknown>;
  }) => Promise<CronJobDefinitionLite>;
  runJobNow: (jobId: string) => Promise<{ queued: boolean; instanceId: string | null }>;
  listInstances: (input?: { jobId?: string; limit?: number }) => Promise<CronJobInstanceLite[]>;
}

type CronServiceCtor = new (runtime: RuntimeStub) => CronServiceInstance;
type RuntimeSessionNotFoundErrorCtor = new (sessionId: string) => Error;

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
  ({ RuntimeSessionNotFoundError } = (await import("../runtime/errors")) as unknown as {
    RuntimeSessionNotFoundError: RuntimeSessionNotFoundErrorCtor;
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
  impl: (input: { sessionId: string; content: string; metadata?: Record<string, unknown> }) => Promise<unknown>,
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
  runtimeImpl: (input: { sessionId: string; content: string; metadata?: Record<string, unknown> }) => Promise<unknown>,
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
});

describe("config routes", () => {
  test("GET /api/config/agents returns agents and hash", async () => {
    const { routes } = createRouteHarness(async () => ({ sessionId: "main", messages: [] }));
    const route = routes["/api/config/agents"] as { GET: (req: Request) => Response };
    const response = route.GET(new Request("http://localhost/api/config/agents"));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      agents?: Array<{ id: string }>;
      hash?: string;
    };
    expect(Array.isArray(payload.agents)).toBe(true);
    expect(typeof payload.hash).toBe("string");
  });

  test("PUT /api/config/agents rejects updates when semantic validation fails", async () => {
    const { routes } = createRouteHarness(async () => ({ sessionId: "main", messages: [] }));
    const route = routes["/api/config/agents"] as {
      PUT: (req: Request) => Promise<Response>;
    };
    const response = await route.PUT(
      new Request("http://localhost/api/config/agents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runSmokeTest: false,
          agents: [
            {
              id: "eval-agent",
              name: "Eval Agent",
              specialty: "MVP checks",
              summary: "Runs evaluation tasks.",
              model: "test-provider/test-model",
              status: "available",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(422);
    const payload = (await response.json()) as {
      stage?: string;
      error?: string;
    };
    expect(payload.stage === "semantic" || payload.stage === "smoke").toBe(true);
    expect(typeof payload.error).toBe("string");
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
  test("invalid runMode/invokePolicy combinations are rejected", async () => {
    const runtime = createRuntimeStub(async () => ({ sessionId: "main", messages: [] }));
    const cronService = new CronService(runtime);

    await expect(
      cronService.createJob({
        name: "invalid-system",
        scheduleKind: "every",
        everyMs: 5_000,
        runMode: "system",
        invokePolicy: "always",
        handlerKey: "memory.maintenance",
      }),
    ).rejects.toThrow("runMode=system requires invokePolicy=never");

    await expect(
      cronService.createJob({
        name: "invalid-agent",
        scheduleKind: "every",
        everyMs: 5_000,
        runMode: "agent",
        invokePolicy: "never",
        agentPromptTemplate: "Daily summary",
      }),
    ).rejects.toThrow("runMode=agent requires invokePolicy=always");

    await expect(
      cronService.createJob({
        name: "invalid-script",
        scheduleKind: "every",
        everyMs: 5_000,
        runMode: "script",
        invokePolicy: "on_condition",
      }),
    ).rejects.toThrow("runMode=script requires handlerKey");
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
      invokePolicy: "always",
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
