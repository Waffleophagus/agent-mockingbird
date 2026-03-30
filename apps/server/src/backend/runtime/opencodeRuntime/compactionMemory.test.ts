import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CompactionMemoryCandidate } from "./compactionMemory";
import type { AgentMockingbirdConfig } from "../../config/schema";

const testRoot = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-compaction-memory-"));
const testDbPath = path.join(testRoot, "agent-mockingbird.compaction-memory.test.db");
const testConfigPath = path.join(testRoot, "agent-mockingbird.compaction-memory.config.json");
const workspaceDir = path.join(testRoot, "workspace");

process.env.NODE_ENV = "test";
process.env.AGENT_MOCKINGBIRD_DB_PATH = testDbPath;
process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = testConfigPath;
process.env.AGENT_MOCKINGBIRD_MEMORY_ENABLED = "true";
process.env.AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER = "none";
process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR = workspaceDir;

let rememberMemory: (input: {
  source: "user" | "assistant" | "system" | "compaction";
  content: string;
  entities?: string[];
  confidence?: number;
  sessionId?: string;
  topic?: string;
  ttl?: number;
  supersedes?: string[];
}) => Promise<{ accepted: boolean }>;
let listMemoryWriteEvents: (limit?: number) => Promise<
  Array<{
    status: "accepted" | "rejected";
    source: "user" | "assistant" | "system" | "compaction";
    content: string;
    sessionId: string | null;
    topic: string | null;
  }>
>;
let parseCompactionMemoryCandidates: (summary: string) => CompactionMemoryCandidate[];
let persistCompactionMemoryCandidates: (input: {
  summary: string;
  sessionId: string;
}) => Promise<{
  parsedCount: number;
  attemptedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  skippedCount: number;
}>;

beforeAll(async () => {
  mkdirSync(workspaceDir, { recursive: true });
  const exampleConfig = JSON.parse(
    readFileSync(path.resolve(import.meta.dir, "../../../../../../agent-mockingbird.config.example.json"), "utf8"),
  ) as AgentMockingbirdConfig;
  exampleConfig.workspace = {
    pinnedDirectory: workspaceDir,
  };
  exampleConfig.runtime.opencode.directory = workspaceDir;
  exampleConfig.runtime.memory.workspaceDir = workspaceDir;
  exampleConfig.runtime.memory.enabled = true;
  exampleConfig.runtime.memory.embedProvider = "none";
  exampleConfig.runtime.opencode.compaction = {
    preemptiveIdleMinutes: 15,
    preemptiveThresholdRatio: 0.6,
    memoryAutoPersist: true,
  };
  writeFileSync(testConfigPath, JSON.stringify(exampleConfig));

  await import("../../db/migrate");
  ({
    rememberMemory,
    listMemoryWriteEvents,
  } = await import("../../memory/service"));
  ({
    parseCompactionMemoryCandidates,
    persistCompactionMemoryCandidates,
  } = await import("./compactionMemory"));
});

beforeEach(async () => {
  const { resetDatabaseToDefaults } = await import("../../db/repository");
  resetDatabaseToDefaults();
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("compaction memory parser", () => {
  test("accepts none", () => {
    expect(
      parseCompactionMemoryCandidates([
        "## Decisions",
        "none",
        "## Memory candidates",
        "none",
      ].join("\n")),
    ).toEqual([]);
  });

  test("accepts structured memory candidate bullets", () => {
    expect(
      parseCompactionMemoryCandidates([
        "## Memory candidates",
        "- content: The user prefers Bun over Node.js. | confidence: high | entities: user, bun | topic: tooling",
        "- content: The Streamdown fork is the source of truth for library changes. | confidence: medium | entities: Streamdown",
      ].join("\n")),
    ).toEqual([
      {
        content: "The user prefers Bun over Node.js.",
        confidence: "high",
        entities: ["user", "bun"],
        topic: "tooling",
      },
      {
        content: "The Streamdown fork is the source of truth for library changes.",
        confidence: "medium",
        entities: ["Streamdown"],
        topic: undefined,
      },
    ]);
  });
});

describe("compaction memory persistence", () => {
  test("accepted candidates are persisted through rememberMemory", async () => {
    const sessionId = "sess-accepted";
    const content = `The user prefers short final answers ${Date.now()}.`;
    const result = await persistCompactionMemoryCandidates({
      sessionId,
      summary: [
        "## Memory candidates",
        `- content: ${content} | confidence: high | entities: user | topic: style`,
      ].join("\n"),
    });

    expect(result).toEqual({
      parsedCount: 1,
      attemptedCount: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      skippedCount: 0,
    });

    const events = await listMemoryWriteEvents(10);
    const accepted = events.find(event => event.content === content);
    expect(accepted?.status).toBe("accepted");
    expect(accepted?.source).toBe("compaction");
    expect(accepted?.sessionId).toBe(sessionId);
    expect(accepted?.topic).toBe("style");
  });

  test("rejected candidates do not fail compaction persistence", async () => {
    const duplicateContent = `The user maintains a Streamdown fork ${Date.now()}.`;
    await rememberMemory({
      source: "assistant",
      content: duplicateContent,
      sessionId: "seed-session",
      confidence: 0.9,
    });

    const result = await persistCompactionMemoryCandidates({
      sessionId: "sess-rejected",
      summary: [
        "## Memory candidates",
        `- content: ${duplicateContent} | confidence: high | entities: user | topic: streamdown`,
        `- content: The user is actively working on OpenCode compaction ${Date.now()}. | confidence: medium | entities: OpenCode | topic: projects`,
      ].join("\n"),
    });

    expect(result.parsedCount).toBe(2);
    expect(result.attemptedCount).toBe(2);
    expect(result.acceptedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);

    const events = await listMemoryWriteEvents(10);
    const rejected = events.find(event => event.content === duplicateContent && event.sessionId === "sess-rejected");
    expect(rejected?.status).toBe("rejected");
  });

  test("duplicate candidates from one summary are only attempted once", async () => {
    const content = `The user prefers percent-based threshold inputs ${Date.now()}.`;
    const result = await persistCompactionMemoryCandidates({
      sessionId: "sess-duplicate",
      summary: [
        "## Memory candidates",
        `- content: ${content} | confidence: high | entities: user | topic: ui`,
        `- content: ${content} | confidence: high | entities: user | topic: ui`,
      ].join("\n"),
    });

    expect(result).toEqual({
      parsedCount: 2,
      attemptedCount: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      skippedCount: 1,
    });
  });
});
