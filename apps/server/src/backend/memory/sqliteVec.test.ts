import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { findPackagedSqliteVecLoadablePath } from "./sqliteVec";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "sqlite-vec-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("findPackagedSqliteVecLoadablePath", () => {
  test("prefers a sibling sqlite-vec directory next to the executable", () => {
    const root = makeTempDir();
    const execPath = path.join(root, "dist", "agent-mockingbird");
    const extensionPath = path.join(root, "dist", "sqlite-vec", "vec0.so");
    mkdirSync(path.dirname(extensionPath), { recursive: true });
    writeFileSync(extensionPath, "");

    expect(
      findPackagedSqliteVecLoadablePath({
        cwd: root,
        execPath,
        platform: "linux",
      }),
    ).toBe(extensionPath);
  });

  test("falls back to cwd/dist when executable-adjacent asset is absent", () => {
    const root = makeTempDir();
    const execPath = path.join(root, "bin", "agent-mockingbird");
    const extensionPath = path.join(root, "dist", "sqlite-vec", "vec0.so");
    mkdirSync(path.dirname(extensionPath), { recursive: true });
    writeFileSync(extensionPath, "");

    expect(
      findPackagedSqliteVecLoadablePath({
        cwd: root,
        execPath,
        platform: "linux",
      }),
    ).toBe(extensionPath);
  });

  test("returns null when no packaged sqlite-vec asset exists", () => {
    const root = makeTempDir();

    expect(
      findPackagedSqliteVecLoadablePath({
        cwd: root,
        execPath: path.join(root, "dist", "agent-mockingbird"),
        platform: "linux",
      }),
    ).toBeNull();
  });
});
