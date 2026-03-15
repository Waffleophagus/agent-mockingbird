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
});
