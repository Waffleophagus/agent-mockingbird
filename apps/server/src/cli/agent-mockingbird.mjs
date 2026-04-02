#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  opencodeEnvironment,
  pathsFor,
  prepareRuntimeAssetSources,
} from "./runtime-layout.mjs";
import { syncRuntimeWorkspaceAssets } from "./runtime-assets.mjs";

const { console, fetch } = globalThis;

const DEFAULT_SCOPE = "waffleophagus";
const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org/";
const PUBLIC_NPM_REGISTRY = "https://registry.npmjs.org/";
const DEFAULT_TAG = "latest";
const PACKAGE_NAME = "agent-mockingbird";
const DEFAULT_ROOT_DIR = path.join(os.homedir(), ".agent-mockingbird");
const USER_UNIT_DIR = path.join(os.homedir(), ".config", "systemd", "user");
const UNIT_EXECUTOR = "executor.service";
const UNIT_OPENCODE = "opencode.service";
const UNIT_AGENT_MOCKINGBIRD = "agent-mockingbird.service";
const AGENT_MOCKINGBIRD_API_BASE_URL = "http://127.0.0.1:3001";
const DEFAULT_ENABLED_SKILLS = [
  "config-editor",
  "config-auditor",
  "runtime-diagnose",
  "memory-ops",
];
const MODULE_PATH = fileURLToPath(import.meta.url);
const MODULE_DIR = path.dirname(MODULE_PATH);

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function parseArgs(argv) {
  const args = {
    command: undefined,
    positionals: [],
    yes: false,
    json: false,
    dryRun: false,
    skipLinger: false,
    purgeData: false,
    keepData: false,
    registryUrl: DEFAULT_REGISTRY_URL,
    scope: DEFAULT_SCOPE,
    tag: DEFAULT_TAG,
    version: undefined,
    tagExplicit: false,
    versionExplicit: false,
    rootDir: DEFAULT_ROOT_DIR,
    legacyImportFlags: [],
  };

  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--yes" || arg === "-y") {
      args.yes = true;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--skip-linger") {
      args.skipLinger = true;
      continue;
    }
    if (arg === "--purge-data") {
      args.purgeData = true;
      continue;
    }
    if (arg === "--keep-data") {
      args.keepData = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.command = "help";
      continue;
    }
    if (arg === "--next") {
      args.tag = "next";
      args.tagExplicit = true;
      continue;
    }
    if (arg === "--latest") {
      args.tag = "latest";
      args.tagExplicit = true;
      continue;
    }
    if (arg === "--skip-memory-sync") {
      args.legacyImportFlags.push(arg);
      continue;
    }
    const next = argv[i + 1];
    if ((arg === "--registry-url" || arg === "--registry") && next) {
      args.registryUrl = next;
      i += 1;
      continue;
    }
    if (arg === "--scope" && next) {
      args.scope = next;
      i += 1;
      continue;
    }
    if (arg === "--tag" && next) {
      args.tag = next;
      args.tagExplicit = true;
      i += 1;
      continue;
    }
    if (arg === "--version" && next) {
      args.version = next;
      args.versionExplicit = true;
      i += 1;
      continue;
    }
    if (arg === "--root-dir" && next) {
      args.rootDir = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--git" && next) {
      args.legacyImportFlags.push(arg, next);
      i += 1;
      continue;
    }
    if (arg === "--path" && next) {
      args.legacyImportFlags.push(arg, next);
      i += 1;
      continue;
    }
    if (arg === "--ref" && next) {
      args.legacyImportFlags.push(arg, next);
      i += 1;
      continue;
    }
    if (arg === "--target-dir" && next) {
      args.legacyImportFlags.push(arg, next);
      i += 1;
      continue;
    }
    if (arg === "--preview-id" && next) {
      args.legacyImportFlags.push(arg, next);
      i += 1;
      continue;
    }
    if (arg === "--overwrite" && next) {
      args.legacyImportFlags.push(arg, next);
      i += 1;
      continue;
    }
    if (arg === "--skip-path" && next) {
      args.legacyImportFlags.push(arg, next);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (positionals.length > 0) {
    args.positionals = positionals;
    if (positionals[0] === "import" && positionals[1] === "openclaw") {
      args.command = "import-openclaw-legacy";
    } else {
      args.command = positionals[0];
    }
  }

  args.registryUrl = normalizeRegistryUrl(args.registryUrl);
  return args;
}

function readRootDirArg(argv = process.argv.slice(2)) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root-dir" && argv[index + 1]) {
      return path.resolve(argv[index + 1]);
    }
  }
  return null;
}

function resolveManagedCliDelegationTarget({
  argv = process.argv,
  env = process.env,
} = {}) {
  const rootDir =
    readRootDirArg(argv.slice(2)) ||
    (env.AGENT_MOCKINGBIRD_ROOT_DIR || "").trim() ||
    DEFAULT_ROOT_DIR;
  const managedCliPath = resolveManagedCliPathForRoot(rootDir);
  if (!fs.existsSync(managedCliPath)) {
    return null;
  }
  return managedCliPath;
}

function normalizeRegistryUrl(url) {
  const trimmed = (url || "").trim();
  if (!trimmed) {
    return DEFAULT_REGISTRY_URL;
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function printHelp() {
  console.log(
    `agent-mockingbird\n\nUsage:\n  agent-mockingbird <install|update|onboard|status|restart|start|stop|uninstall> [flags]\n\nFlags:\n  --registry-url <url>   Scoped npm registry (default: ${DEFAULT_REGISTRY_URL})\n  --scope <scope>        Package scope (default: ${DEFAULT_SCOPE})\n  --tag <tag>            Dist-tag when --version not set (default: installed package version, otherwise ${DEFAULT_TAG})\n  --next                 Shortcut for --tag next\n  --latest               Shortcut for --tag latest\n  --version <version>    Exact agent-mockingbird version\n  --root-dir <path>      Install root (default: ${DEFAULT_ROOT_DIR})\n  --yes, -y              Non-interactive\n  --json                 JSON output\n  --dry-run              Preview update actions without mutating (update only)\n  --skip-linger          Skip loginctl enable-linger\n  --purge-data           Uninstall: remove ${DEFAULT_ROOT_DIR}/data and workspace\n  --keep-data            Uninstall: keep data/workspace even when --yes\n  --help, -h             Show help`,
  );
}

function colorEnabled() {
  return process.stdout.isTTY && !process.env.NO_COLOR;
}

function paint(text, color) {
  if (!colorEnabled()) return text;
  return `${color}${text}${ANSI.reset}`;
}

function heading(text) {
  return paint(text, `${ANSI.bold}${ANSI.cyan}`);
}

function info(text) {
  return paint(text, ANSI.dim);
}

function success(text) {
  return paint(text, ANSI.green);
}

function warn(text) {
  return paint(text, ANSI.yellow);
}

function errorText(text) {
  return paint(text, ANSI.red);
}

function summarizeActionPlan(title, lines) {
  return [heading(title), ...lines];
}

function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function shell(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: options.env ?? process.env,
    cwd: options.cwd,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function must(command, args, options = {}) {
  const result = shell(command, args, options);
  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result;
}

function commandExists(command) {
  const result = shell("bash", ["-lc", `command -v ${command}`]);
  return result.code === 0;
}

function resolvePackageManager() {
  if (commandExists("npm")) {
    return "npm";
  }
  if (commandExists("bun")) {
    return "bun";
  }
  return null;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readRunningPackageVersion(moduleDir = MODULE_DIR) {
  const candidatePaths = [
    path.resolve(moduleDir, "../package.json"),
    path.resolve(moduleDir, "../../../../package.json"),
  ];

  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }
    try {
      const parsed = readJson(candidatePath);
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return parsed.version.trim();
      }
    } catch {
      // Ignore unreadable package metadata and continue searching.
    }
  }

  return "";
}

function applyDefaultInstallTarget(args, moduleDir = MODULE_DIR) {
  if (args.versionExplicit || args.tagExplicit) {
    return args;
  }

  const runningVersion = readRunningPackageVersion(moduleDir);
  if (runningVersion) {
    args.version = runningVersion;
  }

  return args;
}

async function promptRuntimeAssetConflictDecision(conflict) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return "use-packaged";
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    while (true) {
      const answer = (
        await rl.question(
          `runtime-assets conflict for ${conflict.relativePath}\n  [k]eep local or [u]se packaged? [k/u] `,
        )
      )
        .trim()
        .toLowerCase();
      if (answer === "k" || answer === "keep" || answer === "keep-local") {
        return "keep-local";
      }
      if (answer === "u" || answer === "use" || answer === "use-packaged") {
        return "use-packaged";
      }
    }
  } finally {
    rl.close();
  }
}

async function ensureDefaultRuntimeSkillsWhenEmpty(input = {}) {
  const retries =
    typeof input.retries === "number" ? Math.max(1, input.retries) : 5;
  const delayMs =
    typeof input.delayMs === "number" ? Math.max(100, input.delayMs) : 750;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const skillsResponse = await fetch(
        `${AGENT_MOCKINGBIRD_API_BASE_URL}/api/config/skills`,
        { method: "GET" },
      );
      if (!skillsResponse.ok) {
        throw new Error(
          `GET /api/config/skills failed (${skillsResponse.status})`,
        );
      }
      const payload = await skillsResponse.json();
      const currentSkills = Array.isArray(payload?.skills)
        ? payload.skills.filter(
            (value) => typeof value === "string" && value.trim().length > 0,
          )
        : [];
      if (currentSkills.length > 0) {
        return {
          attempted: true,
          updated: false,
          reason: "existing skills preserved",
          skills: currentSkills,
        };
      }

      const catalogResponse = await fetch(
        `${AGENT_MOCKINGBIRD_API_BASE_URL}/api/config/skills/catalog`,
        { method: "GET" },
      );
      if (!catalogResponse.ok) {
        throw new Error(
          `GET /api/config/skills/catalog failed (${catalogResponse.status})`,
        );
      }
      const catalogPayload = await catalogResponse.json();
      const availableSkillIds = Array.isArray(catalogPayload?.skills)
        ? catalogPayload.skills
            .map((skill) =>
              skill && typeof skill.id === "string" ? skill.id.trim() : "",
            )
            .filter((value) => value.length > 0)
        : [];
      const defaultsToEnable = DEFAULT_ENABLED_SKILLS.filter((id) =>
        availableSkillIds.includes(id),
      );
      if (defaultsToEnable.length === 0) {
        return {
          attempted: true,
          updated: false,
          reason: "no default runtime skills available in catalog",
          skills: [],
        };
      }

      const expectedHash =
        typeof payload?.hash === "string" ? payload.hash.trim() : "";

      const updateResponse = await fetch(
        `${AGENT_MOCKINGBIRD_API_BASE_URL}/api/config/skills`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            skills: defaultsToEnable,
            expectedHash: expectedHash || undefined,
          }),
        },
      );

      const updatePayload = await updateResponse.json().catch(() => ({}));
      if (!updateResponse.ok) {
        const message =
          typeof updatePayload?.error === "string"
            ? updatePayload.error
            : `PUT /api/config/skills failed (${updateResponse.status})`;
        throw new Error(message);
      }

      const nextSkills = Array.isArray(updatePayload?.skills)
        ? updatePayload.skills
        : defaultsToEnable;
      return {
        attempted: true,
        updated: true,
        reason: "initialized defaults",
        skills: nextSkills,
      };
    } catch (error) {
      if (attempt === retries) {
        return {
          attempted: true,
          updated: false,
          reason: error instanceof Error ? error.message : String(error),
          skills: [],
        };
      }
      await sleep(delayMs);
    }
  }

  return {
    attempted: false,
    updated: false,
    reason: "skipped",
    skills: [],
  };
}

function userName() {
  return process.env.USER || process.env.LOGNAME || os.userInfo().username;
}

function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveAgentMockingbirdAppDir(paths) {
  return firstExistingPath([
    paths.agentMockingbirdAppDirGlobal,
    paths.agentMockingbirdAppDirLocal,
    paths.agentMockingbirdAppDirScopedGlobal,
    paths.agentMockingbirdAppDirScopedLocal,
    paths.agentMockingbirdAppDirBunGlobal,
    paths.agentMockingbirdAppDirScopedBunGlobal,
  ]);
}

function resolveInstalledPackageDir(paths, packageName) {
  const npmGlobal = typeof paths.npmPrefix === "string"
    ? path.join(paths.npmPrefix, "lib", "node_modules", packageName)
    : null;
  const npmLocal = typeof paths.npmPrefix === "string"
    ? path.join(paths.npmPrefix, "node_modules", packageName)
    : null;
  const bunGlobal = typeof paths.bunInstallDir === "string"
    ? path.join(paths.bunInstallDir, "install", "global", "node_modules", packageName)
    : null;
  return firstExistingPath([npmGlobal, npmLocal, bunGlobal]);
}

function resolveManagedCliPathForAppDir(agentMockingbirdAppDir) {
  return firstExistingPath([
    path.join(agentMockingbirdAppDir, "bin", "agent-mockingbird-managed"),
    path.join(agentMockingbirdAppDir, "apps", "server", "src", "cli", "agent-mockingbird.mjs"),
  ]);
}

function resolveManagedCliPathForRoot(rootDir, scope = DEFAULT_SCOPE) {
  const paths = pathsFor({
    rootDir,
    scope,
    userUnitDir: USER_UNIT_DIR,
  });
  const agentMockingbirdAppDir = resolveAgentMockingbirdAppDir(paths);
  if (!agentMockingbirdAppDir) {
    return null;
  }
  return resolveManagedCliPathForAppDir(agentMockingbirdAppDir);
}

function resolveAgentMockingbirdServiceEntrypoint(agentMockingbirdAppDir) {
  const pkgPath = path.join(agentMockingbirdAppDir, "package.json");
  const candidates = [];
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = readJson(pkgPath);
      if (typeof pkg.module === "string") {
        candidates.push(pkg.module);
      }
      if (typeof pkg.main === "string") {
        candidates.push(pkg.main);
      }
    } catch {
      // Ignore parse errors and fall back to static candidates.
    }
  }

  candidates.push(
    "src/index.ts",
    "src/index.js",
    "dist/index.js",
    "index.js",
    "apps/server/src/index.ts",
    "apps/server/src/index.js",
    "apps/server/dist/index.js",
  );
  for (const relPath of candidates) {
    const absolutePath = path.join(agentMockingbirdAppDir, relPath);
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }
  return null;
}

function resolveOpencodeBin(paths) {
  return firstExistingPath([
    paths.opencodeBinGlobal,
    paths.opencodeBinLocal,
    paths.opencodeBinBunGlobal,
  ]);
}

function resolveExecutorBin(paths) {
  return firstExistingPath([
    paths.executorBinGlobal,
    paths.executorBinLocal,
    paths.executorBinBunGlobal,
  ]);
}

function resolveRequestedExecutorMode() {
  const configured = process.env.AGENT_MOCKINGBIRD_EXECUTOR_MODE?.trim();
  return configured === "upstream-fallback"
    ? "upstream-fallback"
    : "embedded-patched";
}

