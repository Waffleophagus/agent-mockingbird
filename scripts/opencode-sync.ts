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
const lockPath = path.join(repoRoot, "opencode.lock.json");
const patchComparePrefix = "opencode-sync-export-";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const lock = readLock();

  if (args.status) {
    const report = collectStatus(lock);
    printStatus(report, args.json);
    process.exit(report.vendor.state === "invalid" ? 1 : 0);
  }

  if (args.check) {
    runCheck(lock);
    return;
  }

  if (args.exportPatches) {
    ensureCleanroomClone(lock);
    ensureCleanroomAtCommit(lock, lock.upstream.commit);
    ensureVendorBranchState(lock, { requirePatchesMatch: false });
    exportPatchesFromBranch(lock);
    verifyBranchMatchesPatches(lock);
    console.log("Exported patches/opencode successfully.");
    return;
  }

  if (args.rebuildOnly) {
    ensureCleanroomClone(lock);
    ensureCleanroomAtCommit(lock, lock.upstream.commit);
    recreateVendorWorktree(lock, lock.upstream.commit);
    verifyBranchMatchesPatches(lock);
    console.log(`Rebuilt ${lock.paths.vendor} from ${lock.upstream.tag}.`);
    return;
  }

  if (args.ref) {
    ensureCleanroomClone(lock);
    ensureCleanroomPristine(lock);
    const targetTag = normalizeTag(args.ref);
    const targetCommit = resolveUpstreamCommit(lock.paths.cleanroom, targetTag);
    ensureVendorSafeForRefChange(lock);
    ensureCleanroomAtCommit(lock, targetCommit);
    recreateVendorWorktree(lock, targetCommit);
    runValidation(lock.paths.vendor);
    exportPatchesFromBranch(lock, targetCommit);
    verifyBranchMatchesPatches(lock);
    verifyPatchReproducibility(lock, {
      baseCommit: targetCommit,
      compareDir: path.resolve(repoRoot, lock.paths.vendor),
      useTemporaryClone: true,
    });
    writeLock(lock, {
      upstream: {
        remote: lock.upstream.remote,
        tag: targetTag,
        commit: targetCommit,
      },
      packageVersion: stripLeadingV(targetTag),
      paths: lock.paths,
      branch: lock.branch,
    });
    console.log(`Updated ${path.relative(repoRoot, lockPath)} to ${targetTag} (${targetCommit}).`);
    return;
  }

  if (args.hardRef) {
    ensureCleanroomClone(lock);
    ensureCleanroomPristine(lock);
    const targetTag = normalizeTag(args.hardRef);
    const targetCommit = resolveUpstreamCommit(lock.paths.cleanroom, targetTag);
    ensureCleanroomAtCommit(lock, targetCommit);
    recreateVendorWorktree(lock, targetCommit, { force: true });
    runValidation(lock.paths.vendor);
    exportPatchesFromBranch(lock, targetCommit);
    verifyBranchMatchesPatches(lock);
    verifyPatchReproducibility(lock, {
      baseCommit: targetCommit,
      compareDir: path.resolve(repoRoot, lock.paths.vendor),
      useTemporaryClone: true,
    });
    writeLock(lock, {
      upstream: {
        remote: lock.upstream.remote,
        tag: targetTag,
        commit: targetCommit,
      },
      packageVersion: stripLeadingV(targetTag),
      paths: lock.paths,
      branch: lock.branch,
    });
    console.log(`Force-updated ${path.relative(repoRoot, lockPath)} to ${targetTag} (${targetCommit}).`);
    return;
  }

  throw new Error(
    "Specify one of --status, --rebuild-only, --export-patches, --check, --ref <tag>, or --hard-ref <tag>.",
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    status: false,
    json: false,
    rebuildOnly: false,
    exportPatches: false,
    check: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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

function readLock(): LockFile {
  if (!existsSync(lockPath)) {
    throw new Error(`Missing lock file: ${path.relative(repoRoot, lockPath)}`);
  }
  return JSON.parse(readFileSync(lockPath, "utf8")) as LockFile;
}

function writeLock(previous: LockFile, next: LockFile) {
  if (previous.upstream.commit === next.upstream.commit && previous.upstream.tag === next.upstream.tag) {
    return;
  }
  writeFileSync(lockPath, `${JSON.stringify(next, null, 2)}\n`);
}

function collectStatus(lock: LockFile): StatusReport {
  const cleanroomPath = path.resolve(repoRoot, lock.paths.cleanroom);
  const vendorPath = path.resolve(repoRoot, lock.paths.vendor);
  const patchesPath = path.resolve(repoRoot, lock.paths.patches);
  const cleanroomExists = isGitRepository(cleanroomPath);
  const cleanroomHead = cleanroomExists ? gitOutput(cleanroomPath, ["rev-parse", "HEAD"]).trim() : null;
  const cleanroomPristine = cleanroomExists ? gitIsPristine(cleanroomPath) : null;
  const cleanroomMatchesLock = cleanroomHead ? cleanroomHead === lock.upstream.commit : null;

  const vendorExists = existsSync(vendorPath);
  let vendorState: StatusReport["vendor"]["state"] = "missing";
  let vendorHead: string | null = null;
  let branchHead: string | null = null;
  let patchesMatch: boolean | null = null;
  if (vendorExists) {
    if (!isGitRepository(vendorPath)) {
      vendorState = "invalid";
    } else {
      vendorHead = gitOutput(vendorPath, ["rev-parse", "HEAD"]).trim();
      branchHead = vendorHead;
      const porcelain = gitOutput(vendorPath, ["status", "--porcelain"]).trim().split("\n").filter(Boolean);
      if (porcelain.some((line) => line.startsWith("UU ") || line.includes(" -> "))) {
        vendorState = "conflicted";
      } else if (porcelain.length > 0) {
        vendorState = "dirty";
      } else {
        vendorState = "clean";
      }
      if (vendorState !== "invalid") {
        patchesMatch = branchMatchesPatches(lock, vendorPath);
      }
    }
  }

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
      matchesLock: cleanroomMatchesLock,
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
      count: patchFiles(patchesPath).length,
      matchesBranch: patchesMatch,
    },
  };
}

