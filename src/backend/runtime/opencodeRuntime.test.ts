import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const testRoot = mkdtempSync(path.join(tmpdir(), "wafflebot-runtime-test-"));
const testDbPath = path.join(testRoot, "wafflebot.runtime.test.db");
const testWorkspacePath = path.join(testRoot, "workspace");
const testConfigPath = path.join(testRoot, "wafflebot.runtime.config.json");

process.env.NODE_ENV = "test";
process.env.WAFFLEBOT_DB_PATH = testDbPath;
process.env.WAFFLEBOT_CONFIG_PATH = testConfigPath;
process.env.WAFFLEBOT_MEMORY_WORKSPACE_DIR = testWorkspacePath;
process.env.WAFFLEBOT_MEMORY_ENABLED = "false";
process.env.WAFFLEBOT_MEMORY_TOOL_MODE = "tool_only";
process.env.WAFFLEBOT_CRON_ENABLED = "false";
process.env.WAFFLEBOT_OPENCODE_PROVIDER_ID = "test-provider";
process.env.WAFFLEBOT_OPENCODE_MODEL_ID = "test-model";
process.env.WAFFLEBOT_OPENCODE_SMALL_MODEL = "test-provider/test-small";
process.env.WAFFLEBOT_OPENCODE_TIMEOUT_MS = "120000";
process.env.WAFFLEBOT_OPENCODE_PROMPT_TIMEOUT_MS = "20";

interface RepositoryApi {
  ensureSeedData: () => void;
  resetDatabaseToDefaults: () => unknown;
  listMessagesForSession: (sessionId: string) => Array<{ role: string; content: string }>;
}

type PromptInput = {
  path: { id: string };
  body?: {
    model?: {
      providerID?: string;
      modelID?: string;
    };
  };
  signal?: AbortSignal;
};

type PromptAsyncInput = {
  path: { id: string };
  body?: {
    model?: {
      providerID?: string;
      modelID?: string;
    };
    parts?: Array<{ type: string; text?: string }>;
  };
  signal?: AbortSignal;
};

interface MockClient {
  session: {
    create: (input: unknown) => Promise<unknown>;
    children: (input: unknown) => Promise<unknown>;
    prompt: (input: PromptInput) => Promise<unknown>;
    promptAsync: (input: PromptAsyncInput) => Promise<unknown>;
    status: (input: unknown) => Promise<unknown>;
    messages: (input: unknown) => Promise<unknown>;
    get: (input: unknown) => Promise<unknown>;
    abort: (input: unknown) => Promise<unknown>;
    summarize: (input: unknown) => Promise<unknown>;
  };
  event: {
    subscribe: (input: unknown) => Promise<{ stream: AsyncIterable<unknown> }>;
  };
  config: {
    get: (input: unknown) => Promise<unknown>;
    update: (input: unknown) => Promise<unknown>;
  };
}

type ConfiguredMcpServer =
  | {
      id: string;
      type: "remote";
      enabled: boolean;
      url: string;
      headers: Record<string, string>;
      oauth: "auto" | "off";
      timeoutMs?: number;
    }
  | {
      id: string;
      type: "local";
      enabled: boolean;
      command: string[];
      environment: Record<string, string>;
      timeoutMs?: number;
    };

