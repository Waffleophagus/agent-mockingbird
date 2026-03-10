import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { createAppApiServices as CreateAppApiServicesType } from "./services";
import type * as RepositoryModuleType from "../db/repository";

const testRoot = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-trpc-services-test-"));
const testDbPath = path.join(testRoot, "agent-mockingbird.trpc-services.test.db");
const testConfigPath = path.join(testRoot, "agent-mockingbird.trpc-services.config.json");
const testWorkspacePath = path.join(testRoot, "workspace");

process.env.NODE_ENV = "test";
process.env.AGENT_MOCKINGBIRD_DB_PATH = testDbPath;
process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = testConfigPath;
process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR = testWorkspacePath;
process.env.AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER = "none";

type CreateAppApiServicesFn = typeof CreateAppApiServicesType;
type RepositoryModule = typeof RepositoryModuleType;

let createAppApiServices: CreateAppApiServicesFn;
let repository: RepositoryModule;

beforeAll(async () => {
  await import("../db/migrate");
  const servicesModule = await import("./services");
  const repositoryModule = await import("../db/repository");
  createAppApiServices = servicesModule.createAppApiServices;
  repository = repositoryModule;
});

beforeEach(() => {
  repository.resetDatabaseToDefaults();
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function buildRuntimeStub() {
  return {
    syncSessionMessages: async () => undefined,
  };
}

describe("createAppApiServices", () => {
  test("getSessionMessages returns only messages after the client checkpoint", async () => {
    const session = repository.createSession({ title: "Delta Session" });
    repository.upsertSessionMessages({
      sessionId: session.id,
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "hello",
          createdAt: Date.parse("2026-03-07T12:00:00.000Z"),
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "world",
          createdAt: Date.parse("2026-03-07T12:00:01.000Z"),
        },
        {
          id: "user-2",
          role: "user",
          content: "next",
          createdAt: Date.parse("2026-03-07T12:01:00.000Z"),
        },
        {
          id: "assistant-2",
          role: "assistant",
          content: "reply",
          createdAt: Date.parse("2026-03-07T12:01:01.000Z"),
        },
      ],
    });

    const services = createAppApiServices(buildRuntimeStub() as never, () => 0);
    const checkpoint = {
      lastMessageAt: "2026-03-07T12:00:01.000Z",
      lastMessageId: "assistant-1",
    };
    const response = await services.getSessionMessages({
      sessionId: session.id,
      checkpoint,
    });

    expect(response.requiresReset).toBeUndefined();
    expect(response.messages.map(message => message.id)).toEqual(["user-2", "assistant-2"]);
    expect(response.checkpoint?.lastMessageId).toBe("assistant-2");
  });

  test("getSessionMessages requests a reset when the client checkpoint is ahead of the server", async () => {
    const session = repository.createSession({ title: "Reset Session" });
    repository.appendChatExchange({
      sessionId: session.id,
      userContent: "hello",
      assistantContent: "world",
      source: "api",
      usage: {
        requestCountDelta: 1,
        inputTokensDelta: 1,
        outputTokensDelta: 1,
        estimatedCostUsdDelta: 0,
      },
      createdAt: Date.parse("2026-03-07T12:00:00.000Z"),
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
    });

    const services = createAppApiServices(buildRuntimeStub() as never, () => 0);
    const response = await services.getSessionMessages({
      sessionId: session.id,
      checkpoint: {
        lastMessageAt: "2026-03-07T13:00:00.000Z",
        lastMessageId: "assistant-999",
      },
    });

    expect(response.requiresReset).toBe(true);
    expect(response.messages.map(message => message.id)).toEqual(["user-1", "assistant-1"]);
  });

  test("getSessionHistory returns the latest page in ascending order with hasOlder metadata", async () => {
    const session = repository.createSession({ title: "History Session" });
    for (let index = 1; index <= 3; index += 1) {
      repository.appendChatExchange({
        sessionId: session.id,
        userContent: `user-${index}`,
        assistantContent: `assistant-${index}`,
        source: "api",
        usage: {
          requestCountDelta: 1,
          inputTokensDelta: 1,
          outputTokensDelta: 1,
          estimatedCostUsdDelta: 0,
        },
        createdAt: Date.parse(`2026-03-07T12:0${index}:00.000Z`),
        userMessageId: `user-${index}`,
        assistantMessageId: `assistant-${index}`,
      });
    }

    const services = createAppApiServices(buildRuntimeStub() as never, () => 0);
    const response = await services.getSessionHistory({
      sessionId: session.id,
      limit: 4,
    });

    expect(response.messages.map(message => message.id)).toEqual(["user-2", "assistant-2", "user-3", "assistant-3"]);
    expect(response.meta.hasOlder).toBe(true);
    expect(response.meta.oldestLoaded?.id).toBe("user-2");
    expect(response.meta.newestLoaded?.id).toBe("assistant-3");
    expect(response.meta.totalMessages).toBe(6);
  });

  test("getSessionHistory returns the next older page before a cursor", async () => {
    const session = repository.createSession({ title: "History Cursor Session" });
    for (let index = 1; index <= 4; index += 1) {
      repository.appendChatExchange({
        sessionId: session.id,
        userContent: `user-${index}`,
        assistantContent: `assistant-${index}`,
        source: "api",
        usage: {
          requestCountDelta: 1,
          inputTokensDelta: 1,
          outputTokensDelta: 1,
          estimatedCostUsdDelta: 0,
        },
        createdAt: Date.parse(`2026-03-07T12:0${index}:00.000Z`),
        userMessageId: `user-${index}`,
        assistantMessageId: `assistant-${index}`,
      });
    }

    const services = createAppApiServices(buildRuntimeStub() as never, () => 0);
    const latest = await services.getSessionHistory({
      sessionId: session.id,
      limit: 4,
    });
    const older = await services.getSessionHistory({
      sessionId: session.id,
      limit: 4,
      before: latest.meta.oldestLoaded ?? undefined,
    });

    expect(older.messages.map(message => message.id)).toEqual(["user-1", "assistant-1", "user-2", "assistant-2"]);
    expect(older.meta.hasOlder).toBe(false);
    expect(older.meta.oldestLoaded?.id).toBe("user-1");
    expect(older.meta.newestLoaded?.id).toBe("assistant-2");
  });

  test("getSessionHistory keeps user before assistant when timestamps match", async () => {
    const session = repository.createSession({ title: "Equal Timestamp Session" });
    repository.appendChatExchange({
      sessionId: session.id,
      userContent: "hello",
      assistantContent: "world",
      source: "api",
      usage: {
        requestCountDelta: 1,
        inputTokensDelta: 1,
        outputTokensDelta: 1,
        estimatedCostUsdDelta: 0,
      },
      createdAt: Date.parse("2026-03-07T12:00:00.000Z"),
      userMessageId: "zzz-user",
      assistantMessageId: "aaa-assistant",
    });

    const services = createAppApiServices(buildRuntimeStub() as never, () => 0);
    const response = await services.getSessionHistory({
      sessionId: session.id,
      limit: 10,
    });

    expect(response.messages.map(message => message.id)).toEqual(["zzz-user", "aaa-assistant"]);
  });

  test("bootstrap honors messageWindowLimit and returns window metadata", async () => {
    const session = repository.createSession({ title: "Bootstrap Window Session" });
    for (let index = 1; index <= 3; index += 1) {
      repository.appendChatExchange({
        sessionId: session.id,
        userContent: `user-${index}`,
        assistantContent: `assistant-${index}`,
        source: "api",
        usage: {
          requestCountDelta: 1,
          inputTokensDelta: 1,
          outputTokensDelta: 1,
          estimatedCostUsdDelta: 0,
        },
        createdAt: Date.parse(`2026-03-07T12:0${index}:00.000Z`),
        userMessageId: `user-${index}`,
        assistantMessageId: `assistant-${index}`,
      });
    }

    const services = createAppApiServices(buildRuntimeStub() as never, () => 42);
    const response = await services.getSessionBootstrap({
      sessionId: session.id,
      messageWindowLimit: 2,
    });

    expect(response.messages.map(message => message.id)).toEqual(["user-3", "assistant-3"]);
    expect(response.messagesMeta?.hasOlder).toBe(true);
    expect(response.messagesMeta?.oldestLoaded?.id).toBe("user-3");
    expect(response.messagesMeta?.newestLoaded?.id).toBe("assistant-3");
    expect(response.realtime.latestSeq).toBe(42);
  });
});
