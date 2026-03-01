import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { applyOpenclawImport, previewOpenclawImport } from "./openclawImport";

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots.splice(0, testRoots.length)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makePaths() {
  const root = mkdtempSync(path.join(tmpdir(), "wafflebot-openclaw-import-test-"));
  testRoots.push(root);
  const sourceDir = path.join(root, "source");
  const targetDir = path.join(root, "target");
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(targetDir, { recursive: true });
  return { sourceDir, targetDir };
}

test("preview reports conflict when destination path exists as a directory", () => {
  const { sourceDir, targetDir } = makePaths();
  writeFileSync(path.join(sourceDir, "doc.md"), "# doc\n", "utf8");
  mkdirSync(path.join(targetDir, "doc.md"), { recursive: true });

  const preview = previewOpenclawImport({
    source: { mode: "local", path: sourceDir },
    targetDirectory: targetDir,
  });

  expect(preview.filesConflicting).toHaveLength(1);
  expect(preview.filesConflicting[0]?.relativePath).toBe("doc.md");
  expect(preview.filesConflicting[0]?.targetHash).toBeNull();
});

test("apply re-checks destination state and skips newly-created targets unless overwrite is requested", async () => {
  const { sourceDir, targetDir } = makePaths();
  writeFileSync(path.join(sourceDir, "doc.md"), "# imported\n", "utf8");

  const preview = previewOpenclawImport({
    source: { mode: "local", path: sourceDir },
    targetDirectory: targetDir,
  });
  writeFileSync(path.join(targetDir, "doc.md"), "# newer target\n", "utf8");

  const applied = await applyOpenclawImport({
    previewId: preview.previewId,
    runMemorySync: false,
  });

  expect(applied.summary.copied).toBe(0);
  expect(applied.summary.skippedExisting).toBe(1);
  expect(applied.skippedExisting[0]?.relativePath).toBe("doc.md");
  expect(readFileSync(path.join(targetDir, "doc.md"), "utf8")).toContain("newer target");
});

test("apply allows overwrite for targets created after preview when explicitly requested", async () => {
  const { sourceDir, targetDir } = makePaths();
  writeFileSync(path.join(sourceDir, "doc.md"), "# imported\n", "utf8");

  const preview = previewOpenclawImport({
    source: { mode: "local", path: sourceDir },
    targetDirectory: targetDir,
  });
  writeFileSync(path.join(targetDir, "doc.md"), "# newer target\n", "utf8");

  const applied = await applyOpenclawImport({
    previewId: preview.previewId,
    overwritePaths: ["doc.md"],
    runMemorySync: false,
  });

  expect(applied.summary.copied).toBe(1);
  expect(applied.summary.skippedExisting).toBe(0);
  expect(applied.summary.failed).toBe(0);
  expect(readFileSync(path.join(targetDir, "doc.md"), "utf8")).toContain("imported");
});
