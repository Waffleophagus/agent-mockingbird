#!/usr/bin/env bun
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

type LockFile = {
  upstream: {
    remote: string;
    tag: string;
    commit: string;
  };
  packageVersion: string;
  paths: {
    cleanroom: string;
    vendor: string;
    patches: string;
  };
  branch: {
    name: string;
  };
};

type ParsedArgs = {
  help: boolean;
  status: boolean;
  json: boolean;
  rebuildOnly: boolean;
  exportPatches: boolean;
  check: boolean;
  ref?: string;
  hardRef?: string;
};

type ExecOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowFailure?: boolean;
};

type StatusReport = {
  lock: {
    tag: string;
    commit: string;
    packageVersion: string;
  };
  cleanroom: {
    path: string;
    exists: boolean;
    pristine: boolean | null;
    head: string | null;
    matchesLock: boolean | null;
  };
  branch: {
    name: string;
    head: string | null;
  };
  vendor: {
    path: string;
    exists: boolean;
    state: "missing" | "clean" | "dirty" | "conflicted" | "invalid";
    head: string | null;
  };
  patches: {
    path: string;
    count: number;
    matchesBranch: boolean | null;
  };
};

const repoRoot = path.resolve(import.meta.dir, "..");
const lockPath = path.join(repoRoot, "executor.lock.json");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const lock = readLock();

  if (args.status) {
    const report = collectStatus(lock);
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printStatus(report);
    }
    process.exit(report.vendor.state === "invalid" ? 1 : 0);
  }

  if (args.check) {
    runCheck(lock);
    return;
  }

  if (args.exportPatches) {
    ensureCleanroomClone(lock);
    ensureCleanroomAtCommit(lock, lock.upstream.commit);
    ensureVendorClean(lock);
    exportPatches(lock, lock.upstream.commit);
    console.log("Exported patches/executor successfully.");
    return;
  }

  if (args.rebuildOnly) {
    ensureCleanroomClone(lock);
    ensureCleanroomAtCommit(lock, lock.upstream.commit);
    recreateVendorWorktree(lock, lock.upstream.commit);
    console.log(`Rebuilt ${lock.paths.vendor} from ${lock.upstream.tag}.`);
    return;
  }

  if (args.ref) {
    const targetTag = normalizeTag(args.ref);
    ensureCleanroomClone(lock);
    ensureCleanroomPristine(lock);
    ensureVendorClean(lock);
    const targetCommit = resolveUpstreamCommit(lock, targetTag);
    ensureCleanroomAtCommit(lock, targetCommit);
    recreateVendorWorktree(lock, targetCommit);
    exportPatches(lock, targetCommit);
    verifyPatchReproducibility(lock, targetCommit);
    writeLock({
      ...lock,
      upstream: {
        remote: lock.upstream.remote,
        tag: targetTag,
        commit: targetCommit,
      },
      packageVersion: stripLeadingV(targetTag),
    });
    console.log(`Updated executor.lock.json to ${targetTag} (${targetCommit}).`);
    return;
  }

  if (args.hardRef) {
    const targetTag = normalizeTag(args.hardRef);
    ensureCleanroomClone(lock);
    ensureCleanroomPristine(lock);
    const targetCommit = resolveUpstreamCommit(lock, targetTag);
    ensureCleanroomAtCommit(lock, targetCommit);
    recreateVendorWorktree(lock, targetCommit, { force: true });
    exportPatches(lock, targetCommit);
    verifyPatchReproducibility(lock, targetCommit);
    writeLock({
      ...lock,
      upstream: {
        remote: lock.upstream.remote,
        tag: targetTag,
        commit: targetCommit,
      },
      packageVersion: stripLeadingV(targetTag),
    });
    console.log(`Force-updated executor.lock.json to ${targetTag} (${targetCommit}).`);
    return;
  }

  throw new Error(
    "Specify one of --status, --rebuild-only, --export-patches, --check, --ref <tag>, --hard-ref <tag>, or --help.",
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    help: false,
    status: false,
    json: false,
    rebuildOnly: false,
    exportPatches: false,
    check: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--status") {
      parsed.status = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--rebuild-only") {
      parsed.rebuildOnly = true;
      continue;
    }
    if (arg === "--export-patches") {
      parsed.exportPatches = true;
      continue;
    }
    if (arg === "--check") {
      parsed.check = true;
      continue;
    }
    if (arg === "--ref") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value after --ref.");
      }
      parsed.ref = value;
      index += 1;
      continue;
    }
    if (arg === "--hard-ref") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value after --hard-ref.");
      }
      parsed.hardRef = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const selected = [
    parsed.help,
    parsed.status,
    parsed.rebuildOnly,
    parsed.exportPatches,
    parsed.check,
    Boolean(parsed.ref),
    Boolean(parsed.hardRef),
  ].filter(Boolean);
  if (selected.length !== 1) {
    throw new Error("Exactly one primary operation is required.");
  }
  if (parsed.json && !parsed.status) {
    throw new Error("--json is only supported together with --status.");
  }

  return parsed;
}