function resolvePackagedExecutorLayout(agentMockingbirdAppDir) {
  const packagedExecutorDir = path.join(
    agentMockingbirdAppDir,
    "vendor",
    "executor",
  );
  const packagedExecutorEntrypoint = path.join(
    packagedExecutorDir,
    "apps",
    "executor",
    "src",
    "cli",
    "main.ts",
  );
  const packagedExecutorNodeModules = path.join(
    packagedExecutorDir,
    "node_modules",
  );
  const packagedExecutorWebDir = path.join(
    packagedExecutorDir,
    "apps",
    "web",
  );
  const packagedExecutorWebAssetsDir = path.join(
    packagedExecutorWebDir,
    "dist",
  );

  return {
    packagedExecutorDir,
    packagedExecutorEntrypoint,
    packagedExecutorNodeModules,
    packagedExecutorWebDir,
    packagedExecutorWebAssetsDir,
    packagedExecutorWebIndex: path.join(
      packagedExecutorWebAssetsDir,
      "index.html",
    ),
  };
}

function resolvePackagedExecutorWebAssetsDir(agentMockingbirdAppDir) {
  const layout = resolvePackagedExecutorLayout(agentMockingbirdAppDir);
  return fs.existsSync(layout.packagedExecutorWebIndex)
    ? layout.packagedExecutorWebAssetsDir
    : null;
}

function resolveExecutorRuntimeCommand(
  agentMockingbirdAppDir,
  paths,
  bunBin,
  requestedMode = resolveRequestedExecutorMode(),
) {
  if (requestedMode === "upstream-fallback") {
    const executorBin = resolveExecutorBin(paths);
    if (!executorBin) {
      return null;
    }
    return {
      execStart: `${shellEscapeSystemdArg(executorBin)} server start --port 8788`,
      mode: "upstream-fallback",
      webAssetsDir: null,
    };
  }

  const {
    packagedExecutorEntrypoint,
    packagedExecutorNodeModules,
    packagedExecutorWebAssetsDir,
    packagedExecutorWebIndex,
  } = resolvePackagedExecutorLayout(agentMockingbirdAppDir);
  if (
    fs.existsSync(packagedExecutorEntrypoint) &&
    fs.existsSync(packagedExecutorNodeModules)
  ) {
    if (!fs.existsSync(packagedExecutorWebIndex)) {
      throw new Error(
        `embedded executor web assets missing: expected ${packagedExecutorWebIndex}. Install/update must build the vendored Executor web bundle before starting embedded mode.`,
      );
    }
    if (!bunBin) {
      throw new Error(
        "bun binary was not found for packaged vendored executor runtime.",
      );
    }
    return {
      execStart: `${shellEscapeSystemdArg(bunBin)} ${shellEscapeSystemdArg(packagedExecutorEntrypoint)} server start --port 8788`,
      mode: "embedded-patched",
      webAssetsDir: packagedExecutorWebAssetsDir,
    };
  }

  throw new Error(
    `embedded executor runtime missing: expected packaged vendored executor at ${packagedExecutorEntrypoint}. Set AGENT_MOCKINGBIRD_EXECUTOR_MODE=upstream-fallback only for explicit fallback mode.`,
  );
}

function ensurePackagedExecutorRuntime(agentMockingbirdAppDir, bunBin) {
  const layout = resolvePackagedExecutorLayout(agentMockingbirdAppDir);
  if (!fs.existsSync(layout.packagedExecutorEntrypoint)) {
    return null;
  }

  if (!fs.existsSync(layout.packagedExecutorNodeModules)) {
    const installArgs = ["install"];
    if (fs.existsSync(path.join(layout.packagedExecutorDir, "bun.lock"))) {
      installArgs.push("--frozen-lockfile");
    }
    must(bunBin, installArgs, {
      cwd: layout.packagedExecutorDir,
      env: {
        ...process.env,
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_API_URL: "https://api.github.com",
      },
    });
  }

  must(bunBin, ["x", "vite", "build", "--config", "vite.config.ts"], {
    cwd: layout.packagedExecutorWebDir,
    env: {
      ...process.env,
      EXECUTOR_WEB_BASE_PATH: "/executor",
      EXECUTOR_SERVER_BASE_PATH: "/executor",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_API_URL: "https://api.github.com",
    },
  });

  const packagedExecutorWebAssetsDir = resolvePackagedExecutorWebAssetsDir(
    agentMockingbirdAppDir,
  );
  if (!packagedExecutorWebAssetsDir) {
    throw new Error(
      `embedded executor web asset build did not produce ${layout.packagedExecutorWebIndex}`,
    );
  }

  return packagedExecutorWebAssetsDir;
}

function buildManagedOpenCodeInstallArgs(sourceDir) {
  const installArgs = ["install"];
  if (fs.existsSync(path.join(sourceDir, "bun.lock"))) {
    installArgs.push("--frozen-lockfile");
  }
  return installArgs;
}

function cleanupManagedOpenCodeConfigInstallArtifacts(input) {
  const rawSourceDir = input?.sourceDir;
  const rawTargetDir = input?.targetDir;
  const mode = input?.mode === "update" ? "update" : "install";
  const logger = typeof input?.logger === "function" ? input.logger : null;

  if (!rawSourceDir) {
    throw new Error("managed OpenCode config source directory is required");
  }
  if (!rawTargetDir) {
    throw new Error("managed OpenCode config target directory is required");
  }

  const sourceDir = path.resolve(String(rawSourceDir));
  const targetDir = path.resolve(String(rawTargetDir));

  const sourceLockPath = path.join(sourceDir, "bun.lock");
  const targetLockPath = path.join(targetDir, "bun.lock");
  const targetNodeModulesPath = path.join(targetDir, "node_modules");
  const targetBunCachePath = path.join(targetDir, ".bun");

  const summary = {
    cleanedLockfile: false,
    cleanedNodeModules: false,
    cleanedBunCache: false,
  };

  if (!fs.existsSync(sourceLockPath) && fs.existsSync(targetLockPath)) {
    fs.rmSync(targetLockPath, { force: true });
    summary.cleanedLockfile = true;
    if (logger) logger("managed-open-code-config: removed stale bun.lock");
  }

  if (mode === "install" && fs.existsSync(targetNodeModulesPath)) {
    fs.rmSync(targetNodeModulesPath, { recursive: true, force: true });
    summary.cleanedNodeModules = true;
    if (logger) logger("managed-open-code-config: removed stale node_modules");
  }

  if (mode === "install" && fs.existsSync(targetBunCachePath)) {
    fs.rmSync(targetBunCachePath, { recursive: true, force: true });
    summary.cleanedBunCache = true;
    if (logger) logger("managed-open-code-config: removed stale .bun");
  }

  return summary;
}

function candidateBunBinaryPaths(paths) {
  const candidates = [];
  const seen = new Set();
  const add = (value) => {
    if (!value) return;
    const resolved = path.resolve(value);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push(resolved);
  };

  if (commandExists("bun")) {
    const out = shell("bash", ["-lc", "command -v bun"]);
    add(out.stdout.trim());
  }

  add(paths.bunBinManagedGlobal);
  add(paths.bunBinManagedLocal);
  add(paths.bunBinTools);
  return candidates;
}

function readBunVersion(bunBin) {
  if (!bunBin || !fs.existsSync(bunBin)) {
    return null;
  }
  const result = shell(bunBin, ["--version"]);
  if (result.code !== 0) {
    return null;
  }
  const version = result.stdout.trim();
  return version || null;
}

function resolveBunBinary(paths, expectedVersion) {
  const candidates = candidateBunBinaryPaths(paths);
  if (!expectedVersion) {
    return candidates[0] ?? null;
  }

  let fallback = null;
  for (const candidate of candidates) {
    fallback ||= candidate;
    if (readBunVersion(candidate) === expectedVersion) {
      return candidate;
    }
  }
  return fallback;
}

function inspectBunRuntime(paths, expectedVersion) {
  const bunBin = resolveBunBinary(paths, expectedVersion);
  const actualVersion = readBunVersion(bunBin);
  return {
    bunBin,
    actualVersion,
    expectedVersion,
    present: Boolean(bunBin && actualVersion),
    matches: actualVersion === expectedVersion,
  };
}

function assertPinnedBunRuntime(paths, expectedVersion) {
  const runtime = inspectBunRuntime(paths, expectedVersion);
  if (runtime.matches && runtime.bunBin) {
    return runtime.bunBin;
  }

  const actualLabel = runtime.actualVersion
    ? `bun@${runtime.actualVersion} at ${runtime.bunBin}`
    : runtime.bunBin
      ? `unreadable bun binary at ${runtime.bunBin}`
      : "bun not found";
  throw new Error(
    `Pinned Bun runtime mismatch: expected bun@${expectedVersion}, found ${actualLabel}. Set AGENT_MOCKINGBIRD_BUN_VERSION only for an explicit override.`,
  );
}

function tryInstallBun(paths, bunVersion) {
  try {
    npmInstall(
      paths.npmPrefix,
      [`bun@${bunVersion}`],
      ["-g", "--registry", PUBLIC_NPM_REGISTRY],
    );
  } catch {
    // Fallback below.
  }
  if (inspectBunRuntime(paths, bunVersion).matches) {
    return;
  }

  if (!commandExists("curl")) {
    throw new Error(
      `bun@${bunVersion} is required and curl is unavailable for bun.com fallback install.`,
    );
  }

  ensureDir(path.join(paths.rootDir, "tools"));
  const fallback = shell(
    "bash",
    [
      "-lc",
      `curl -fsSL https://bun.com/install | BUN_INSTALL="${path.join(paths.rootDir, "tools", "bun")}" bash`,
    ],
    { stdio: "inherit" },
  );
  if (fallback.code !== 0 || !inspectBunRuntime(paths, bunVersion).matches) {
    throw new Error(
      `Failed to install pinned bun@${bunVersion} via npm and bun.com install script fallback.`,
    );
  }
}

function writeScopedNpmrc(paths, scope, registryUrl) {
  const normalizedScope = scope.replace(/^@/, "");
  writeFile(
    paths.npmrcPath,
    `registry=${PUBLIC_NPM_REGISTRY}\n@${normalizedScope}:registry=${registryUrl}\n`,
  );
}

function npmInstall(prefix, packages, extraArgs = [], env = process.env) {
  const args = [
    "install",
    "--no-audit",
    "--no-fund",
    "--prefix",
    prefix,
    ...extraArgs,
    ...packages,
  ];
  must("npm", args, { stdio: "inherit", env });
}

function bunInstall(
  installDir,
  packages,
  extraArgs = [],
  env = process.env,
  bunCommand = "bun",
) {
  const args = ["install", "--global", ...extraArgs, ...packages];
  must(bunCommand, args, {
    stdio: "inherit",
    env: {
      ...env,
      BUN_INSTALL: installDir,
    },
  });
}

function installManagedPackage(
  packageManager,
  paths,
  packages,
  extraArgs = [],
  env = process.env,
  options = {},
) {
  if (packageManager === "bun") {
    bunInstall(
      paths.bunInstallDir,
      packages,
      extraArgs,
      env,
      options.bunCommand,
    );
    return;
  }
  npmInstall(paths.npmPrefix, packages, extraArgs, env);
}

function ensurePathExportInFile(filePath, exportLine) {
  const exists = fs.existsSync(filePath);
  const content = exists ? fs.readFileSync(filePath, "utf8") : "";
  if (content.includes(exportLine) || content.includes(".local/bin")) {
    return false;
  }
  const suffix = content.length === 0 || content.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(filePath, `${suffix}${exportLine}\n`, "utf8");
  return true;
}

function ensureLocalBinPath(paths) {
  const entries = (process.env.PATH || "").split(":");
  if (entries.includes(paths.localBinDir)) {
    return { inPath: true, updatedFiles: [] };
  }

  const exportLine = `export PATH="${paths.localBinDir}:$PATH"`;
  const rcFiles = [".bashrc", ".zshrc", ".profile"].map((name) =>
    path.join(os.homedir(), name),
  );
  const updatedFiles = [];
  for (const rc of rcFiles) {
    if (fs.existsSync(rc) && ensurePathExportInFile(rc, exportLine)) {
      updatedFiles.push(rc);
    }
  }

  if (updatedFiles.length === 0) {
    const profile = path.join(os.homedir(), ".profile");
    if (ensurePathExportInFile(profile, exportLine)) {
      updatedFiles.push(profile);
    }
  }

  return { inPath: false, updatedFiles };
}

function resolveCurrentAgentMockingbirdCommandPath() {
  const resolvedCommand = shell("bash", ["-lc", "command -v agent-mockingbird"]);
  if (resolvedCommand.code !== 0) {
    return "";
  }
  return resolvedCommand.stdout.trim();
}

function collectCommandResolution({ rootDir, scope }) {
  const managedCliPath = resolveManagedCliPathForRoot(rootDir, scope);
  const commandPath = resolveCurrentAgentMockingbirdCommandPath();
  const normalizedCommandPath = commandPath ? path.resolve(commandPath) : "";
  const normalizedManagedCliPath = managedCliPath ? path.resolve(managedCliPath) : "";
  let mode = "unresolved";
  if (normalizedCommandPath && normalizedManagedCliPath) {
    mode =
      normalizedCommandPath === normalizedManagedCliPath
        ? "managed-direct"
        : "bootstrap-wrapper";
  } else if (normalizedManagedCliPath) {
    mode = "managed-only";
  } else if (normalizedCommandPath) {
    mode = "bootstrap-only";
  }

  return {
    rootDir,
    managedCliPath: managedCliPath ?? "",
    commandPath,
    mode,
  };
}

function writeAgentMockingbirdShim(
  paths,
  managedCliPath,
  opencodePackageVersion,
) {
  ensureDir(paths.localBinDir);
  const shim = `#!/usr/bin/env bash
set -euo pipefail
# managed-by: agent-mockingbird-installer
export AGENT_MOCKINGBIRD_OPENCODE_VERSION=${JSON.stringify(opencodePackageVersion)}
exec "${managedCliPath}" "$@"
`;
  writeFile(paths.agentMockingbirdShimPath, shim);
  fs.chmodSync(paths.agentMockingbirdShimPath, 0o755);
  return paths.agentMockingbirdShimPath;
}

function writeOpencodeShim(paths, opencodeBin) {
  ensureDir(paths.localBinDir);
  const shim = `#!/usr/bin/env bash
set -euo pipefail
# managed-by: agent-mockingbird-installer
export OPENCODE_CONFIG_DIR=${JSON.stringify(paths.opencodeConfigDir)}
export OPENCODE_DISABLE_PROJECT_CONFIG=1
exec "${opencodeBin}" "$@"
`;
  writeFile(paths.opencodeShimPath, shim);
  fs.chmodSync(paths.opencodeShimPath, 0o755);
  return paths.opencodeShimPath;
}

function removeAgentMockingbirdShim(paths) {
  if (!fs.existsSync(paths.agentMockingbirdShimPath)) {
    return false;
  }
  const content = fs.readFileSync(paths.agentMockingbirdShimPath, "utf8");
  if (!content.includes("managed-by: agent-mockingbird-installer")) {
    return false;
  }
  fs.rmSync(paths.agentMockingbirdShimPath, { force: true });
  return true;
}

