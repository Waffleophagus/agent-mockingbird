import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function loadTestModule() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-release-checker-"));
  tempDirs.push(tempDir);

  const sourcePath = path.resolve(
    import.meta.dir,
    "../../../../../runtime-assets/workspace/cron-modules/with-state-release-checker.ts",
  );
  const modulePath = path.join(tempDir, "with-state-release-checker.ts");
  writeFileSync(modulePath, readFileSync(sourcePath, "utf8"), "utf8");

  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test("stateful release checker falls back to the default state key and accepts valid keys", async () => {
  const module = (await loadTestModule()) as {
    default: (ctx: { payload: { stateKey?: string } }) => Promise<{
      data: { stateKey: string; versions: Record<string, string> };
      summary: string;
    }>;
  };

  const blankKeyResult = await module.default({
    payload: { stateKey: "   " },
  });
  expect(blankKeyResult.data.stateKey).toBe("default");
  expect(blankKeyResult.data.versions).toEqual({});
  expect(blankKeyResult.summary).toContain("no changes");

  const validKeyResult = await module.default({
    payload: { stateKey: "release_check-1" },
  });
  expect(validKeyResult.data.stateKey).toBe("release_check-1");
  expect(validKeyResult.data.versions).toEqual({});
});

test("stateful release checker rejects invalid state keys", async () => {
  const module = (await loadTestModule()) as {
    default: (ctx: { payload: { stateKey?: string } }) => Promise<unknown>;
  };

  await expect(module.default({ payload: { stateKey: "../escape" } })).rejects.toThrow(
    'Invalid stateKey: only letters, numbers, "_" and "-" are allowed',
  );
  await expect(module.default({ payload: { stateKey: "nested/path" } })).rejects.toThrow(
    'Invalid stateKey: only letters, numbers, "_" and "-" are allowed',
  );
  await expect(module.default({ payload: { stateKey: ".." } })).rejects.toThrow(
    'Invalid stateKey: only letters, numbers, "_" and "-" are allowed',
  );
});