function printHelp() {
  console.log(`Executor workflow helper

Usage:
  bun run executor:sync --status [--json]
  bun run executor:sync --rebuild-only
  bun run executor:sync --export-patches
  bun run executor:sync --check
  bun run executor:sync --ref <tag>
  bun run executor:sync --hard-ref <tag>

Commands:
  --status        Show lock, cleanroom, vendor, and patch status.
  --rebuild-only  Recreate vendor/executor from executor.lock.json and patches.
  --export-patches
                  Export committed vendor/executor changes into patches/executor.
  --check         Reproduce vendor/executor from lock + patches in temp state.
  --ref <tag>     Upgrade to a new upstream tag while requiring a clean vendor tree.
  --hard-ref <tag>
                  Force-reset the vendor worktree to a new upstream tag before exporting patches.

Typical upgrade flow:
  1. bun run executor:sync --status
  2. bun run executor:sync --ref vX.Y.Z
  3. If the patch stack needs a manual rebase, resolve it in vendor/executor and commit there.
  4. bun run executor:sync --export-patches
  5. bun run executor:sync --check`);
}

function readLock(): LockFile {
  return JSON.parse(readFileSync(lockPath, "utf8")) as LockFile;
}

function writeLock(lock: LockFile) {
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

function normalizeTag(tag: string) {
  const trimmed = tag.trim();
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function stripLeadingV(tag: string) {
  return tag.replace(/^v/, "");
}

function sanitizedEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (
      key === "GIT_DIR" ||
      key === "GIT_WORK_TREE" ||
      key === "GIT_INDEX_FILE" ||
      key === "GIT_OBJECT_DIRECTORY" ||
      key === "GIT_ALTERNATE_OBJECT_DIRECTORIES" ||
      key === "GIT_COMMON_DIR" ||
      key === "GIT_PREFIX" ||
      key === "GIT_SUPER_PREFIX"
    ) {
      delete env[key];
    }
  }
  return env;
}

