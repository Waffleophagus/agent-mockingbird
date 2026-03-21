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
});
