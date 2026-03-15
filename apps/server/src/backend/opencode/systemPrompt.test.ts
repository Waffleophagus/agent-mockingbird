import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentMockingbirdConfig } from "../config/schema";

const tempDirs: string[] = [];
const originalConfigPath = process.env.AGENT_MOCKINGBIRD_CONFIG_PATH;

afterEach(() => {
  process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = originalConfigPath;
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

  test("builds compaction context with workspace and memory follow-through guidance", async () => {
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

    const { buildAgentMockingbirdCompactionContext } = await import("./systemPrompt");
    const context = buildAgentMockingbirdCompactionContext();

    expect(context.join("\n\n")).toContain("Agent Mockingbird continuation notes:");
    expect(context.join("\n\n")).toContain("Memory follow-through:");
    expect(context.join("\n\n")).toContain("Workspace bootstrap context:");
    expect(context.join("\n\n")).toContain("# Project Context");
  });

  test("adds session-aware compaction continuity notes from the mirrored transcript", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-compaction-session-"));
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
    writeFileSync(path.join(root, "config.json"), JSON.stringify(exampleConfig));
    process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = path.join(root, "config.json");

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
      userContent: "Do not lose the unresolved follow-up about /api/waffle/runtime/compaction-context on 2026-03-15.",
      assistantContent: "I will preserve that exact endpoint and date in the continuation notes.",
      source: "runtime",
      usage: {
        requestCountDelta: 1,
        inputTokensDelta: 10,
        outputTokensDelta: 10,
        estimatedCostUsdDelta: 0,
      },
    });

    const { buildAgentMockingbirdCompactionContext } = await import("./systemPrompt");
    const context = buildAgentMockingbirdCompactionContext("sess-ctx").join("\n\n");

    expect(context).toContain("Transcript continuity requirements:");
    expect(context).toContain("Latest user ask to carry forward:");
    expect(context).toContain("/api/waffle/runtime/compaction-context");
    expect(context).toContain("2026-03-15");
    expect(context).toContain("Recent turns to preserve verbatim when useful:");
    expect(context).toContain("apps/server/src/backend/opencode/systemPrompt.ts");
  });
});
