#!/usr/bin/env bun
import { chmodSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

function run(command: string, args: string[]) {
  return spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
  });
}

const revParse = run("git", ["rev-parse", "--show-toplevel"]);
if ((revParse.status ?? 1) !== 0) {
  process.exit(0);
}

const rootDir = revParse.stdout.trim();
if (!rootDir) {
  process.exit(0);
}

const hooksDir = path.join(rootDir, ".githooks");
const preCommitHook = path.join(hooksDir, "pre-commit");

if (existsSync(preCommitHook)) {
  chmodSync(preCommitHook, 0o755);
}

const result = run("git", ["config", "core.hooksPath", ".githooks"]);
if ((result.status ?? 1) !== 0) {
  const stderr = result.stderr.trim();
  if (stderr) {
    console.warn(`[hooks] Failed to configure core.hooksPath: ${stderr}`);
  }
  process.exit(result.status ?? 1);
}

console.log("[hooks] Configured core.hooksPath=.githooks");