function removeOpencodeShim(paths) {
  if (!fs.existsSync(paths.opencodeShimPath)) {
    return false;
  }
  const content = fs.readFileSync(paths.opencodeShimPath, "utf8");
  if (!content.includes("managed-by: agent-mockingbird-installer")) {
    return false;
  }
  fs.rmSync(paths.opencodeShimPath, { force: true });
  return true;
}

function shellEscapeSystemdArg(value) {
  return `"${String(value).replace(/(["\\$`])/g, "\\$1")}"`;
}

function hasCompiledDashboardAssets(agentMockingbirdAppDir) {
  return fs.existsSync(
    path.join(agentMockingbirdAppDir, "dist", "app", "index.html"),
  );
}

function hasCompiledAgentMockingbirdRuntime(agentMockingbirdAppDir) {
  return fs.existsSync(
    path.join(agentMockingbirdAppDir, "dist", "agent-mockingbird"),
  );
}

function resolveAgentMockingbirdRuntimeCommand(agentMockingbirdAppDir, bunBin) {
  const compiledBinary = path.join(
    agentMockingbirdAppDir,
    "dist",
    "agent-mockingbird",
  );
  if (
    hasCompiledAgentMockingbirdRuntime(agentMockingbirdAppDir) &&
    hasCompiledDashboardAssets(agentMockingbirdAppDir)
  ) {
    return {
      execStart: compiledBinary,
      mode: "compiled",
    };
  }

  const entrypoint = resolveAgentMockingbirdServiceEntrypoint(
    agentMockingbirdAppDir,
  );
  if (entrypoint && bunBin) {
    return {
      execStart: `${shellEscapeSystemdArg(bunBin)} ${shellEscapeSystemdArg(entrypoint)}`,
      mode: "source",
    };
  }

  return null;
}

function unitContents(
  paths,
  executorExecStart,
  executorMode,
  executorWebAssetsDir,
  agentMockingbirdExecStart,
  runtimeMode,
) {
  const executorWebAssetsEnvLine = executorWebAssetsDir
    ? `Environment=EXECUTOR_WEB_ASSETS_DIR=${executorWebAssetsDir}\n`
    : "";
  const executor = `[Unit]\nDescription=Executor Sidecar for Agent Mockingbird (user service)\nAfter=network.target\nWants=network.target\n\n[Service]\nType=simple\nWorkingDirectory=${paths.executorWorkspaceDir}\nEnvironment=EXECUTOR_DATA_DIR=${paths.executorDataDir}\nEnvironment=EXECUTOR_LOCAL_DATA_DIR=${paths.executorLocalDataDir}\nEnvironment=EXECUTOR_SERVER_PID_FILE=${path.join(paths.executorRunDir, "server.pid")}\nEnvironment=EXECUTOR_SERVER_LOG_FILE=${path.join(paths.executorRunDir, "server.log")}\nEnvironment=EXECUTOR_SERVER_BASE_PATH=/executor\n${executorWebAssetsEnvLine}ExecStart=${executorExecStart}\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n`;
  const agentMockingbird = `[Unit]\nDescription=Agent Mockingbird API and Dashboard (user service)\nAfter=network.target ${UNIT_EXECUTOR}\nWants=network.target ${UNIT_EXECUTOR}\n\n[Service]\nType=simple\nWorkingDirectory=${paths.rootDir}\nEnvironment=NODE_ENV=production\nEnvironment=PORT=3001\nEnvironment=AGENT_MOCKINGBIRD_CONFIG_PATH=${path.join(paths.dataDir, "agent-mockingbird.config.json")}\nEnvironment=AGENT_MOCKINGBIRD_DB_PATH=${path.join(paths.dataDir, "agent-mockingbird.db")}\nEnvironment=AGENT_MOCKINGBIRD_OPENCODE_BASE_URL=http://127.0.0.1:3001\nEnvironment=AGENT_MOCKINGBIRD_EXECUTOR_BASE_URL=http://127.0.0.1:8788\nEnvironment=AGENT_MOCKINGBIRD_EXECUTOR_ENABLED=true\nEnvironment=AGENT_MOCKINGBIRD_EXECUTOR_WORKSPACE_DIR=${paths.executorWorkspaceDir}\nEnvironment=AGENT_MOCKINGBIRD_EXECUTOR_DATA_DIR=${paths.executorDataDir}\nEnvironment=AGENT_MOCKINGBIRD_EXECUTOR_MODE=${executorMode}\nEnvironment=AGENT_MOCKINGBIRD_EXECUTOR_HEALTHCHECK_PATH=/executor\nEnvironment=AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL=http://127.0.0.1:3001\nEnvironment=AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR=${paths.workspaceDir}\nEnvironment=OPENCODE_CONFIG_DIR=${paths.opencodeConfigDir}\nEnvironment=OPENCODE_DISABLE_PROJECT_CONFIG=1\nEnvironment=OPENCODE_DISABLE_EXTERNAL_SKILLS=1\nEnvironment=AGENT_MOCKINGBIRD_RUNTIME_MODE=${runtimeMode}\nExecStart=${agentMockingbirdExecStart}\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n`;

  return { executor, agentMockingbird };
}

function ensureSystemdUserAvailable() {
  const result = shell("systemctl", ["--user", "status"]);
  if (result.code !== 0) {
    throw new Error(
      "systemd user services are unavailable (`systemctl --user status` failed)",
    );
  }
}

function ensureLinger(skipLinger) {
  if (skipLinger) {
    return { changed: false, skipped: true };
  }
  const user = userName();
  const status = shell("loginctl", ["show-user", user, "-p", "Linger"]);
  if (status.code !== 0) {
    return {
      changed: false,
      skipped: true,
      warning: "Could not read linger status via loginctl.",
    };
  }
  if (status.stdout.toLowerCase().includes("linger=yes")) {
    return { changed: false, skipped: false };
  }

  const direct = shell("loginctl", ["enable-linger", user]);
  if (direct.code === 0) {
    return { changed: true, skipped: false };
  }

  const sudo = shell("sudo", ["loginctl", "enable-linger", user], {
    stdio: "inherit",
  });
  if (sudo.code === 0) {
    return { changed: true, skipped: false };
  }

  return {
    changed: false,
    skipped: false,
    warning: `Failed to enable lingering automatically. Run: sudo loginctl enable-linger ${user}`,
  };
}

