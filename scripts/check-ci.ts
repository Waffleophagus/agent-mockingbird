#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
  combined: string;
};

const repoRoot = path.resolve(import.meta.dir, "..");
const trackedArtifactPaths = [
  "bin/agent-mockingbird",
  "bin/agent-mockingbird-managed",
  "bin/runtime-assets.mjs",
  "bin/runtime-layout.mjs",
] as const;

main();

function main() {
  runStep("Build CLI", ["bun", "run", "build:cli"]);
  assertTrackedArtifactsSynced(trackedArtifactPaths);

  runStep("Lint", ["bun", "run", "lint"]);
  runStep("Typecheck", ["bun", "run", "typecheck"]);
  runStep("Test", ["bun", "run", "test"]);

  runStep("Build", ["bun", "run", "build"]);
  assertDistBuilt();
  assertTrackedArtifactsSynced(trackedArtifactPaths);

  console.log("\nCI check passed.");
}

function runStep(label: string, command: string[]) {
  console.log(`\n== ${label} ==`);
  runCommand(command);
}

function assertDistBuilt() {
  const indexPath = path.join(repoRoot, "dist", "app", "index.html");
  const assetsPath = path.join(repoRoot, "dist", "app", "assets");
  const binaryPath = path.join(repoRoot, "dist", "agent-mockingbird");
  const drizzleJournalPath = path.join(repoRoot, "dist", "drizzle", "meta", "_journal.json");
  const opencodeServerPath = path.join(
    repoRoot,
    "dist",
    "packages",
    "opencode",
    "src",
    "server",
    "embedded-opencode.js",
  );
  const opencodeMigrationPath = path.join(
    repoRoot,
    "dist",
    "packages",
    "opencode",
    "migration",
    "20260127222353_familiar_lady_ursula",
    "migration.sql",
  );

  if (!existsSync(indexPath)) {
    fail("Missing dist/app/index.html after build.");
  }
  if (!existsSync(assetsPath) || !directoryHasFiles(assetsPath)) {
    fail("Missing built OpenCode app assets in dist/app/assets after build.");
  }
  if (!existsSync(binaryPath)) {
    fail("Missing dist/agent-mockingbird after build.");
  }
  if (!existsSync(drizzleJournalPath)) {
    fail("Missing dist/drizzle/meta/_journal.json after build.");
  }
  if (!existsSync(opencodeServerPath)) {
    fail("Missing dist/packages/opencode/src/server/embedded-opencode.js after build.");
  }
  if (!existsSync(opencodeMigrationPath)) {
    fail("Missing packaged OpenCode migration SQL after build.");
  }
}

function directoryHasFiles(targetPath: string): boolean {
  for (const entry of readdirSync(targetPath)) {
    const entryPath = path.join(targetPath, entry);
    const stats = statSync(entryPath);
    if (stats.isFile()) {
      return true;
    }
    if (stats.isDirectory() && directoryHasFiles(entryPath)) {
      return true;
    }
  }
  return false;
}

function assertTrackedArtifactsSynced(pathsToCheck: readonly string[]) {
  const result = runCommand(["git", "diff", "--name-only", "--", ...pathsToCheck], {
    allowFailure: true,
    printCommand: false,
  });
  const changed = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (changed.length === 0) {
    return;
  }

  const detail = changed.map((item) => `- ${item}`).join("\n");
  fail(`Generated artifacts are out of sync:\n${detail}\n\nRebuild and commit the generated outputs before shipping.`);
}

function runCommand(
  command: string[],
  options?: {
    allowFailure?: boolean;
    cwd?: string;
    printCommand?: boolean;
  },
): CommandResult {
  if (options?.printCommand !== false) {
    console.log(`$ ${command.join(" ")}`);
  }

  const result = spawnSync(command[0], command.slice(1), {
    cwd: options?.cwd ?? repoRoot,
    env: process.env,
    stdio: "pipe",
    encoding: "utf8",
  });

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  const status = result.status ?? 1;

  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }

  if (status !== 0 && !options?.allowFailure) {
    process.exit(status);
  }

  return { status, stdout, stderr, combined };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