function run(command: string[], options: ExecOptions = {}) {
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: options.cwd ?? repoRoot,
    env: sanitizedEnv(options.env ?? process.env),
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (result.status !== 0 && !options.allowFailure) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("");
    throw new Error(`Command failed: ${command.join(" ")}\n${detail}`);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function git(lock: LockFile, args: string[], options: ExecOptions = {}) {
  return run(["git", ...args], {
    cwd: options.cwd ?? path.resolve(repoRoot, lock.paths.cleanroom),
    allowFailure: options.allowFailure,
  });
}

function ensureCleanroomClone(lock: LockFile) {
  const cleanroomPath = path.resolve(repoRoot, lock.paths.cleanroom);
  if (existsSync(path.join(cleanroomPath, ".git"))) {
    git(lock, ["remote", "set-url", "origin", lock.upstream.remote]);
    git(lock, ["fetch", "--tags", "origin"]);
    return;
  }

  mkdirSync(path.dirname(cleanroomPath), { recursive: true });
  run(["git", "clone", lock.upstream.remote, cleanroomPath], { cwd: repoRoot });
  git(lock, ["fetch", "--tags", "origin"]);
}

function ensureCleanroomPristine(lock: LockFile) {
  const status = git(lock, ["status", "--porcelain"], { allowFailure: true }).stdout.trim();
  if (status.length > 0) {
    throw new Error(`${lock.paths.cleanroom} is dirty.`);
  }
}

function ensureCleanroomAtCommit(lock: LockFile, commit: string) {
  git(lock, ["fetch", "--tags", "origin"]);
  git(lock, ["checkout", "--detach", commit]);
  git(lock, ["reset", "--hard", commit]);
  git(lock, ["clean", "-fdx"]);
}

function ensureVendorClean(lock: LockFile) {
  const vendorPath = path.resolve(repoRoot, lock.paths.vendor);
  if (!existsSync(path.join(vendorPath, ".git"))) {
    return;
  }
  const status = run(["git", "status", "--porcelain"], {
    cwd: vendorPath,
    allowFailure: true,
  }).stdout.trim();
  if (status.length > 0) {
    throw new Error(`${lock.paths.vendor} is dirty.`);
  }
}

function removeWorktreeIfPresent(lock: LockFile, targetPath: string, options?: { force?: boolean }) {
  const cleanroomPath = path.resolve(repoRoot, lock.paths.cleanroom);
  run(["git", "worktree", "prune"], { cwd: cleanroomPath, allowFailure: true });
  if (!existsSync(targetPath)) {
    return;
  }
  const worktrees = run(["git", "worktree", "list", "--porcelain"], {
    cwd: cleanroomPath,
    allowFailure: true,
  }).stdout.split("\n");
  const registered = worktrees.some(line => line === `worktree ${targetPath}`);
  if (registered) {
    const removeArgs = ["worktree", "remove"];
    if (options?.force) {
      removeArgs.push("--force");
    }
    removeArgs.push(targetPath);
    git(lock, removeArgs, {
      cwd: cleanroomPath,
      allowFailure: true,
    });
    run(["git", "worktree", "prune"], { cwd: cleanroomPath, allowFailure: true });
    return;
  }
  if (!options?.force) {
    const dirty = run(["git", "status", "--porcelain"], {
      cwd: targetPath,
      allowFailure: true,
    }).stdout.trim();
    if (dirty.length > 0) {
      throw new Error(`${path.relative(repoRoot, targetPath)} is dirty.`);
    }
  }
  rmSync(targetPath, { recursive: true, force: true });
}

function recreateVendorWorktree(lock: LockFile, baseCommit: string, options?: { force?: boolean }) {
  const cleanroomPath = path.resolve(repoRoot, lock.paths.cleanroom);
  const vendorPath = path.resolve(repoRoot, lock.paths.vendor);
  const patchesPath = path.resolve(repoRoot, lock.paths.patches);

  removeWorktreeIfPresent(lock, vendorPath, options);
  run(["git", "worktree", "prune"], { cwd: cleanroomPath, allowFailure: true });
  mkdirSync(path.dirname(vendorPath), { recursive: true });
  git(lock, ["worktree", "add", "--detach", vendorPath, baseCommit], { cwd: cleanroomPath });
  run(["git", "checkout", "-B", lock.branch.name, baseCommit], { cwd: vendorPath });

  const patchFiles = listPatchFiles(patchesPath);
  if (patchFiles.length > 0) {
    run(["git", "am", "--3way", ...patchFiles], { cwd: vendorPath, env: gitAmEnv() });
  }
}

function exportPatches(lock: LockFile, baseCommit: string) {
  const vendorPath = path.resolve(repoRoot, lock.paths.vendor);
  const patchesPath = path.resolve(repoRoot, lock.paths.patches);
  mkdirSync(patchesPath, { recursive: true });
  for (const entry of readdirSync(patchesPath)) {
    if (entry.endsWith(".patch")) {
      rmSync(path.join(patchesPath, entry), { force: true });
    }
  }
  run(
    ["git", "format-patch", "--no-stat", "--full-index", "--output-directory", patchesPath, `${baseCommit}..HEAD`],
    { cwd: vendorPath },
  );
}

function listPatchFiles(patchesPath: string) {
  if (!existsSync(patchesPath)) {
    return [];
  }
  return readdirSync(patchesPath)
    .filter(entry => entry.endsWith(".patch"))
    .sort((left, right) => left.localeCompare(right))
    .map(entry => path.join(patchesPath, entry));
}

function resolveUpstreamCommit(lock: LockFile, tag: string) {
  const result = git(lock, ["rev-list", "-n", "1", tag], { allowFailure: true }).stdout.trim();
  if (!result) {
    throw new Error(`Unable to resolve upstream tag ${tag}.`);
  }
  return result;
}

function collectStatus(lock: LockFile): StatusReport {
  const cleanroomPath = path.resolve(repoRoot, lock.paths.cleanroom);
  const vendorPath = path.resolve(repoRoot, lock.paths.vendor);
  const patchesPath = path.resolve(repoRoot, lock.paths.patches);
  const cleanroomExists = existsSync(path.join(cleanroomPath, ".git"));
  const vendorExists = existsSync(path.join(vendorPath, ".git"));

  const cleanroomHead = cleanroomExists
    ? run(["git", "rev-parse", "HEAD"], { cwd: cleanroomPath, allowFailure: true }).stdout.trim() || null
    : null;
  const cleanroomPristine = cleanroomExists
    ? run(["git", "status", "--porcelain"], { cwd: cleanroomPath, allowFailure: true }).stdout.trim().length === 0
    : null;
  const vendorHead = vendorExists
    ? run(["git", "rev-parse", "HEAD"], { cwd: vendorPath, allowFailure: true }).stdout.trim() || null
    : null;
  const vendorStatusRaw = vendorExists
    ? run(["git", "status", "--porcelain"], { cwd: vendorPath, allowFailure: true }).stdout.trim()
    : "";
  const vendorState: StatusReport["vendor"]["state"] = !vendorExists
    ? "missing"
    : vendorStatusRaw.length === 0
      ? "clean"
      : "dirty";
  const branchHead = cleanroomExists
    ? run(["git", "rev-parse", lock.branch.name], { cwd: cleanroomPath, allowFailure: true }).stdout.trim() || null
    : null;

  return {
    lock: {
      tag: lock.upstream.tag,
      commit: lock.upstream.commit,
      packageVersion: lock.packageVersion,
    },
    cleanroom: {
      path: lock.paths.cleanroom,
      exists: cleanroomExists,
      pristine: cleanroomPristine,
      head: cleanroomHead,
      matchesLock: cleanroomHead ? cleanroomHead === lock.upstream.commit : null,
    },
    branch: {
      name: lock.branch.name,
      head: branchHead,
    },
    vendor: {
      path: lock.paths.vendor,
      exists: vendorExists,
      state: vendorState,
      head: vendorHead,
    },
    patches: {
      path: lock.paths.patches,
      count: listPatchFiles(patchesPath).length,
      matchesBranch: cleanroomExists && vendorExists ? branchHead === vendorHead : null,
    },
  };
}

function printStatus(report: StatusReport) {
  console.log(`lock: ${report.lock.tag} (${report.lock.commit}) package=${report.lock.packageVersion}`);
  console.log(
    `cleanroom: ${report.cleanroom.exists ? "present" : "missing"} pristine=${String(report.cleanroom.pristine)} matchesLock=${String(report.cleanroom.matchesLock)}`,
  );
  console.log(`branch: ${report.branch.name} head=${report.branch.head ?? "missing"}`);
  console.log(`vendor: ${report.vendor.exists ? "present" : "missing"} state=${report.vendor.state}`);
  console.log(`patches: count=${report.patches.count} matchesBranch=${String(report.patches.matchesBranch)}`);
}

function runCheck(lock: LockFile) {
  ensureCleanroomClone(lock);
  ensureCleanroomAtCommit(lock, lock.upstream.commit);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "executor-sync-check-"));
  const compareDir = path.join(tempRoot, "vendor");
  try {
    recreateVendorWorktreeIn(lock, lock.upstream.commit, compareDir);
    const actualVendorPath = path.resolve(repoRoot, lock.paths.vendor);
    if (existsSync(path.join(actualVendorPath, ".git"))) {
      compareGitTrees(compareDir, actualVendorPath, "Executor vendor tree does not match lock + patches.");
    }
    console.log("executor:sync --check passed.");
  } finally {
    removeWorktreeIfPresent(lock, compareDir);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function recreateVendorWorktreeIn(lock: LockFile, baseCommit: string, targetPath: string) {
  const cleanroomPath = path.resolve(repoRoot, lock.paths.cleanroom);
  const patchesPath = path.resolve(repoRoot, lock.paths.patches);
  removeWorktreeIfPresent(lock, targetPath);
  run(["git", "worktree", "prune"], { cwd: cleanroomPath, allowFailure: true });
  mkdirSync(path.dirname(targetPath), { recursive: true });
  git(lock, ["worktree", "add", "--detach", targetPath, baseCommit], { cwd: cleanroomPath });
  const patchFiles = listPatchFiles(patchesPath);
  if (patchFiles.length > 0) {
    run(["git", "am", "--3way", ...patchFiles], { cwd: targetPath, env: gitAmEnv() });
  }
}

function gitAmEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "Agent Mockingbird CI",
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "agent-mockingbird-ci@example.invalid",
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "Agent Mockingbird CI",
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "agent-mockingbird-ci@example.invalid",
  };
}

