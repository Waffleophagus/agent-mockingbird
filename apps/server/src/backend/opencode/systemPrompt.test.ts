import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentMockingbirdConfig } from "../config/schema";

const tempDirs: string[] = [];
const originalConfigPath = process.env.AGENT_MOCKINGBIRD_CONFIG_PATH;
const originalDbPath = process.env.AGENT_MOCKINGBIRD_DB_PATH;

afterEach(() => {
  process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = originalConfigPath;
  process.env.AGENT_MOCKINGBIRD_DB_PATH = originalDbPath;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("systemPrompt helpers", () => {
  test("includes config, memory, cron, and workspace bootstrap guidance", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-system-prompt-"));
    tempDirs.push(root);
    const workspaceDir = path.join(root, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# Workspace Guide\n\nUse the workspace guide.\n");
    const exampleConfig = JSON.parse(
      readFileSync(path.resolve(import.meta.dir, "../../../../../agent-mockingbird.config.example.json"), "utf8"),
    ) as AgentMockingbirdConfig;
    exampleConfig.workspace = {
      pinnedDirectory: workspaceDir,
    };
    exampleConfig.runtime.opencode.directory = workspaceDir;
    exampleConfig.runtime.memory.workspaceDir = workspaceDir;
    exampleConfig.runtime.memory.enabled = true;
    exampleConfig.runtime.memory.toolMode = "hybrid";
    exampleConfig.runtime.opencode.bootstrap.enabled = true;
    exampleConfig.runtime.opencode.bootstrap.includeAgentPrompt = false;
    writeFileSync(
      path.join(root, "config.json"),
      JSON.stringify(exampleConfig),
    );
    process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = path.join(root, "config.json");

    const { buildAgentMockingbirdSystemPrompt } = await import("./systemPrompt");
    const prompt = buildAgentMockingbirdSystemPrompt() ?? "";

    expect(prompt).toContain("Config policy:");
    expect(prompt).toContain("Memory policy:");
    expect(prompt).toContain("Cron policy:");
    expect(prompt).toContain("# Project Context");
    expect(prompt).toContain("Use the workspace guide.");
  });

  test("builds a compaction prompt with OpenClaw-style headings and local guidance", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-compaction-context-"));
    tempDirs.push(root);
    const workspaceDir = path.join(root, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# Workspace Guide\n\nUse the workspace guide.\n");
    const exampleConfig = JSON.parse(
      readFileSync(path.resolve(import.meta.dir, "../../../../../agent-mockingbird.config.example.json"), "utf8"),
    ) as AgentMockingbirdConfig;
    exampleConfig.workspace = {
      pinnedDirectory: workspaceDir,
    };
    exampleConfig.runtime.opencode.directory = workspaceDir;
    exampleConfig.runtime.memory.workspaceDir = workspaceDir;
    exampleConfig.runtime.memory.enabled = true;
    exampleConfig.runtime.memory.toolMode = "hybrid";
    exampleConfig.runtime.opencode.bootstrap.enabled = true;
    exampleConfig.runtime.opencode.bootstrap.includeAgentPrompt = false;
    writeFileSync(path.join(root, "config.json"), JSON.stringify(exampleConfig));
    process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = path.join(root, "config.json");

    const { buildAgentMockingbirdCompactionPrompt } = await import("./systemPrompt");
    const prompt = buildAgentMockingbirdCompactionPrompt();

    expect(prompt).toContain("Compaction rules:");
    expect(prompt).toContain("## Decisions");
    expect(prompt).toContain("## Pending user asks");
    expect(prompt).toContain("## Exact identifiers");
    expect(prompt).toContain("Agent Mockingbird continuation notes:");
    expect(prompt).toContain("Memory follow-through:");
    expect(prompt).toContain("Workspace bootstrap context:");
    expect(prompt).toContain("# Project Context");
  });

  test("adds session-aware compaction prompt context from the mirrored transcript", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-compaction-session-"));
    tempDirs.push(root);
    const testDbPath = path.join(root, "agent-mockingbird.compaction-session.test.db");
    tempDirs.push(testDbPath);
    const workspaceDir = path.join(root, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# Workspace Guide\n\nUse the workspace guide.\n");
    const exampleConfig = JSON.parse(
      readFileSync(path.resolve(import.meta.dir, "../../../../../agent-mockingbird.config.example.json"), "utf8"),
    ) as AgentMockingbirdConfig;
    exampleConfig.workspace = {
      pinnedDirectory: workspaceDir,
    };
    exampleConfig.runtime.opencode.directory = workspaceDir;
    exampleConfig.runtime.memory.workspaceDir = workspaceDir;
    writeFileSync(path.join(root, "config.json"), JSON.stringify(exampleConfig));
    process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = path.join(root, "config.json");
    process.env.AGENT_MOCKINGBIRD_DB_PATH = testDbPath;

    const { appendChatExchange, createSession, resetDatabaseToDefaults, setRuntimeSessionBinding } = await import(
      "../db/repository"
    );
    resetDatabaseToDefaults();
    const session = createSession({ title: "Compaction Test" });
    setRuntimeSessionBinding("opencode", session.id, "sess-ctx");
    appendChatExchange({
      sessionId: session.id,
      userContent: "Please update apps/server/src/backend/opencode/systemPrompt.ts and keep port 3001 and https://example.test/docs in mind.",
      assistantContent: "I am investigating the compaction hook and runtime routes now.",
      source: "runtime",
      usage: {
        requestCountDelta: 1,
        inputTokensDelta: 10,
        outputTokensDelta: 10,
        estimatedCostUsdDelta: 0,
      },
    });
    appendChatExchange({
      sessionId: session.id,
      userContent: "Do not lose the unresolved follow-up about /api/mockingbird/runtime/compaction-context on 2026-03-15.",
      assistantContent: "I will preserve that exact endpoint and date in the continuation notes.",
      source: "runtime",
      usage: {
        requestCountDelta: 1,
        inputTokensDelta: 10,
        outputTokensDelta: 10,
        estimatedCostUsdDelta: 0,
      },
    });

    const { buildAgentMockingbirdCompactionPrompt } = await import("./systemPrompt");
    const prompt = buildAgentMockingbirdCompactionPrompt("sess-ctx");

    expect(prompt).toContain("Session-specific context to preserve:");
    expect(prompt).toContain("Transcript continuity requirements:");
    expect(prompt).toContain("Latest user ask to carry forward:");
    expect(prompt).toContain("/api/mockingbird/runtime/compaction-context");
    expect(prompt).toContain("2026-03-15");
    expect(prompt).toContain("Recent turns to preserve verbatim when useful:");
    expect(prompt).toContain("apps/server/src/backend/opencode/systemPrompt.ts");
  });
});
