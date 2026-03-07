import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { MemorySearchResult } from "../memory/types";

const testRoot = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-runtime-test-"));
const testDbPath = path.join(testRoot, "agent-mockingbird.runtime.test.db");
const testWorkspacePath = path.join(testRoot, "workspace");
const testConfigPath = path.join(testRoot, "agent-mockingbird.runtime.config.json");

process.env.NODE_ENV = "test";
process.env.AGENT_MOCKINGBIRD_DB_PATH = testDbPath;
process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = testConfigPath;
process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR = testWorkspacePath;
process.env.AGENT_MOCKINGBIRD_MEMORY_ENABLED = "false";
process.env.AGENT_MOCKINGBIRD_MEMORY_TOOL_MODE = "tool_only";
process.env.AGENT_MOCKINGBIRD_CRON_ENABLED = "false";

interface RepositoryApi {
  ensureSeedData: () => void;
  resetDatabaseToDefaults: () => unknown;
  setSessionModel: (sessionId: string, model: string) => { id: string; model: string } | null;
  listMessagesForSession: (sessionId: string) => Array<{ id: string; role: string; content: string; at: string }>;
  upsertSessionMessages: (input: {
    sessionId: string;
    messages: Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
      createdAt: number;
    }>;
  }) => unknown;
  appendChatExchange: (input: {
    sessionId: string;
    userContent: string;
    assistantContent: string;
    source: "api" | "runtime" | "scheduler" | "system";
    createdAt?: number;
    userMessageId?: string;
    assistantMessageId?: string;
    usage: {
      requestCountDelta: number;
      inputTokensDelta: number;
      outputTokensDelta: number;
      estimatedCostUsdDelta: number;
    };
  }) =>
    | {
        messages: Array<{ id: string; role: "user" | "assistant"; content: string; at: string }>;
      }
    | null;
  appendAssistantMessage: (input: {
    sessionId: string;
    content: string;
    source: "api" | "runtime" | "scheduler" | "system";
    createdAt?: number;
    messageId?: string;
  }) => { message: { id: string; role: "assistant"; content: string } } | null;
}