async function healthCheck(url) {
  try {
    const response = await fetch(url, { method: "GET" });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function healthCheckWithRetry(url, input = {}) {
  const attempts = Number.isFinite(input.attempts)
    ? Math.max(1, Math.trunc(input.attempts))
    : 6;
  const delayMs = Number.isFinite(input.delayMs)
    ? Math.max(50, Math.trunc(input.delayMs))
    : 500;
  let last = { ok: false, status: 0 };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await healthCheck(url);
    if (last.ok) {
      return last;
    }
    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }
  return last;
}

async function verifyEmbeddedExecutorGateway(baseUrl, fetchImpl = fetch) {
  try {
    const htmlResponse = await fetchImpl(baseUrl, { method: "GET" });
    const html = await htmlResponse.text();
    const stylesheetMatches = [
      ...html.matchAll(
        /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi,
      ),
    ];
    const stylesheetHref =
      stylesheetMatches
        .map((match) => match[1])
        .find((href) => href.startsWith("/executor/assets/")) ?? "";
    const scriptMatch = html.match(
      /<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i,
    );
    if (!htmlResponse.ok) {
      return {
        ok: false,
        pageOk: false,
        cssOk: false,
        scriptOk: false,
        pageStatus: htmlResponse.status,
        cssStatus: 0,
        scriptStatus: 0,
        cssUrl: "",
        scriptUrl: "",
        referencedFontCount: 0,
        error: `dashboard page returned ${htmlResponse.status}`,
      };
    }
    if (!scriptMatch) {
      return {
        ok: false,
        pageOk: htmlResponse.ok,
        cssOk: false,
        scriptOk: false,
        pageStatus: htmlResponse.status,
        cssStatus: 0,
        scriptStatus: 0,
        cssUrl: "",
        scriptUrl: "",
        referencedFontCount: 0,
        error: "dashboard HTML did not include a module script",
      };
    }

    const cssUrl = stylesheetHref
      ? new globalThis.URL(stylesheetHref, baseUrl).toString()
      : "";
    const scriptUrl = new globalThis.URL(scriptMatch[1], baseUrl).toString();
    const scriptResponse = await fetchImpl(scriptUrl, { method: "GET" });
    let cssResponse = { ok: true, status: 200 };
    let referencedFontUrls = [];
    if (cssUrl) {
      const response = await fetchImpl(cssUrl, { method: "GET" });
      const cssText = await response.text();
      cssResponse = response;
      referencedFontUrls = [
        ...cssText.matchAll(/url\((['"]?)([^'")]*\.woff2)\1\)/gi),
      ].map((match) => new globalThis.URL(match[2], cssUrl).toString());
    }
    const cssRequired = Boolean(cssUrl);
    const cssOk = !cssRequired || (cssResponse.ok && cssUrl.includes("/executor/assets/"));
    return {
      ok:
        htmlResponse.ok &&
        scriptResponse.ok &&
        cssOk &&
        scriptUrl.includes("/executor/assets/") &&
        !html.includes('"/assets/') &&
        !html.includes("'/assets/"),
      pageOk: htmlResponse.ok,
      cssOk,
      scriptOk: scriptResponse.ok && scriptUrl.includes("/executor/assets/"),
      pageStatus: htmlResponse.status,
      cssStatus: cssRequired ? cssResponse.status : 0,
      scriptStatus: scriptResponse.status,
      cssUrl,
      scriptUrl,
      referencedFontCount: referencedFontUrls.length,
      rootAssetLeakage:
        html.includes('"/assets/') || html.includes("'/assets/"),
      error: !cssResponse.ok
        ? `stylesheet returned ${cssResponse.status}`
        : !scriptResponse.ok
          ? `module script returned ${scriptResponse.status}`
          : cssRequired && !cssUrl.includes("/executor/assets/")
            ? "stylesheet is not served from /executor/assets/"
          : !scriptUrl.includes("/executor/assets/")
              ? "module script is not served from /executor/assets/"
            : html.includes('"/assets/') || html.includes("'/assets/")
                ? "executor HTML still references root /assets/"
                : "",
    };
  } catch (error) {
    return {
      ok: false,
      pageOk: false,
      cssOk: false,
      scriptOk: false,
      pageStatus: 0,
      cssStatus: 0,
      scriptStatus: 0,
      cssUrl: "",
      scriptUrl: "",
      referencedFontCount: 0,
      rootAssetLeakage: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifyEmbeddedExecutorGatewayWithRetry(baseUrl, input = {}) {
  const attempts =
    typeof input.attempts === "number"
      ? Math.max(1, Math.trunc(input.attempts))
      : 10;
  const delayMs =
    typeof input.delayMs === "number"
      ? Math.max(100, Math.trunc(input.delayMs))
      : 750;
  let last = await verifyEmbeddedExecutorGateway(baseUrl);
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    if (last.ok) {
      return last;
    }
    await sleep(delayMs);
    last = await verifyEmbeddedExecutorGateway(baseUrl);
  }
  return last;
}

async function runPostInstallVerification() {
  const agentMockingbirdStatus = shell("systemctl", [
    "--user",
    "status",
    UNIT_AGENT_MOCKINGBIRD,
    "--no-pager",
  ]);
  const executorStatus = shell("systemctl", [
    "--user",
    "status",
    UNIT_EXECUTOR,
    "--no-pager",
  ]);
  const linger = shell("loginctl", ["show-user", userName(), "-p", "Linger"]);
  const embeddedExecutor = await verifyEmbeddedExecutorGatewayWithRetry(
    "http://127.0.0.1:3001/executor",
    {
      attempts: 10,
      delayMs: 750,
    },
  );
  const externalProxy = await healthCheck(
    "http://127.0.0.1:3001/api/embed/external/executor/npm-registry/-/package/executor/dist-tags",
  );
  return {
    agentMockingbirdServiceOk: agentMockingbirdStatus.code === 0,
    executorServiceOk: executorStatus.code === 0,
    lingerOk:
      linger.code === 0 && linger.stdout.toLowerCase().includes("linger=yes"),
    embeddedExecutorOk: embeddedExecutor.ok,
    embeddedExecutor,
    externalProxyOk: externalProxy.ok,
    externalProxy,
    commandOutput: {
      agentMockingbirdStatus: (
        agentMockingbirdStatus.stdout || agentMockingbirdStatus.stderr
      ).trim(),
      executorStatus: (executorStatus.stdout || executorStatus.stderr).trim(),
      linger: (linger.stdout || linger.stderr).trim(),
    },
  };
}

function checkSystemdUserStatus() {
  const result = shell("systemctl", ["--user", "status"]);
  return result.code === 0;
}

function interactivePrompt(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return rl.question(message).finally(() => rl.close());
}

async function promptYesNo(message, defaultValue = false) {
  const suffix = defaultValue ? "[Y/n]" : "[y/N]";
  const answer = (await interactivePrompt(`${message} ${suffix} `))
    .trim()
    .toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes";
}

async function promptText(message, defaultValue = "") {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  const answer = (await interactivePrompt(`${message}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function promptSelect(message, options, defaultIndex = 0) {
  console.log(message);
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const marker = index === defaultIndex ? " (default)" : "";
    console.log(`  ${index + 1}. ${option.label}${marker}`);
    if (option.hint) {
      console.log(`     ${info(option.hint)}`);
    }
  }
  const raw = await interactivePrompt(`Select 1-${options.length}: `);
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > options.length) {
    return options[defaultIndex];
  }
  return options[parsed - 1];
}

function buildInstallSummary({ args, paths }) {
  const target = args.version ?? `tag:${args.tag}`;
  const opencodePackageVersion = readOpenCodePackageVersion();
  const pinnedBunVersion = readPinnedBunVersion({ paths });
  const bunRuntime = inspectBunRuntime(paths, pinnedBunVersion);
  const hasSystemdUser = checkSystemdUserStatus();
  const hasLoginctl = commandExists("loginctl");
  const hasCurl = commandExists("curl");
  const bunPlan = bunRuntime.matches
    ? `   - bun: ${success(`found bun@${pinnedBunVersion} at ${bunRuntime.bunBin}`)}`
    : bunRuntime.present
      ? `   - bun: ${warn(`found bun@${bunRuntime.actualVersion} at ${bunRuntime.bunBin}; will install pinned bun@${pinnedBunVersion}${hasCurl ? " with bun.com/install fallback" : ""}`)}`
      : `   - bun: ${warn(`not found, will install pinned bun@${pinnedBunVersion}${hasCurl ? " with bun.com/install fallback" : ""}`)}`;
  return summarizeActionPlan("Install plan", [
    `- Target package: ${PACKAGE_NAME} (${target})`,
    `- Private registry scope: @${args.scope.replace(/^@/, "")} -> ${args.registryUrl}`,
    `- Public registry fallback: ${PUBLIC_NPM_REGISTRY} (for non-scope deps, bun, executor, opencode-ai)`,
    `- Install root: ${paths.rootDir}`,
    "",
    "What will happen:",
    `1. Validate required tools: npm + systemd user services.`,
    `   - npm: ${commandExists("npm") ? success("found") : errorText("missing")}`,
    `   - systemctl --user: ${hasSystemdUser ? success("available") : errorText("unavailable")}`,
    "2. Ensure Bun runtime for service command.",
    bunPlan,
    `3. Install/refresh executor sidecar dependency (\`executor@${readExecutorPackageVersion()}\`) from npmjs.`,
    `4. Install/refresh OpenCode CLI dependency (\`opencode-ai@${opencodePackageVersion}\`) from npmjs.`,
    `5. Install Agent Mockingbird package (${PACKAGE_NAME}) from npm.`,
    "6. Create/refresh runtime directories under the install root.",
    `7. Install CLI shims at ${paths.agentMockingbirdShimPath} and ${paths.opencodeShimPath}, and ensure ${paths.localBinDir} is on PATH.`,
    `8. Seed workspace skills from bundled package into ${path.join(paths.workspaceDir, ".agents", "skills")}.`,
    "9. Build the packaged Executor embedded web bundle for /executor.",
    `10. Write user services: ${paths.executorUnitPath}, ${paths.opencodeUnitPath}, and ${paths.agentMockingbirdUnitPath}.`,
    "11. Reload systemd user daemon and enable/start all three services.",
    args.skipLinger
      ? "12. Skip linger configuration (--skip-linger set)."
      : `12. Attempt loginctl linger so services survive logout/reboot${hasLoginctl ? "" : " (loginctl missing; may require manual setup)"}.`,
    "13. Run health checks, and initialize default enabled skills if config has none.",
    "",
    info(
      "After install (interactive only), a provider onboarding wizard can launch OpenCode auth and set a default model.",
    ),
  ]);
}

function buildUpdateSummary({ args, paths }) {
  const target = args.version ?? `tag:${args.tag}`;
  const pinnedBunVersion = readPinnedBunVersion({ paths });
  const bunRuntime = inspectBunRuntime(paths, pinnedBunVersion);
  const hasSystemdUser = checkSystemdUserStatus();
  const hasLoginctl = commandExists("loginctl");
  const hasCurl = commandExists("curl");
  const bunStatus = bunRuntime.matches
    ? success(`already present as bun@${pinnedBunVersion}`)
    : bunRuntime.present
      ? warn(`found bun@${bunRuntime.actualVersion}; will install pinned bun@${pinnedBunVersion}${hasCurl ? " with curl fallback" : ""}`)
      : warn(`will install pinned bun@${pinnedBunVersion}${hasCurl ? " with curl fallback" : ""}`);
  return summarizeActionPlan("Update plan", [
    `- Update target: ${PACKAGE_NAME} (${target})`,
    `- Install root: ${paths.rootDir}`,
    "",
    "What this update does:",
    "1. Refresh Agent Mockingbird package + executor + OpenCode sidecar dependencies.",
    `2. Ensure pinned Bun runtime is available (${bunStatus}).`,
    "3. Re-seed workspace skills from bundled package.",
    "4. Rebuild the packaged Executor embedded web bundle for /executor.",
    "5. Re-write CLI shim + systemd user units to current paths/entrypoint.",
    "   - Includes agent-mockingbird + opencode shims in ~/.local/bin",
    "6. Reload daemon, enable/start services, then force restart all sidecars.",
    args.skipLinger
      ? "7. Skip linger configuration (--skip-linger set)."
      : `7. Re-check linger and enable when missing${hasLoginctl ? "" : " (loginctl missing; may require manual setup)"}.`,
    "8. Run health + service verification, and initialize default enabled skills if config has none.",
    "",
    "What this update does not do:",
    `- It does not wipe ${paths.dataDir} or ${paths.workspaceDir}.`,
    "- It does not uninstall/recreate services from scratch unless unit contents changed.",
    "- It does not reset runtime configuration, DB data, sessions, skills, or agents.",
    `- It does not rerun full onboarding unless you manually run ${paint("agent-mockingbird install", ANSI.bold)} again.`,
    "",
    `Precheck: systemctl --user ${hasSystemdUser ? success("available") : errorText("unavailable (update will fail)")}`,
  ]);
}

function buildUpdateDryRun({ args, paths }) {
  const target = args.version ?? `tag:${args.tag}`;
  const pinnedBunVersion = readPinnedBunVersion({ paths });
  const bunRuntime = inspectBunRuntime(paths, pinnedBunVersion);
  const hasSystemdUser = checkSystemdUserStatus();
  const hasLoginctl = commandExists("loginctl");

  const actions = [
    `Refresh package ${PACKAGE_NAME} (${target})`,
    "Refresh executor dependency",
    "Refresh opencode-ai dependency",
    bunRuntime.matches
      ? `Reuse existing pinned Bun runtime (bun@${pinnedBunVersion})`
      : bunRuntime.present
        ? `Install pinned Bun runtime bun@${pinnedBunVersion} because bun@${bunRuntime.actualVersion} is not accepted`
        : `Install pinned Bun runtime bun@${pinnedBunVersion}`,
    "Reseed workspace skills from bundled package",
    "Build packaged Executor embedded web bundle for /executor",
    "Rewrite agent-mockingbird CLI shim",
    "Rewrite opencode CLI shim",
    "Rewrite systemd user unit files for executor + agent-mockingbird",
    "Disable and remove any stale opencode.service user unit",
    "systemctl --user daemon-reload + enable --now executor.service agent-mockingbird.service",
    "systemctl --user restart executor.service agent-mockingbird.service",
    args.skipLinger
      ? "Skip loginctl linger step (--skip-linger)"
      : "Check/enable loginctl linger when needed",
    `GET ${AGENT_MOCKINGBIRD_API_BASE_URL}/api/health`,
    "Run service verification checks",
    "Initialize default enabled skills if runtime config currently has none",
  ];

  const nonActions = [
    `No deletion of ${paths.dataDir} or ${paths.workspaceDir}`,
    "No reset of config, DB, sessions, skills, MCPs, or agents",
    "No onboarding rerun",
  ];

  return {
    mode: "update-dry-run",
    rootDir: paths.rootDir,
    registryUrl: args.registryUrl,
    target,
    precheck: {
      npm: commandExists("npm"),
      systemdUser: hasSystemdUser,
      loginctl: hasLoginctl,
      bunExpectedVersion: pinnedBunVersion,
      bunPresent: bunRuntime.present,
      bunVersionMatch: bunRuntime.matches,
      bunActualVersion: bunRuntime.actualVersion,
    },
    actions,
    nonActions,
  };
}

async function runOnboardingCommand(args) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Onboarding command requires an interactive TTY.");
  }
  const paths = pathsFor({
    rootDir: args.rootDir,
    scope: args.scope,
    userUnitDir: USER_UNIT_DIR,
  });
  const opencodeBin =
    resolveOpencodeBin(paths) ??
    (commandExists("opencode") ? "opencode" : null);
  if (!opencodeBin) {
    throw new Error(
      "opencode binary not found. Run `agent-mockingbird install` first.",
    );
  }
  const onboarding = await runInteractiveProviderOnboarding({
    opencodeBin,
    workspaceDir: paths.workspaceDir,
  });
  return {
    mode: "onboard",
    rootDir: paths.rootDir,
    onboarding,
  };
}

async function migrateOpenclawWorkspace(input) {
  const response = await fetch(
    `${AGENT_MOCKINGBIRD_API_BASE_URL}/api/config/opencode/bootstrap/import-openclaw`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: input.source,
        targetDirectory: input.targetDirectory || undefined,
      }),
    },
  );
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : "Failed to migrate OpenClaw workspace";
    throw new Error(message);
  }
  return payload.migration ?? {};
}

async function fetchMemoryStatus() {
  const response = await fetch(
    `${AGENT_MOCKINGBIRD_API_BASE_URL}/api/memory/status`,
    { method: "GET" },
  );
  if (!response.ok) return null;
  const payload = await response.json();
  return payload?.status ?? null;
}

async function syncMemoryNow() {
  const response = await fetch(
    `${AGENT_MOCKINGBIRD_API_BASE_URL}/api/memory/sync`,
    { method: "POST" },
  );
  if (!response.ok) {
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    throw new Error(
      typeof payload?.error === "string" ? payload.error : "Memory sync failed",
    );
  }
}

async function confirmInstall(args, paths, mode) {
  if (args.yes) {
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Install is interactive by default. Re-run with --yes in non-interactive environments.",
    );
  }

  const summaryLines =
    mode === "update"
      ? buildUpdateSummary({ args, paths })
      : buildInstallSummary({ args, paths });
  for (const line of summaryLines) {
    console.log(line);
  }
  console.log("");

  const proceed = await promptYesNo(
    `Proceed with ${mode === "update" ? "update" : "install"}?`,
    false,
  );
  if (!proceed) {
    throw new Error("Aborted by user.");
  }
}

function packageSpec(_scope, version, tag) {
  const target = version || tag;
  return `${PACKAGE_NAME}@${target}`;
}

function readInstalledVersion(paths) {
  const appDir = resolveAgentMockingbirdAppDir(paths);
  if (!appDir) {
    return null;
  }
  return readPackageVersion(path.join(appDir, "package.json"));
}

function readPackageVersion(pkgPath) {
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  return readJson(pkgPath).version ?? null;
}

function readPackagedOpenCodeVersion(paths) {
  const appDir = resolveAgentMockingbirdAppDir(paths);
  if (!appDir) {
    return null;
  }
  return readPackageVersion(
    path.join(appDir, "vendor", "opencode", "packages", "opencode", "package.json"),
  );
}

function readPackagedExecutorVersion(paths) {
  const appDir = resolveAgentMockingbirdAppDir(paths);
  if (!appDir) {
    return null;
  }
  return readPackageVersion(
    path.join(appDir, "vendor", "executor", "apps", "executor", "package.json"),
  );
}

function readInstalledOpenCodeVersion(paths) {
  const installedPackageDir = resolveInstalledPackageDir(paths, "opencode-ai");
  const installedVersion = installedPackageDir
    ? readPackageVersion(path.join(installedPackageDir, "package.json"))
    : null;
  return installedVersion ?? readPackagedOpenCodeVersion(paths);
}

function readInstalledExecutorVersion(paths) {
  if (readInstalledExecutorMode(paths) === "embedded-patched") {
    const packagedVersion = readPackagedExecutorVersion(paths);
    if (packagedVersion) {
      return packagedVersion;
    }
  }

  const installedPackageDir = resolveInstalledPackageDir(paths, "executor");
  const installedVersion = installedPackageDir
    ? readPackageVersion(path.join(installedPackageDir, "package.json"))
    : null;
  return installedVersion ?? readPackagedExecutorVersion(paths);
}

function readInstalledExecutorMode(paths) {
  if (!fs.existsSync(paths.executorUnitPath)) {
    return null;
  }
  const execStartLine = fs
    .readFileSync(paths.executorUnitPath, "utf8")
    .split("\n")
    .find((line) => line.startsWith("ExecStart="));
  if (!execStartLine) {
    return null;
  }
  return execStartLine.includes("/vendor/executor/")
    ? "embedded-patched"
    : "upstream-fallback";
}

function readInstalledRuntimeMode(paths) {
  if (!fs.existsSync(paths.agentMockingbirdUnitPath)) {
    return null;
  }
  const execStartLine = fs
    .readFileSync(paths.agentMockingbirdUnitPath, "utf8")
    .split("\n")
    .find((line) => line.startsWith("ExecStart="));
  if (!execStartLine) {
    return null;
  }
  if (execStartLine.includes("/dist/agent-mockingbird")) {
    return "compiled";
  }
  if (
    execStartLine.includes("apps/server/src/index.ts") ||
    execStartLine.includes("apps/server/src/index.js") ||
    execStartLine.includes("apps/server/dist/index.js") ||
    execStartLine.includes("/dist/index.js")
  ) {
    return "source";
  }
  return null;
}

async function fetchRuntimeDefaultModel() {
  try {
    const response = await fetch(
      `${AGENT_MOCKINGBIRD_API_BASE_URL}/api/config`,
      { method: "GET" },
    );
    if (!response.ok) return "";
    const payload = await response.json();
    const providerId = payload?.config?.runtime?.opencode?.providerId;
    const modelId = payload?.config?.runtime?.opencode?.modelId;
    if (typeof providerId !== "string" || typeof modelId !== "string") {
      return "";
    }
    const provider = providerId.trim();
    const model = modelId.trim();
    return provider && model ? `${provider}/${model}` : "";
  } catch {
    return "";
  }
}

async function fetchRuntimeModelOptions() {
  try {
    const response = await fetch(
      `${AGENT_MOCKINGBIRD_API_BASE_URL}/api/opencode/models`,
      { method: "GET" },
    );
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload?.models)) {
      return [];
    }
    return payload.models
      .map((model) => ({
        id: typeof model?.id === "string" ? model.id.trim() : "",
        providerId:
          typeof model?.providerId === "string" ? model.providerId.trim() : "",
        modelId: typeof model?.modelId === "string" ? model.modelId.trim() : "",
        label: typeof model?.label === "string" ? model.label.trim() : "",
      }))
      .filter((model) => model.id);
  } catch {
    return [];
  }
}

async function fetchRuntimeModelOptionsWithRetry(input = {}) {
  const attempts =
    typeof input.attempts === "number" ? Math.max(1, input.attempts) : 8;
  const delayMs =
    typeof input.delayMs === "number" ? Math.max(100, input.delayMs) : 1_000;
  let last = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await fetchRuntimeModelOptions();
    if (last.length > 0) return last;
    if (attempt < attempts - 1) {
      await sleep(delayMs);
    }
  }
  return last;
}

function buildEmptyModelDiscoveryDiagnostics(input) {
  const lines = [
    "No runtime models were discovered after provider setup.",
    `Workspace: ${input.workspaceDir}`,
    `OpenCode config dir: ${input.opencodeConfigDir}`,
  ];
  if (input.currentModel) {
    lines.push(`Current runtime default: ${input.currentModel}`);
  }
  if (input.authAttempts > 0) {
    lines.push(
      `Provider auth attempts: ${input.authAttempts} (${input.authSuccess ? "at least one succeeded" : "none succeeded"})`,
    );
  }
  if (input.authRefresh) {
    lines.push(`OpenCode auth refresh: ${input.authRefresh.message}`);
  }
  lines.push(
    "This usually means the runtime workspace config and the saved provider credentials are still out of sync.",
  );
  lines.push("Recommended checks:");
  lines.push(
    `- OPENCODE_CONFIG_DIR=${input.opencodeConfigDir} OPENCODE_DISABLE_PROJECT_CONFIG=1 opencode auth list`,
  );
  lines.push("- curl -sS http://127.0.0.1:3001/api/opencode/models");
  lines.push(
    "- verify the provider you authenticated actually exposes models in this workspace configuration",
  );
  return lines;
}

