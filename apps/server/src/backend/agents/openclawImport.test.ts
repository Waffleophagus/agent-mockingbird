import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { migrateOpenclawWorkspace } from "./openclawImport";

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots.splice(0, testRoots.length)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makePaths() {
  const root = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-openclaw-import-test-"));
  testRoots.push(root);
  const sourceDir = path.join(root, "source");
  const targetDir = path.join(root, "target");
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(targetDir, { recursive: true });
  return { sourceDir, targetDir };
}

test("migrate copies supported workspace files and maps skills into .agents/skills", async () => {
  const { sourceDir, targetDir } = makePaths();
  mkdirSync(path.join(sourceDir, "skills", "my-skill"), { recursive: true });
  mkdirSync(path.join(sourceDir, "scripts"), { recursive: true });
  writeFileSync(path.join(sourceDir, "AGENTS.md"), "# Imported Agents\n", "utf8");
  writeFileSync(path.join(sourceDir, "skills", "my-skill", "SKILL.md"), "# Skill\n", "utf8");
  writeFileSync(path.join(sourceDir, "scripts", "sync.sh"), "#!/usr/bin/env bash\n", "utf8");

  const migrated = await migrateOpenclawWorkspace({
    source: { mode: "local", path: sourceDir },
    targetDirectory: targetDir,
  });

  expect(migrated.summary.copied).toBe(3);
  expect(readFileSync(path.join(targetDir, "AGENTS.md"), "utf8")).toContain("Imported Agents");
  expect(readFileSync(path.join(targetDir, ".agents", "skills", "my-skill", "SKILL.md"), "utf8")).toContain("Skill");
  expect(readFileSync(path.join(targetDir, "scripts", "sync.sh"), "utf8")).toContain("usr/bin/env bash");
});

test("migrate keeps existing AGENTS.md when smart merge is unavailable", async () => {
  const { sourceDir, targetDir } = makePaths();
  writeFileSync(path.join(sourceDir, "AGENTS.md"), "# OpenClaw Instructions\nUse OpenClaw auth\nGeneral rule\n", "utf8");
  writeFileSync(path.join(targetDir, "AGENTS.md"), "# Agent Mockingbird Instructions\nKeep this\n", "utf8");

  const migrated = await migrateOpenclawWorkspace({
    source: { mode: "local", path: sourceDir },
    targetDirectory: targetDir,
  });

  expect(migrated.summary.merged).toBe(0);
  expect(migrated.summary.skippedExisting).toBe(1);
  expect(readFileSync(path.join(targetDir, "AGENTS.md"), "utf8")).toBe("# Agent Mockingbird Instructions\nKeep this\n");
});

test("migrate maps CLAUDE.md into AGENTS.md when source AGENTS.md is absent", async () => {
  const { sourceDir, targetDir } = makePaths();
  writeFileSync(path.join(sourceDir, "CLAUDE.md"), "# CLAUDE\nConverted guidance\n", "utf8");

  const migrated = await migrateOpenclawWorkspace({
    source: { mode: "local", path: sourceDir },
    targetDirectory: targetDir,
  });

  expect(migrated.summary.copied).toBe(1);
  expect(readFileSync(path.join(targetDir, "AGENTS.md"), "utf8")).toContain("Converted guidance");
  expect(migrated.warnings.some(line => line.includes("Mapped CLAUDE.md to AGENTS.md"))).toBe(true);
});

test("migrate does not map CLAUDE.md when source AGENTS.md exists", async () => {
  const { sourceDir, targetDir } = makePaths();
  writeFileSync(path.join(sourceDir, "AGENTS.md"), "# Agents source\n", "utf8");
  writeFileSync(path.join(sourceDir, "CLAUDE.md"), "# Claude source\n", "utf8");

  await migrateOpenclawWorkspace({
    source: { mode: "local", path: sourceDir },
    targetDirectory: targetDir,
  });

  expect(readFileSync(path.join(targetDir, "AGENTS.md"), "utf8")).toContain("Agents source");
  expect(readFileSync(path.join(targetDir, "CLAUDE.md"), "utf8")).toContain("Claude source");
});

test("migrate copies missing memory day files wholesale", async () => {
  const { sourceDir, targetDir } = makePaths();
  mkdirSync(path.join(sourceDir, "memory"), { recursive: true });
  writeFileSync(path.join(sourceDir, "memory", "2026-03-04.md"), "# Memory\nCurrent events and notes\n", "utf8");

  const migrated = await migrateOpenclawWorkspace({
    source: { mode: "local", path: sourceDir },
    targetDirectory: targetDir,
  });

  expect(migrated.summary.copied).toBe(1);
  expect(readFileSync(path.join(targetDir, "memory", "2026-03-04.md"), "utf8")).toBe(
    "# Memory\nCurrent events and notes\n",
  );
});

test("migrate keeps existing non-AGENTS conflicts instead of line-merging", async () => {
  const { sourceDir, targetDir } = makePaths();
  mkdirSync(path.join(sourceDir, "memory"), { recursive: true });
  mkdirSync(path.join(targetDir, "memory"), { recursive: true });
  writeFileSync(path.join(sourceDir, "memory", "notes.md"), "# Source\nnew note\n", "utf8");
  writeFileSync(path.join(targetDir, "memory", "notes.md"), "# Target\nexisting note\n", "utf8");

  const migrated = await migrateOpenclawWorkspace({
    source: { mode: "local", path: sourceDir },
    targetDirectory: targetDir,
  });

  expect(migrated.summary.merged).toBe(0);
  expect(migrated.summary.skippedExisting).toBe(1);
  expect(readFileSync(path.join(targetDir, "memory", "notes.md"), "utf8")).toBe("# Target\nexisting note\n");
});

test("migrate skips protected .opencode paths", async () => {
  const { sourceDir, targetDir } = makePaths();
  mkdirSync(path.join(sourceDir, ".opencode"), { recursive: true });
  writeFileSync(path.join(sourceDir, ".opencode", "opencode.jsonc"), "{}\n", "utf8");

  const migrated = await migrateOpenclawWorkspace({
    source: { mode: "local", path: sourceDir },
    targetDirectory: targetDir,
  });

  expect(migrated.summary.skippedProtected).toBe(1);
  expect(migrated.summary.copied).toBe(0);
});