function printStatus(report: StatusReport, asJson: boolean) {
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`lock tag: ${report.lock.tag}`);
  console.log(`lock commit: ${report.lock.commit}`);
  console.log(`package version: ${report.lock.packageVersion}`);
  console.log(`cleanroom: ${report.cleanroom.path}`);
  console.log(`cleanroom exists: ${report.cleanroom.exists ? "yes" : "no"}`);
  console.log(`cleanroom pristine: ${stringifyStatus(report.cleanroom.pristine)}`);
  console.log(`cleanroom head: ${report.cleanroom.head ?? "missing"}`);
  console.log(`cleanroom matches lock: ${stringifyStatus(report.cleanroom.matchesLock)}`);
  console.log(`patch branch: ${report.branch.name}`);
  console.log(`patch branch head: ${report.branch.head ?? "missing"}`);
  console.log(`vendor: ${report.vendor.path}`);
  console.log(`vendor state: ${report.vendor.state}`);
  console.log(`vendor head: ${report.vendor.head ?? "missing"}`);
  console.log(`patches count: ${report.patches.count}`);
  console.log(`patches match branch: ${stringifyStatus(report.patches.matchesBranch)}`);
}

function stringifyStatus(value: boolean | null) {
  if (value === null) {
    return "unknown";
  }
  return value ? "yes" : "no";
}