async function restartOpencodeServiceForAuthRefresh() {
  if (!checkSystemdUserStatus()) {
    return {
      attempted: false,
      ok: false,
      message:
        "systemctl --user unavailable; skipping automatic Agent Mockingbird restart.",
    };
  }
  const loadState = shell("systemctl", [
    "--user",
    "show",
    "--property=LoadState",
    "--value",
    UNIT_AGENT_MOCKINGBIRD,
  ]);
  if (loadState.code === 0 && loadState.stdout.trim() === "not-found") {
    return {
      attempted: false,
      ok: false,
      message: `${UNIT_AGENT_MOCKINGBIRD} is not installed as a user service; provider credentials were saved without a restart.`,
    };
  }
  const restarted = shell("systemctl", ["--user", "restart", UNIT_AGENT_MOCKINGBIRD]);
  if (restarted.code !== 0) {
    const detail =
      (restarted.stderr || restarted.stdout).trim() || "unknown error";
    return {
      attempted: true,
      ok: false,
      message: `Failed to restart ${UNIT_AGENT_MOCKINGBIRD}: ${detail}`,
    };
  }
  await sleep(1_500);
  return {
    attempted: true,
    ok: true,
    message: `${UNIT_AGENT_MOCKINGBIRD} restarted to refresh provider credentials.`,
  };
}

function isValidHttpUrl(value) {
  try {
    const parsed = new globalThis.URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function modelOptionSearchText(option) {
  return `${option.label || ""} ${option.id || ""} ${option.providerId || ""} ${option.modelId || ""}`
    .toLowerCase()
    .trim();
}

function matchesSearchQuery(option, query) {
  const normalizedQuery = String(query ?? "")
    .toLowerCase()
    .trim();
  if (!normalizedQuery) return true;
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const haystack = modelOptionSearchText(option);
  return tokens.every((token) => haystack.includes(token));
}

async function promptSearchableModelChoice(input) {
  const { modelOptions, currentModel } = input;
  const pageSize = 12;
  let query = "";
  let page = 0;

  while (true) {
    const filtered = modelOptions.filter((option) =>
      matchesSearchQuery(option, query),
    );
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page >= totalPages) page = 0;

    const startIndex = page * pageSize;
    const pageItems = filtered.slice(startIndex, startIndex + pageSize);

    const titleParts = ["Select a default model"];
    if (query) titleParts.push(`search="${query}"`);
    titleParts.push(`matches=${filtered.length}`);
    titleParts.push(`page=${page + 1}/${totalPages}`);

    const options = [
      ...pageItems.map((option) => ({
        value: option.id,
        label: option.label || option.id,
        hint: option.id,
      })),
    ];

    if (filtered.length > 0 && page < totalPages - 1) {
      options.push({
        value: "__next__",
        label: "Next page",
        hint: "Show more results",
      });
    }
    if (filtered.length > 0 && page > 0) {
      options.push({ value: "__prev__", label: "Previous page" });
    }
    options.push({
      value: "__search__",
      label: "Change search query",
      hint: query ? "Edit query" : "Find by provider/model name",
    });
    options.push({
      value: "__manual__",
      label: "Enter manually",
      hint: "Type provider/model yourself",
    });
    options.push({
      value: "__keep__",
      label: "Keep current",
      hint: currentModel || "No change",
    });

    const selection = await promptSelect(titleParts.join(" | "), options, 0);
    if (selection.value === "__next__") {
      page += 1;
      continue;
    }
    if (selection.value === "__prev__") {
      page = Math.max(0, page - 1);
      continue;
    }
    if (selection.value === "__search__") {
      query = (
        await promptText("Search models (provider, model, id)", query)
      ).trim();
      page = 0;
      continue;
    }
    return selection.value;
  }
}

async function setRuntimeDefaultModel(modelRef) {
  const response = await fetch(
    `${AGENT_MOCKINGBIRD_API_BASE_URL}/api/runtime/default-model`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelRef }),
    },
  );
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : "Failed to set runtime default model";
    throw new Error(message);
  }
}

async function fetchRuntimeMemoryConfig() {
  try {
    const response = await fetch(
      `${AGENT_MOCKINGBIRD_API_BASE_URL}/api/config`,
      { method: "GET" },
    );
    if (!response.ok) {
      return {
        enabled: true,
        embedModel: "qwen3-embedding:4b",
        ollamaBaseUrl: "http://127.0.0.1:11434",
      };
    }
    const payload = await response.json();
    const memory = payload?.config?.runtime?.memory ?? {};
    return {
      enabled: typeof memory?.enabled === "boolean" ? memory.enabled : true,
      embedModel:
        typeof memory?.embedModel === "string" && memory.embedModel.trim()
          ? memory.embedModel.trim()
          : "qwen3-embedding:4b",
      ollamaBaseUrl:
        typeof memory?.ollamaBaseUrl === "string" && memory.ollamaBaseUrl.trim()
          ? memory.ollamaBaseUrl.trim()
          : "http://127.0.0.1:11434",
    };
  } catch {
    return {
      enabled: true,
      embedModel: "qwen3-embedding:4b",
      ollamaBaseUrl: "http://127.0.0.1:11434",
    };
  }
}

async function fetchRuntimeConfigHash() {
  const response = await fetch(`${AGENT_MOCKINGBIRD_API_BASE_URL}/api/config`, {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(`Failed to read runtime config hash (${response.status})`);
  }
  const payload = await response.json();
  const expectedHash =
    typeof payload?.hash === "string" ? payload.hash.trim() : "";
  if (!expectedHash) {
    throw new Error("Runtime config hash missing from /api/config response");
  }
  return expectedHash;
}

async function setRuntimeMemoryEmbeddingConfig(input) {
  const expectedHash = await fetchRuntimeConfigHash();
  const response = await fetch(
    `${AGENT_MOCKINGBIRD_API_BASE_URL}/api/config/patch-safe`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patch: {
          runtime: {
            memory: {
              enabled: input.enabled,
              embedProvider: "ollama",
              embedModel: input.embedModel,
              ollamaBaseUrl: input.ollamaBaseUrl,
            },
          },
        },
        expectedHash,
        runSmokeTest: false,
      }),
    },
  );
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : "Failed to update memory embedding config";
    throw new Error(message);
  }
}

async function fetchOllamaModels(ollamaBaseUrl) {
  const base = ollamaBaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/api/tags`, { method: "GET" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Ollama tags request failed: ${response.status} ${text}`.trim(),
    );
  }
  const payload = await response.json();
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const names = models
    .map((model) => {
      if (typeof model?.name === "string" && model.name.trim())
        return model.name.trim();
      if (typeof model?.model === "string" && model.model.trim())
        return model.model.trim();
      return "";
    })
    .filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

async function promptSearchableStringChoice(input) {
  const {
    title = "Select value",
    values,
    currentValue,
    searchPrompt = "Search",
    manualLabel = "Enter manually",
    keepLabel = "Keep current",
  } = input;
  const pageSize = 12;
  let query = "";
  let page = 0;

  while (true) {
    const filtered = values.filter((value) =>
      matchesSearchQuery(
        { label: value, id: value, providerId: "", modelId: "" },
        query,
      ),
    );
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page >= totalPages) page = 0;
    const pageItems = filtered.slice(
      page * pageSize,
      page * pageSize + pageSize,
    );

    const options = [
      ...pageItems.map((value) => ({
        value,
        label: value,
      })),
    ];
    if (filtered.length > 0 && page < totalPages - 1) {
      options.push({ value: "__next__", label: "Next page" });
    }
    if (filtered.length > 0 && page > 0) {
      options.push({ value: "__prev__", label: "Previous page" });
    }
    options.push({
      value: "__search__",
      label: "Change search query",
      hint: query ? `Current: ${query}` : "Filter the list",
    });
    options.push({ value: "__manual__", label: manualLabel });
    options.push({
      value: "__keep__",
      label: keepLabel,
      hint: currentValue || "No change",
    });

    const selection = await promptSelect(
      `${title} | matches=${filtered.length} | page=${page + 1}/${totalPages}`,
      options,
      0,
    );
    if (selection.value === "__next__") {
      page += 1;
      continue;
    }
    if (selection.value === "__prev__") {
      page = Math.max(0, page - 1);
      continue;
    }
    if (selection.value === "__search__") {
      query = (await promptText(searchPrompt, query)).trim();
      page = 0;
      continue;
    }
    return selection.value;
  }
}

async function runOpenclawMigrationWizard() {
  console.log("");
  console.log(heading("OpenClaw migration"));

  const sourceChoice = await promptSelect("Import source", [
    { value: "git", label: "Clone from git repository" },
    { value: "local", label: "Copy from local directory" },
    { value: "skip", label: "Skip OpenClaw migration" },
  ]);
  if (sourceChoice.value === "skip") {
    return { attempted: false, skipped: true, reason: "user-skip" };
  }

  let source;
  if (sourceChoice.value === "git") {
    const url = (await promptText("Git repository URL", "")).trim();
    if (!url) {
      return { attempted: false, skipped: true, reason: "missing-git-url" };
    }
    const ref = (await promptText("Git ref (optional)", "")).trim();
    source = { mode: "git", url, ref: ref || undefined };
  } else {
    const sourcePath = (
      await promptText("OpenClaw workspace directory", "")
    ).trim();
    if (!sourcePath) {
      return { attempted: false, skipped: true, reason: "missing-path" };
    }
    source = { mode: "local", path: path.resolve(sourcePath) };
  }

  const customTarget = await promptYesNo(
    "Use a custom migration target directory?",
    false,
  );
  let targetDirectory;
  if (customTarget) {
    const entered = (await promptText("Target directory", "")).trim();
    if (entered) {
      targetDirectory = path.resolve(entered);
    }
  }

  console.log(info("Running one-shot migration..."));
  const migration = await migrateOpenclawWorkspace({
    source,
    targetDirectory,
  });

  let memorySync = {
    attempted: false,
    completed: false,
    reason: "memory-disabled",
  };
  try {
    const memoryStatus = await fetchMemoryStatus();
    if (memoryStatus?.enabled) {
      console.log(
        info("Memory is enabled; syncing memory index after migration..."),
      );
      await syncMemoryNow();
      memorySync = { attempted: true, completed: true };
    }
  } catch (error) {
    memorySync = {
      attempted: true,
      completed: false,
      reason: error instanceof Error ? error.message : String(error),
    };
    console.log(
      warn(`Post-migration memory sync failed: ${memorySync.reason}`),
    );
  }

  return {
    attempted: true,
    skipped: false,
    migration,
    memorySync,
  };
}

