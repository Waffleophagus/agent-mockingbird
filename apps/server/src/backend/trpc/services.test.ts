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
    const firstExchange = repository.appendChatExchange({
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
    repository.appendChatExchange({
      sessionId: session.id,
      userContent: "next",
      assistantContent: "reply",
      source: "api",
      usage: {
        requestCountDelta: 1,
        inputTokensDelta: 1,
        outputTokensDelta: 1,
        estimatedCostUsdDelta: 0,
      },
      createdAt: Date.parse("2026-03-07T12:01:00.000Z"),
      userMessageId: "user-2",
      assistantMessageId: "assistant-2",
    });

    const services = createAppApiServices(buildRuntimeStub() as never, () => 0);
    const checkpoint = {
      lastMessageAt: firstExchange?.messages[firstExchange.messages.length - 1]?.at ?? "",
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
});