type PromptInput = {
  path: { id: string };
  body?: {
    model?: {
      providerID?: string;
      modelID?: string;
    };
    system?: string;
    agent?: string;
    parts?: Array<{ type: string; text?: string }>;
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
    message: (input: unknown) => Promise<unknown>;
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
  app: {
    agents: (input?: unknown) => Promise<unknown>;
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
  getRuntimeConfig?: () => {
    baseUrl: string;
    providerId: string;
    modelId: string;
    fallbackModels: string[];
    imageModel: string | null;
    smallModel: string;
    timeoutMs: number;
    promptTimeoutMs: number;
    runWaitTimeoutMs: number;
    childSessionHideAfterDays: number;
    directory: string | null;
    bootstrap: {
      enabled: boolean;
      maxCharsPerFile: number;
      maxCharsTotal: number;
      subagentMinimal: boolean;
      includeAgentPrompt: boolean;
    };
  };
  getEnabledSkills?: () => Array<string>;
  getEnabledMcps?: () => Array<string>;
  getConfiguredMcpServers?: () => Array<ConfiguredMcpServer>;
  searchMemoryFn?: (query: string, options?: { maxResults?: number; minScore?: number }) => Promise<MemorySearchResult[]>;
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
  sendUserMessage: (input: {
    sessionId: string;
    content: string;
    agent?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<{
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
let RuntimeSessionQueuedError: new (sessionId: string, depth: number) => Error;
let RuntimeContinuationDetachedError: new (sessionId: string, childRunCount: number) => Error;

beforeAll(async () => {
  await import("../db/migrate");
  const configService = (await import("../config/service")) as unknown as {
    getConfigSnapshot: () => unknown;
  };
  configService.getConfigSnapshot();
  repository = (await import("../db/repository")) as unknown as RepositoryApi;
  ({ OpencodeRuntime } = (await import("./opencodeRuntime")) as unknown as {
    OpencodeRuntime: RuntimeCtor;
  });
  ({
    RuntimeProviderQuotaError,
    RuntimeProviderAuthError,
    RuntimeProviderRateLimitError,
    RuntimeSessionBusyError,
    RuntimeSessionQueuedError,
    RuntimeContinuationDetachedError,
  } = (await import("./errors")) as unknown as {
    RuntimeProviderQuotaError: new (message?: string) => Error;
    RuntimeProviderAuthError: new (message?: string) => Error;
    RuntimeProviderRateLimitError: new (message?: string) => Error;
    RuntimeSessionBusyError: new (sessionId: string) => Error;
    RuntimeSessionQueuedError: new (sessionId: string, depth: number) => Error;
    RuntimeContinuationDetachedError: new (sessionId: string, childRunCount: number) => Error;
  });
  repository.ensureSeedData();
});

beforeEach(() => {
  repository.resetDatabaseToDefaults();
  repository.setSessionModel("main", "test-provider/test-model");
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function assistantResponse(sessionID: string, text: string) {
  const now = Date.now();
  const parentID = `msg-user-${crypto.randomUUID().slice(0, 8)}`;
  return {
    data: {
      info: {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        sessionID,
        parentID,
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

function assistantResponseWithId(sessionID: string, id: string, text: string) {
  const now = Date.now();
  const parentID = `msg-user-${crypto.randomUUID().slice(0, 8)}`;
  return {
    data: {
      info: {
        id,
        sessionID,
        parentID,
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

function assistantResponseWithIds(sessionID: string, input: { id: string; parentID: string; text: string }) {
  const now = Date.now();
  return {
    data: {
      info: {
        id: input.id,
        parentID: input.parentID,
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
          text: input.text,
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
  message?: (request: unknown) => Promise<unknown>;
  children?: (request: unknown) => Promise<unknown>;
  appAgents?: (request?: unknown) => Promise<unknown>;
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
      message: async (request) => {
        if (input.message) return input.message(request);
        const path = (request as { path: { id: string; messageID: string } }).path;
        return {
          data: assistantResponse(path.id, "Background result").data,
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
    app: {
      agents: async (request) => {
        if (input.appAgents) return input.appAgents(request);
        return {
          data: [
            { name: "agent-mockingbird", mode: "primary" },
            { name: "general", mode: "subagent" },
          ],
        };
      },
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
    searchMemoryFn?: (query: string, options?: { maxResults?: number; minScore?: number }) => Promise<MemorySearchResult[]>;
    enableSmallModelSync?: boolean;
    enableBackgroundSync?: boolean;
    runtimeDirectory?: string | null;
  },
) {
  return new OpencodeRuntime({
    defaultProviderId: "test-provider",
    defaultModelId: "test-model",
    fallbackModelRefs: options?.fallbackModelRefs,
    getRuntimeConfig: () => ({
      baseUrl: "http://127.0.0.1:4096",
      providerId: "test-provider",
      modelId: "test-model",
      fallbackModels: options?.fallbackModelRefs ?? [],
      imageModel: null,
      smallModel: "test-provider/test-small",
      timeoutMs: 120_000,
      promptTimeoutMs: 20,
      runWaitTimeoutMs: 180_000,
      childSessionHideAfterDays: 3,
      directory: options?.runtimeDirectory ?? null,
      bootstrap: {
        enabled: true,
        maxCharsPerFile: 20_000,
        maxCharsTotal: 150_000,
        subagentMinimal: true,
        includeAgentPrompt: true,
      },
    }),
    getEnabledSkills: options?.getEnabledSkills,
    getEnabledMcps: options?.getEnabledMcps,
    getConfiguredMcpServers: options?.getConfiguredMcpServers,
    searchMemoryFn: options?.searchMemoryFn,
    client: client as unknown,
    enableEventSync: false,
    enableSmallModelSync: options?.enableSmallModelSync ?? false,
    enableBackgroundSync: options?.enableBackgroundSync ?? false,
  });
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function updateRuntimeMemoryConfig(
  patch: Partial<{
    enabled: boolean;
    workspaceDir: string;
    embedProvider: "ollama" | "none";
    toolMode: "hybrid" | "inject_only" | "tool_only";
    minScore: number;
    injectionDedupeEnabled: boolean;
    injectionDedupeFallbackRecallOnly: boolean;
    injectionDedupeMaxTracked: number;
  }>,
) {
  if (!existsSync(testConfigPath)) {
    throw new Error(`Missing runtime test config: ${testConfigPath}`);
  }
  const raw = JSON.parse(readFileSync(testConfigPath, "utf8")) as {
    runtime?: {
      memory?: Record<string, unknown>;
    };
  };
  const runtime = raw.runtime ?? {};
  const memory = runtime.memory ?? {};
  runtime.memory = {
    ...memory,
    ...patch,
  };
  raw.runtime = runtime;
  writeFileSync(testConfigPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}

async function seedMemoryFixture(marker: string) {
  mkdirSync(testWorkspacePath, { recursive: true });
  writeFileSync(
    path.join(testWorkspacePath, "MEMORY.md"),
    `# Durable Memory\n\nMarker ${marker} is important for memory injection tests.\n`,
    "utf8",
  );
  const memoryService = (await import("../memory/service")) as unknown as {
    syncMemoryIndex: (input?: { force?: boolean }) => Promise<void>;
    searchMemory: (query: string, options?: { maxResults?: number; minScore?: number }) => Promise<Array<unknown>>;
  };
  await memoryService.syncMemoryIndex({ force: true });
  const warmup = await memoryService.searchMemory("Durable Memory", { minScore: 0, maxResults: 6 });
  expect(warmup.length).toBeGreaterThan(0);
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

  test("drops unavailable requested agent before prompt dispatch", async () => {
    const seenAgents: Array<string | undefined> = [];
    const events: Array<unknown> = [];
    const runtime = createRuntimeWithClient(
      createMockClient({
        appAgents: async () => ({
          data: [{ name: "agent-mockingbird", mode: "primary" }],
        }),
        prompt: async (request) => {
          seenAgents.push(request.body?.agent);
          return assistantResponse(request.path.id, "OK");
        },
      }),
    );
    runtime.subscribe((event) => {
      events.push(event);
    });

    const ack = await runtime.sendUserMessage({
      sessionId: "main",
      content: "hello",
      agent: "ghost-agent",
    });

    expect(ack.messages.at(-1)?.content).toBe("OK");
    expect(seenAgents).toEqual(["build"]);
    const retryEvent = events.find((event) => {
      if (!event || typeof event !== "object") return false;
      const record = event as { type?: string; payload?: { message?: string } };
      return (
        record.type === "session.run.status.updated" &&
        typeof record.payload?.message === "string" &&
        record.payload.message.includes('Requested agent "ghost-agent" is unavailable')
      );
    });
    expect(retryEvent).toBeTruthy();
  });

  test("retries without explicit agent when OpenCode throws agent.variant error", async () => {
    const seenAgents: Array<string | undefined> = [];
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => {
          seenAgents.push(request.body?.agent);
          if (request.body?.agent) {
            throw new TypeError("undefined is not an object (evaluating 'agent.variant')");
          }
          return assistantResponse(request.path.id, "Recovered");
        },
      }),
    );

    const ack = await runtime.sendUserMessage({
      sessionId: "main",
      content: "hello",
      agent: "build",
    });

    expect(ack.messages.at(-1)?.content).toBe("Recovered");
    expect(seenAgents).toEqual(["build", undefined]);
  });

  test("uses explicit primary agent id when no agent is provided", async () => {
    const seenAgents: Array<string | undefined> = [];
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => {
          seenAgents.push(request.body?.agent);
          return assistantResponse(request.path.id, "Recovered via primary agent");
        },
      }),
    );

    const ack = await runtime.sendUserMessage({
      sessionId: "main",
      content: "hello",
    });

    expect(ack.messages.at(-1)?.content).toBe("Recovered via primary agent");
    expect(seenAgents).toEqual(["build"]);
  });

  test("injects memory context once for stable retrieval and re-injects after compaction", async () => {
    updateRuntimeMemoryConfig({
      enabled: true,
      workspaceDir: testWorkspacePath,
      embedProvider: "none",
      toolMode: "hybrid",
      minScore: 0,
    });
    const marker = `marker-${crypto.randomUUID().slice(0, 8)}`;
    await seedMemoryFixture(marker);

    const promptTexts: string[] = [];
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => {
          const text = request.body?.parts?.find((part) => part.type === "text")?.text ?? "";
          promptTexts.push(text);
          return assistantResponse(request.path.id, "OK");
        },
      }),
    );

    try {
      await runtime.sendUserMessage({ sessionId: "main", content: "Durable Memory" });
      await runtime.sendUserMessage({ sessionId: "main", content: "Durable Memory" });
      const internal = runtime as unknown as { handleOpencodeEvent: (event: unknown) => void };
      internal.handleOpencodeEvent({
        type: "session.compacted",
        properties: { sessionID: "ses-1" },
      });
      await runtime.sendUserMessage({ sessionId: "main", content: "Durable Memory" });
    } finally {
      updateRuntimeMemoryConfig({
        enabled: false,
        toolMode: "tool_only",
        minScore: 0.25,
      });
    }

    expect(promptTexts.length).toBe(3);
    expect(promptTexts[0]?.includes("[Memory Context]")).toBe(true);
    expect(promptTexts[1]?.includes("[Memory Context]")).toBe(false);
    expect(promptTexts[2]?.includes("[Memory Context]")).toBe(true);
  });

  test("reinjects memory context on 404 session recreation even when current turn was deduped", async () => {
    updateRuntimeMemoryConfig({
      enabled: true,
      workspaceDir: testWorkspacePath,
      embedProvider: "none",
      toolMode: "hybrid",
      minScore: 0,
    });
    const marker = `marker-${crypto.randomUUID().slice(0, 8)}`;
    await seedMemoryFixture(marker);

    const promptCalls: Array<{ sessionId: string; hasMemoryContext: boolean }> = [];
    let failNextWith404 = false;
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => {
          const text = request.body?.parts?.find((part) => part.type === "text")?.text ?? "";
          promptCalls.push({
            sessionId: request.path.id,
            hasMemoryContext: text.includes("[Memory Context]"),
          });
          if (failNextWith404) {
            failNextWith404 = false;
            throw Object.assign(new Error("session missing"), { status: 404 });
          }
          return assistantResponse(request.path.id, "OK");
        },
      }),
    );

    try {
      await runtime.sendUserMessage({ sessionId: "main", content: "Durable Memory" });
      failNextWith404 = true;
      await runtime.sendUserMessage({ sessionId: "main", content: "Durable Memory" });
    } finally {
      updateRuntimeMemoryConfig({
        enabled: false,
        toolMode: "tool_only",
        minScore: 0.25,
      });
    }

    expect(promptCalls.length).toBe(3);
    expect(promptCalls[0]?.hasMemoryContext).toBe(true);
    expect(promptCalls[1]?.hasMemoryContext).toBe(false);
    expect(promptCalls[2]?.hasMemoryContext).toBe(true);
    expect(promptCalls[1]?.sessionId).not.toBe(promptCalls[2]?.sessionId);
  });

  test("does not reinject memory context when only retrieval scores change", async () => {
    updateRuntimeMemoryConfig({
      enabled: true,
      workspaceDir: testWorkspacePath,
      embedProvider: "none",
      toolMode: "hybrid",
      minScore: 0,
    });

    const promptTexts: string[] = [];
    let searchCallCount = 0;
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => {
          const text = request.body?.parts?.find((part) => part.type === "text")?.text ?? "";
          promptTexts.push(text);
          return assistantResponse(request.path.id, "OK");
        },
      }),
      {
        searchMemoryFn: async () => {
          searchCallCount += 1;
          const score = searchCallCount === 1 ? 0.92 : 0.18;
          return [
            {
              id: "chunk-stable",
              path: "MEMORY.md",
              startLine: 1,
              endLine: 4,
              source: "memory",
              score,
              snippet: "Marker chunk remains stable while scores move.",
              citation: "MEMORY.md#L1",
            },
          ];
        },
      },
    );

    try {
      await runtime.sendUserMessage({ sessionId: "main", content: "Durable marker detail" });
      await runtime.sendUserMessage({ sessionId: "main", content: "Durable marker detail" });
    } finally {
      updateRuntimeMemoryConfig({
        enabled: false,
        toolMode: "tool_only",
        minScore: 0.25,
      });
    }

    expect(searchCallCount).toBe(2);
    expect(promptTexts.length).toBe(2);
    expect(promptTexts[0]?.includes("[Memory Context]")).toBe(true);
    expect(promptTexts[1]?.includes("[Memory Context]")).toBe(false);
  });

  test("suppresses already injected records when retrieval set expands", async () => {
    updateRuntimeMemoryConfig({
      enabled: true,
      workspaceDir: testWorkspacePath,
      embedProvider: "none",
      toolMode: "hybrid",
      minScore: 0,
      injectionDedupeEnabled: true,
      injectionDedupeFallbackRecallOnly: true,
    });

    const promptTexts: string[] = [];
    let searchCallCount = 0;
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => {
          const text = request.body?.parts?.find((part) => part.type === "text")?.text ?? "";
          promptTexts.push(text);
          return assistantResponse(request.path.id, "OK");
        },
      }),
      {
        searchMemoryFn: async () => {
          searchCallCount += 1;
          const recordA = [
            "### [memory:memory_a] 2026-03-02T20:41:01.037Z",
            "```json",
            '{"id":"memory_a"}',
            "```",
            "Durable marker alpha detail.",
          ].join("\n");
          const recordB = [
            "### [memory:memory_b] 2026-03-02T20:41:01.037Z",
            "```json",
            '{"id":"memory_b"}',
            "```",
            "Durable marker beta detail.",
          ].join("\n");
          if (searchCallCount === 1) {
            return [
              {
                id: "chunk-a",
                path: "memory/2026-03-02.md",
                startLine: 1,
                endLine: 5,
                source: "memory",
                score: 0.92,
                snippet: recordA,
                citation: "memory/2026-03-02.md#L1",
              },
            ];
          }
          return [
            {
              id: "chunk-a",
              path: "memory/2026-03-02.md",
              startLine: 1,
              endLine: 5,
              source: "memory",
              score: 0.91,
              snippet: recordA,
              citation: "memory/2026-03-02.md#L1",
            },
            {
              id: "chunk-b",
              path: "memory/2026-03-02.md",
              startLine: 7,
              endLine: 11,
              source: "memory",
              score: 0.83,
              snippet: recordB,
              citation: "memory/2026-03-02.md#L7",
            },
          ];
        },
      },
    );

    try {
      await runtime.sendUserMessage({ sessionId: "main", content: "durable marker status" });
      await runtime.sendUserMessage({ sessionId: "main", content: "durable marker update" });
    } finally {
      updateRuntimeMemoryConfig({
        enabled: false,
        toolMode: "tool_only",
        minScore: 0.25,
      });
    }

    expect(promptTexts.length).toBe(2);
    expect(promptTexts[0]?.includes("memory:memory_a")).toBe(true);
    expect(promptTexts[1]?.includes("memory:memory_a")).toBe(false);
    expect(promptTexts[1]?.includes("memory:memory_b")).toBe(true);
  });

  test("allows recall-intent fallback when all relevant records were already injected", async () => {
    updateRuntimeMemoryConfig({
      enabled: true,
      workspaceDir: testWorkspacePath,
      embedProvider: "none",
      toolMode: "hybrid",
      minScore: 0,
      injectionDedupeEnabled: true,
      injectionDedupeFallbackRecallOnly: true,
    });

    const promptTexts: string[] = [];
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => {
          const text = request.body?.parts?.find((part) => part.type === "text")?.text ?? "";
          promptTexts.push(text);
          return assistantResponse(request.path.id, "OK");
        },
      }),
      {
        searchMemoryFn: async () => [
          {
            id: "chunk-a",
            path: "memory/2026-03-02.md",
            startLine: 1,
            endLine: 5,
            source: "memory",
            score: 0.92,
            snippet: [
              "### [memory:memory_a] 2026-03-02T20:41:01.037Z",
              "```json",
              '{"id":"memory_a"}',
              "```",
              "Durable marker alpha detail.",
            ].join("\n"),
            citation: "memory/2026-03-02.md#L1",
          },
        ],
      },
    );

    try {
      await runtime.sendUserMessage({ sessionId: "main", content: "durable marker status" });
      await runtime.sendUserMessage({ sessionId: "main", content: "what do you remember about me?" });
    } finally {
      updateRuntimeMemoryConfig({
        enabled: false,
        toolMode: "tool_only",
        minScore: 0.25,
      });
    }

    expect(promptTexts.length).toBe(2);
    expect(promptTexts[0]?.includes("[Memory Context]")).toBe(true);
    expect(promptTexts[1]?.includes("[Memory Context]")).toBe(true);
    expect(promptTexts[1]?.includes("memory:memory_a")).toBe(true);
  });

  test("skips memory injection for write-intent remember turns in hybrid mode", async () => {
    updateRuntimeMemoryConfig({
      enabled: true,
      workspaceDir: testWorkspacePath,
      embedProvider: "none",
      toolMode: "hybrid",
      minScore: 0,
    });

    const promptTexts: string[] = [];
    let searchCalls = 0;
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => {
          const text = request.body?.parts?.find((part) => part.type === "text")?.text ?? "";
          promptTexts.push(text);
          return assistantResponse(request.path.id, "OK");
        },
      }),
      {
        searchMemoryFn: async () => {
          searchCalls += 1;
          return [
            {
              id: "chunk-memory",
              path: "memory/2026-03-02.md",
              startLine: 1,
              endLine: 4,
              source: "memory",
              score: 0.8,
              snippet: "User has an Android phone.",
              citation: "memory/2026-03-02.md#L1",
            },
          ];
        },
      },
    );

    try {
      await runtime.sendUserMessage({ sessionId: "main", content: "also remember that I have an android phone" });
    } finally {
      updateRuntimeMemoryConfig({
        enabled: false,
        toolMode: "tool_only",
        minScore: 0.25,
      });
    }

    expect(searchCalls).toBe(0);
    expect(promptTexts.length).toBe(1);
    expect(promptTexts[0]).toBe("also remember that I have an android phone");
    expect(promptTexts[0]?.includes("[Memory Context]")).toBe(false);
  });

  test("filters low-signal boilerplate memory from injected context when unrelated to query", async () => {
    updateRuntimeMemoryConfig({
      enabled: true,
      workspaceDir: testWorkspacePath,
      embedProvider: "none",
      toolMode: "hybrid",
      minScore: 0,
    });

    const promptTexts: string[] = [];
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => {
          const text = request.body?.parts?.find((part) => part.type === "text")?.text ?? "";
          promptTexts.push(text);
          return assistantResponse(request.path.id, "OK");
        },
      }),
      {
        searchMemoryFn: async () => [
          {
            id: "chunk-index",
            path: "MEMORY.md",
            startLine: 1,
            endLine: 4,
            source: "memory",
            score: 0.92,
            snippet:
              "# Memory Index\nThis file is part of the runtime workspace bundle.\nStore durable notes in `memory/*.md`.",
            citation: "MEMORY.md#L1",
          },
          {
            id: "chunk-pokemon",
            path: "memory/2026-03-02.md",
            startLine: 20,
            endLine: 24,
            source: "memory",
            score: 0.51,
            snippet: "User's favorite Pokemon is Vulpix.",
            citation: "memory/2026-03-02.md#L20",
          },
        ],
      },
    );

    try {
      await runtime.sendUserMessage({ sessionId: "main", content: "what is my favorite pokemon?" });
    } finally {
      updateRuntimeMemoryConfig({
        enabled: false,
        toolMode: "tool_only",
        minScore: 0.25,
      });
    }

    expect(promptTexts.length).toBe(1);
    expect(promptTexts[0]?.includes("[Memory Context]")).toBe(true);
    expect(promptTexts[0]?.includes("User's favorite Pokemon is Vulpix.")).toBe(true);
    expect(promptTexts[0]?.includes("This file is part of the runtime workspace bundle.")).toBe(false);
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

  test("syncs runtime skill paths and MCP config into OpenCode config without permission skill writes", async () => {
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
      runtimeDirectory: testWorkspacePath,
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
          permission?: Record<string, unknown>;
        }
      | undefined;
    expect(updated).toBeTruthy();
    expect(updated?.skills?.paths).toContain(path.resolve(testWorkspacePath, ".agents", "skills"));
    expect(updated?.permission).toEqual({});
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
    expect(latest?.content).toContain("Background findings complete.");
    expect(latest?.content).toContain("Child session:");
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

  test("syncSessionMessages replaces stale reasoning content when final text arrives for same message id", async () => {
    let createCount = 0;
    let syncCount = 0;
    const reconciledMessageId = "msg-sync-reconcile-1";
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
        messages: async () => {
          syncCount += 1;
          if (syncCount === 1) {
            const now = Date.now();
            return {
              data: [
                {
                  info: {
                    id: reconciledMessageId,
                    sessionID: "ses-2",
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
                      text: "Planning the response before emitting final text.",
                      time: { start: now, end: now },
                    },
                  ],
                },
              ],
            };
          }
          return {
            data: [assistantResponseWithId("ses-2", reconciledMessageId, "```ts\nconst ok = true;\n```").data],
          };
        },
      }),
    );

    const spawned = await runtime.spawnBackgroundSession({
      parentSessionId: "main",
      title: "Reasoning child",
    });
    expect(spawned.childSessionId).toBeTruthy();

    await runtime.syncSessionMessages(spawned.childSessionId as string);
    await runtime.syncSessionMessages(spawned.childSessionId as string);

    const messages = repository.listMessagesForSession(spawned.childSessionId as string);
    const reconciled = messages.find(message => message.id === reconciledMessageId);
    expect(reconciled?.content).toContain("const ok = true;");
    expect(reconciled?.content).not.toContain("Planning the response before emitting final text.");
  });

  test("syncSessionMessages reconciles parent session transcripts", async () => {
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => assistantResponse(request.path.id, "Initial parent reply"),
        messages: async () => ({
          data: [assistantResponse("ses-1", "Final consolidated plan from OpenCode").data],
        }),
      }),
    );

    await runtime.sendUserMessage({
      sessionId: "main",
      content: "Kick off planning",
    });

    await runtime.syncSessionMessages("main");
    const messages = repository.listMessagesForSession("main");
    expect(messages.some(message => message.content.includes("Final consolidated plan from OpenCode"))).toBe(true);
  });

  test("message.updated event reconciles parent final assistant message", async () => {
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => assistantResponse(request.path.id, "Seed response"),
        message: async () => ({
          data: assistantResponse("ses-1", "Final plan from message.updated reconciliation").data,
        }),
      }),
    );

    await runtime.sendUserMessage({
      sessionId: "main",
      content: "Start run",
    });

    const handleOpencodeEvent = (runtime as unknown as { handleOpencodeEvent: (event: unknown) => void }).handleOpencodeEvent;
    handleOpencodeEvent.call(runtime, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-final-1",
          sessionID: "ses-1",
          role: "assistant",
        },
      },
    });

    await sleep(20);
    const messages = repository.listMessagesForSession("main");
    expect(messages.some(message => message.content.includes("Final plan from message.updated reconciliation"))).toBe(true);
  });

  test("sendUserMessage is resilient when transcript sync already inserted the same assistant message id", async () => {
    const duplicateAssistantId = "msg-duplicate-assistant";
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) =>
          assistantResponseWithId(request.path.id, duplicateAssistantId, "Final assistant content from prompt"),
      }),
    );

    const seeded = repository.appendAssistantMessage({
      sessionId: "main",
      content: "",
      source: "runtime",
      messageId: duplicateAssistantId,
    });
    expect(seeded?.message.id).toBe(duplicateAssistantId);

    const ack = await runtime.sendUserMessage({
      sessionId: "main",
      content: "persist this user turn",
    });

    expect(ack.messages.some(message => message.role === "assistant" && message.id === duplicateAssistantId)).toBe(true);
    expect(ack.messages.some(message => message.role === "user" && message.content.includes("persist this user turn"))).toBe(
      true,
    );

    const stored = repository.listMessagesForSession("main");
    expect(stored.filter(message => message.id === duplicateAssistantId).length).toBe(1);
    expect(
      stored.filter(
        message => message.role === "assistant" && message.content.includes("Final assistant content from prompt"),
      ).length,
    ).toBe(1);
    expect(stored.filter(message => message.role === "user" && message.content.includes("persist this user turn")).length).toBe(
      1,
    );
  });

  test("sendUserMessage reuses assistant parentID to avoid duplicate remote user rows", async () => {
    const remoteUserId = "msg-user-remote-1";
    repository.upsertSessionMessages({
      sessionId: "main",
      messages: [
        {
          id: remoteUserId,
          role: "user",
          content: "persist this user turn",
          createdAt: Date.now() - 10_000,
        },
      ],
    });

    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) =>
          assistantResponseWithIds(request.path.id, {
            id: "msg-assistant-remote-1",
            parentID: remoteUserId,
            text: "Final assistant content from prompt",
          }),
      }),
    );

    const ack = await runtime.sendUserMessage({
      sessionId: "main",
      content: "persist this user turn",
    });

    expect(ack.messages.filter(message => message.role === "user" && message.id === remoteUserId).length).toBe(1);
    const stored = repository.listMessagesForSession("main");
    expect(stored.filter(message => message.role === "user" && message.id === remoteUserId).length).toBe(1);
  });

  test("sendUserMessage keeps user turn before assistant when assistant row was synced first", async () => {
    const remoteUserId = "msg-user-ordered-1";
    const remoteAssistantId = "msg-assistant-ordered-1";
    const seededAssistantCreatedAt = Date.now() - 30_000;
    repository.appendAssistantMessage({
      sessionId: "main",
      content: "",
      source: "runtime",
      createdAt: seededAssistantCreatedAt,
      messageId: remoteAssistantId,
    });

    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) =>
          assistantResponseWithIds(request.path.id, {
            id: remoteAssistantId,
            parentID: remoteUserId,
            text: "Ordered assistant reply",
          }),
      }),
    );

    await runtime.sendUserMessage({
      sessionId: "main",
      content: "ordered user turn",
    });

    const stored = repository.listMessagesForSession("main");
    const userIndex = stored.findIndex(message => message.id === remoteUserId);
    const assistantIndex = stored.findIndex(message => message.id === remoteAssistantId);
    expect(userIndex).toBeGreaterThanOrEqual(0);
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(userIndex).toBeLessThan(assistantIndex);

    const user = stored.find(message => message.id === remoteUserId);
    const assistant = stored.find(message => message.id === remoteAssistantId);
    expect(user).toBeTruthy();
    expect(assistant).toBeTruthy();
    expect(Date.parse(user?.at ?? "")).toBeLessThanOrEqual(Date.parse(assistant?.at ?? ""));
  });

  test("appendChatExchange aligns newly inserted user timestamp when assistant exists first", () => {
    const userMessageId = "msg-user-aligned-1";
    const assistantMessageId = "msg-assistant-aligned-1";
    const assistantCreatedAt = Date.now() - 20_000;
    repository.appendAssistantMessage({
      sessionId: "main",
      content: "",
      source: "runtime",
      createdAt: assistantCreatedAt,
      messageId: assistantMessageId,
    });

    const appended = repository.appendChatExchange({
      sessionId: "main",
      userContent: "hello",
      assistantContent: "world",
      source: "runtime",
      createdAt: Date.now(),
      userMessageId,
      assistantMessageId,
      usage: {
        requestCountDelta: 1,
        inputTokensDelta: 1,
        outputTokensDelta: 1,
        estimatedCostUsdDelta: 0,
      },
    });
    expect(appended).toBeTruthy();

    const messages = repository.listMessagesForSession("main");
    const user = messages.find(message => message.id === userMessageId);
    const assistant = messages.find(message => message.id === assistantMessageId);
    expect(user).toBeTruthy();
    expect(assistant).toBeTruthy();
    expect(Date.parse(user?.at ?? "")).toBeLessThanOrEqual(Date.parse(assistant?.at ?? ""));
  });

  test("appendChatExchange backfills assistant timestamp at or after existing user timestamp", () => {
    const userMessageId = "msg-user-preexisting-1";
    const assistantMessageId = "msg-assistant-backfill-1";
    const userCreatedAt = Date.now() - 10_000;
    repository.upsertSessionMessages({
      sessionId: "main",
      messages: [
        {
          id: userMessageId,
          role: "user",
          content: "preexisting user",
          createdAt: userCreatedAt,
        },
      ],
    });

    const appended = repository.appendChatExchange({
      sessionId: "main",
      userContent: "preexisting user",
      assistantContent: "assistant backfill",
      source: "runtime",
      createdAt: userCreatedAt - 2_000,
      userMessageId,
      assistantMessageId,
      usage: {
        requestCountDelta: 1,
        inputTokensDelta: 1,
        outputTokensDelta: 1,
        estimatedCostUsdDelta: 0,
      },
    });
    expect(appended).toBeTruthy();

    const messages = repository.listMessagesForSession("main");
    const user = messages.find(message => message.id === userMessageId);
    const assistant = messages.find(message => message.id === assistantMessageId);
    expect(user).toBeTruthy();
    expect(assistant).toBeTruthy();
    expect(Date.parse(assistant?.at ?? "")).toBeGreaterThanOrEqual(Date.parse(user?.at ?? ""));
  });

  test("appendChatExchange repairs reversed preexisting pair ordering", () => {
    const userMessageId = "msg-user-repair-1";
    const assistantMessageId = "msg-assistant-repair-1";
    const assistantCreatedAt = Date.now() - 25_000;
    const userCreatedAt = Date.now() - 5_000;
    repository.appendAssistantMessage({
      sessionId: "main",
      content: "assistant early",
      source: "runtime",
      createdAt: assistantCreatedAt,
      messageId: assistantMessageId,
    });
    repository.upsertSessionMessages({
      sessionId: "main",
      messages: [
        {
          id: userMessageId,
          role: "user",
          content: "user late",
          createdAt: userCreatedAt,
        },
      ],
    });

    const appended = repository.appendChatExchange({
      sessionId: "main",
      userContent: "user late",
      assistantContent: "assistant early",
      source: "runtime",
      createdAt: Date.now(),
      userMessageId,
      assistantMessageId,
      usage: {
        requestCountDelta: 1,
        inputTokensDelta: 1,
        outputTokensDelta: 1,
        estimatedCostUsdDelta: 0,
      },
    });
    expect(appended).toBeTruthy();

    const messages = repository.listMessagesForSession("main");
    const user = messages.find(message => message.id === userMessageId);
    const assistant = messages.find(message => message.id === assistantMessageId);
    expect(user).toBeTruthy();
    expect(assistant).toBeTruthy();
    expect(Date.parse(user?.at ?? "")).toBeLessThanOrEqual(Date.parse(assistant?.at ?? ""));
  });

  test("message.updated skips transcript sync while local session is busy", async () => {
    let messageSyncCalls = 0;
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => assistantResponse(request.path.id, "Seed response"),
        message: async () => {
          messageSyncCalls += 1;
          return {
            data: assistantResponse("ses-1", "Should not sync while busy").data,
          };
        },
      }),
    );

    await runtime.sendUserMessage({
      sessionId: "main",
      content: "Start run",
    });

    const internal = runtime as unknown as {
      busySessions: Set<string>;
      handleOpencodeEvent: (event: unknown) => void;
    };
    internal.busySessions.add("main");
    internal.handleOpencodeEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-busy-sync-1",
          sessionID: "ses-1",
          role: "assistant",
        },
      },
    });

    await sleep(20);
    expect(messageSyncCalls).toBe(0);
  });

  test("message.part.updated emits session.message.delta for assistant text updates", async () => {
    const events: Array<unknown> = [];
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => assistantResponse(request.path.id, "Seed response"),
      }),
    );
    runtime.subscribe(event => {
      events.push(event);
    });

    await runtime.sendUserMessage({
      sessionId: "main",
      content: "Start run",
    });
    events.length = 0;

    const handleOpencodeEvent = (runtime as unknown as { handleOpencodeEvent: (event: unknown) => void }).handleOpencodeEvent;
    handleOpencodeEvent.call(runtime, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-stream-1",
          sessionID: "ses-1",
          role: "assistant",
        },
      },
    });
    handleOpencodeEvent.call(runtime, {
      type: "message.part.updated",
      properties: {
        delta: "Hel",
        part: {
          id: "part-text-1",
          sessionID: "ses-1",
          messageID: "msg-stream-1",
          type: "text",
          text: "Hello",
          time: { start: Date.now() },
        },
      },
    });

    const deltaEvent = events.find(event => {
      if (!event || typeof event !== "object") return false;
      const record = event as {
        type?: string;
        payload?: {
          sessionId?: string;
          messageId?: string;
          mode?: string;
          text?: string;
        };
      };
      return (
        record.type === "session.message.delta" &&
        record.payload?.sessionId === "main" &&
        record.payload?.messageId === "msg-stream-1" &&
        record.payload?.mode === "append" &&
        record.payload?.text === "Hel"
      );
    });
    expect(deltaEvent).toBeTruthy();
  });

  test("message.part.delta emits session.message.delta when assistant role metadata is known", async () => {
    const events: Array<unknown> = [];
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => assistantResponse(request.path.id, "Seed response"),
      }),
    );
    runtime.subscribe(event => {
      events.push(event);
    });

    await runtime.sendUserMessage({
      sessionId: "main",
      content: "Start run",
    });
    events.length = 0;

    const handleOpencodeEvent = (runtime as unknown as { handleOpencodeEvent: (event: unknown) => void }).handleOpencodeEvent;
    handleOpencodeEvent.call(runtime, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-stream-2",
          sessionID: "ses-1",
          role: "assistant",
        },
      },
    });
    handleOpencodeEvent.call(runtime, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-text-2",
          sessionID: "ses-1",
          messageID: "msg-stream-2",
          type: "text",
          text: "H",
          time: { start: Date.now() },
        },
      },
    });
    events.length = 0;

    handleOpencodeEvent.call(runtime, {
      type: "message.part.delta",
      properties: {
        sessionID: "ses-1",
        messageID: "msg-stream-2",
        partID: "part-text-2",
        field: "text",
        delta: "ello",
      },
    });

    const deltaEvent = events.find(event => {
      if (!event || typeof event !== "object") return false;
      const record = event as {
        type?: string;
        payload?: {
          sessionId?: string;
          messageId?: string;
          mode?: string;
          text?: string;
        };
      };
      return (
        record.type === "session.message.delta" &&
        record.payload?.sessionId === "main" &&
        record.payload?.messageId === "msg-stream-2" &&
        record.payload?.mode === "append" &&
        record.payload?.text === "ello"
      );
    });
    expect(deltaEvent).toBeTruthy();
  });

  test("permission/question events map to runtime prompt events", async () => {
    const events: Array<unknown> = [];
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => assistantResponse(request.path.id, "Seed response"),
      }),
    );
    runtime.subscribe(event => {
      events.push(event);
    });

    await runtime.sendUserMessage({
      sessionId: "main",
      content: "Start run",
    });
    events.length = 0;

    const handleOpencodeEvent = (runtime as unknown as { handleOpencodeEvent: (event: unknown) => void }).handleOpencodeEvent;
    handleOpencodeEvent.call(runtime, {
      type: "permission.asked",
      properties: {
        id: "perm-1",
        sessionID: "ses-1",
        permission: "Read",
        patterns: ["/tmp/*"],
        metadata: {},
        always: [],
      },
    });
    handleOpencodeEvent.call(runtime, {
      type: "permission.replied",
      properties: {
        sessionID: "ses-1",
        requestID: "perm-1",
        reply: "once",
      },
    });
    handleOpencodeEvent.call(runtime, {
      type: "question.asked",
      properties: {
        id: "question-1",
        sessionID: "ses-1",
        questions: [
          {
            question: "Pick one",
            header: "pick",
            options: [{ label: "A", description: "Option A" }],
          },
        ],
      },
    });
    handleOpencodeEvent.call(runtime, {
      type: "question.replied",
      properties: {
        sessionID: "ses-1",
        requestID: "question-1",
      },
    });
    handleOpencodeEvent.call(runtime, {
      type: "question.rejected",
      properties: {
        sessionID: "ses-1",
        requestID: "question-2",
      },
    });

    const permissionRequested = events.find(event => {
      if (!event || typeof event !== "object") return false;
      const record = event as { type?: string; payload?: { id?: string; sessionId?: string } };
      return record.type === "session.permission.requested" && record.payload?.id === "perm-1" && record.payload?.sessionId === "main";
    });
    expect(permissionRequested).toBeTruthy();

    const permissionResolved = events.find(event => {
      if (!event || typeof event !== "object") return false;
      const record = event as { type?: string; payload?: { requestId?: string; reply?: string } };
      return record.type === "session.permission.resolved" && record.payload?.requestId === "perm-1" && record.payload?.reply === "once";
    });
    expect(permissionResolved).toBeTruthy();

    const questionRequested = events.find(event => {
      if (!event || typeof event !== "object") return false;
      const record = event as {
        type?: string;
        payload?: {
          id?: string;
          sessionId?: string;
          questions?: Array<{ question?: string }>;
        };
      };
      return (
        record.type === "session.question.requested" &&
        record.payload?.id === "question-1" &&
        record.payload?.sessionId === "main" &&
        record.payload.questions?.[0]?.question === "Pick one"
      );
    });
    expect(questionRequested).toBeTruthy();

    const questionReplied = events.find(event => {
      if (!event || typeof event !== "object") return false;
      const record = event as { type?: string; payload?: { requestId?: string; outcome?: string } };
      return record.type === "session.question.resolved" && record.payload?.requestId === "question-1" && record.payload?.outcome === "replied";
    });
    expect(questionReplied).toBeTruthy();

    const questionRejected = events.find(event => {
      if (!event || typeof event !== "object") return false;
      const record = event as { type?: string; payload?: { requestId?: string; outcome?: string } };
      return record.type === "session.question.resolved" && record.payload?.requestId === "question-2" && record.payload?.outcome === "rejected";
    });
    expect(questionRejected).toBeTruthy();
  });

  test("streamed message metadata caches evict oldest entries when over limit", () => {
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => assistantResponse(request.path.id, "Seed response"),
      }),
    );
    const internal = runtime as unknown as {
      rememberMessageRole: (sessionId: string, messageId: string, role: "assistant" | "user") => void;
      rememberPartMetadata: (part: unknown) => void;
      messageRoleByScopedMessageId: Map<string, "assistant" | "user">;
      partTypeByScopedPartId: Map<string, string>;
    };

    const limit = 10_000;
    const totalEntries = limit + 250;
    for (let index = 0; index < totalEntries; index += 1) {
      const messageId = `msg-cache-${index}`;
      const partId = `part-cache-${index}`;
      internal.rememberMessageRole("ses-1", messageId, "assistant");
      internal.rememberPartMetadata({
        id: partId,
        sessionID: "ses-1",
        messageID: messageId,
        type: "text",
      });
    }

    expect(internal.messageRoleByScopedMessageId.size).toBe(limit);
    expect(internal.partTypeByScopedPartId.size).toBe(limit);
    expect(internal.messageRoleByScopedMessageId.has("ses-1:msg-cache-0")).toBe(false);
    expect(internal.partTypeByScopedPartId.has("ses-1:msg-cache-0:part-cache-0")).toBe(false);
    expect(internal.messageRoleByScopedMessageId.has(`ses-1:msg-cache-${totalEntries - 1}`)).toBe(true);
    expect(internal.partTypeByScopedPartId.has(`ses-1:msg-cache-${totalEntries - 1}:part-cache-${totalEntries - 1}`)).toBe(
      true,
    );
  });

  test("session.idle triggers best-effort parent transcript sync", async () => {
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => assistantResponse(request.path.id, "Seed response"),
        messages: async () => ({
          data: [assistantResponse("ses-1", "Final parent plan synced on idle").data],
        }),
      }),
    );

    await runtime.sendUserMessage({
      sessionId: "main",
      content: "Start run",
    });

    const handleOpencodeEvent = (runtime as unknown as { handleOpencodeEvent: (event: unknown) => void }).handleOpencodeEvent;
    handleOpencodeEvent.call(runtime, {
      type: "session.idle",
      properties: {
        sessionID: "ses-1",
      },
    });

    await sleep(20);
    const messages = repository.listMessagesForSession("main");
    expect(messages.some(message => message.content.includes("Final parent plan synced on idle"))).toBe(true);
  });

  test("no-text assistant prompt response persists partial assistant content", async () => {
    const now = Date.now();
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => ({
          data: {
            info: {
              id: "msg-partial-1",
              sessionID: request.path.id,
              role: "assistant",
              summary: false,
              mode: "build",
              finish: "tool_calls",
              time: {
                created: now,
                completed: now,
              },
              tokens: {
                input: 8,
                output: 12,
              },
              cost: 0,
            },
            parts: [
              {
                id: "reasoning-1",
                type: "reasoning",
                text: "Working through subtasks before finalizing.",
                time: { start: now, end: now },
              },
            ],
          },
        }),
      }),
    );

    const ack = await runtime.sendUserMessage({
      sessionId: "main",
      content: "Do work in parallel",
    });

    expect(ack.messages.at(-1)?.role).toBe("assistant");
    expect(ack.messages.at(-1)?.content).toContain("Working through subtasks before finalizing.");
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

  test("throws RuntimeContinuationDetachedError when prompt times out and children are still in-flight", async () => {
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => {
          return await new Promise((_resolve, reject) => {
            const timer = setTimeout(() => {
              reject(new Error("prompt should have been aborted"));
            }, 300);
            const signal = request.signal;
            if (!signal) {
              clearTimeout(timer);
              reject(new Error("missing prompt timeout signal"));
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

    let childCheckCalls = 0;
    (runtime as unknown as { inFlightBackgroundChildRunCount: (_sessionId: string) => number }).inFlightBackgroundChildRunCount =
      () => {
        childCheckCalls += 1;
        return childCheckCalls === 1 ? 0 : 1;
      };

    await expect(runtime.sendUserMessage({ sessionId: "main", content: "hello" })).rejects.toBeInstanceOf(
      RuntimeContinuationDetachedError,
    );
  });

  test("throws RuntimeContinuationDetachedError for timeout-like errors when children are still in-flight", async () => {
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async () => {
          throw new Error("The operation timed out.");
        },
      }),
    );

    let childCheckCalls = 0;
    (runtime as unknown as { inFlightBackgroundChildRunCount: (_sessionId: string) => number }).inFlightBackgroundChildRunCount =
      () => {
        childCheckCalls += 1;
        return childCheckCalls === 1 ? 0 : 1;
      };

    await expect(runtime.sendUserMessage({ sessionId: "main", content: "hello" })).rejects.toBeInstanceOf(
      RuntimeContinuationDetachedError,
    );
  });

  test("suppresses session.run.error timeout events while child runs are in-flight", async () => {
    const events: Array<unknown> = [];
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => assistantResponse(request.path.id, "ok"),
      }),
    );
    runtime.subscribe(event => {
      events.push(event);
    });

    await runtime.sendUserMessage({ sessionId: "main", content: "bootstrap" });
    events.length = 0;

    const internal = runtime as unknown as {
      inFlightBackgroundChildRunCount: (_sessionId: string) => number;
      markBackgroundRunFailed: (_sessionId: string, _message: string) => void;
      handleSessionErrorEvent: (event: unknown) => void;
    };
    internal.inFlightBackgroundChildRunCount = () => 2;
    internal.markBackgroundRunFailed = () => {};
    internal.handleSessionErrorEvent({
      type: "session.error",
      properties: {
        sessionID: "ses-1",
        error: new Error("The operation timed out."),
      },
    });

    const runErrorEvent = events.find(event => {
      if (!event || typeof event !== "object") return false;
      return (event as { type?: string }).type === "session.run.error";
    });
    expect(runErrorEvent).toBeUndefined();

    const busyStatusEvent = events.find(event => {
      if (!event || typeof event !== "object") return false;
      const record = event as { type?: string; payload?: { sessionId?: string; status?: string } };
      return (
        record.type === "session.run.status.updated" &&
        record.payload?.sessionId === "main" &&
        record.payload?.status === "busy"
      );
    });
    expect(busyStatusEvent).toBeTruthy();
  });

  test("emits session.run.error for non-timeout session errors", async () => {
    const events: Array<unknown> = [];
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async (request) => assistantResponse(request.path.id, "ok"),
      }),
    );
    runtime.subscribe(event => {
      events.push(event);
    });

    await runtime.sendUserMessage({ sessionId: "main", content: "bootstrap" });
    events.length = 0;

    const internal = runtime as unknown as {
      inFlightBackgroundChildRunCount: (_sessionId: string) => number;
      markBackgroundRunFailed: (_sessionId: string, _message: string) => void;
      handleSessionErrorEvent: (event: unknown) => void;
    };
    internal.inFlightBackgroundChildRunCount = () => 2;
    internal.markBackgroundRunFailed = () => {};
    internal.handleSessionErrorEvent({
      type: "session.error",
      properties: {
        sessionID: "ses-1",
        error: new Error("upstream disconnect"),
      },
    });

    const runErrorEvent = events.find(event => {
      if (!event || typeof event !== "object") return false;
      const record = event as { type?: string; payload?: { sessionId?: string } };
      return record.type === "session.run.error" && record.payload?.sessionId === "main";
    });
    expect(runErrorEvent).toBeTruthy();
  });

  test("queues parent message when child runs are in flight", async () => {
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
      }),
    );

    const spawned = await runtime.spawnBackgroundSession({
      parentSessionId: "main",
      title: "child run",
    });
    await runtime.promptBackgroundAsync({
      runId: spawned.runId,
      content: "Investigate",
    });
    await runtime.getBackgroundStatus(spawned.runId);

    await expect(runtime.sendUserMessage({ sessionId: "main", content: "follow up" })).rejects.toBeInstanceOf(
      RuntimeSessionQueuedError,
    );
    expect(getLaneQueue().depth("main")).toBe(1);

    statusType = "idle";
    await runtime.getBackgroundStatus(spawned.runId);
    getLaneQueue().clearAll();
  });

  test("queues non-heartbeat messages when session is busy", async () => {
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
      RuntimeSessionQueuedError,
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

  test("reports queued non-heartbeat messages while session is busy", async () => {
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
      RuntimeSessionQueuedError,
    );
    expect(getLaneQueue().depth("main")).toBe(1);

    promptResolve!();
    await firstCall;
    getLaneQueue().clearAll();
  });

  test("queues externally submitted messages while queue drain is active unless marked as internal drain", async () => {
    const runtime = createRuntimeWithClient(
      createMockClient({
        prompt: async () => assistantResponse("ses-1", "OK"),
      }),
    );

    (runtime as unknown as { drainingSessions: Set<string> }).drainingSessions.add("main");

    await expect(runtime.sendUserMessage({ sessionId: "main", content: "external" })).rejects.toBeInstanceOf(
      RuntimeSessionQueuedError,
    );

    const ack = await runtime.sendUserMessage({
      sessionId: "main",
      content: "drained",
      metadata: { __queueDrain: true },
    });
    expect(ack.messages.some((message) => message.role === "assistant")).toBe(true);
  });
});