async function runInteractiveProviderOnboarding(input) {
  const { opencodeBin, workspaceDir, opencodeEnv } = input;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return { status: "skipped", reason: "non-interactive" };
  }

  console.log("");
  console.log(heading("Agent Mockingbird onboarding"));
  console.log(
    info(
      "Optional: connect inference providers through OpenCode and pick a default runtime model.",
    ),
  );

  const pathChoice = await promptSelect("Choose onboarding flow", [
    {
      value: "quickstart",
      label: "Quick start (recommended)",
      hint: "Connect at least one provider, then pick a default model",
    },
    {
      value: "model-only",
      label: "Model only",
      hint: "Skip provider auth and only set default model",
    },
    {
      value: "memory-only",
      label: "Memory only",
      hint: "Configure Ollama memory embedding settings only",
    },
    {
      value: "openclaw-only",
      label: "OpenClaw only",
      hint: "Run OpenClaw workspace migration only",
    },
    {
      value: "skip",
      label: "Skip for now",
      hint: "You can rerun later with agent-mockingbird status + dashboard settings",
    },
  ]);

  if (pathChoice.value === "skip") {
    return { status: "skipped", reason: "user-skip" };
  }
  const modelOnly = pathChoice.value === "model-only";
  const memoryOnly = pathChoice.value === "memory-only";
  const openclawOnly = pathChoice.value === "openclaw-only";

  let authAttempts = 0;
  let authSuccess = false;
  let authRefresh = null;
  if (pathChoice.value === "quickstart") {
    console.log("");
    console.log(heading("Provider auth"));
    console.log(info("Current OpenCode credentials:"));
    shell(opencodeBin, ["auth", "list"], {
      stdio: "inherit",
      cwd: workspaceDir,
      env: opencodeEnv,
    });

    while (true) {
      const selection = await promptSelect(
        "Connect a provider",
        [
          {
            value: "__picker__",
            label: "OpenCode interactive provider picker (recommended)",
            hint: "Lets OpenCode show supported providers directly",
          },
          {
            value: "__manual_url__",
            label: "Enter provider auth URL manually",
            hint: "Use when provider requires a custom auth endpoint URL",
          },
          {
            value: "__done__",
            label: "Done with provider auth",
          },
        ],
        0,
      );

      if (selection.value === "__done__") break;

      let result;
      if (selection.value === "__picker__") {
        authAttempts += 1;
        result = shell(opencodeBin, ["auth", "login"], {
          stdio: "inherit",
          cwd: workspaceDir,
          env: opencodeEnv,
        });
      } else if (selection.value === "__manual_url__") {
        const providerUrl = (await promptText("Provider auth URL", "")).trim();
        if (!providerUrl) {
          const continueChoice = await promptYesNo(
            "No URL provided. Continue auth flow?",
            true,
          );
          if (!continueChoice) break;
          continue;
        }
        if (!isValidHttpUrl(providerUrl)) {
          console.log(
            warn(
              "Invalid URL. Enter a full http(s) URL, for example https://example.com.",
            ),
          );
          const continueChoice = await promptYesNo("Continue auth flow?", true);
          if (!continueChoice) break;
          continue;
        }
        authAttempts += 1;
        result = shell(opencodeBin, ["auth", "login", providerUrl], {
          stdio: "inherit",
          cwd: workspaceDir,
          env: opencodeEnv,
        });
      } else {
        continue;
      }

      if (result.code === 0) {
        authSuccess = true;
        shell(opencodeBin, ["auth", "list"], {
          stdio: "inherit",
          cwd: workspaceDir,
          env: opencodeEnv,
        });
      } else {
        console.log(
          warn("OpenCode login attempt did not complete successfully."),
        );
      }
      const addAnother = await promptYesNo("Connect another provider?", false);
      if (!addAnother) break;
    }
    if (authAttempts > 0) {
      console.log("");
      console.log(
        info("Applying provider auth changes before model selection..."),
      );
      authRefresh = await restartOpencodeServiceForAuthRefresh();
      if (authRefresh.ok) {
        console.log(success(authRefresh.message));
      } else {
        console.log(warn(authRefresh.message));
      }
    }
  }

  const allowModelSetup = !memoryOnly && !openclawOnly;
  const setModelNow = allowModelSetup
    ? modelOnly
      ? true
      : await promptYesNo("Set runtime default model now?", true)
    : false;
  let selectedModel = "";
  if (setModelNow) {
    const currentModel = await fetchRuntimeDefaultModel();
    const modelOptions =
      authAttempts > 0
        ? await fetchRuntimeModelOptionsWithRetry({
            attempts: 10,
            delayMs: 1_000,
          })
        : await fetchRuntimeModelOptions();
    console.log("");
    console.log(heading("Default model"));
    if (currentModel) {
      console.log(info(`Current runtime default: ${currentModel}`));
    }
    if (modelOptions.length === 0) {
      const diagnostics = buildEmptyModelDiscoveryDiagnostics({
        workspaceDir,
        opencodeConfigDir: opencodeEnv.OPENCODE_CONFIG_DIR,
        currentModel,
        authAttempts,
        authSuccess,
        authRefresh,
      });
      console.log("");
      console.log(warn(diagnostics[0]));
      for (const line of diagnostics.slice(1)) {
        console.log(info(line));
      }
      return {
        status: "error",
        message: diagnostics[0],
        flow: pathChoice.value,
        authAttempts,
        authSuccess,
        authRefresh,
        selectedModel: null,
        diagnostics,
      };
    } else {
      const selection = await promptSearchableModelChoice({
        modelOptions,
        currentModel,
      });
      if (selection === "__manual__") {
        const manual = (
          await promptText("Enter provider/model", currentModel || "")
        ).trim();
        if (manual) {
          await setRuntimeDefaultModel(manual);
          selectedModel = manual;
        }
      } else if (selection !== "__keep__") {
        await setRuntimeDefaultModel(selection);
        selectedModel = selection;
      }
    }
  }

  const configureMemoryNow = memoryOnly
    ? true
    : !modelOnly && !openclawOnly
      ? await promptYesNo(
          "Configure memory embedding model (Ollama) now?",
          true,
        )
      : false;
  let memoryEmbedding = null;
  if (configureMemoryNow) {
    const currentMemory = await fetchRuntimeMemoryConfig();
    console.log("");
    console.log(heading("Memory embeddings"));
    console.log(info(`Current provider: ollama`));
    console.log(info(`Current Ollama URL: ${currentMemory.ollamaBaseUrl}`));
    console.log(info(`Current embedding model: ${currentMemory.embedModel}`));

    const memoryEnabled = await promptYesNo(
      "Enable memory features?",
      currentMemory.enabled,
    );
    if (!memoryEnabled) {
      await setRuntimeMemoryEmbeddingConfig({
        enabled: false,
        embedModel: currentMemory.embedModel,
        ollamaBaseUrl: currentMemory.ollamaBaseUrl,
      });
      memoryEmbedding = {
        configured: true,
        enabled: false,
        ollamaBaseUrl: currentMemory.ollamaBaseUrl,
        embedModel: currentMemory.embedModel,
      };
    } else {
      let ollamaBaseUrl = await promptText(
        "Ollama base URL",
        currentMemory.ollamaBaseUrl,
      );
      let models = [];

      while (true) {
        try {
          models = await fetchOllamaModels(ollamaBaseUrl);
          if (models.length === 0) {
            console.log(
              warn(
                "Connected to Ollama but no models were returned from /api/tags.",
              ),
            );
          } else {
            console.log(
              success(
                `Discovered ${models.length} model${models.length === 1 ? "" : "s"} from Ollama.`,
              ),
            );
          }
          break;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.log(
            warn(`Could not query Ollama at ${ollamaBaseUrl}: ${message}`),
          );
          const retryChoice = await promptSelect(
            "Ollama model discovery failed",
            [
              { value: "retry", label: "Retry same URL" },
              { value: "change", label: "Change Ollama URL" },
              {
                value: "manual",
                label: "Skip discovery and enter model manually",
              },
              { value: "skip", label: "Skip memory embedding setup" },
            ],
          );
          if (retryChoice.value === "retry") continue;
          if (retryChoice.value === "change") {
            ollamaBaseUrl = await promptText("Ollama base URL", ollamaBaseUrl);
            continue;
          }
          if (retryChoice.value === "manual") {
            models = [];
            break;
          }
          memoryEmbedding = {
            configured: false,
            reason: "model-discovery-skipped",
          };
          break;
        }
      }

      if (!memoryEmbedding) {
        let embedModel = currentMemory.embedModel;
        if (models.length === 0) {
          const manualModel = (
            await promptText(
              "Embedding model (manual)",
              currentMemory.embedModel,
            )
          ).trim();
          if (manualModel) {
            embedModel = manualModel;
          }
        } else {
          const selection = await promptSearchableStringChoice({
            title: "Select Ollama embedding model",
            values: models,
            currentValue: currentMemory.embedModel,
            searchPrompt: "Search Ollama models",
            manualLabel: "Enter model manually",
            keepLabel: "Keep current model",
          });
          if (selection === "__manual__") {
            const manualModel = (
              await promptText(
                "Embedding model (manual)",
                currentMemory.embedModel,
              )
            ).trim();
            if (manualModel) {
              embedModel = manualModel;
            }
          } else if (selection !== "__keep__") {
            embedModel = selection;
          }
        }

        await setRuntimeMemoryEmbeddingConfig({
          enabled: true,
          embedModel,
          ollamaBaseUrl,
        });
        memoryEmbedding = {
          configured: true,
          enabled: true,
          ollamaBaseUrl,
          embedModel,
          discoveredModelCount: models.length,
        };
      }
    }
  }

  let openclawMigration = null;
  const runMigration = openclawOnly
    ? true
    : !modelOnly && !memoryOnly
      ? await promptYesNo("Import an OpenClaw workspace now?", false)
      : false;
  if (runMigration) {
    try {
      openclawMigration = await runOpenclawMigrationWizard();
    } catch (error) {
      openclawMigration = {
        attempted: true,
        skipped: false,
        error: error instanceof Error ? error.message : String(error),
      };
      console.log(
        warn(`OpenClaw migration failed: ${openclawMigration.error}`),
      );
    }
  } else {
    openclawMigration = {
      attempted: false,
      skipped: true,
      reason: modelOnly || memoryOnly ? "flow-skip" : "user-skip",
    };
  }

  return {
    status: "completed",
    flow: pathChoice.value,
    authAttempts,
    authSuccess,
    authRefresh,
    selectedModel: selectedModel || null,
    memoryEmbedding,
    openclawMigration,
  };
}

export const testing = {
  applyDefaultInstallTarget,
  buildEmptyModelDiscoveryDiagnostics,
  buildManagedOpenCodeInstallArgs,
  cleanupManagedOpenCodeConfigInstallArtifacts,
  readInstalledExecutorMode,
  readInstalledExecutorVersion,
  readInstalledOpenCodeVersion,
  readPinnedBunVersion,
  readRunningPackageVersion,
  readOpenCodePackageVersion,
  resolveManagedCliDelegationTarget,
  resolveManagedCliPathForAppDir,
  resolveManagedCliPathForRoot,
  resolvePackagedExecutorWebAssetsDir,
  resolveExecutorRuntimeCommand,
  unitContents,
  verifyEmbeddedExecutorGateway,
};

/**
 * @typedef {{
 *   agentMockingbirdAppDirGlobal?: string,
 *   agentMockingbirdAppDirLocal?: string,
 *   agentMockingbirdAppDirScopedGlobal?: string,
 *   agentMockingbirdAppDirScopedLocal?: string,
 * }} ReadOpenCodePackageVersionPaths
 */

/**
 * @typedef {{
 *   paths?: ReadOpenCodePackageVersionPaths,
 *   moduleDir?: string,
 *   argv?: string[],
 *   env?: NodeJS.ProcessEnv,
 * }} ReadOpenCodePackageVersionOptions
 */

/**
 * @typedef {{
 *   paths?: ReadOpenCodePackageVersionPaths,
 *   moduleDir?: string,
 *   argv?: string[],
 *   env?: NodeJS.ProcessEnv,
 * }} ReadPinnedBunVersionOptions
 */

/**
 * @param {ReadOpenCodePackageVersionOptions} [options]
 */
function candidateLockPaths(
  lockFileName,
  {
    paths,
    moduleDir = MODULE_DIR,
    argv = process.argv,
    env = process.env,
  } = {},
) {
  const candidates = [];
  const seen = new Set();
  const add = (value) => {
    if (!value) return;
    const resolved = path.resolve(value);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push(resolved);
  };

  add(path.resolve(moduleDir, `../../../../${lockFileName}`));
  add(path.resolve(moduleDir, `../${lockFileName}`));

  const invokedScript = argv[1];
  if (typeof invokedScript === "string" && invokedScript.trim()) {
    add(path.resolve(path.dirname(invokedScript), `../${lockFileName}`));
    try {
      const realScript = fs.realpathSync(invokedScript);
      add(path.resolve(path.dirname(realScript), `../${lockFileName}`));
      add(path.resolve(path.dirname(realScript), `../../${lockFileName}`));
    } catch {
      // Ignore missing or unreadable realpaths.
    }
  }

  if (paths) {
    if (typeof paths.agentMockingbirdAppDirGlobal === "string") {
      add(path.join(paths.agentMockingbirdAppDirGlobal, lockFileName));
    }
    if (typeof paths.agentMockingbirdAppDirLocal === "string") {
      add(path.join(paths.agentMockingbirdAppDirLocal, lockFileName));
    }
    if (typeof paths.agentMockingbirdAppDirScopedGlobal === "string") {
      add(path.join(paths.agentMockingbirdAppDirScopedGlobal, lockFileName));
    }
    if (typeof paths.agentMockingbirdAppDirScopedLocal === "string") {
      add(path.join(paths.agentMockingbirdAppDirScopedLocal, lockFileName));
    }
  }

  const explicitRoot = env.AGENT_MOCKINGBIRD_ROOT_DIR?.trim();
  const explicitScope =
    env.AGENT_MOCKINGBIRD_INSTALLER_SCOPE?.trim() ||
    env.AGENT_MOCKINGBIRD_SCOPE?.trim();
  if (explicitRoot && explicitScope) {
    const derivedPaths = pathsFor({
      rootDir: path.resolve(explicitRoot),
      scope: explicitScope,
      userUnitDir: USER_UNIT_DIR,
    });
    add(path.join(derivedPaths.agentMockingbirdAppDirGlobal, lockFileName));
    add(path.join(derivedPaths.agentMockingbirdAppDirLocal, lockFileName));
    add(
      path.join(derivedPaths.agentMockingbirdAppDirScopedGlobal, lockFileName),
    );
    add(
      path.join(derivedPaths.agentMockingbirdAppDirScopedLocal, lockFileName),
    );
  }

  return candidates;
}

function candidatePackageJsonPaths({
  paths,
  moduleDir = MODULE_DIR,
  argv = process.argv,
  env = process.env,
} = {}) {
  return candidateLockPaths("package.json", { paths, moduleDir, argv, env });
}

function candidateOpenCodePackageJsonPaths({
  paths,
  moduleDir = MODULE_DIR,
  argv = process.argv,
  env = process.env,
} = {}) {
  const candidates = [];
  const seen = new Set();
  const add = (value) => {
    if (!value) return;
    const resolved = path.resolve(value);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    candidates.push(resolved);
  };

  for (const packageJsonPath of candidatePackageJsonPaths({
    paths,
    moduleDir,
    argv,
    env,
  })) {
    const appRoot = path.dirname(packageJsonPath);
    add(path.join(appRoot, "cleanroom", "opencode", "package.json"));
    add(path.join(appRoot, "vendor", "opencode", "package.json"));
  }

  return candidates;
}

function readPackageManagerBunVersionFromPackageJsonPath(packageJsonPath) {
  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const packageManager = parsed?.packageManager;
  if (typeof packageManager !== "string" || packageManager.length === 0) {
    throw new Error(`Invalid packageManager in ${packageJsonPath}`);
  }
  if (!packageManager.startsWith("bun@")) {
    throw new Error(
      `Expected packageManager to start with bun@ in ${packageJsonPath}, found ${packageManager}`,
    );
  }
  const bunVersion = packageManager.slice(4).trim();
  if (!bunVersion) {
    throw new Error(`Invalid packageManager in ${packageJsonPath}`);
  }
  return bunVersion;
}

function readPinnedInstallVersion(
  fieldName,
  {
    paths,
    moduleDir = MODULE_DIR,
    argv = process.argv,
    env = process.env,
  } = {},
) {
  const candidatePaths = candidatePackageJsonPaths({
    paths,
    moduleDir,
    argv,
    env,
  });
  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }
    const parsed = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
    const version = parsed?.agentMockingbirdInstall?.[fieldName];
    if (typeof version === "string" && version.trim()) {
      return version.trim();
    }
  }
  return null;
}

/**
 * @param {ReadPinnedBunVersionOptions} [options]
 */
function readPinnedBunVersion({
  paths,
  moduleDir = MODULE_DIR,
  argv = process.argv,
  env = process.env,
} = {}) {
  const envVersion = env.AGENT_MOCKINGBIRD_BUN_VERSION?.trim();
  if (envVersion) {
    return envVersion;
  }

  for (const candidatePath of candidateOpenCodePackageJsonPaths({
    paths,
    moduleDir,
    argv,
    env,
  })) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }
    return readPackageManagerBunVersionFromPackageJsonPath(candidatePath);
  }

  for (const candidatePath of candidatePackageJsonPaths({
    paths,
    moduleDir,
    argv,
    env,
  })) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }
    return readPackageManagerBunVersionFromPackageJsonPath(candidatePath);
  }

  throw new Error(
    "Unable to locate package.json for Bun version pinning.",
  );
}

/**
 * @param {ReadOpenCodePackageVersionOptions} [options]
 */
function readOpenCodePackageVersion({
  paths,
  moduleDir = MODULE_DIR,
  argv = process.argv,
  env = process.env,
} = {}) {
  const envVersion = env.AGENT_MOCKINGBIRD_OPENCODE_VERSION?.trim();
  if (envVersion) {
    return envVersion;
  }
  const candidatePaths = candidateLockPaths("opencode.lock.json", {
    paths,
    moduleDir,
    argv,
    env,
  });
  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }
    const parsed = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
    if (
      typeof parsed.packageVersion !== "string" ||
      parsed.packageVersion.length === 0
    ) {
      throw new Error(`Invalid packageVersion in ${candidatePath}`);
    }
    return parsed.packageVersion;
  }
  const pinnedVersion = readPinnedInstallVersion("opencodeVersion", {
    paths,
    moduleDir,
    argv,
    env,
  });
  if (pinnedVersion) {
    return pinnedVersion;
  }
  throw new Error(
    "Unable to locate opencode.lock.json for installer version pinning.",
  );
}

function readExecutorPackageVersion({
  paths,
  moduleDir = MODULE_DIR,
  argv = process.argv,
  env = process.env,
} = {}) {
  const envVersion = env.AGENT_MOCKINGBIRD_EXECUTOR_VERSION?.trim();
  if (envVersion) {
    return envVersion;
  }
  const candidatePaths = candidateLockPaths("executor.lock.json", {
    paths,
    moduleDir,
    argv,
    env,
  });
  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }
    const parsed = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
    if (
      typeof parsed.packageVersion !== "string" ||
      parsed.packageVersion.length === 0
    ) {
      throw new Error(`Invalid packageVersion in ${candidatePath}`);
    }
    return parsed.packageVersion;
  }
  const pinnedVersion = readPinnedInstallVersion("executorVersion", {
    paths,
    moduleDir,
    argv,
    env,
  });
  if (pinnedVersion) {
    return pinnedVersion;
  }
  throw new Error(
    "Unable to locate executor.lock.json for installer version pinning.",
  );
}