function runCheck(lock: LockFile) {
  validateLock(lock);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-opencode-check-"));
  try {
    const cleanroomPath = path.join(tempRoot, "cleanroom");
    console.log("Checking OpenCode workflow: cloning upstream...");
    cloneUpstreamForValidation(lock, cleanroomPath);
    run(["git", "checkout", "--detach", lock.upstream.commit], cleanroomPath);
    const vendorPath = path.join(tempRoot, "vendor");
    console.log("Checking OpenCode workflow: creating temporary vendor worktree...");
    run(["git", "worktree", "add", "--detach", vendorPath, lock.upstream.commit], cleanroomPath);
    run(["git", "checkout", "-B", lock.branch.name, lock.upstream.commit], vendorPath);
    console.log("Checking OpenCode workflow: applying tracked patch series...");
    applyPatchSeries(lock, vendorPath);
    console.log("Checking OpenCode workflow: running OpenCode validation...");
    runValidation(vendorPath, { includeRepoValidation: false });
    console.log("Checking OpenCode workflow: verifying patch reproducibility...");
    verifyPatchReproducibility(lock, {
      baseCommit: lock.upstream.commit,
      compareDir: vendorPath,
      cleanroomOverride: cleanroomPath,
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log("OpenCode workflow check passed.");
}

function validateLock(lock: LockFile) {
  if (!lock.upstream?.remote || !lock.upstream?.tag || !lock.upstream?.commit) {
    throw new Error("opencode.lock.json is missing upstream metadata.");
  }
  if (!lock.packageVersion) {
    throw new Error("opencode.lock.json is missing packageVersion.");
  }
  if (!lock.paths?.cleanroom || !lock.paths?.vendor || !lock.paths?.patches) {
    throw new Error("opencode.lock.json is missing paths metadata.");
  }
  if (!lock.branch?.name) {
    throw new Error("opencode.lock.json is missing branch metadata.");
  }
}

function ensureCleanroomClone(lock: LockFile) {
  validateLock(lock);
  const cleanroomPath = path.resolve(repoRoot, lock.paths.cleanroom);
  if (isGitRepository(cleanroomPath)) {
    const remote = gitOutput(cleanroomPath, ["remote", "get-url", "origin"]).trim();
    if (remote !== lock.upstream.remote) {
      throw new Error(`Cleanroom origin mismatch: expected ${lock.upstream.remote}, got ${remote}`);
    }
    run(["git", "fetch", "--tags", "origin"], cleanroomPath);
    return;
  }
  if (existsSync(cleanroomPath)) {
    throw new Error(`Cleanroom path exists but is not a git clone: ${cleanroomPath}`);
  }
  mkdirSync(path.dirname(cleanroomPath), { recursive: true });
  run(["git", "clone", lock.upstream.remote, cleanroomPath], repoRoot);
  run(["git", "fetch", "--tags", "origin"], cleanroomPath);
}

function ensureCleanroomPristine(lock: LockFile) {
  const cleanroomPath = path.resolve(repoRoot, lock.paths.cleanroom);
  if (!gitIsPristine(cleanroomPath)) {
    throw new Error(`Cleanroom is dirty: ${cleanroomPath}`);
  }
}

function ensureCleanroomAtCommit(lock: LockFile, commit: string) {
  const cleanroomPath = path.resolve(repoRoot, lock.paths.cleanroom);
  ensureCleanroomPristine(lock);
  run(["git", "checkout", "--detach", commit], cleanroomPath);
  run(["git", "reset", "--hard", commit], cleanroomPath);
  run(["git", "clean", "-fdx"], cleanroomPath);
}

function resolveUpstreamCommit(cleanroomPathInput: string, ref: string) {
  const cleanroomPath = path.resolve(repoRoot, cleanroomPathInput);
  run(["git", "fetch", "--tags", "origin"], cleanroomPath);
  return gitOutput(cleanroomPath, ["rev-parse", `refs/tags/${ref}^{commit}`]).trim();
}

function ensureVendorSafeForRefChange(lock: LockFile) {
  const vendorPath = path.resolve(repoRoot, lock.paths.vendor);
  if (!existsSync(vendorPath)) {
    return;
  }
  if (!isGitRepository(vendorPath)) {
    throw new Error(`Vendor path exists but is not a git worktree: ${vendorPath}`);
  }
  const dirty = gitOutput(vendorPath, ["status", "--porcelain"]).trim();
  if (dirty) {
    throw new Error(`Vendor worktree is dirty. Commit or discard changes first: ${vendorPath}`);
  }
  if (!branchMatchesPatches(lock, vendorPath)) {
    throw new Error("Vendor branch has changes that are not represented by patches/opencode.");
  }
}

function recreateVendorWorktree(lock: LockFile, baseCommit: string, options?: { force?: boolean }) {
  const cleanroomPath = path.resolve(repoRoot, lock.paths.cleanroom);
  const vendorPath = path.resolve(repoRoot, lock.paths.vendor);
  removeVendorWorktree(lock, options?.force ?? false);
  run(["git", "worktree", "prune"], cleanroomPath);
  mkdirSync(path.dirname(vendorPath), { recursive: true });
  run(["git", "worktree", "add", "--detach", vendorPath, baseCommit], cleanroomPath);
  run(["git", "checkout", "-B", lock.branch.name, baseCommit], vendorPath);
  applyPatchSeries(lock, vendorPath);
}

function removeVendorWorktree(lock: LockFile, force: boolean) {
  const cleanroomPath = path.resolve(repoRoot, lock.paths.cleanroom);
  const vendorPath = path.resolve(repoRoot, lock.paths.vendor);
  run(["git", "worktree", "prune"], cleanroomPath, { allowFailure: true });
  if (!existsSync(vendorPath)) {
    return;
  }
  if (isGitRepository(vendorPath)) {
    const worktrees = gitOutput(cleanroomPath, ["worktree", "list", "--porcelain"]).split("\n");
    const registered = worktrees.some((line) => line === `worktree ${vendorPath}`);
    if (registered) {
      run(["git", "worktree", "remove", force ? "--force" : vendorPath, force ? vendorPath : ""].filter(Boolean), cleanroomPath);
      run(["git", "worktree", "prune"], cleanroomPath);
      return;
    }
  }
  if (!force && isPathDirty(vendorPath)) {
    throw new Error(`Refusing to remove dirty vendor path: ${vendorPath}`);
  }
  rmSync(vendorPath, { recursive: true, force: true });
}

function isPathDirty(targetPath: string) {
  if (!existsSync(targetPath)) {
    return false;
  }
  const entries = readdirSync(targetPath);
  return entries.length > 0;
}

function applyPatchSeries(lock: LockFile, vendorPath: string) {
  const patches = patchFiles(path.resolve(repoRoot, lock.paths.patches));
  if (patches.length === 0) {
    return;
  }
  run(["git", "am", "--3way", ...patches], vendorPath, { env: gitAmEnv() });
}

function exportPatchesFromBranch(lock: LockFile, baseCommit?: string) {
  ensureVendorBranchState(lock, { requirePatchesMatch: false });
  const vendorPath = path.resolve(repoRoot, lock.paths.vendor);
  const patchesPath = path.resolve(repoRoot, lock.paths.patches);
  rmSync(patchesPath, { recursive: true, force: true });
  mkdirSync(patchesPath, { recursive: true });
  run(
    [
      "git",
      "format-patch",
      "--quiet",
      "--output-directory",
      patchesPath,
      `${baseCommit ?? readLock().upstream.commit}..HEAD`,
    ],
    vendorPath,
  );
}

function ensureVendorBranchState(lock: LockFile, options: { requirePatchesMatch: boolean }) {
  const vendorPath = path.resolve(repoRoot, lock.paths.vendor);
  if (!isGitRepository(vendorPath)) {
    throw new Error(`Vendor worktree is missing: ${vendorPath}`);
  }
  const dirty = gitOutput(vendorPath, ["status", "--porcelain"]).trim();
  if (dirty) {
    throw new Error(`Vendor worktree is dirty: ${vendorPath}`);
  }
  const branch = gitOutput(vendorPath, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (branch !== lock.branch.name) {
    throw new Error(`Vendor worktree branch mismatch: expected ${lock.branch.name}, got ${branch}`);
  }
  if (options.requirePatchesMatch && !branchMatchesPatches(lock, vendorPath)) {
    throw new Error("Current branch state does not match patches/opencode.");
  }
}

function verifyBranchMatchesPatches(lock: LockFile) {
  ensureVendorBranchState(lock, { requirePatchesMatch: false });
  const vendorPath = path.resolve(repoRoot, lock.paths.vendor);
  if (!branchMatchesPatches(lock, vendorPath)) {
    throw new Error("Exported patch series is not reproducible from the current branch.");
  }
}

function branchMatchesPatches(lock: LockFile, vendorPath: string) {
  const cleanroomPath = path.resolve(repoRoot, lock.paths.cleanroom);
  if (!isGitRepository(cleanroomPath)) {
    return false;
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-opencode-branch-match-"));
  try {
    const compareWorktree = path.join(tempDir, "vendor");
    run(["git", "worktree", "add", "--detach", compareWorktree, lock.upstream.commit], cleanroomPath);
    const patches = patchFiles(path.resolve(repoRoot, lock.paths.patches));
    if (patches.length > 0) {
      run(["git", "am", "--3way", ...patches], compareWorktree, { env: gitAmEnv() });
    }
    const compareTree = gitOutput(compareWorktree, ["rev-parse", "HEAD^{tree}"]).trim();
    const vendorTree = gitOutput(vendorPath, ["rev-parse", "HEAD^{tree}"]).trim();
    return compareTree === vendorTree;
  } finally {
    const compareWorktree = path.join(tempDir, "vendor");
    if (existsSync(compareWorktree)) {
      run(["git", "worktree", "remove", "--force", compareWorktree], cleanroomPath, { allowFailure: true });
      run(["git", "worktree", "prune"], cleanroomPath, { allowFailure: true });
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function verifyPatchReproducibility(
  lock: LockFile,
  options: {
    baseCommit: string;
    compareDir: string;
    cleanroomOverride?: string;
  },
) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-opencode-repro-"));
  try {
    const cleanroomPath = options.cleanroomOverride ?? path.join(tempRoot, "cleanroom");
    if (!options.cleanroomOverride) {
      cloneUpstreamForValidation(lock, cleanroomPath);
    }
    run(["git", "checkout", "--detach", options.baseCommit], cleanroomPath);
    const compareWorktree = path.join(tempRoot, "vendor");
    run(["git", "worktree", "add", "--detach", compareWorktree, options.baseCommit], cleanroomPath);
    const patches = patchFiles(path.resolve(repoRoot, lock.paths.patches));
    if (patches.length > 0) {
      run(["git", "am", "--3way", ...patches], compareWorktree, { env: gitAmEnv() });
    }
    compareDirectories(compareWorktree, options.compareDir);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function cloneUpstreamForValidation(lock: LockFile, destination: string) {
  run(
    [
      "git",
      "clone",
      "--branch",
      lock.upstream.tag,
      "--single-branch",
      "--filter=blob:none",
      lock.upstream.remote,
      destination,
    ],
    repoRoot,
  );
}

function compareDirectories(left: string, right: string) {
  if (isGitRepository(left) && isGitRepository(right)) {
    const leftDirty = gitOutput(left, ["status", "--porcelain", "--untracked-files=no"]).trim();
    const rightDirty = gitOutput(right, ["status", "--porcelain", "--untracked-files=no"]).trim();
    if (leftDirty || rightDirty) {
      throw new Error("Tracked file changes detected while verifying patch reproducibility.");
    }
    const leftTree = gitOutput(left, ["rev-parse", "HEAD^{tree}"]).trim();
    const rightTree = gitOutput(right, ["rev-parse", "HEAD^{tree}"]).trim();
    if (leftTree !== rightTree) {
      throw new Error(`Patch reproducibility tree mismatch: ${leftTree} != ${rightTree}`);
    }
    return;
  }
  run(["diff", "-qr", "--exclude", ".git", left, right], repoRoot);
}

function patchFiles(patchesPath: string) {
  if (!existsSync(patchesPath)) {
    return [];
  }
  return readdirSync(patchesPath)
    .filter((entry) => entry.endsWith(".patch"))
    .sort()
    .map((entry) => path.join(patchesPath, entry));
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

function bunInstallEnv() {
  return {
    ...process.env,
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_API_URL: "https://api.github.com",
  };
}

function runValidation(vendorPath: string, options?: { includeRepoValidation?: boolean }) {
  const includeRepoValidation =
    options?.includeRepoValidation ?? path.resolve(vendorPath) === path.resolve(repoRoot, readLock().paths.vendor);
  run(["bun", "install", "--cwd", vendorPath], repoRoot, { env: bunInstallEnv() });
  run(["bun", "run", "typecheck"], path.join(vendorPath, "packages", "app"));
  run(["bun", "run", "build"], path.join(vendorPath, "packages", "app"));
  run(
    ["bun", "test", "test/cli/plugin-auth-picker.test.ts", "test/plugin/module-exports.test.ts"],
    path.join(vendorPath, "packages", "opencode"),
  );
  if (includeRepoValidation) {
    run(["bun", "run", "build"], repoRoot);
    run(["bun", "run", "typecheck"], repoRoot);
  }
}

function normalizeTag(tag: string) {
  return tag.startsWith("v") ? tag : `v${tag}`;
}

function stripLeadingV(tag: string) {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

function isGitRepository(targetPath: string) {
  if (!existsSync(targetPath)) {
    return false;
  }
  const result = run(["git", "rev-parse", "--is-inside-work-tree"], targetPath, { allowFailure: true });
  return result.status === 0;
}

function gitIsPristine(targetPath: string) {
  return gitOutput(targetPath, ["status", "--porcelain"]).trim() === "";
}

function gitOutput(cwd: string, args: string[]) {
  return run(["git", ...args], cwd).stdout;
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

function run(command: string[], cwd: string, options: ExecOptions = {}) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: options.cwd ?? cwd,
    env: sanitizedEnv(options.env ?? process.env),
    encoding: "utf8",
  });
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(
      `Command failed: ${command.join(" ")}\n${stderr || stdout || `exit ${result.status ?? "unknown"}`}`,
    );
  }
  return {
    status: result.status ?? 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
