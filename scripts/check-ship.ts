#!/usr/bin/env bun
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
  combined: string;
};

type SyncStatus = {
  cleanroom: {
    exists: boolean;
    pristine: boolean | null;
    matchesLock: boolean | null;
    path: string;
  };
  vendor: {
    exists: boolean;
    state: "missing" | "clean" | "dirty" | "conflicted" | "invalid";
    path: string;
  };
  patches: {
    matchesBranch: boolean | null;
  };
};

type Diagnostic = {
  key: string;
  line: string;
};

const repoRoot = path.resolve(import.meta.dir, "..");
const cleanroomRoot = path.join(repoRoot, "cleanroom", "opencode");
const vendorRoot = path.join(repoRoot, "vendor", "opencode");
const trackedArtifactPaths = ["bin/agent-mockingbird", "dist/app"];

main();

function main() {
  ensureOpencodeWorktree();
  const initialStatus = readSyncStatus();
  if (!initialStatus) {
    fail("Unable to read OpenCode sync status after worktree setup.");
  }
  assertShipState(initialStatus);

  runStep("Build CLI", ["bun", "run", "build:cli"]);
  assertTrackedArtifactsSynced(["bin/agent-mockingbird"]);

  runStep("Lint", ["bun", "run", "lint"]);
  runStep("Typecheck", ["bun", "run", "typecheck"]);

  runStep("OpenCode Patch Check", ["bun", "run", "opencode:sync", "--check"]);
  runFilteredOpencodeTypecheck();

  runStep("Build", ["bun", "run", "build"]);
  assertDistAppBuilt();
  assertTrackedArtifactsSynced(trackedArtifactPaths);

  runStep("Build Standalone Runtime", ["bun", "run", "build:bin"]);
  assertTrackedArtifactsSynced(["bin/agent-mockingbird"]);

  console.log("\nShip check passed.");
}

function ensureOpencodeWorktree() {
  const status = readSyncStatus({ allowFailure: true });
  if (status && status.vendor.exists) {
    return;
  }

  console.log("\n== Materialize OpenCode Worktree ==");
  runCommand(["bun", "run", "opencode:sync", "--rebuild-only"]);
}

function assertShipState(status: SyncStatus) {
  const problems: string[] = [];

  if (!status.cleanroom.exists) {
    problems.push("cleanroom/opencode is missing");
  }
  if (status.cleanroom.pristine !== true) {
    problems.push("cleanroom/opencode is not pristine");
  }
  if (status.cleanroom.matchesLock !== true) {
    problems.push("cleanroom/opencode does not match opencode.lock.json");
  }
  if (!status.vendor.exists) {
    problems.push("vendor/opencode is missing");
  }
  if (status.vendor.state !== "clean") {
    problems.push(`vendor/opencode is ${status.vendor.state}`);
  }
  if (status.patches.matchesBranch !== true) {
    problems.push("patches/opencode does not match the vendor patch branch");
  }

  if (problems.length === 0) {
    return;
  }

  const detail = problems.map((item) => `- ${item}`).join("\n");
  fail(`OpenCode ship state is not clean:\n${detail}\n\nCommit/export vendor changes or rebuild the worktree before shipping.`);
}

function runFilteredOpencodeTypecheck() {
  console.log("\n== OpenCode Dependency Install ==");
  runCommand(["bun", "install", "--cwd", cleanroomRoot, "--frozen-lockfile"], {
    quietLabel: "cleanroom/opencode",
    env: bunInstallEnv(),
  });
  runCommand(["bun", "install", "--cwd", vendorRoot, "--frozen-lockfile"], {
    quietLabel: "vendor/opencode",
    env: bunInstallEnv(),
  });

  console.log("\n== OpenCode Full Typecheck ==");
  const cleanroomResult = runCommand(
    ["bun", "run", "--cwd", cleanroomRoot, "typecheck"],
    { allowFailure: true, quietLabel: "cleanroom/opencode" },
  );
  const vendorResult = runCommand(
    ["bun", "run", "--cwd", vendorRoot, "typecheck"],
    { allowFailure: true, quietLabel: "vendor/opencode" },
  );

  if (cleanroomResult.status === 0 && vendorResult.status === 0) {
    console.log("OpenCode cleanroom and vendor workspaces both typecheck cleanly.");
    return;
  }

  if (cleanroomResult.status === 0 && vendorResult.status !== 0) {
    fail(
      "Patched OpenCode workspace typecheck failed while cleanroom passed.\n\nVendor output:\n" +
        indentBlock(vendorResult.combined || "<no output>"),
    );
  }

  const cleanroomDiagnostics = collectDiagnostics(cleanroomResult.combined, cleanroomRoot);
  const vendorDiagnostics = collectDiagnostics(vendorResult.combined, vendorRoot);
  const cleanroomKeys = new Set(cleanroomDiagnostics.map((item) => item.key));
  const vendorOnlyDiagnostics = vendorDiagnostics.filter((item) => !cleanroomKeys.has(item.key));

  if (vendorOnlyDiagnostics.length > 0) {
    const detail = vendorOnlyDiagnostics.map((item) => `- ${item.line}`).join("\n");
    fail(`Patched OpenCode introduced new typecheck diagnostics:\n${detail}`);
  }

  if (vendorDiagnostics.length === 0 && cleanroomDiagnostics.length === 0) {
    const cleanroomComparable = normalizeComparableOutput(cleanroomResult.combined, cleanroomRoot);
    const vendorComparable = normalizeComparableOutput(vendorResult.combined, vendorRoot);
    if (cleanroomComparable !== vendorComparable) {
      fail(
        "OpenCode workspace typecheck failed in both cleanroom and vendor, but the failures do not normalize to the same output.\n\nVendor output:\n" +
          indentBlock(vendorResult.combined || "<no output>"),
      );
    }
  }

  if (vendorResult.status !== 0) {
    const baselineCount = vendorDiagnostics.length || countComparableLines(normalizeComparableOutput(vendorResult.combined, vendorRoot));
    console.log(`Ignoring ${baselineCount} cleanroom-matching OpenCode typecheck issue(s).`);
    if (vendorDiagnostics.length > 0) {
      console.log("Ignored baseline diagnostics:");
      for (const diagnostic of vendorDiagnostics) {
        console.log(`- ${diagnostic.line}`);
      }
    }
  }
}