function verifyPatchReproducibility(lock: LockFile, baseCommit: string) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "executor-sync-repro-"));
  const compareDir = path.join(tempRoot, "vendor");
  const vendorPath = path.resolve(repoRoot, lock.paths.vendor);
  try {
    recreateVendorWorktreeIn(lock, baseCommit, compareDir);
    compareGitTrees(compareDir, vendorPath, "Exported patches are not reproducible.");
  } finally {
    removeWorktreeIfPresent(lock, compareDir);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function compareGitTrees(leftPath: string, rightPath: string, message: string) {
  const leftDirty = run(["git", "status", "--porcelain", "--untracked-files=no"], {
    cwd: leftPath,
    allowFailure: true,
  }).stdout.trim();
  const rightDirty = run(["git", "status", "--porcelain", "--untracked-files=no"], {
    cwd: rightPath,
    allowFailure: true,
  }).stdout.trim();
  if (leftDirty || rightDirty) {
    throw new Error(`${message}\nTracked file changes detected while verifying patch reproducibility.`);
  }

  const leftTree = run(["git", "rev-parse", "HEAD^{tree}"], {
    cwd: leftPath,
    allowFailure: true,
  }).stdout.trim();
  const rightTree = run(["git", "rev-parse", "HEAD^{tree}"], {
    cwd: rightPath,
    allowFailure: true,
  }).stdout.trim();
  if (leftTree !== rightTree) {
    throw new Error(`${message}\nTree mismatch: ${leftTree} != ${rightTree}`);
  }
}

void main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