async function installOrUpdate(args, mode) {
  const packageManager = resolvePackageManager();
  if (!packageManager) {
    throw new Error("npm or bun is required. Please install one and run again.");
  }

  const paths = pathsFor({
    rootDir: args.rootDir,
    scope: args.scope,
    userUnitDir: USER_UNIT_DIR,
  });
  const opencodePackageVersion = readOpenCodePackageVersion({ paths });
  const executorPackageVersion = readExecutorPackageVersion({ paths });
  const pinnedBunVersion = readPinnedBunVersion({ paths });
  await confirmInstall(args, paths, mode);
  ensureDir(paths.rootDir);
  ensureDir(paths.npmPrefix);
  ensureDir(paths.bunInstallDir);
  ensureDir(paths.dataDir);
  ensureDir(paths.workspaceDir);
  ensureDir(paths.executorWorkspaceDir);
  ensureDir(paths.executorDataDir);
  ensureDir(paths.executorLocalDataDir);
  ensureDir(paths.executorRunDir);
  ensureDir(paths.opencodeConfigDir);
  ensureDir(paths.logsDir);
  ensureDir(paths.etcDir);

  ensureSystemdUserAvailable();
  writeScopedNpmrc(paths, args.scope, args.registryUrl);

  if (!inspectBunRuntime(paths, pinnedBunVersion).matches) {
    tryInstallBun(paths, pinnedBunVersion);
  }
  const bunBin = assertPinnedBunRuntime(paths, pinnedBunVersion);

  installManagedPackage(
    packageManager,
    paths,
    [`executor@${executorPackageVersion}`],
    packageManager === "bun"
      ? ["--registry", PUBLIC_NPM_REGISTRY]
      : ["-g", "--registry", PUBLIC_NPM_REGISTRY],
    process.env,
    { bunCommand: bunBin },
  );

  installManagedPackage(
    packageManager,
    paths,
    [`opencode-ai@${opencodePackageVersion}`],
    packageManager === "bun"
      ? ["--registry", PUBLIC_NPM_REGISTRY]
      : ["-g", "--registry", PUBLIC_NPM_REGISTRY],
    process.env,
    { bunCommand: bunBin },
  );

  const env = {
    ...process.env,
    npm_config_userconfig: paths.npmrcPath,
    npm_config_registry: PUBLIC_NPM_REGISTRY,
  };

  installManagedPackage(
    packageManager,
    paths,
    [packageSpec(args.scope, args.version, args.tag)],
    packageManager === "bun"
      ? ["--registry", args.registryUrl]
      : ["-g", "--registry", args.registryUrl],
    env,
    { bunCommand: bunBin },
  );

  const agentMockingbirdAppDir = resolveAgentMockingbirdAppDir(paths);
  if (!agentMockingbirdAppDir) {
    throw new Error(
      `agent-mockingbird package directory missing: looked in ${paths.agentMockingbirdAppDirGlobal}, ${paths.agentMockingbirdAppDirLocal}, ${paths.agentMockingbirdAppDirScopedGlobal}, ${paths.agentMockingbirdAppDirScopedLocal}, ${paths.agentMockingbirdAppDirBunGlobal}, and ${paths.agentMockingbirdAppDirScopedBunGlobal}`,
    );
  }
  const managedCliPath = resolveManagedCliPathForAppDir(agentMockingbirdAppDir);
  if (!managedCliPath) {
    throw new Error(
      `agent-mockingbird managed CLI missing in ${agentMockingbirdAppDir}: expected bin/agent-mockingbird-managed or source CLI fallback`,
    );
  }
  const shimPath = writeAgentMockingbirdShim(
    paths,
    managedCliPath,
    opencodePackageVersion,
  );
  const pathSetup = ensureLocalBinPath(paths);

  const runtimeAssetsSource = prepareRuntimeAssetSources(
    agentMockingbirdAppDir,
  );
  const workspaceRuntimeAssets = await syncRuntimeWorkspaceAssets({
    sourceWorkspaceDir: runtimeAssetsSource.workspaceSourceDir,
    targetWorkspaceDir: paths.workspaceDir,
    stateFilePath: path.join(
      paths.dataDir,
      "runtime-assets-workspace-state.json",
    ),
    mode,
    interactive: mode === "update" && !args.yes,
    onConflict: promptRuntimeAssetConflictDecision,
  });
  const opencodeRuntimeAssets = await syncRuntimeWorkspaceAssets({
    sourceWorkspaceDir: runtimeAssetsSource.opencodeConfigSourceDir,
    targetWorkspaceDir: paths.opencodeConfigDir,
    stateFilePath: path.join(
      paths.dataDir,
      "runtime-assets-opencode-config-state.json",
    ),
    mode,
    interactive: mode === "update" && !args.yes,
    onConflict: promptRuntimeAssetConflictDecision,
  });
  const opencodePackagePath = path.join(
    paths.opencodeConfigDir,
    "package.json",
  );
  const managedCleanup = {
    opencodeConfig: cleanupManagedOpenCodeConfigInstallArtifacts({
      sourceDir: runtimeAssetsSource.opencodeConfigSourceDir,
      targetDir: paths.opencodeConfigDir,
      mode,
    }),
  };
  if (fs.existsSync(opencodePackagePath)) {
    const installArgs = buildManagedOpenCodeInstallArgs(
      runtimeAssetsSource.opencodeConfigSourceDir,
    );
    must(bunBin, installArgs, { cwd: paths.opencodeConfigDir });
  }
  ensurePackagedExecutorRuntime(agentMockingbirdAppDir, bunBin);
  const agentMockingbirdRuntime = resolveAgentMockingbirdRuntimeCommand(
    agentMockingbirdAppDir,
    bunBin,
  );
  if (!agentMockingbirdRuntime) {
    throw new Error(
      `agent-mockingbird runtime missing in ${agentMockingbirdAppDir} (checked compiled dist bundle, then package module/main entry files).`,
    );
  }
  const opencodeBin = resolveOpencodeBin(paths);
  if (!opencodeBin) {
    throw new Error(
      `opencode binary missing: looked in ${paths.opencodeBinGlobal} and ${paths.opencodeBinLocal}`,
    );
  }
  const executorRuntime = resolveExecutorRuntimeCommand(
    agentMockingbirdAppDir,
    paths,
    bunBin,
  );
  if (!executorRuntime) {
    throw new Error(
      `executor runtime missing: looked in vendored executor checkout and ${paths.executorBinGlobal} / ${paths.executorBinLocal}`,
    );
  }
  const opencodeShimPath = writeOpencodeShim(paths, opencodeBin);

  const units = unitContents(
    paths,
    executorRuntime.execStart,
    executorRuntime.mode,
    executorRuntime.webAssetsDir,
    agentMockingbirdRuntime.execStart,
    agentMockingbirdRuntime.mode,
  );
  writeFile(paths.executorUnitPath, units.executor);
  writeFile(paths.agentMockingbirdUnitPath, units.agentMockingbird);
  if (fs.existsSync(paths.opencodeUnitPath)) {
    fs.rmSync(paths.opencodeUnitPath, { force: true });
  }
  shell("systemctl", ["--user", "disable", "--now", UNIT_OPENCODE]);

  must("systemctl", ["--user", "daemon-reload"]);
  must("systemctl", [
    "--user",
    "enable",
    "--now",
    UNIT_EXECUTOR,
    UNIT_AGENT_MOCKINGBIRD,
  ]);
  if (mode === "update") {
    must("systemctl", [
      "--user",
      "restart",
      UNIT_EXECUTOR,
      UNIT_AGENT_MOCKINGBIRD,
    ]);
  }

  const linger = ensureLinger(args.skipLinger);
  const health = await healthCheckWithRetry(
    "http://127.0.0.1:3001/api/health",
    {
      attempts: 8,
      delayMs: 500,
    },
  );
  const defaultSkillSync = health.ok
    ? await ensureDefaultRuntimeSkillsWhenEmpty({ retries: 6, delayMs: 800 })
    : {
        attempted: false,
        updated: false,
        reason: "skipped (runtime health failed)",
        skills: [],
      };
  const verify = await runPostInstallVerification();
  let onboarding = null;
  if (mode === "install" && !args.yes) {
    try {
      onboarding = await runInteractiveProviderOnboarding({
        opencodeBin: opencodeShimPath,
        workspaceDir: paths.workspaceDir,
        opencodeEnv: opencodeEnvironment(paths),
      });
    } catch (error) {
      onboarding = {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    mode,
    rootDir: paths.rootDir,
    registryUrl: args.registryUrl,
    agentMockingbirdVersion: readInstalledVersion(paths),
    executorVersion: readInstalledExecutorVersion(paths),
    opencodeVersion: readInstalledOpenCodeVersion(paths),
    runtimeMode: agentMockingbirdRuntime.mode,
    executorMode: executorRuntime.mode,
    shimPath,
    opencodeShimPath,
    pathSetup,
    units: [UNIT_EXECUTOR, UNIT_AGENT_MOCKINGBIRD],
    runtimeAssets: {
      workspace: workspaceRuntimeAssets,
      opencodeConfig: opencodeRuntimeAssets,
    },
    managedCleanup,
    defaultSkillSync,
    health,
    linger,
    verify,
    onboarding,
  };
}

async function status(args) {
  const paths = pathsFor({
    rootDir: args.rootDir,
    scope: args.scope,
    userUnitDir: USER_UNIT_DIR,
  });
  const unitStates = {};
  for (const unit of [UNIT_EXECUTOR, UNIT_AGENT_MOCKINGBIRD]) {
    const result = shell("systemctl", ["--user", "is-active", unit]);
    unitStates[unit] = result.code === 0 ? result.stdout.trim() : "inactive";
  }
  const health = await healthCheck("http://127.0.0.1:3001/api/health");

  return {
    mode: "status",
    rootDir: paths.rootDir,
    agentMockingbirdVersion: readInstalledVersion(paths),
    executorVersion: readInstalledExecutorVersion(paths),
    executorMode: readInstalledExecutorMode(paths),
    opencodeVersion: readInstalledOpenCodeVersion(paths),
    runtimeMode: readInstalledRuntimeMode(paths),
    unitStates,
    health,
  };
}

function serviceCommand(action) {
  must("systemctl", [
    "--user",
    action,
    UNIT_EXECUTOR,
    UNIT_AGENT_MOCKINGBIRD,
  ]);
}

async function manageService(args, action) {
  ensureSystemdUserAvailable();
  serviceCommand(action);
  const base = await status(args);
  return {
    ...base,
    mode: action,
  };
}

async function uninstall(args) {
  const paths = pathsFor({
    rootDir: args.rootDir,
    scope: args.scope,
    userUnitDir: USER_UNIT_DIR,
  });

  if (args.purgeData && args.keepData) {
    throw new Error("Choose only one of --purge-data or --keep-data.");
  }

  if (!args.yes && process.stdin.isTTY && process.stdout.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = (
      await rl.question(`Remove user services at ${paths.rootDir}? [y/N] `)
    )
      .trim()
      .toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      rl.close();
      throw new Error("Aborted by user.");
    }
    const purgeAnswer = (
      await rl.question(
        "Purge data/workspaces under ~/.agent-mockingbird/data, ~/.agent-mockingbird/workspace, and ~/.agent-mockingbird/executor-workspace? [y/N] ",
      )
    )
      .trim()
      .toLowerCase();
    args.purgeData = purgeAnswer === "y" || purgeAnswer === "yes";
    rl.close();
  } else if (!args.yes) {
    throw new Error(
      "Uninstall requires confirmation. Re-run with --yes in non-interactive environments.",
    );
  }

  if (args.yes && !args.purgeData) {
    args.keepData = true;
  }

  shell("systemctl", [
    "--user",
    "disable",
    "--now",
    UNIT_AGENT_MOCKINGBIRD,
    UNIT_OPENCODE,
    UNIT_EXECUTOR,
  ]);
  if (fs.existsSync(paths.agentMockingbirdUnitPath)) {
    fs.rmSync(paths.agentMockingbirdUnitPath, { force: true });
  }
  if (fs.existsSync(paths.opencodeUnitPath)) {
    fs.rmSync(paths.opencodeUnitPath, { force: true });
  }
  if (fs.existsSync(paths.executorUnitPath)) {
    fs.rmSync(paths.executorUnitPath, { force: true });
  }
  shell("systemctl", ["--user", "daemon-reload"]);
  const removedShim = removeAgentMockingbirdShim(paths);
  const removedOpencodeShim = removeOpencodeShim(paths);

  if (args.purgeData) {
    if (fs.existsSync(paths.rootDir)) {
      fs.rmSync(paths.rootDir, { recursive: true, force: true });
    }
  } else {
    const preserve = [
      paths.dataDir,
      paths.workspaceDir,
      paths.executorWorkspaceDir,
      paths.logsDir,
    ];
    for (const target of preserve) {
      ensureDir(target);
    }
    const removePaths = [paths.etcDir, paths.npmPrefix];
    for (const target of removePaths) {
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
      }
    }
  }

  return {
    mode: "uninstall",
    rootDir: paths.rootDir,
    unitsRemoved: [UNIT_EXECUTOR, UNIT_AGENT_MOCKINGBIRD],
    removedShim,
    removedOpencodeShim,
    removed: true,
    purgeData: Boolean(args.purgeData),
  };
}

