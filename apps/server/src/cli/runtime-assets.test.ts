import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { syncRuntimeWorkspaceAssets } from "./runtime-assets.mjs";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-runtime-assets-"));
  tempDirs.push(dir);
  return dir;
}

describe("syncRuntimeWorkspaceAssets", () => {
  test("removes previously managed files that no longer exist in the source bundle", async () => {
    const sourceDir = makeTempDir();
    const targetDir = makeTempDir();
    const stateFilePath = path.join(makeTempDir(), "runtime-assets-state.json");

    fs.mkdirSync(path.join(sourceDir, "plugins"), { recursive: true });
    fs.mkdirSync(path.join(targetDir, "plugins"), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "plugins", "memory_search.ts"), "export default 1\n");

    await syncRuntimeWorkspaceAssets({
      sourceWorkspaceDir: sourceDir,
      targetWorkspaceDir: targetDir,
      stateFilePath,
      mode: "install",
    });

    expect(fs.existsSync(path.join(targetDir, "plugins", "memory_search.ts"))).toBe(true);

    fs.rmSync(path.join(sourceDir, "plugins", "memory_search.ts"));
    const result = await syncRuntimeWorkspaceAssets({
      sourceWorkspaceDir: sourceDir,
      targetWorkspaceDir: targetDir,
      stateFilePath,
      mode: "update",
    });

    expect(result.removed).toBe(1);
    expect(fs.existsSync(path.join(targetDir, "plugins", "memory_search.ts"))).toBe(false);
  });

  test("install mode preserves unrelated preexisting files in the target directory", async () => {
    const sourceDir = makeTempDir();
    const targetDir = makeTempDir();
    const stateFilePath = path.join(makeTempDir(), "runtime-assets-state.json");

    fs.writeFileSync(path.join(sourceDir, "package.json"), "{\"name\":\"managed\"}\n");
    fs.writeFileSync(path.join(targetDir, "bun.lock"), "stale lock\n");

    const result = await syncRuntimeWorkspaceAssets({
      sourceWorkspaceDir: sourceDir,
      targetWorkspaceDir: targetDir,
      stateFilePath,
      mode: "install",
    });

    expect(result.overwritten).toBe(0);
    expect(fs.readFileSync(path.join(targetDir, "package.json"), "utf8")).toBe(
      "{\"name\":\"managed\"}\n",
    );
    expect(fs.existsSync(path.join(targetDir, "bun.lock"))).toBe(true);
  });

  test("update mode treats untracked target files as conflicts instead of silently overwriting", async () => {
    const sourceDir = makeTempDir();
    const targetDir = makeTempDir();
    const stateFilePath = path.join(makeTempDir(), "runtime-assets-state.json");

    fs.mkdirSync(path.join(sourceDir, "plugins"), { recursive: true });
    fs.mkdirSync(path.join(targetDir, "plugins"), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "plugins", "memory_search.ts"), "export default 'packaged'\n");
    fs.writeFileSync(path.join(targetDir, "plugins", "memory_search.ts"), "export default 'local'\n");

    const result = await syncRuntimeWorkspaceAssets({
      sourceWorkspaceDir: sourceDir,
      targetWorkspaceDir: targetDir,
      stateFilePath,
      mode: "update",
    });

    expect(result.conflicts).toBe(1);
    expect(result.backupsCreated).toBe(1);
    expect(fs.readFileSync(path.join(targetDir, "plugins", "memory_search.ts"), "utf8")).toBe(
      "export default 'packaged'\n",
    );
    expect(fs.readdirSync(path.join(targetDir, "plugins")).some(name => name.startsWith("memory_search.ts.backup-"))).toBe(true);
  });

  test("validates required paths before resolving them", async () => {
    const sourceDir = makeTempDir();
    fs.writeFileSync(path.join(sourceDir, "package.json"), "{\"name\":\"managed\"}\n");

    await expect(
      syncRuntimeWorkspaceAssets({
        sourceWorkspaceDir: "",
        targetWorkspaceDir: makeTempDir(),
        stateFilePath: path.join(makeTempDir(), "runtime-assets-state.json"),
        mode: "install",
      }),
    ).rejects.toThrow("runtime asset source directory");

    await expect(
      syncRuntimeWorkspaceAssets({
        sourceWorkspaceDir: "   ",
        targetWorkspaceDir: makeTempDir(),
        stateFilePath: path.join(makeTempDir(), "runtime-assets-state.json"),
        mode: "install",
      }),
    ).rejects.toThrow("runtime asset source directory");

    await expect(
      syncRuntimeWorkspaceAssets({
        sourceWorkspaceDir: sourceDir,
        targetWorkspaceDir: "",
        stateFilePath: path.join(makeTempDir(), "runtime-assets-state.json"),
        mode: "install",
      }),
    ).rejects.toThrow("runtime asset target directory is required");

    await expect(
      syncRuntimeWorkspaceAssets({
        sourceWorkspaceDir: sourceDir,
        targetWorkspaceDir: makeTempDir(),
        stateFilePath: "",
        mode: "install",
      }),
    ).rejects.toThrow("runtime asset state file path is required");
  });
});