function collectDiagnostics(output: string, workspaceRoot: string) {
  const diagnostics = new Map<string, Diagnostic>();
  const lines = output.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const match = line.match(
      /^(?<task>.+?:typecheck:\s+)?(?<file>.+?)\((?<line>\d+),(?<column>\d+)\): error TS(?<code>\d+): (?<message>.+)$/,
    );
    if (!match?.groups) {
      continue;
    }

    const task = (match.groups.task ?? "typecheck").trim();
    const file = normalizePath(match.groups.file, workspaceRoot);
    const row = match.groups.line;
    const column = match.groups.column;
    const code = `TS${match.groups.code}`;
    const message = match.groups.message.trim();
    const key = [task, file, row, column, code, message].join("|");
    diagnostics.set(key, { key, line: `${task} ${file}(${row},${column}): error ${code}: ${message}` });
  }

  return [...diagnostics.values()];
}

function normalizeComparableOutput(output: string, workspaceRoot: string) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => !isNoiseLine(line))
    .map((line) => normalizeRoot(line, workspaceRoot));
  return lines.join("\n");
}

function countComparableLines(output: string) {
  if (!output) {
    return 0;
  }
  return output.split("\n").filter(Boolean).length;
}

function isNoiseLine(line: string) {
  return (
    line === "$ bun turbo typecheck" ||
    line.startsWith("• turbo ") ||
    line.startsWith("• Packages in scope:") ||
    line.startsWith("• Running typecheck in ") ||
    line.startsWith("• Remote caching ") ||
    line.startsWith("Tasks:") ||
    line.startsWith("Cached:") ||
    line.startsWith("Time:")
  );
}

function normalizePath(filePath: string, workspaceRoot: string) {
  const normalized = filePath.replaceAll("\\", "/");
  if (path.isAbsolute(normalized)) {
    return normalizeRoot(normalized, workspaceRoot);
  }
  return normalized.replace(/^\.\//, "");
}

function normalizeRoot(value: string, workspaceRoot: string) {
  const normalizedRoot = workspaceRoot.replaceAll("\\", "/");
  return value.replaceAll(normalizedRoot, "<workspace>").replaceAll(repoRoot.replaceAll("\\", "/"), "<repo>");
}

function assertDistAppBuilt() {
  const indexPath = path.join(repoRoot, "dist", "app", "index.html");
  const assetsPath = path.join(repoRoot, "dist", "app", "assets");

  if (!existsSync(indexPath)) {
    fail("Missing dist/app/index.html after build.");
  }
  if (!existsSync(assetsPath) || !directoryHasFiles(assetsPath)) {
    fail("Missing built OpenCode app assets in dist/app/assets after build.");
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

function assertTrackedArtifactsSynced(pathsToCheck: string[]) {
  const result = runCommand(["git", "diff", "--name-only", "--", ...pathsToCheck], { allowFailure: true, printCommand: false });
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

function readSyncStatus(options?: { allowFailure?: boolean }): SyncStatus | null {
  const result = runCommand(
    ["bun", "run", "opencode:sync", "--status", "--json"],
    { allowFailure: options?.allowFailure ?? false, printCommand: false, suppressOutput: true },
  );
  if (result.status !== 0) {
    return null;
  }

  try {
    return JSON.parse(result.stdout) as SyncStatus;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`Failed to parse opencode sync status JSON: ${message}`);
  }
}

function runStep(label: string, command: string[]) {
  console.log(`\n== ${label} ==`);
  runCommand(command);
}

function runCommand(
  command: string[],
  options: {
    allowFailure?: boolean;
    cwd?: string;
    printCommand?: boolean;
    quietLabel?: string;
    suppressOutput?: boolean;
    env?: NodeJS.ProcessEnv;
  } = {},
): CommandResult {
  const cwd = options.cwd ?? repoRoot;
  if (options.printCommand !== false) {
    console.log(`$ ${command.join(" ")}`);
  }

  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const combined = [stdout, stderr].filter(Boolean).join(stdout && stderr ? "\n" : "");

  if (options.suppressOutput) {
    // Intentionally silent.
  } else if (options.quietLabel) {
    const summary = result.status === 0 ? "passed" : `failed (${result.status ?? "unknown"})`;
    console.log(`${options.quietLabel}: ${summary}`);
  } else {
    if (stdout) {
      process.stdout.write(stdout);
    }
    if (stderr) {
      process.stderr.write(stderr);
    }
  }

  if ((result.status ?? 0) !== 0 && !options.allowFailure) {
    fail(
      `Command failed: ${command.join(" ")}\n\n${combined ? indentBlock(combined) : "  <no output>"}`,
      result.status ?? 1,
    );
  }

  return {
    status: result.status ?? 0,
    stdout,
    stderr,
    combined,
  };
}

function indentBlock(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join("\n");
}

function bunInstallEnv() {
  return {
    ...process.env,
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_API_URL: "https://api.github.com",
  };
}

function fail(message: string, code = 1): never {
  console.error(`\n${message}`);
  process.exit(code);
}