function printResult(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.mode === "install" || result.mode === "update") {
    const localBinDir = path.join(os.homedir(), ".local", "bin");
    console.log(`${result.mode} complete`);
    console.log(`root: ${result.rootDir}`);
    console.log(`registry: ${result.registryUrl}`);
    console.log(
      `agent-mockingbird: ${result.agentMockingbirdVersion ?? "unknown"}`,
    );
    console.log(`executor: ${result.executorVersion ?? "unknown"}`);
    console.log(`executor-mode: ${result.executorMode ?? "unknown"}`);
    console.log(`runtime: ${result.runtimeMode ?? "unknown"}`);
    console.log(`opencode: ${result.opencodeVersion ?? "unknown"}`);
    console.log(`cli: ${result.shimPath ?? "unavailable"}`);
    if (result.opencodeShimPath) {
      console.log(`opencode-cli: ${result.opencodeShimPath}`);
    }
    if (result.commandResolution) {
      console.log(`managed-root: ${result.commandResolution.rootDir}`);
      console.log(`managed-cli: ${result.commandResolution.managedCliPath || "unavailable"}`);
      console.log(`command: ${result.commandResolution.commandPath || "unresolved"}`);
      console.log(`command-mode: ${result.commandResolution.mode}`);
    }
    if (result.pathSetup) {
      if (result.pathSetup.inPath) {
        console.log(`path: ${localBinDir} already in PATH`);
      } else if (result.pathSetup.updatedFiles?.length > 0) {
        console.log(
          `path: added ${localBinDir} to ${result.pathSetup.updatedFiles.join(", ")}`,
        );
      } else {
        console.log(
          `path: add ${localBinDir} to PATH, then restart your shell`,
        );
      }
    }
    for (const [name, assetResult] of Object.entries(
      result.runtimeAssets ?? {},
    )) {
      if (
        !assetResult ||
        typeof assetResult !== "object" ||
        !("target" in assetResult)
      ) {
        continue;
      }
      console.log(`runtime-assets:${name}: source ${assetResult.source}`);
      console.log(`runtime-assets:${name}: target ${assetResult.target}`);
      console.log(
        `runtime-assets:${name}: copied=${assetResult.copied}, overwritten=${assetResult.overwritten}, unchanged=${assetResult.unchanged}, keptLocal=${assetResult.keptLocal}, conflicts=${assetResult.conflicts}`,
      );
      if (assetResult.backupsCreated > 0) {
        console.log(
          `runtime-assets:${name}: backups created=${assetResult.backupsCreated}`,
        );
      }
    }
    if (result.managedCleanup?.opencodeConfig?.cleanedLockfile) {
      console.log("managed-cleanup: opencode-config removed stale bun.lock");
    }
    if (result.managedCleanup?.opencodeConfig?.cleanedNodeModules) {
      console.log("managed-cleanup: opencode-config removed stale node_modules");
    }
    if (result.managedCleanup?.opencodeConfig?.cleanedBunCache) {
      console.log("managed-cleanup: opencode-config removed stale .bun");
    }
    if (result.defaultSkillSync?.attempted) {
      if (result.defaultSkillSync.updated) {
        console.log(
          `skills: enabled defaults (${result.defaultSkillSync.skills.join(", ")})`,
        );
      } else {
        console.log(`skills: ${result.defaultSkillSync.reason}`);
      }
    }
    console.log(
      `health: ${result.health.ok ? "ok" : `failed (${result.health.status})`}`,
    );
    if (result.linger.warning) {
      console.log(`linger: ${result.linger.warning}`);
    } else if (result.linger.changed) {
      console.log("linger: enabled");
    }
    if (result.verify) {
      console.log(
        `verify: agent-mockingbird.service=${result.verify.agentMockingbirdServiceOk ? "ok" : "failed"}`,
      );
      console.log(
        `verify: executor.service=${result.verify.executorServiceOk ? "ok" : "failed"}`,
      );
      console.log(`verify: linger=${result.verify.lingerOk ? "yes" : "no"}`);
      console.log(
        `verify: executor-gateway=${result.verify.embeddedExecutorOk ? "ok" : "failed"}`,
      );
      console.log(
        `verify: executor-external-proxy=${result.verify.externalProxyOk ? "ok" : "failed"}`,
      );
      if (result.verify.embeddedExecutor?.cssUrl) {
        console.log(
          `verify: executor-css=${result.verify.embeddedExecutor.cssUrl}`,
        );
      }
      if (
        !result.verify.agentMockingbirdServiceOk ||
        !result.verify.executorServiceOk ||
        !result.verify.lingerOk ||
        !result.verify.embeddedExecutorOk ||
        !result.verify.externalProxyOk
      ) {
        console.log("verify-details:");
        console.log(
          result.verify.commandOutput.agentMockingbirdStatus || "(no output)",
        );
        console.log(
          result.verify.commandOutput.executorStatus || "(no output)",
        );
        console.log(result.verify.commandOutput.linger || "(no output)");
        if (result.verify.embeddedExecutor?.error) {
          console.log(result.verify.embeddedExecutor.error);
        }
      }
    }
    if (result.mode === "install" && result.onboarding) {
      if (result.onboarding.status === "completed") {
        console.log(`onboarding: completed (${result.onboarding.flow})`);
        if (result.onboarding.authAttempts > 0) {
          console.log(
            `onboarding: provider auth attempts=${result.onboarding.authAttempts} success=${result.onboarding.authSuccess ? "yes" : "no"}`,
          );
          if (result.onboarding.authRefresh) {
            console.log(
              `onboarding: auth refresh=${result.onboarding.authRefresh.ok ? "ok" : "skipped/failed"}`,
            );
          }
        }
        if (result.onboarding.selectedModel) {
          console.log(
            `onboarding: default model=${result.onboarding.selectedModel}`,
          );
        }
        if (result.onboarding.memoryEmbedding) {
          if (result.onboarding.memoryEmbedding.configured === false) {
            console.log(
              `onboarding: memory embeddings=skipped (${result.onboarding.memoryEmbedding.reason ?? "not-configured"})`,
            );
          } else {
            console.log(
              `onboarding: memory enabled=${result.onboarding.memoryEmbedding.enabled ? "yes" : "no"}`,
            );
            if (result.onboarding.memoryEmbedding.ollamaBaseUrl) {
              console.log(
                `onboarding: memory ollama=${result.onboarding.memoryEmbedding.ollamaBaseUrl}`,
              );
            }
            if (result.onboarding.memoryEmbedding.embedModel) {
              console.log(
                `onboarding: memory embedModel=${result.onboarding.memoryEmbedding.embedModel}`,
              );
            }
          }
        }
      } else if (result.onboarding.status === "skipped") {
        console.log(`onboarding: skipped (${result.onboarding.reason})`);
      } else if (result.onboarding.status === "error") {
        console.log(`onboarding: failed (${result.onboarding.message})`);
        if (Array.isArray(result.onboarding.diagnostics)) {
          for (const line of result.onboarding.diagnostics) {
            console.log(`onboarding: ${line}`);
          }
        }
      }
    }
    return;
  }

  if (result.mode === "update-dry-run") {
    console.log("update dry-run");
    console.log(`root: ${result.rootDir}`);
    console.log(`registry: ${result.registryUrl}`);
    console.log(`target: ${result.target}`);
    console.log(
      `precheck: npm=${result.precheck.npm ? "ok" : "missing"}, systemd-user=${result.precheck.systemdUser ? "ok" : "missing"}, bun=${result.precheck.bunVersionMatch ? `bun@${result.precheck.bunExpectedVersion}` : result.precheck.bunPresent ? `bun@${result.precheck.bunActualVersion} -> install bun@${result.precheck.bunExpectedVersion}` : `missing -> install bun@${result.precheck.bunExpectedVersion}`}`,
    );
    console.log("planned actions:");
    for (const action of result.actions) {
      console.log(`- ${action}`);
    }
    console.log("not performed:");
    for (const nonAction of result.nonActions) {
      console.log(`- ${nonAction}`);
    }
    return;
  }

  if (result.mode === "status") {
    console.log("status");
    console.log(`root: ${result.rootDir}`);
    console.log(
      `agent-mockingbird: ${result.agentMockingbirdVersion ?? "not installed"}`,
    );
    console.log(`executor: ${result.executorVersion ?? "not installed"}`);
    console.log(`executor-mode: ${result.executorMode ?? "unknown"}`);
    console.log(`runtime: ${result.runtimeMode ?? "unknown"}`);
    console.log(`opencode: ${result.opencodeVersion ?? "not installed"}`);
    console.log(
      `units: ${UNIT_EXECUTOR}=${result.unitStates[UNIT_EXECUTOR]}, ${UNIT_AGENT_MOCKINGBIRD}=${result.unitStates[UNIT_AGENT_MOCKINGBIRD]}`,
    );
    console.log(
      `health: ${result.health.ok ? "ok" : `failed (${result.health.status})`}`,
    );
    if (result.commandResolution) {
      console.log(`managed-root: ${result.commandResolution.rootDir}`);
      console.log(`managed-cli: ${result.commandResolution.managedCliPath || "unavailable"}`);
      console.log(`command: ${result.commandResolution.commandPath || "unresolved"}`);
      console.log(`command-mode: ${result.commandResolution.mode}`);
    }
    return;
  }

  if (
    result.mode === "restart" ||
    result.mode === "start" ||
    result.mode === "stop"
  ) {
    console.log(`${result.mode} complete`);
    console.log(`root: ${result.rootDir}`);
    console.log(
      `agent-mockingbird: ${result.agentMockingbirdVersion ?? "not installed"}`,
    );
    console.log(`executor: ${result.executorVersion ?? "not installed"}`);
    console.log(`executor-mode: ${result.executorMode ?? "unknown"}`);
    console.log(`runtime: ${result.runtimeMode ?? "unknown"}`);
    console.log(`opencode: ${result.opencodeVersion ?? "not installed"}`);
    console.log(
      `units: ${UNIT_EXECUTOR}=${result.unitStates[UNIT_EXECUTOR]}, ${UNIT_AGENT_MOCKINGBIRD}=${result.unitStates[UNIT_AGENT_MOCKINGBIRD]}`,
    );
    console.log(
      `health: ${result.health.ok ? "ok" : `failed (${result.health.status})`}`,
    );
    if (result.commandResolution) {
      console.log(`managed-root: ${result.commandResolution.rootDir}`);
      console.log(`managed-cli: ${result.commandResolution.managedCliPath || "unavailable"}`);
      console.log(`command: ${result.commandResolution.commandPath || "unresolved"}`);
      console.log(`command-mode: ${result.commandResolution.mode}`);
    }
    return;
  }

  if (result.mode === "uninstall") {
    console.log(
      `uninstall complete: ${result.purgeData ? `removed ${result.rootDir}` : `removed services/runtime, kept data in ${result.rootDir}`}`,
    );
    console.log(`cli shim removed: ${result.removedShim ? "yes" : "no"}`);
    console.log(
      `opencode shim removed: ${result.removedOpencodeShim ? "yes" : "no"}`,
    );
    return;
  }

  if (result.mode === "onboard") {
    if (result.onboarding?.status === "completed") {
      console.log("onboard complete");
      if (result.onboarding.authAttempts > 0) {
        console.log(
          `provider auth attempts: ${result.onboarding.authAttempts}`,
        );
        if (result.onboarding.authRefresh) {
          console.log(
            `provider auth refresh: ${result.onboarding.authRefresh.ok ? "ok" : "skipped/failed"}`,
          );
        }
      }
      if (result.onboarding.selectedModel) {
        console.log(`default model: ${result.onboarding.selectedModel}`);
      }
      if (result.onboarding.memoryEmbedding) {
        if (result.onboarding.memoryEmbedding.configured === false) {
          console.log(
            `memory embeddings: skipped (${result.onboarding.memoryEmbedding.reason ?? "not-configured"})`,
          );
        } else {
          console.log(
            `memory enabled: ${result.onboarding.memoryEmbedding.enabled ? "yes" : "no"}`,
          );
          if (result.onboarding.memoryEmbedding.ollamaBaseUrl) {
            console.log(
              `memory ollama: ${result.onboarding.memoryEmbedding.ollamaBaseUrl}`,
            );
          }
          if (result.onboarding.memoryEmbedding.embedModel) {
            console.log(
              `memory embedModel: ${result.onboarding.memoryEmbedding.embedModel}`,
            );
          }
        }
      }
      if (result.onboarding.openclawMigration) {
        const migration = result.onboarding.openclawMigration;
        if (
          migration.attempted &&
          !migration.skipped &&
          migration.migration?.summary
        ) {
          console.log("openclaw migration: completed");
          const summary = migration.migration.summary;
          console.log(
            `openclaw summary: discovered=${summary.discovered ?? 0}, copied=${summary.copied ?? 0}, merged=${summary.merged ?? 0}, skippedExisting=${summary.skippedExisting ?? 0}, skippedIdentical=${summary.skippedIdentical ?? 0}, skippedProtected=${summary.skippedProtected ?? 0}, failed=${summary.failed ?? 0}`,
          );
          if (migration.memorySync?.attempted) {
            console.log(
              `openclaw memory sync: ${migration.memorySync.completed ? "completed" : "failed"}`,
            );
          }
        } else if (migration.error) {
          console.log(`openclaw migration: failed (${migration.error})`);
        } else {
          console.log(
            `openclaw migration: skipped (${migration.reason ?? "not-requested"})`,
          );
        }
      }
      return;
    }
    if (result.onboarding?.status === "skipped") {
      console.log(`onboard skipped: ${result.onboarding.reason}`);
      return;
    }
    if (result.onboarding?.status === "error") {
      console.log(`onboard failed: ${result.onboarding.message}`);
      if (Array.isArray(result.onboarding.diagnostics)) {
        for (const line of result.onboarding.diagnostics) {
          console.log(line);
        }
      }
      return;
    }
    console.log("onboard complete");
    return;
  }
}

function evaluateResult(result) {
  const isActive =
    result?.unitStates?.[UNIT_EXECUTOR] === "active" &&
    result?.unitStates?.[UNIT_AGENT_MOCKINGBIRD] === "active";
  if (result.mode === "install" || result.mode === "update") {
    if (
      !result.health?.ok ||
      !result.verify?.agentMockingbirdServiceOk ||
      !result.verify?.executorServiceOk ||
      !result.verify?.frontendAssetsOk
    ) {
      return 2;
    }
    return 0;
  }
  if (
    result.mode === "status" ||
    result.mode === "restart" ||
    result.mode === "start"
  ) {
    return isActive && result.health?.ok ? 0 : 2;
  }
  if (result.mode === "update-dry-run") {
    return result.precheck.npm && result.precheck.systemdUser ? 0 : 2;
  }
  if (result.mode === "stop") {
    const stopped =
      result?.unitStates?.[UNIT_EXECUTOR] !== "active" &&
      result?.unitStates?.[UNIT_AGENT_MOCKINGBIRD] !== "active";
    return stopped ? 0 : 2;
  }
  if (result.mode === "onboard") {
    return result.onboarding?.status === "error" ? 2 : 0;
  }
  return 0;
}

async function main() {
  const args = applyDefaultInstallTarget(parseArgs(process.argv.slice(2)));
  if (!args.command || args.command === "help") {
    printHelp();
    if (!args.command) {
      console.log(
        "\nHint: run `agent-mockingbird status` to check service health.",
      );
    }
    return;
  }

  let result;
  if (args.command === "install") {
    if (args.dryRun) {
      throw new Error(
        "--dry-run is supported for `agent-mockingbird update` only.",
      );
    }
    result = await installOrUpdate(args, "install");
  } else if (args.command === "update") {
    if (args.dryRun) {
      result = buildUpdateDryRun({
        args,
        paths: pathsFor({
          rootDir: args.rootDir,
          scope: args.scope,
          userUnitDir: USER_UNIT_DIR,
        }),
      });
    } else {
      result = await installOrUpdate(args, "update");
    }
  } else if (args.command === "onboard") {
    if (args.dryRun) {
      throw new Error(
        "--dry-run is not applicable to `agent-mockingbird onboard`.",
      );
    }
    result = await runOnboardingCommand(args);
  } else if (args.command === "status") {
    result = await status(args);
  } else if (args.command === "restart") {
    result = await manageService(args, "restart");
  } else if (args.command === "start") {
    result = await manageService(args, "start");
  } else if (args.command === "stop") {
    result = await manageService(args, "stop");
  } else if (args.command === "uninstall") {
    result = await uninstall(args);
  } else if (args.command === "import-openclaw-legacy") {
    throw new Error(
      "`agent-mockingbird import openclaw ...` is deprecated. Use `agent-mockingbird onboard` and pick the OpenClaw flow.",
    );
  } else {
    throw new Error(`Unknown command: ${args.command}`);
  }

  if (
    result &&
    typeof result === "object" &&
    "rootDir" in result &&
    typeof result.rootDir === "string"
  ) {
    result.commandResolution = collectCommandResolution({
      rootDir: result.rootDir,
      scope: args.scope,
    });
  }

  printResult(result, args.json);
  process.exitCode = evaluateResult(result);
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