type RuntimeCtor = new (input: {
  defaultProviderId: string;
  defaultModelId: string;
  fallbackModelRefs?: Array<string>;
  client?: unknown;
  getEnabledSkills?: () => Array<string>;
  getEnabledMcps?: () => Array<string>;
  getConfiguredMcpServers?: () => Array<ConfiguredMcpServer>;
  enableEventSync?: boolean;
  enableSmallModelSync?: boolean;
  enableBackgroundSync?: boolean;
}) => {
  subscribe: (listener: (event: unknown) => void) => () => void;
  checkHealth: (input?: { force?: boolean }) => Promise<{
    ok: boolean;
    fromCache: boolean;
    error: { name: string; message: string } | null;
    responseText: string | null;
    latencyMs: number | null;
  }>;
  syncSessionMessages: (sessionId: string) => Promise<void>;
  sendUserMessage: (input: { sessionId: string; content: string }) => Promise<{
    sessionId: string;
    messages: Array<{ id: string; role: "user" | "assistant"; content: string }>;
  }>;
  spawnBackgroundSession: (input: {
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
  promptBackgroundAsync: (input: {
    runId: string;
    content: string;
    model?: string;
    system?: string;
    agent?: string;
    noReply?: boolean;
  }) => Promise<{
    runId: string;
    status: string;
  }>;
  getBackgroundStatus: (runId: string) => Promise<{
    runId: string;
    status: string;
    completedAt: string | null;
  } | null>;
  listBackgroundRuns: (input?: {
    parentSessionId?: string;
    limit?: number;
    inFlightOnly?: boolean;
  }) => Promise<
    Array<{
      runId: string;
      childExternalSessionId: string;
      childSessionId: string | null;
      status: string;
      completedAt: string | null;
    }>
  >;
  abortBackground: (runId: string) => Promise<boolean>;
};

let repository: RepositoryApi;
let OpencodeRuntime: RuntimeCtor;
let RuntimeProviderQuotaError: new (message?: string) => Error;
let RuntimeProviderAuthError: new (message?: string) => Error;
let RuntimeProviderRateLimitError: new (message?: string) => Error;
let RuntimeSessionBusyError: new (sessionId: string) => Error;

beforeAll(async () => {
  await import("../db/migrate");
  repository = (await import("../db/repository")) as unknown as RepositoryApi;
  ({ OpencodeRuntime } = (await import("./opencodeRuntime")) as unknown as {
    OpencodeRuntime: RuntimeCtor;
  });
  ({
    RuntimeProviderQuotaError,
    RuntimeProviderAuthError,
    RuntimeProviderRateLimitError,
    RuntimeSessionBusyError,
  } = (await import("./errors")) as unknown as {
    RuntimeProviderQuotaError: new (message?: string) => Error;
    RuntimeProviderAuthError: new (message?: string) => Error;
    RuntimeProviderRateLimitError: new (message?: string) => Error;
    RuntimeSessionBusyError: new (sessionId: string) => Error;
  });
  repository.ensureSeedData();
});

beforeEach(() => {
  repository.resetDatabaseToDefaults();
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function assistantResponse(sessionID: string, text: string) {
  const now = Date.now();
  return {
    data: {
      info: {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        sessionID,
        role: "assistant",
        summary: false,
        mode: "build",
        finish: "stop",
        time: {
          created: now,
          completed: now,
        },
        tokens: {
          input: 12,
          output: 24,
        },
        cost: 0,
      },
      parts: [
        {
          type: "text",
          text,
        },
      ],
    },
  };
}

function assistantReasoningOnlyResponse(sessionID: string, text: string) {
  const now = Date.now();
  return {
    data: {
      info: {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        sessionID,
        role: "assistant",
        summary: false,
        mode: "build",
        finish: "stop",
        time: {
          created: now,
          completed: now,
        },
        tokens: {
          input: 10,
          output: 20,
        },
        cost: 0,
      },
      parts: [
        {
          type: "reasoning",
          text,
          time: { start: now, end: now },
        },
      ],
    },
  };
}

function createMockClient(input: {
  prompt: (request: PromptInput) => Promise<unknown>;
  create?: (request: unknown) => Promise<unknown>;
  promptAsync?: (request: PromptAsyncInput) => Promise<unknown>;
  status?: () => Promise<unknown>;
  get?: (request: unknown) => Promise<unknown>;
  messages?: (request: unknown) => Promise<unknown>;
  children?: (request: unknown) => Promise<unknown>;
}): MockClient {
  let createCount = 0;
  return {
    session: {
      create: async (request) => {
        if (input.create) return input.create(request);
        createCount += 1;
        return {
          data: {
            id: `ses-${createCount}`,
            title: "main",
          },
        };
      },
      children: async (request) => {
        if (input.children) return input.children(request);
        return { data: [] };
      },
      prompt: input.prompt,
      promptAsync: async (request) => {
        if (input.promptAsync) return input.promptAsync(request);
        return { data: undefined };
      },
      status: async () => {
        if (input.status) return input.status();
        return {
          data: {},
        };
      },
      messages: async (request) => {
        if (input.messages) return input.messages(request);
        return {
          data: [assistantResponse((request as { path: { id: string } }).path.id, "Background result").data],
        };
      },
      get: async (request) => {
        if (input.get) return input.get(request);
        return {
          data: {
            id: (request as { path: { id: string } }).path.id,
            title: "main",
          },
        };
      },
      abort: async () => ({ data: true }),
      summarize: async () => ({ data: true }),
    },
    event: {
      subscribe: async () => ({
        stream: (async function* () {})(),
      }),
    },
    config: {
      get: async () => ({
        data: { small_model: "test-provider/test-small" },
      }),
      update: async () => ({ data: {} }),
    },
  };
}

function createRuntimeWithClient(
  client: MockClient,
  options?: {
    fallbackModelRefs?: Array<string>;
    getEnabledSkills?: () => Array<string>;
    getEnabledMcps?: () => Array<string>;
    getConfiguredMcpServers?: () => Array<ConfiguredMcpServer>;
    enableSmallModelSync?: boolean;
    enableBackgroundSync?: boolean;
  },
) {
  return new OpencodeRuntime({
    defaultProviderId: "test-provider",
    defaultModelId: "test-model",
    fallbackModelRefs: options?.fallbackModelRefs,
    getEnabledSkills: options?.getEnabledSkills,
    getEnabledMcps: options?.getEnabledMcps,
    getConfiguredMcpServers: options?.getConfiguredMcpServers,
    client: client as unknown,
    enableEventSync: false,
    enableSmallModelSync: options?.enableSmallModelSync ?? false,
    enableBackgroundSync: options?.enableBackgroundSync ?? false,
  });
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("opencode runtime failover contract", () => {
  test("recreates session and retries prompt when provider returns 404", async () => {
    const sessionIds: string[] = [];
    let createCount = 0;
    let promptCount = 0;
    const runtime = createRuntimeWithClient(
      createMockClient({
        create: async () => {
          createCount += 1;
          return {
            data: {
              id: `ses-${createCount}`,
              title: "main",
            },
          };
        },
        prompt: async (request) => {
          sessionIds.push(request.path.id);
          promptCount += 1;
          if (promptCount === 1) {
            throw Object.assign(new Error("session missing"), { status: 404 });
          }
          return assistantResponse(request.path.id, "Recovered reply");
        },
      }),
    );

    const ack = await runtime.sendUserMessage({
      sessionId: "main",
      content: "hello",
    });

    expect(ack.sessionId).toBe("main");
    expect(ack.messages.at(-1)?.role).toBe("assistant");
    expect(ack.messages.at(-1)?.content).toBe("Recovered reply");
    expect(createCount).toBe(2);
    expect(sessionIds.length).toBe(2);
    expect(sessionIds[0]).not.toBe(sessionIds[1]);
  });

  test("maps quota errors to RuntimeProviderQuotaError", async () => {
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async () => {
          throw Object.assign(
            new Error("You exceeded your current token quota. please check your account balance"),
            { status: 429 },
          );
        },
      }),
    );

    await expect(runtime.sendUserMessage({ sessionId: "main", content: "hello" })).rejects.toBeInstanceOf(
      RuntimeProviderQuotaError,
    );
  });

  test("fails over to configured model and emits retry status", async () => {
    const modelCalls: Array<string> = [];
    const events: Array<unknown> = [];
    let promptCount = 0;

    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => {
          const providerID = request.body?.model?.providerID ?? "unknown-provider";
          const modelID = request.body?.model?.modelID ?? "unknown-model";
          modelCalls.push(`${providerID}/${modelID}`);
          promptCount += 1;
          if (promptCount === 1) {
            throw Object.assign(
              new Error("You exceeded your current token quota. please check your account balance"),
              { status: 429 },
            );
          }
          return assistantResponse(request.path.id, "Fallback reply");
        },
      }),
      {
        fallbackModelRefs: ["backup-provider/backup-model"],
      },
    );
    runtime.subscribe((event) => {
      events.push(event);
    });

    const ack = await runtime.sendUserMessage({
      sessionId: "main",
      content: "hello",
    });

    expect(ack.messages.at(-1)?.content).toBe("Fallback reply");
    expect(modelCalls).toEqual(["test-provider/test-model", "backup-provider/backup-model"]);

    const retryEvent = events.find((event) => {
      if (!event || typeof event !== "object") return false;
      const record = event as { type?: string; payload?: { status?: string; attempt?: number; message?: string } };
      return (
        record.type === "session.run.status.updated" &&
        record.payload?.status === "retry" &&
        record.payload.attempt === 2
      );
    }) as { payload?: { message?: string } } | undefined;

    expect(retryEvent).toBeTruthy();
    expect(retryEvent?.payload?.message).toContain("backup-provider/backup-model");
  });

  test("emits explicit unavailable-model retry status before configured fallback", async () => {
    const modelCalls: Array<string> = [];
    const events: Array<unknown> = [];
    let promptCount = 0;

    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => {
          const providerID = request.body?.model?.providerID ?? "unknown-provider";
          const modelID = request.body?.model?.modelID ?? "unknown-model";
          modelCalls.push(`${providerID}/${modelID}`);
          promptCount += 1;
          if (promptCount <= 2) {
            throw Object.assign(new Error("model not found: test-model"), { status: 404 });
          }
          return assistantResponse(request.path.id, "Configured fallback reply");
        },
      }),
      {
        fallbackModelRefs: ["backup-provider/backup-model"],
      },
    );
    runtime.subscribe((event) => {
      events.push(event);
    });

    const ack = await runtime.sendUserMessage({
      sessionId: "main",
      content: "hello",
    });

    expect(ack.messages.at(-1)?.content).toBe("Configured fallback reply");
    expect(modelCalls).toEqual([
      "test-provider/test-model",
      "test-provider/test-model",
      "backup-provider/backup-model",
    ]);

    const retryEvent = events.find((event) => {
      if (!event || typeof event !== "object") return false;
      const record = event as { type?: string; payload?: { status?: string; attempt?: number; message?: string } };
      return (
        record.type === "session.run.status.updated" &&
        record.payload?.status === "retry" &&
        record.payload.attempt === 2
      );
    }) as { payload?: { message?: string } } | undefined;

    expect(retryEvent).toBeTruthy();
    expect(retryEvent?.payload?.message).toContain(
      "Model test-provider/test-model is not available at the selected provider.",
    );
    expect(retryEvent?.payload?.message).toContain("Retrying with backup-provider/backup-model.");
  });

  test("syncs runtime skill and MCP allow-lists into OpenCode config", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const client = createMockClient({
      prompt: async (request) => assistantResponse(request.path.id, "OK"),
    });
    client.config.get = async () => ({
      data: {
        small_model: "test-provider/test-small",
        skills: {
          paths: [],
        },
        mcp: {
          github: {
            enabled: true,
          },
          linear: {
            type: "remote",
            url: "https://example.com/mcp",
            enabled: true,
          },
        },
        permission: {},
      },
    });
    client.config.update = async (input: unknown) => {
      const body = (input as { body?: Record<string, unknown> }).body ?? {};
      updates.push(body);
      return { data: body };
    };

    const runtime = createRuntimeWithClient(client, {
      enableSmallModelSync: true,
      getEnabledSkills: () => ["btca-cli"],
      getEnabledMcps: () => ["github"],
      getConfiguredMcpServers: () => [
        {
          id: "github",
          type: "remote",
          enabled: true,
          url: "https://api.github.com/mcp",
          headers: {},
          oauth: "auto",
        },
      ],
    });
    const ack = await runtime.sendUserMessage({
      sessionId: "main",
      content: "hello",
    });

    expect(ack.messages.at(-1)?.content).toBe("OK");
    const updated = updates.at(-1) as
      | {
          skills?: { paths?: Array<string> };
          mcp?: Record<string, { enabled?: boolean; url?: string }>;
          agent?: Record<
            string,
            {
              model?: string;
              description?: string;
              prompt?: string;
              disable?: boolean;
              options?: Record<string, unknown>;
            }
          >;
          permission?: { skill?: Record<string, string> };
        }
      | undefined;
    expect(updated).toBeTruthy();
    expect(updated?.skills?.paths).toContain(path.resolve(process.cwd(), ".agents", "skills"));
    expect(updated?.permission?.skill?.["*"]).toBe("deny");
    expect(updated?.permission?.skill?.["btca-cli"]).toBe("allow");
    expect(updated?.mcp?.github?.enabled).toBe(true);
    expect(updated?.mcp?.github?.url).toBe("https://api.github.com/mcp");
    expect(updated?.mcp?.linear?.enabled).toBe(false);
    expect(updated?.agent).toBeUndefined();
  });

  test("maps authentication errors to RuntimeProviderAuthError", async () => {
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async () => {
          throw Object.assign(new Error("Unauthorized"), { status: 401 });
        },
      }),
    );

    await expect(runtime.sendUserMessage({ sessionId: "main", content: "hello" })).rejects.toBeInstanceOf(
      RuntimeProviderAuthError,
    );
  });

  test("maps rate-limit errors to RuntimeProviderRateLimitError", async () => {
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async () => {
          throw Object.assign(new Error("Too Many Requests"), { status: 429 });
        },
      }),
    );

    await expect(runtime.sendUserMessage({ sessionId: "main", content: "hello" })).rejects.toBeInstanceOf(
      RuntimeProviderRateLimitError,
    );
  });

  test("spawns a background child session with parent linkage", async () => {
    const createBodies: Array<Record<string, unknown>> = [];
    let createCount = 0;
    const runtime = createRuntimeWithClient(
      createMockClient({
        create: async (request) => {
          const body = ((request as { body?: Record<string, unknown> }).body ?? {}) as Record<string, unknown>;
          createBodies.push(body);
          createCount += 1;
          return {
            data: {
              id: `ses-${createCount}`,
              title: createCount === 1 ? "main" : "background",
            },
          };
        },
        prompt: async (request) => assistantResponse(request.path.id, "OK"),
      }),
    );

    const spawned = await runtime.spawnBackgroundSession({
      parentSessionId: "main",
      title: "Planner child",
      requestedBy: "test",
    });

    expect(spawned.parentSessionId).toBe("main");
    expect(spawned.parentExternalSessionId).toBe("ses-1");
    expect(spawned.childExternalSessionId).toBe("ses-2");
    expect(spawned.status).toBe("created");
    expect(createBodies[1]?.parentID).toBe("ses-1");

    const listed = await runtime.listBackgroundRuns({ parentSessionId: "main" });
    expect(listed.some((run) => run.runId === spawned.runId)).toBe(true);
  });

  test("dispatches async background prompt and completes when session becomes idle", async () => {
    let createCount = 0;
    let statusType: "busy" | "idle" = "busy";
    const asyncPrompts: Array<PromptAsyncInput> = [];

    const runtime = createRuntimeWithClient(
      createMockClient({
        create: async () => {
          createCount += 1;
          return {
            data: {
              id: `ses-${createCount}`,
              title: createCount === 1 ? "main" : "background",
            },
          };
        },
        prompt: async (request) => assistantResponse(request.path.id, "OK"),
        promptAsync: async (request) => {
          asyncPrompts.push(request);
          return { data: undefined };
        },
        status: async () => ({
          data: {
            "ses-2": {
              type: statusType,
            },
          },
        }),
      }),
    );

    const spawned = await runtime.spawnBackgroundSession({
      parentSessionId: "main",
      title: "Planner child",
    });

    const running = await runtime.promptBackgroundAsync({
      runId: spawned.runId,
      content: "Investigate and report back.",
    });
    expect(running.status).toBe("running");
    expect(asyncPrompts.length).toBe(1);
    expect(asyncPrompts[0]?.path.id).toBe("ses-2");
    expect(asyncPrompts[0]?.body?.parts?.[0]?.text).toBe("Investigate and report back.");

    statusType = "idle";
    const completed = await runtime.getBackgroundStatus(spawned.runId);
    expect(completed?.status).toBe("completed");
    expect(completed?.completedAt).toBeTruthy();
  });

  test("aborts background runs against the child session id", async () => {
    let createCount = 0;
    const abortedSessionIds: Array<string> = [];
    const client = createMockClient({
      create: async () => {
        createCount += 1;
        return {
          data: {
            id: `ses-${createCount}`,
            title: createCount === 1 ? "main" : "background",
          },
        };
      },
      prompt: async (request) => assistantResponse(request.path.id, "OK"),
    });
    client.session.abort = async (request) => {
      abortedSessionIds.push((request as { path: { id: string } }).path.id);
      return { data: true };
    };

    const runtime = createRuntimeWithClient(client);
    const spawned = await runtime.spawnBackgroundSession({
      parentSessionId: "main",
      title: "Planner child",
    });

    const aborted = await runtime.abortBackground(spawned.runId);
    expect(aborted).toBe(true);
    expect(abortedSessionIds).toEqual(["ses-2"]);
  });

  test("announces completed background run into the parent session", async () => {
    let createCount = 0;
    let statusType: "busy" | "idle" = "busy";
    const runtime = createRuntimeWithClient(
      createMockClient({
        create: async () => {
          createCount += 1;
          return {
            data: {
              id: `ses-${createCount}`,
              title: createCount === 1 ? "main" : "background",
            },
          };
        },
        prompt: async (request) => assistantResponse(request.path.id, "OK"),
        promptAsync: async () => ({ data: undefined }),
        status: async () => ({
          data: {
            "ses-2": {
              type: statusType,
            },
          },
        }),
        messages: async () => ({
          data: [assistantResponse("ses-2", "Background findings complete.").data],
        }),
      }),
    );

    const spawned = await runtime.spawnBackgroundSession({
      parentSessionId: "main",
      title: "Planner child",
    });
    await runtime.promptBackgroundAsync({
      runId: spawned.runId,
      content: "Investigate.",
    });

    statusType = "idle";
    const completed = await runtime.getBackgroundStatus(spawned.runId);
    expect(completed?.status).toBe("completed");

    await sleep(10);
    const parentMessages = repository.listMessagesForSession("main");
    const latest = parentMessages.at(-1);
    expect(latest?.role).toBe("assistant");
    expect(latest?.content).toContain(`[Background ${spawned.runId}]`);
    expect(latest?.content).toContain("Open the child session for full output.");
  });

  test("reconciles child sessions via session.children into background runs", async () => {
    let createCount = 0;
    const runtime = createRuntimeWithClient(
      createMockClient({
        create: async () => {
          createCount += 1;
          return {
            data: {
              id: `ses-${createCount}`,
              title: createCount === 1 ? "main" : "background",
            },
          };
        },
        prompt: async (request) => assistantResponse(request.path.id, "OK"),
        children: async () => ({
          data: [
            {
              id: "ses-child-1",
              parentID: "ses-1",
              title: "Child session",
            },
          ],
        }),
      }),
    );

    await runtime.sendUserMessage({
      sessionId: "main",
      content: "Seed parent session binding",
    });

    const syncBackgroundRuns = (runtime as unknown as { syncBackgroundRuns: () => Promise<void> }).syncBackgroundRuns;
    await syncBackgroundRuns.call(runtime);

    const listed = await runtime.listBackgroundRuns({ parentSessionId: "main", limit: 20 });
    expect(listed.some((run) => run.childExternalSessionId === "ses-child-1")).toBe(true);
  });

  test("syncSessionMessages maps reasoning-only assistant parts into visible message content", async () => {
    let createCount = 0;
    const runtime = createRuntimeWithClient(
      createMockClient({
        create: async () => {
          createCount += 1;
          return {
            data: {
              id: `ses-${createCount}`,
              title: createCount === 1 ? "main" : "child",
            },
          };
        },
        prompt: async (request) => assistantResponse(request.path.id, "Initial response"),
        messages: async () => ({
          data: [assistantReasoningOnlyResponse("ses-2", "Subagent completed work item A").data],
        }),
      }),
    );

    const spawned = await runtime.spawnBackgroundSession({
      parentSessionId: "main",
      title: "Reasoning child",
    });
    expect(spawned.childSessionId).toBeTruthy();

    await runtime.syncSessionMessages(spawned.childSessionId as string);

    const messages = repository.listMessagesForSession(spawned.childSessionId as string);
    expect(
      messages.some(message => message.role === "assistant" && message.content.includes("Subagent completed work item A")),
    ).toBe(true);
  });

  test("health check runs prompt probe and serves cached result", async () => {
    let promptCount = 0;
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => {
          promptCount += 1;
          return assistantResponse(request.path.id, "OK");
        },
      }),
    );

    const first = await runtime.checkHealth({ force: true });
    expect(first.ok).toBe(true);
    expect(first.fromCache).toBe(false);
    expect(first.responseText).toContain("OK");

    const second = await runtime.checkHealth();
    expect(second.ok).toBe(true);
    expect(second.fromCache).toBe(true);
    expect(promptCount).toBe(1);
  });

  test("health check maps provider auth failures", async () => {
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async () => {
          throw Object.assign(new Error("Unauthorized"), { status: 401 });
        },
      }),
    );

    const health = await runtime.checkHealth({ force: true });
    expect(health.ok).toBe(false);
    expect(health.error?.name).toBe("RuntimeProviderAuthError");
  });

  test("health check maps provider quota failures", async () => {
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async () => {
          throw Object.assign(
            new Error("You exceeded your current token quota. please check your account balance"),
            { status: 429 },
          );
        },
      }),
    );

    const health = await runtime.checkHealth({ force: true });
    expect(health.ok).toBe(false);
    expect(health.error?.name).toBe("RuntimeProviderQuotaError");
  });

  test("health check maps probe timeouts", async () => {
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => {
          return await new Promise((_resolve, reject) => {
            const timer = setTimeout(() => {
              reject(new Error("health probe should have been aborted"));
            }, 2_000);
            const signal = request.signal;
            if (!signal) {
              clearTimeout(timer);
              reject(new Error("missing health probe signal"));
              return;
            }
            if (signal.aborted) {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
              return;
            }
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
          });
        },
      }),
    );

    const health = await runtime.checkHealth({ force: true });
    expect(health.ok).toBe(false);
    expect(health.error?.message).toContain("timed out");
  });

  test("applies prompt timeout signal to blocking prompt requests", async () => {
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => {
          return await new Promise((_resolve, reject) => {
            const timer = setTimeout(() => {
              reject(new Error("prompt should have been aborted"));
            }, 200);
            const signal = request.signal;
            if (!signal) {
              clearTimeout(timer);
              reject(new Error("missing prompt timeout signal"));
              return;
            }
            if (signal.aborted) {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
              return;
            }
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
          });
        },
      }),
    );

    await expect(runtime.sendUserMessage({ sessionId: "main", content: "hello" })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  test("throws RuntimeSessionBusyError when session is busy", async () => {
    let promptResolve: () => void;
    const promptPromise = new Promise<void>((resolve) => {
      promptResolve = resolve;
    });

    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async () => {
          await promptPromise;
          return assistantResponse("ses-1", "OK");
        },
      }),
    );

    const firstCall = runtime.sendUserMessage({ sessionId: "main", content: "first" });

    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(runtime.sendUserMessage({ sessionId: "main", content: "second" })).rejects.toBeInstanceOf(
      RuntimeSessionBusyError,
    );

    promptResolve!();
    await firstCall;
  });

  test("does not enqueue heartbeat messages when session is busy", async () => {
    const { initLaneQueue, getLaneQueue } = (await import("../queue/service")) as unknown as {
      initLaneQueue: (config: {
        enabled: boolean;
        defaultMode: "collect" | "followup" | "replace";
        maxDepth: number;
        coalesceDebounceMs: number;
      }) => { depth: (sessionId: string) => number; clearAll: () => void };
      getLaneQueue: () => { depth: (sessionId: string) => number; clearAll: () => void };
    };
    initLaneQueue({
      enabled: true,
      defaultMode: "collect",
      maxDepth: 10,
      coalesceDebounceMs: 500,
    });

    let promptResolve: () => void;
    const promptPromise = new Promise<void>((resolve) => {
      promptResolve = resolve;
    });

    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async () => {
          await promptPromise;
          return assistantResponse("ses-1", "OK");
        },
      }),
    );

    const firstCall = runtime.sendUserMessage({ sessionId: "main", content: "first" });

    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(
      runtime.sendUserMessage({
        sessionId: "main",
        content: "heartbeat",
        metadata: { heartbeat: true },
      }),
    ).rejects.toBeInstanceOf(RuntimeSessionBusyError);
    expect(getLaneQueue().depth("main")).toBe(0);

    promptResolve!();
    await firstCall;
    getLaneQueue().clearAll();
  });

  test("enqueues non-heartbeat messages when session is busy", async () => {
    const { initLaneQueue, getLaneQueue } = (await import("../queue/service")) as unknown as {
      initLaneQueue: (config: {
        enabled: boolean;
        defaultMode: "collect" | "followup" | "replace";
        maxDepth: number;
        coalesceDebounceMs: number;
      }) => { depth: (sessionId: string) => number; clearAll: () => void };
      getLaneQueue: () => { depth: (sessionId: string) => number; clearAll: () => void };
    };
    initLaneQueue({
      enabled: true,
      defaultMode: "collect",
      maxDepth: 10,
      coalesceDebounceMs: 500,
    });

    let promptResolve: () => void;
    const promptPromise = new Promise<void>((resolve) => {
      promptResolve = resolve;
    });

    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async () => {
          await promptPromise;
          return assistantResponse("ses-1", "OK");
        },
      }),
    );

    const firstCall = runtime.sendUserMessage({ sessionId: "main", content: "first" });

    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(runtime.sendUserMessage({ sessionId: "main", content: "second" })).rejects.toBeInstanceOf(
      RuntimeSessionBusyError,
    );
    expect(getLaneQueue().depth("main")).toBe(1);

    promptResolve!();
    await firstCall;
    getLaneQueue().clearAll();
  });
});
