#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { syncRuntimeWorkspaceAssets } from "./runtime-assets.mjs";

const { console, fetch } = globalThis;

const DEFAULT_SCOPE = "waffleophagus";
const DEFAULT_REGISTRY_URL = "https://git.waffleophagus.com/api/packages/waffleophagus/npm/";
const PUBLIC_NPM_REGISTRY = "https://registry.npmjs.org/";
const DEFAULT_TAG = "latest";
const DEFAULT_ROOT_DIR = path.join(os.homedir(), ".wafflebot");
const USER_UNIT_DIR = path.join(os.homedir(), ".config", "systemd", "user");
const UNIT_OPENCODE = "opencode.service";
const UNIT_WAFFLEBOT = "wafflebot.service";
const WAFFLEBOT_API_BASE_URL = "http://127.0.0.1:3001";
const DEFAULT_ENABLED_SKILLS = ["config-editor", "config-auditor", "runtime-diagnose", "memory-ops"];

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
    rootDir: DEFAULT_ROOT_DIR,
    importGitUrl: undefined,
    importPath: undefined,
    importRef: undefined,
    importTargetDir: undefined,
    previewId: undefined,
    overwritePaths: [],
    skipPaths: [],
    skipMemorySync: false,
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
    if (arg === "--skip-memory-sync") {
      args.skipMemorySync = true;
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
      i += 1;
      continue;
    }
    if (arg === "--version" && next) {
      args.version = next;
      i += 1;
      continue;
    }
    if (arg === "--root-dir" && next) {
      args.rootDir = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--git" && next) {
      args.importGitUrl = next;
      i += 1;
      continue;
    }
    if (arg === "--path" && next) {
      args.importPath = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--ref" && next) {
      args.importRef = next;
      i += 1;
      continue;
    }
    if (arg === "--target-dir" && next) {
      args.importTargetDir = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--preview-id" && next) {
      args.previewId = next;
      i += 1;
      continue;
    }
    if (arg === "--overwrite" && next) {
      args.overwritePaths.push(next);
      i += 1;
      continue;
    }
    if (arg === "--skip-path" && next) {
      args.skipPaths.push(next);
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (positionals.length > 0) {
    args.positionals = positionals;
    if (positionals[0] === "import" && positionals[1] === "openclaw" && positionals[2] === "preview") {
      args.command = "import-openclaw-preview";
    } else if (positionals[0] === "import" && positionals[1] === "openclaw" && positionals[2] === "apply") {
      args.command = "import-openclaw-apply";
    } else {
      args.command = positionals[0];
    }
  }

  args.registryUrl = normalizeRegistryUrl(args.registryUrl);
  return args;
}

function normalizeRegistryUrl(url) {
  const trimmed = (url || "").trim();
  if (!trimmed) {
    return DEFAULT_REGISTRY_URL;
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function printHelp() {
  console.log(`wafflebot\n\nUsage:\n  wafflebot <install|update|onboard|status|restart|start|stop|uninstall> [flags]\n  wafflebot import openclaw preview (--git <url> [--ref <ref>] | --path <dir>) [--target-dir <dir>] [--json]\n  wafflebot import openclaw apply --preview-id <id> [--overwrite <path> ...] [--skip-path <path> ...] [--skip-memory-sync] [--json]\n\nFlags:\n  --registry-url <url>   Scoped npm registry (default: ${DEFAULT_REGISTRY_URL})\n  --scope <scope>        Package scope (default: ${DEFAULT_SCOPE})\n  --tag <tag>            Dist-tag when --version not set (default: ${DEFAULT_TAG})\n  --version <version>    Exact wafflebot version\n  --root-dir <path>      Install root (default: ${DEFAULT_ROOT_DIR})\n  --yes, -y              Non-interactive\n  --json                 JSON output\n  --dry-run              Preview update actions without mutating (update only)\n  --skip-linger          Skip loginctl enable-linger\n  --purge-data           Uninstall: remove ${DEFAULT_ROOT_DIR}/data and workspace\n  --keep-data            Uninstall: keep data/workspace even when --yes\n  --help, -h             Show help`);
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
  return [
    heading(title),
    ...lines,
  ];
}

function sleep(ms) {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms));
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
    throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function commandExists(command) {
  const result = shell("bash", ["-lc", `command -v ${command}`]);
  return result.code === 0;
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

async function promptRuntimeAssetConflictDecision(conflict) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return "use-packaged";
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
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

function prepareRuntimeAssetsSourceDir(wafflebotAppDir) {
  const packagedRuntimeAssetsDir = path.join(wafflebotAppDir, "runtime-assets", "workspace");
  if (fs.existsSync(packagedRuntimeAssetsDir)) {
    return {
      sourceDir: packagedRuntimeAssetsDir,
      tempDir: null,
      fallbackUsed: false,
    };
  }

  const legacySkillsDir = path.join(wafflebotAppDir, ".agents", "skills");
  if (!fs.existsSync(legacySkillsDir)) {
    throw new Error(
      `runtime assets missing in package: expected ${packagedRuntimeAssetsDir} (or legacy fallback ${legacySkillsDir})`,
    );
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wafflebot-runtime-assets-"));
  const tempSourceDir = path.join(tempDir, "workspace");
  const tempSkillsDir = path.join(tempSourceDir, ".agents", "skills");
  ensureDir(path.dirname(tempSkillsDir));
  fs.cpSync(legacySkillsDir, tempSkillsDir, { recursive: true, force: true });
  writeFile(
    path.join(tempSourceDir, "AGENTS.md"),
    [
      "# Wafflebot Runtime Agent Guide",
      "",
      "This workspace was initialized from legacy packaged skills fallback.",
      "Prefer configured skills in `.agents/skills` and follow direct user instructions.",
      "",
    ].join("\n"),
  );
  writeFile(
    path.join(tempSourceDir, "MEMORY.md"),
    ["# Memory Index", "", "Store durable notes in `memory/*.md`.", ""].join("\n"),
  );

  return {
    sourceDir: tempSourceDir,
    tempDir,
    fallbackUsed: true,
  };
}

async function ensureDefaultRuntimeSkillsWhenEmpty(input = {}) {
  const retries = typeof input.retries === "number" ? Math.max(1, input.retries) : 5;
  const delayMs = typeof input.delayMs === "number" ? Math.max(100, input.delayMs) : 750;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const configResponse = await fetch(`${WAFFLEBOT_API_BASE_URL}/api/config`, { method: "GET" });
      if (!configResponse.ok) {
        throw new Error(`GET /api/config failed (${configResponse.status})`);
      }
      const payload = await configResponse.json();
      const currentSkills = Array.isArray(payload?.config?.ui?.skills)
        ? payload.config.ui.skills.filter((value) => typeof value === "string" && value.trim().length > 0)
        : [];
      if (currentSkills.length > 0) {
        return {
          attempted: true,
          updated: false,
          reason: "existing skills preserved",
          skills: currentSkills,
        };
      }

      const expectedHash = typeof payload?.hash === "string" ? payload.hash.trim() : "";
      if (!expectedHash) {
        throw new Error("Config hash missing from /api/config response");
      }

      const patchResponse = await fetch(`${WAFFLEBOT_API_BASE_URL}/api/config/patch-safe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: {
            ui: {
              skills: DEFAULT_ENABLED_SKILLS,
            },
          },
          expectedHash,
          runSmokeTest: true,
        }),
      });

      const patchPayload = await patchResponse.json().catch(() => ({}));
      if (!patchResponse.ok) {
        const message =
          typeof patchPayload?.error === "string"
            ? patchPayload.error
            : `POST /api/config/patch-safe failed (${patchResponse.status})`;
        throw new Error(message);
      }

      const nextSkills = Array.isArray(patchPayload?.snapshot?.config?.ui?.skills)
        ? patchPayload.snapshot.config.ui.skills
        : DEFAULT_ENABLED_SKILLS;
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

function pathsFor(rootDir, scope) {
  const normalizedScope = scope.replace(/^@/, "");
  const npmPrefix = path.join(rootDir, "npm");
  const localBinDir = path.join(os.homedir(), ".local", "bin");
  return {
    rootDir,
    npmPrefix,
    localBinDir,
    wafflebotShimPath: path.join(localBinDir, "wafflebot"),
    opencodeShimPath: path.join(localBinDir, "opencode"),
    dataDir: path.join(rootDir, "data"),
    workspaceDir: path.join(rootDir, "workspace"),
    logsDir: path.join(rootDir, "logs"),
    etcDir: path.join(rootDir, "etc"),
    npmrcPath: path.join(rootDir, "etc", "npmrc"),
    wafflebotAppDirGlobal: path.join(npmPrefix, "lib", "node_modules", `@${normalizedScope}`, "wafflebot"),
    wafflebotAppDirLocal: path.join(npmPrefix, "node_modules", `@${normalizedScope}`, "wafflebot"),
    wafflebotBinGlobal: path.join(npmPrefix, "bin", "wafflebot"),
    wafflebotBinLocal: path.join(npmPrefix, "node_modules", ".bin", "wafflebot"),
    opencodeBinGlobal: path.join(npmPrefix, "bin", "opencode"),
    opencodeBinLocal: path.join(npmPrefix, "node_modules", ".bin", "opencode"),
    bunBinManagedGlobal: path.join(npmPrefix, "bin", "bun"),
    bunBinManagedLocal: path.join(npmPrefix, "node_modules", ".bin", "bun"),
    bunBinTools: path.join(rootDir, "tools", "bun", "bin", "bun"),
    opencodeUnitPath: path.join(USER_UNIT_DIR, UNIT_OPENCODE),
    wafflebotUnitPath: path.join(USER_UNIT_DIR, UNIT_WAFFLEBOT),
  };
}

function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveWafflebotAppDir(paths) {
  return firstExistingPath([paths.wafflebotAppDirGlobal, paths.wafflebotAppDirLocal]);
}

function resolveWafflebotBin(paths) {
  return firstExistingPath([paths.wafflebotBinGlobal, paths.wafflebotBinLocal]);
}

function resolveWafflebotServiceEntrypoint(wafflebotAppDir) {
  const pkgPath = path.join(wafflebotAppDir, "package.json");
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

  candidates.push("src/index.ts", "src/index.js", "dist/index.js", "index.js");
  for (const relPath of candidates) {
    const absolutePath = path.join(wafflebotAppDir, relPath);
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }
  return null;
}

function resolveOpencodeBin(paths) {
  return firstExistingPath([paths.opencodeBinGlobal, paths.opencodeBinLocal]);
}

function resolveBunBinary(paths) {
  if (commandExists("bun")) {
    const out = shell("bash", ["-lc", "command -v bun"]);
    return out.stdout.trim();
  }
  return firstExistingPath([paths.bunBinManagedGlobal, paths.bunBinManagedLocal, paths.bunBinTools]);
}

function tryInstallBun(paths) {
  try {
    npmInstall(paths.npmPrefix, ["bun@latest"], ["-g", "--registry", PUBLIC_NPM_REGISTRY]);
  } catch {
    // Fallback below.
  }
  if (resolveBunBinary(paths)) {
    return;
  }

  if (!commandExists("curl")) {
    throw new Error("bun is not installed and curl is unavailable for bun.com fallback install.");
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
  if (fallback.code !== 0 || !resolveBunBinary(paths)) {
    throw new Error("Failed to install bun via npm and bun.com install script fallback.");
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
  const args = ["install", "--no-audit", "--no-fund", "--prefix", prefix, ...extraArgs, ...packages];
  must("npm", args, { stdio: "inherit", env });
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
  const rcFiles = [".bashrc", ".zshrc", ".profile"].map(name => path.join(os.homedir(), name));
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

function writeWafflebotShim(paths, wafflebotBin) {
  ensureDir(paths.localBinDir);
  const shim = `#!/usr/bin/env bash
set -euo pipefail
# managed-by: wafflebot-installer
exec "${wafflebotBin}" "$@"
`;
  writeFile(paths.wafflebotShimPath, shim);
  fs.chmodSync(paths.wafflebotShimPath, 0o755);
  return paths.wafflebotShimPath;
}

function writeOpencodeShim(paths, opencodeBin) {
  ensureDir(paths.localBinDir);
  const shim = `#!/usr/bin/env bash
set -euo pipefail
# managed-by: wafflebot-installer
exec "${opencodeBin}" "$@"
`;
  writeFile(paths.opencodeShimPath, shim);
  fs.chmodSync(paths.opencodeShimPath, 0o755);
  return paths.opencodeShimPath;
}

function removeWafflebotShim(paths) {
  if (!fs.existsSync(paths.wafflebotShimPath)) {
    return false;
  }
  const content = fs.readFileSync(paths.wafflebotShimPath, "utf8");
  if (!content.includes("managed-by: wafflebot-installer")) {
    return false;
  }
  fs.rmSync(paths.wafflebotShimPath, { force: true });
  return true;
}

function removeOpencodeShim(paths) {
  if (!fs.existsSync(paths.opencodeShimPath)) {
    return false;
  }
  const content = fs.readFileSync(paths.opencodeShimPath, "utf8");
  if (!content.includes("managed-by: wafflebot-installer")) {
    return false;
  }
  fs.rmSync(paths.opencodeShimPath, { force: true });
  return true;
}

function unitContents(paths, bunBin, opencodeBin, wafflebotAppDir, wafflebotEntrypoint) {
  const opencode = `[Unit]\nDescription=OpenCode Sidecar for Wafflebot (user service)\nAfter=network.target\nWants=network.target\n\n[Service]\nType=simple\nWorkingDirectory=${paths.workspaceDir}\nEnvironment=WAFFLEBOT_PORT=3001\nEnvironment=WAFFLEBOT_MEMORY_API_BASE_URL=http://127.0.0.1:3001\nExecStart=${opencodeBin} serve --hostname 127.0.0.1 --port 4096 --print-logs --log-level INFO\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n`;

  const wafflebot = `[Unit]\nDescription=Wafflebot API and Dashboard (user service)\nAfter=network.target ${UNIT_OPENCODE}\nWants=network.target ${UNIT_OPENCODE}\n\n[Service]\nType=simple\nWorkingDirectory=${wafflebotAppDir}\nEnvironment=NODE_ENV=production\nEnvironment=PORT=3001\nEnvironment=WAFFLEBOT_CONFIG_PATH=${path.join(paths.dataDir, "wafflebot.config.json")}\nEnvironment=WAFFLEBOT_DB_PATH=${path.join(paths.dataDir, "wafflebot.db")}\nEnvironment=WAFFLEBOT_OPENCODE_BASE_URL=http://127.0.0.1:4096\nEnvironment=WAFFLEBOT_MEMORY_WORKSPACE_DIR=${paths.workspaceDir}\nExecStart=${bunBin} ${wafflebotEntrypoint}\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n`;

  return { opencode, wafflebot };
}

function ensureSystemdUserAvailable() {
  const result = shell("systemctl", ["--user", "status"]);
  if (result.code !== 0) {
    throw new Error("systemd user services are unavailable (`systemctl --user status` failed)");
  }
}

function ensureLinger(skipLinger) {
  if (skipLinger) {
    return { changed: false, skipped: true };
  }
  const user = userName();
  const status = shell("loginctl", ["show-user", user, "-p", "Linger"]);
  if (status.code !== 0) {
    return { changed: false, skipped: true, warning: "Could not read linger status via loginctl." };
  }
  if (status.stdout.toLowerCase().includes("linger=yes")) {
    return { changed: false, skipped: false };
  }

  const direct = shell("loginctl", ["enable-linger", user]);
  if (direct.code === 0) {
    return { changed: true, skipped: false };
  }

  const sudo = shell("sudo", ["loginctl", "enable-linger", user], { stdio: "inherit" });
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
  const attempts = Number.isFinite(input.attempts) ? Math.max(1, Math.trunc(input.attempts)) : 6;
  const delayMs = Number.isFinite(input.delayMs) ? Math.max(50, Math.trunc(input.delayMs)) : 500;
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

function runPostInstallVerification() {
  const wafflebotStatus = shell("systemctl", ["--user", "status", UNIT_WAFFLEBOT, "--no-pager"]);
  const opencodeStatus = shell("systemctl", ["--user", "status", UNIT_OPENCODE, "--no-pager"]);
  const linger = shell("loginctl", ["show-user", userName(), "-p", "Linger"]);
  return {
    wafflebotServiceOk: wafflebotStatus.code === 0,
    opencodeServiceOk: opencodeStatus.code === 0,
    lingerOk: linger.code === 0 && linger.stdout.toLowerCase().includes("linger=yes"),
    commandOutput: {
      wafflebotStatus: (wafflebotStatus.stdout || wafflebotStatus.stderr).trim(),
      opencodeStatus: (opencodeStatus.stdout || opencodeStatus.stderr).trim(),
      linger: (linger.stdout || linger.stderr).trim(),
    },
  };
}

function checkSystemdUserStatus() {
  const result = shell("systemctl", ["--user", "status"]);
  return result.code === 0;
}

function interactivePrompt(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(message).finally(() => rl.close());
}

async function promptYesNo(message, defaultValue = false) {
  const suffix = defaultValue ? "[Y/n]" : "[y/N]";
  const answer = (await interactivePrompt(`${message} ${suffix} `)).trim().toLowerCase();
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
  const hasBun = Boolean(resolveBunBinary(paths));
  const hasSystemdUser = checkSystemdUserStatus();
  const hasLoginctl = commandExists("loginctl");
  const hasCurl = commandExists("curl");
  return summarizeActionPlan("Install plan", [
    `- Target package: @${args.scope.replace(/^@/, "")}/wafflebot (${target})`,
    `- Private registry scope: @${args.scope.replace(/^@/, "")} -> ${args.registryUrl}`,
    `- Public registry fallback: ${PUBLIC_NPM_REGISTRY} (for non-scope deps, bun, opencode-ai)`,
    `- Install root: ${paths.rootDir}`,
    "",
    "What will happen:",
    `1. Validate required tools: npm + systemd user services.`,
    `   - npm: ${commandExists("npm") ? success("found") : errorText("missing")}`,
    `   - systemctl --user: ${hasSystemdUser ? success("available") : errorText("unavailable")}`,
    "2. Ensure Bun runtime for service command.",
    hasBun
      ? `   - bun: ${success(`found at ${resolveBunBinary(paths)}`)}`
      : `   - bun: ${warn(`not found, will install (npm bun@latest${hasCurl ? " with bun.com/install fallback" : ""})`)}`,
    "3. Install/refresh OpenCode CLI dependency (`opencode-ai@latest`) from npmjs.",
    `4. Install Wafflebot package (@${args.scope.replace(/^@/, "")}/wafflebot) from your scoped registry.`,
    "5. Create/refresh runtime directories under the install root.",
    `6. Install CLI shims at ${paths.wafflebotShimPath} and ${paths.opencodeShimPath}, and ensure ${paths.localBinDir} is on PATH.`,
    `7. Seed workspace skills from bundled package into ${path.join(paths.workspaceDir, ".agents", "skills")}.`,
    `8. Write user services: ${paths.opencodeUnitPath} and ${paths.wafflebotUnitPath}.`,
    "9. Reload systemd user daemon and enable/start both services.",
    args.skipLinger
      ? "10. Skip linger configuration (--skip-linger set)."
      : `10. Attempt loginctl linger so services survive logout/reboot${hasLoginctl ? "" : " (loginctl missing; may require manual setup)"}.`,
    "11. Run health checks, and initialize default enabled skills if config has none.",
    "",
    info("After install (interactive only), a provider onboarding wizard can launch OpenCode auth and set a default model."),
  ]);
}

function buildUpdateSummary({ args, paths }) {
  const target = args.version ?? `tag:${args.tag}`;
  const hasBun = Boolean(resolveBunBinary(paths));
  const hasSystemdUser = checkSystemdUserStatus();
  const hasLoginctl = commandExists("loginctl");
  const hasCurl = commandExists("curl");
  return summarizeActionPlan("Update plan", [
    `- Update target: @${args.scope.replace(/^@/, "")}/wafflebot (${target})`,
    `- Install root: ${paths.rootDir}`,
    "",
    "What this update does:",
    "1. Refresh Wafflebot package + OpenCode CLI dependency.",
    `2. Ensure Bun runtime is available${hasBun ? ` (${success("already present")})` : ` (${warn(`will install${hasCurl ? " with curl fallback" : ""}`)})`}.`,
    "3. Re-seed workspace skills from bundled package.",
    "4. Re-write CLI shim + systemd user units to current paths/entrypoint.",
    "   - Includes wafflebot + opencode shims in ~/.local/bin",
    "5. Reload daemon, enable/start services, then force restart both units.",
    args.skipLinger
      ? "6. Skip linger configuration (--skip-linger set)."
      : `6. Re-check linger and enable when missing${hasLoginctl ? "" : " (loginctl missing; may require manual setup)"}.`,
    "7. Run health + service verification, and initialize default enabled skills if config has none.",
    "",
    "What this update does not do:",
    `- It does not wipe ${paths.dataDir} or ${paths.workspaceDir}.`,
    "- It does not uninstall/recreate services from scratch unless unit contents changed.",
    "- It does not reset runtime configuration, DB data, sessions, skills, or agents.",
    `- It does not rerun full onboarding unless you manually run ${paint("wafflebot install", ANSI.bold)} again.`,
    "",
    `Precheck: systemctl --user ${hasSystemdUser ? success("available") : errorText("unavailable (update will fail)")}`,
  ]);
}

function buildUpdateDryRun({ args, paths }) {
  const target = args.version ?? `tag:${args.tag}`;
  const hasBun = Boolean(resolveBunBinary(paths));
  const hasSystemdUser = checkSystemdUserStatus();
  const hasLoginctl = commandExists("loginctl");

  const actions = [
    `Refresh package @${args.scope.replace(/^@/, "")}/wafflebot (${target})`,
    "Refresh opencode-ai dependency",
    hasBun ? "Reuse existing Bun runtime" : "Install Bun runtime if missing",
    "Reseed workspace skills from bundled package",
    "Rewrite wafflebot CLI shim",
    "Rewrite opencode CLI shim",
    "Rewrite systemd user unit files for opencode + wafflebot",
    "systemctl --user daemon-reload + enable --now opencode.service wafflebot.service",
    "systemctl --user restart opencode.service wafflebot.service",
    args.skipLinger
      ? "Skip loginctl linger step (--skip-linger)"
      : "Check/enable loginctl linger when needed",
    `GET ${WAFFLEBOT_API_BASE_URL}/api/health`,
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
      bunPresent: hasBun,
    },
    actions,
    nonActions,
  };
}

async function runOnboardingCommand(args) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Onboarding command requires an interactive TTY.");
  }
  const paths = pathsFor(args.rootDir, args.scope);
  const opencodeBin = resolveOpencodeBin(paths) ?? (commandExists("opencode") ? "opencode" : null);
  if (!opencodeBin) {
    throw new Error("opencode binary not found. Run `wafflebot install` first.");
  }
  const onboarding = await runInteractiveProviderOnboarding({ opencodeBin });
  return {
    mode: "onboard",
    rootDir: paths.rootDir,
    onboarding,
  };
}

async function importOpenclawPreview(args) {
  const hasGit = Boolean(args.importGitUrl);
  const hasPath = Boolean(args.importPath);
  if (hasGit === hasPath) {
    throw new Error("Specify exactly one source: --git <url> or --path <dir>.");
  }

  const source = hasGit
    ? {
        mode: "git",
        url: args.importGitUrl,
        ref: args.importRef || undefined,
      }
    : {
        mode: "local",
        path: args.importPath,
      };

  const response = await fetch(`${WAFFLEBOT_API_BASE_URL}/api/config/opencode/bootstrap/import-openclaw/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source,
      targetDirectory: args.importTargetDir || undefined,
    }),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message =
      typeof payload?.error === "string" ? payload.error : "Failed to preview OpenClaw import";
    throw new Error(message);
  }

  return {
    mode: "import-openclaw-preview",
    preview: payload.preview ?? {},
  };
}

async function importOpenclawApply(args) {
  const previewId = (args.previewId || "").trim();
  if (!previewId) {
    throw new Error("--preview-id is required.");
  }

  const response = await fetch(`${WAFFLEBOT_API_BASE_URL}/api/config/opencode/bootstrap/import-openclaw/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      previewId,
      overwritePaths: args.overwritePaths,
      skipPaths: args.skipPaths,
      runMemorySync: args.skipMemorySync ? false : true,
    }),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : "Failed to apply OpenClaw import";
    throw new Error(message);
  }

  return {
    mode: "import-openclaw-apply",
    applied: payload.applied ?? {},
  };
}

async function confirmInstall(args, paths, mode) {
  if (args.yes) {
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Install is interactive by default. Re-run with --yes in non-interactive environments.");
  }

  const summaryLines =
    mode === "update" ? buildUpdateSummary({ args, paths }) : buildInstallSummary({ args, paths });
  for (const line of summaryLines) {
    console.log(line);
  }
  console.log("");

  const proceed = await promptYesNo(`Proceed with ${mode === "update" ? "update" : "install"}?`, false);
  if (!proceed) {
    throw new Error("Aborted by user.");
  }
}

function packageSpec(scope, version, tag) {
  const normalizedScope = scope.replace(/^@/, "");
  const target = version || tag;
  return `@${normalizedScope}/wafflebot@${target}`;
}

function readInstalledVersion(paths) {
  const appDir = resolveWafflebotAppDir(paths);
  if (!appDir) {
    return null;
  }
  const pkgPath = path.join(appDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  return readJson(pkgPath).version ?? null;
}

function readInstalledOpenCodeVersion(paths) {
  const pkgPath = path.join(paths.npmPrefix, "lib", "node_modules", "opencode-ai", "package.json");
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  return readJson(pkgPath).version ?? null;
}

async function fetchRuntimeDefaultModel() {
  try {
    const response = await fetch(`${WAFFLEBOT_API_BASE_URL}/api/config`, { method: "GET" });
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
    const response = await fetch(`${WAFFLEBOT_API_BASE_URL}/api/opencode/models`, { method: "GET" });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload?.models)) {
      return [];
    }
    return payload.models
      .map(model => ({
        id: typeof model?.id === "string" ? model.id.trim() : "",
        providerId: typeof model?.providerId === "string" ? model.providerId.trim() : "",
        modelId: typeof model?.modelId === "string" ? model.modelId.trim() : "",
        label: typeof model?.label === "string" ? model.label.trim() : "",
      }))
      .filter(model => model.id);
  } catch {
    return [];
  }
}

async function fetchRuntimeModelOptionsWithRetry(input = {}) {
  const attempts = typeof input.attempts === "number" ? Math.max(1, input.attempts) : 8;
  const delayMs = typeof input.delayMs === "number" ? Math.max(100, input.delayMs) : 1_000;
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

async function restartOpencodeServiceForAuthRefresh() {
  if (!checkSystemdUserStatus()) {
    return {
      attempted: false,
      ok: false,
      message: "systemctl --user unavailable; skipping automatic OpenCode restart.",
    };
  }
  const restarted = shell("systemctl", ["--user", "restart", UNIT_OPENCODE]);
  if (restarted.code !== 0) {
    const detail = (restarted.stderr || restarted.stdout).trim() || "unknown error";
    return {
      attempted: true,
      ok: false,
      message: `Failed to restart ${UNIT_OPENCODE}: ${detail}`,
    };
  }
  await sleep(1_500);
  return {
    attempted: true,
    ok: true,
    message: `${UNIT_OPENCODE} restarted to refresh provider credentials.`,
  };
}

async function fetchRuntimeProviderOptions() {
  const models = await fetchRuntimeModelOptions();
  const providers = new Map();
  for (const model of models) {
    const providerId = model.providerId?.trim() || (model.id.includes("/") ? model.id.split("/")[0] : "");
    if (!providerId) continue;
    const current = providers.get(providerId) ?? { providerId, count: 0 };
    current.count += 1;
    providers.set(providerId, current);
  }
  return [...providers.values()]
    .sort((a, b) => a.providerId.localeCompare(b.providerId))
    .map(provider => ({
      value: provider.providerId,
      label: provider.providerId,
      hint: `${provider.count} discovered model${provider.count === 1 ? "" : "s"}`,
    }));
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
  return tokens.every(token => haystack.includes(token));
}

async function promptSearchableModelChoice(input) {
  const { modelOptions, currentModel } = input;
  const pageSize = 12;
  let query = "";
  let page = 0;

  while (true) {
    const filtered = modelOptions.filter(option => matchesSearchQuery(option, query));
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page >= totalPages) page = 0;

    const startIndex = page * pageSize;
    const pageItems = filtered.slice(startIndex, startIndex + pageSize);

    const titleParts = ["Select a default model"];
    if (query) titleParts.push(`search="${query}"`);
    titleParts.push(`matches=${filtered.length}`);
    titleParts.push(`page=${page + 1}/${totalPages}`);

    const options = [
      ...pageItems.map(option => ({
        value: option.id,
        label: option.label || option.id,
        hint: option.id,
      })),
    ];

    if (filtered.length > 0 && page < totalPages - 1) {
      options.push({ value: "__next__", label: "Next page", hint: "Show more results" });
    }
    if (filtered.length > 0 && page > 0) {
      options.push({ value: "__prev__", label: "Previous page" });
    }
    options.push({ value: "__search__", label: "Change search query", hint: query ? "Edit query" : "Find by provider/model name" });
    options.push({ value: "__manual__", label: "Enter manually", hint: "Type provider/model yourself" });
    options.push({ value: "__keep__", label: "Keep current", hint: currentModel || "No change" });

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
      query = (await promptText("Search models (provider, model, id)", query)).trim();
      page = 0;
      continue;
    }
    return selection.value;
  }
}

async function setRuntimeDefaultModel(modelRef) {
  const response = await fetch(`${WAFFLEBOT_API_BASE_URL}/api/runtime/default-model`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelRef }),
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : "Failed to set runtime default model";
    throw new Error(message);
  }
}

async function fetchRuntimeMemoryConfig() {
  try {
    const response = await fetch(`${WAFFLEBOT_API_BASE_URL}/api/config`, { method: "GET" });
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
      embedModel: typeof memory?.embedModel === "string" && memory.embedModel.trim()
        ? memory.embedModel.trim()
        : "qwen3-embedding:4b",
      ollamaBaseUrl: typeof memory?.ollamaBaseUrl === "string" && memory.ollamaBaseUrl.trim()
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
  const response = await fetch(`${WAFFLEBOT_API_BASE_URL}/api/config`, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Failed to read runtime config hash (${response.status})`);
  }
  const payload = await response.json();
  const expectedHash = typeof payload?.hash === "string" ? payload.hash.trim() : "";
  if (!expectedHash) {
    throw new Error("Runtime config hash missing from /api/config response");
  }
  return expectedHash;
}

async function setRuntimeMemoryEmbeddingConfig(input) {
  const expectedHash = await fetchRuntimeConfigHash();
  const response = await fetch(`${WAFFLEBOT_API_BASE_URL}/api/config/patch-safe`, {
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
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : "Failed to update memory embedding config";
    throw new Error(message);
  }
}

async function fetchOllamaModels(ollamaBaseUrl) {
  const base = ollamaBaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/api/tags`, { method: "GET" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama tags request failed: ${response.status} ${text}`.trim());
  }
  const payload = await response.json();
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const names = models
    .map(model => {
      if (typeof model?.name === "string" && model.name.trim()) return model.name.trim();
      if (typeof model?.model === "string" && model.model.trim()) return model.model.trim();
      return "";
    })
    .filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

async function promptSearchableStringChoice(input) {
  const { title = "Select value", values, currentValue, searchPrompt = "Search", manualLabel = "Enter manually", keepLabel = "Keep current" } = input;
  const pageSize = 12;
  let query = "";
  let page = 0;

  while (true) {
    const filtered = values.filter(value => matchesSearchQuery({ label: value, id: value, providerId: "", modelId: "" }, query));
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (page >= totalPages) page = 0;
    const pageItems = filtered.slice(page * pageSize, page * pageSize + pageSize);

    const options = [
      ...pageItems.map(value => ({
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
    options.push({ value: "__search__", label: "Change search query", hint: query ? `Current: ${query}` : "Filter the list" });
    options.push({ value: "__manual__", label: manualLabel });
    options.push({ value: "__keep__", label: keepLabel, hint: currentValue || "No change" });

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

async function runInteractiveProviderOnboarding(input) {
  const { opencodeBin } = input;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return { status: "skipped", reason: "non-interactive" };
  }

  console.log("");
  console.log(heading("Wafflebot onboarding"));
  console.log(info("Optional: connect inference providers through OpenCode and pick a default runtime model."));

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
      value: "skip",
      label: "Skip for now",
      hint: "You can rerun later with wafflebot status + dashboard settings",
    },
  ]);

  if (pathChoice.value === "skip") {
    return { status: "skipped", reason: "user-skip" };
  }

  let authAttempts = 0;
  let authSuccess = false;
  let authRefresh = null;
  if (pathChoice.value === "quickstart") {
    console.log("");
    console.log(heading("Provider auth"));
    console.log(info("Current OpenCode credentials:"));
    shell(opencodeBin, ["auth", "list"], { stdio: "inherit" });
    const discoveredProviders = await fetchRuntimeProviderOptions();

    while (true) {
      const selection = await promptSelect(
        "Connect a provider",
        [
          {
            value: "__picker__",
            label: "OpenCode interactive provider picker (recommended)",
            hint: "Lets OpenCode show supported providers directly",
          },
          ...discoveredProviders,
          {
            value: "__manual__",
            label: "Enter provider slug manually",
            hint: "Use when provider is not in the discovered list",
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
        result = shell(opencodeBin, ["auth", "login"], { stdio: "inherit" });
      } else if (selection.value === "__manual__") {
        const provider = (await promptText("Provider slug", "")).trim();
        if (!provider) {
          const continueChoice = await promptYesNo("No slug provided. Continue auth flow?", true);
          if (!continueChoice) break;
          continue;
        }
        authAttempts += 1;
        result = shell(opencodeBin, ["auth", "login", provider], { stdio: "inherit" });
      } else {
        authAttempts += 1;
        result = shell(opencodeBin, ["auth", "login", selection.value], { stdio: "inherit" });
      }

      if (result.code === 0) {
        authSuccess = true;
        shell(opencodeBin, ["auth", "list"], { stdio: "inherit" });
      } else {
        console.log(warn("OpenCode login attempt did not complete successfully."));
      }
      const addAnother = await promptYesNo("Connect another provider?", false);
      if (!addAnother) break;
    }
    if (authAttempts > 0) {
      console.log("");
      console.log(info("Applying provider auth changes before model selection..."));
      authRefresh = await restartOpencodeServiceForAuthRefresh();
      if (authRefresh.ok) {
        console.log(success(authRefresh.message));
      } else {
        console.log(warn(authRefresh.message));
      }
    }
  }

  const allowModelSetup = pathChoice.value !== "memory-only";
  const setModelNow = allowModelSetup
    ? await promptYesNo("Set runtime default model now?", true)
    : false;
  let selectedModel = "";
  if (setModelNow) {
    const currentModel = await fetchRuntimeDefaultModel();
    const modelOptions =
      authAttempts > 0
        ? await fetchRuntimeModelOptionsWithRetry({ attempts: 10, delayMs: 1_000 })
        : await fetchRuntimeModelOptions();
    console.log("");
    console.log(heading("Default model"));
    if (currentModel) {
      console.log(info(`Current runtime default: ${currentModel}`));
    }
    if (modelOptions.length === 0) {
      const manual = (await promptText("No discovered model list; enter provider/model manually", currentModel || "")).trim();
      if (manual) {
        await setRuntimeDefaultModel(manual);
        selectedModel = manual;
      }
    } else {
      const selection = await promptSearchableModelChoice({
        modelOptions,
        currentModel,
      });
      if (selection === "__manual__") {
        const manual = (await promptText("Enter provider/model", currentModel || "")).trim();
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

  const configureMemoryNow = await promptYesNo("Configure memory embedding model (Ollama) now?", true);
  let memoryEmbedding = null;
  if (configureMemoryNow) {
    const currentMemory = await fetchRuntimeMemoryConfig();
    console.log("");
    console.log(heading("Memory embeddings"));
    console.log(info(`Current provider: ollama`));
    console.log(info(`Current Ollama URL: ${currentMemory.ollamaBaseUrl}`));
    console.log(info(`Current embedding model: ${currentMemory.embedModel}`));

    const memoryEnabled = await promptYesNo("Enable memory features?", currentMemory.enabled);
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
      let ollamaBaseUrl = await promptText("Ollama base URL", currentMemory.ollamaBaseUrl);
      let models = [];

      while (true) {
        try {
          models = await fetchOllamaModels(ollamaBaseUrl);
          if (models.length === 0) {
            console.log(warn("Connected to Ollama but no models were returned from /api/tags."));
          } else {
            console.log(success(`Discovered ${models.length} model${models.length === 1 ? "" : "s"} from Ollama.`));
          }
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(warn(`Could not query Ollama at ${ollamaBaseUrl}: ${message}`));
          const retryChoice = await promptSelect("Ollama model discovery failed", [
            { value: "retry", label: "Retry same URL" },
            { value: "change", label: "Change Ollama URL" },
            { value: "manual", label: "Skip discovery and enter model manually" },
            { value: "skip", label: "Skip memory embedding setup" },
          ]);
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
          const manualModel = (await promptText("Embedding model (manual)", currentMemory.embedModel)).trim();
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
            const manualModel = (await promptText("Embedding model (manual)", currentMemory.embedModel)).trim();
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

  return {
    status: "completed",
    flow: pathChoice.value,
    authAttempts,
    authSuccess,
    authRefresh,
    selectedModel: selectedModel || null,
    memoryEmbedding,
  };
}

async function installOrUpdate(args, mode) {
  if (!commandExists("npm")) {
    throw new Error("npm is required. Please install npm and run again.");
  }

  const paths = pathsFor(args.rootDir, args.scope);
  await confirmInstall(args, paths, mode);
  ensureDir(paths.rootDir);
  ensureDir(paths.npmPrefix);
  ensureDir(paths.dataDir);
  ensureDir(paths.workspaceDir);
  ensureDir(paths.logsDir);
  ensureDir(paths.etcDir);

  ensureSystemdUserAvailable();
  writeScopedNpmrc(paths, args.scope, args.registryUrl);

  if (!resolveBunBinary(paths)) {
    tryInstallBun(paths);
  }

  npmInstall(paths.npmPrefix, ["opencode-ai@latest"], ["-g", "--registry", PUBLIC_NPM_REGISTRY]);

  const env = {
    ...process.env,
    npm_config_userconfig: paths.npmrcPath,
    npm_config_registry: PUBLIC_NPM_REGISTRY,
  };

  npmInstall(paths.npmPrefix, [packageSpec(args.scope, args.version, args.tag)], ["-g"], env);

  const wafflebotBin = resolveWafflebotBin(paths);
  if (!wafflebotBin) {
    throw new Error(
      `wafflebot binary missing: looked in ${paths.wafflebotBinGlobal} and ${paths.wafflebotBinLocal}`,
    );
  }
  const shimPath = writeWafflebotShim(paths, wafflebotBin);
  const pathSetup = ensureLocalBinPath(paths);

  const bunBin = resolveBunBinary(paths);
  if (!bunBin) {
    throw new Error("bun binary was not found after install.");
  }

  const wafflebotAppDir = resolveWafflebotAppDir(paths);
  if (!wafflebotAppDir) {
    throw new Error(
      `wafflebot package directory missing: looked in ${paths.wafflebotAppDirGlobal} and ${paths.wafflebotAppDirLocal}`,
    );
  }
  const runtimeAssetsSource = prepareRuntimeAssetsSourceDir(wafflebotAppDir);
  const runtimeAssetsStatePath = path.join(paths.dataDir, "runtime-assets-state.json");
  let runtimeAssets;
  try {
    runtimeAssets = await syncRuntimeWorkspaceAssets({
      sourceWorkspaceDir: runtimeAssetsSource.sourceDir,
      targetWorkspaceDir: paths.workspaceDir,
      stateFilePath: runtimeAssetsStatePath,
      mode,
      interactive: mode === "update" && !args.yes,
      onConflict: promptRuntimeAssetConflictDecision,
    });
  } finally {
    if (runtimeAssetsSource.tempDir) {
      fs.rmSync(runtimeAssetsSource.tempDir, { recursive: true, force: true });
    }
  }
  runtimeAssets.fallbackUsed = runtimeAssetsSource.fallbackUsed;
  const workspaceOpencodeDir = path.join(paths.workspaceDir, ".opencode");
  const workspaceOpencodePackagePath = path.join(workspaceOpencodeDir, "package.json");
  const workspaceOpencodeLockPath = path.join(workspaceOpencodeDir, "bun.lock");
  if (fs.existsSync(workspaceOpencodePackagePath)) {
    const installArgs = ["install"];
    if (fs.existsSync(workspaceOpencodeLockPath)) {
      installArgs.push("--frozen-lockfile");
    }
    must(bunBin, installArgs, { cwd: workspaceOpencodeDir });
  }
  const wafflebotEntrypoint = resolveWafflebotServiceEntrypoint(wafflebotAppDir);
  if (!wafflebotEntrypoint) {
    throw new Error(
      `wafflebot runtime entrypoint missing in ${wafflebotAppDir} (checked package module/main and common entry files).`,
    );
  }
  const opencodeBin = resolveOpencodeBin(paths);
  if (!opencodeBin) {
    throw new Error(
      `opencode binary missing: looked in ${paths.opencodeBinGlobal} and ${paths.opencodeBinLocal}`,
    );
  }
  const opencodeShimPath = writeOpencodeShim(paths, opencodeBin);

  const units = unitContents(paths, bunBin, opencodeBin, wafflebotAppDir, wafflebotEntrypoint);
  writeFile(paths.opencodeUnitPath, units.opencode);
  writeFile(paths.wafflebotUnitPath, units.wafflebot);

  must("systemctl", ["--user", "daemon-reload"]);
  must("systemctl", ["--user", "enable", "--now", UNIT_OPENCODE, UNIT_WAFFLEBOT]);
  if (mode === "update") {
    must("systemctl", ["--user", "restart", UNIT_OPENCODE, UNIT_WAFFLEBOT]);
  }

  const linger = ensureLinger(args.skipLinger);
  const health = await healthCheckWithRetry("http://127.0.0.1:3001/api/health", {
    attempts: 8,
    delayMs: 500,
  });
  const defaultSkillSync =
    health.ok
      ? await ensureDefaultRuntimeSkillsWhenEmpty({ retries: 6, delayMs: 800 })
      : {
          attempted: false,
          updated: false,
          reason: "skipped (runtime health failed)",
          skills: [],
        };
  const verify = runPostInstallVerification();
  let onboarding = null;
  if (mode === "install" && !args.yes) {
    try {
      onboarding = await runInteractiveProviderOnboarding({ opencodeBin });
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
    wafflebotVersion: readInstalledVersion(paths),
    opencodeVersion: readInstalledOpenCodeVersion(paths),
    shimPath,
    opencodeShimPath,
    pathSetup,
    units: [UNIT_OPENCODE, UNIT_WAFFLEBOT],
    runtimeAssets,
    defaultSkillSync,
    health,
    linger,
    verify,
    onboarding,
  };
}

async function status(args) {
  const paths = pathsFor(args.rootDir, args.scope);
  const unitStates = {};
  for (const unit of [UNIT_OPENCODE, UNIT_WAFFLEBOT]) {
    const result = shell("systemctl", ["--user", "is-active", unit]);
    unitStates[unit] = result.code === 0 ? result.stdout.trim() : "inactive";
  }
  const health = await healthCheck("http://127.0.0.1:3001/api/health");

  return {
    mode: "status",
    rootDir: paths.rootDir,
    wafflebotVersion: readInstalledVersion(paths),
    opencodeVersion: readInstalledOpenCodeVersion(paths),
    unitStates,
    health,
  };
}

function serviceCommand(action) {
  must("systemctl", ["--user", action, UNIT_OPENCODE, UNIT_WAFFLEBOT]);
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
  const paths = pathsFor(args.rootDir, args.scope);

  if (args.purgeData && args.keepData) {
    throw new Error("Choose only one of --purge-data or --keep-data.");
  }

  if (!args.yes && process.stdin.isTTY && process.stdout.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`Remove user services at ${paths.rootDir}? [y/N] `)).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      rl.close();
      throw new Error("Aborted by user.");
    }
    const purgeAnswer = (await rl.question("Purge data/workspace under ~/.wafflebot/data and ~/.wafflebot/workspace? [y/N] ")).trim().toLowerCase();
    args.purgeData = purgeAnswer === "y" || purgeAnswer === "yes";
    rl.close();
  } else if (!args.yes) {
    throw new Error("Uninstall requires confirmation. Re-run with --yes in non-interactive environments.");
  }

  if (args.yes && !args.purgeData) {
    args.keepData = true;
  }

  shell("systemctl", ["--user", "disable", "--now", UNIT_WAFFLEBOT, UNIT_OPENCODE]);
  if (fs.existsSync(paths.wafflebotUnitPath)) {
    fs.rmSync(paths.wafflebotUnitPath, { force: true });
  }
  if (fs.existsSync(paths.opencodeUnitPath)) {
    fs.rmSync(paths.opencodeUnitPath, { force: true });
  }
  shell("systemctl", ["--user", "daemon-reload"]);
  const removedShim = removeWafflebotShim(paths);
  const removedOpencodeShim = removeOpencodeShim(paths);

  if (args.purgeData) {
    if (fs.existsSync(paths.rootDir)) {
      fs.rmSync(paths.rootDir, { recursive: true, force: true });
    }
  } else {
    const preserve = [paths.dataDir, paths.workspaceDir, paths.logsDir];
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
    unitsRemoved: [UNIT_OPENCODE, UNIT_WAFFLEBOT],
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
    console.log(`wafflebot: ${result.wafflebotVersion ?? "unknown"}`);
    console.log(`opencode: ${result.opencodeVersion ?? "unknown"}`);
    console.log(`cli: ${result.shimPath ?? "unavailable"}`);
    if (result.opencodeShimPath) {
      console.log(`opencode-cli: ${result.opencodeShimPath}`);
    }
    if (result.pathSetup) {
      if (result.pathSetup.inPath) {
        console.log(`path: ${localBinDir} already in PATH`);
      } else if (result.pathSetup.updatedFiles?.length > 0) {
        console.log(`path: added ${localBinDir} to ${result.pathSetup.updatedFiles.join(", ")}`);
      } else {
        console.log(`path: add ${localBinDir} to PATH, then restart your shell`);
      }
    }
    if (result.runtimeAssets?.target) {
      console.log(`runtime-assets: source ${result.runtimeAssets.source}`);
      console.log(`runtime-assets: target ${result.runtimeAssets.target}`);
      if (result.runtimeAssets.fallbackUsed) {
        console.log("runtime-assets: using legacy package fallback source");
      }
      console.log(
        `runtime-assets: copied=${result.runtimeAssets.copied}, overwritten=${result.runtimeAssets.overwritten}, unchanged=${result.runtimeAssets.unchanged}, keptLocal=${result.runtimeAssets.keptLocal}, conflicts=${result.runtimeAssets.conflicts}`,
      );
      if (result.runtimeAssets.backupsCreated > 0) {
        console.log(`runtime-assets: backups created=${result.runtimeAssets.backupsCreated}`);
      }
    }
    if (result.defaultSkillSync?.attempted) {
      if (result.defaultSkillSync.updated) {
        console.log(`skills: enabled defaults (${result.defaultSkillSync.skills.join(", ")})`);
      } else {
        console.log(`skills: ${result.defaultSkillSync.reason}`);
      }
    }
    console.log(`health: ${result.health.ok ? "ok" : `failed (${result.health.status})`}`);
    if (result.linger.warning) {
      console.log(`linger: ${result.linger.warning}`);
    } else if (result.linger.changed) {
      console.log("linger: enabled");
    }
    if (result.verify) {
      console.log(`verify: wafflebot.service=${result.verify.wafflebotServiceOk ? "ok" : "failed"}`);
      console.log(`verify: opencode.service=${result.verify.opencodeServiceOk ? "ok" : "failed"}`);
      console.log(`verify: linger=${result.verify.lingerOk ? "yes" : "no"}`);
      if (!result.verify.wafflebotServiceOk || !result.verify.opencodeServiceOk || !result.verify.lingerOk) {
        console.log("verify-details:");
        console.log(result.verify.commandOutput.wafflebotStatus || "(no output)");
        console.log(result.verify.commandOutput.opencodeStatus || "(no output)");
        console.log(result.verify.commandOutput.linger || "(no output)");
      }
    }
    if (result.mode === "install" && result.onboarding) {
      if (result.onboarding.status === "completed") {
        console.log(`onboarding: completed (${result.onboarding.flow})`);
        if (result.onboarding.authAttempts > 0) {
          console.log(`onboarding: provider auth attempts=${result.onboarding.authAttempts} success=${result.onboarding.authSuccess ? "yes" : "no"}`);
          if (result.onboarding.authRefresh) {
            console.log(`onboarding: auth refresh=${result.onboarding.authRefresh.ok ? "ok" : "skipped/failed"}`);
          }
        }
        if (result.onboarding.selectedModel) {
          console.log(`onboarding: default model=${result.onboarding.selectedModel}`);
        }
        if (result.onboarding.memoryEmbedding) {
          if (result.onboarding.memoryEmbedding.configured === false) {
            console.log(`onboarding: memory embeddings=skipped (${result.onboarding.memoryEmbedding.reason ?? "not-configured"})`);
          } else {
            console.log(`onboarding: memory enabled=${result.onboarding.memoryEmbedding.enabled ? "yes" : "no"}`);
            if (result.onboarding.memoryEmbedding.ollamaBaseUrl) {
              console.log(`onboarding: memory ollama=${result.onboarding.memoryEmbedding.ollamaBaseUrl}`);
            }
            if (result.onboarding.memoryEmbedding.embedModel) {
              console.log(`onboarding: memory embedModel=${result.onboarding.memoryEmbedding.embedModel}`);
            }
          }
        }
      } else if (result.onboarding.status === "skipped") {
        console.log(`onboarding: skipped (${result.onboarding.reason})`);
      } else if (result.onboarding.status === "error") {
        console.log(`onboarding: failed (${result.onboarding.message})`);
      }
    }
    return;
  }

  if (result.mode === "update-dry-run") {
    console.log("update dry-run");
    console.log(`root: ${result.rootDir}`);
    console.log(`registry: ${result.registryUrl}`);
    console.log(`target: ${result.target}`);
    console.log(`precheck: npm=${result.precheck.npm ? "ok" : "missing"}, systemd-user=${result.precheck.systemdUser ? "ok" : "missing"}, bun=${result.precheck.bunPresent ? "present" : "will-install"}`);
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
    console.log(`wafflebot: ${result.wafflebotVersion ?? "not installed"}`);
    console.log(`opencode: ${result.opencodeVersion ?? "not installed"}`);
    console.log(`units: ${UNIT_OPENCODE}=${result.unitStates[UNIT_OPENCODE]}, ${UNIT_WAFFLEBOT}=${result.unitStates[UNIT_WAFFLEBOT]}`);
    console.log(`health: ${result.health.ok ? "ok" : `failed (${result.health.status})`}`);
    return;
  }

  if (result.mode === "restart" || result.mode === "start" || result.mode === "stop") {
    console.log(`${result.mode} complete`);
    console.log(`root: ${result.rootDir}`);
    console.log(`wafflebot: ${result.wafflebotVersion ?? "not installed"}`);
    console.log(`opencode: ${result.opencodeVersion ?? "not installed"}`);
    console.log(`units: ${UNIT_OPENCODE}=${result.unitStates[UNIT_OPENCODE]}, ${UNIT_WAFFLEBOT}=${result.unitStates[UNIT_WAFFLEBOT]}`);
    console.log(`health: ${result.health.ok ? "ok" : `failed (${result.health.status})`}`);
    return;
  }

  if (result.mode === "uninstall") {
    console.log(`uninstall complete: ${result.purgeData ? `removed ${result.rootDir}` : `removed services/runtime, kept data in ${result.rootDir}`}`);
    console.log(`cli shim removed: ${result.removedShim ? "yes" : "no"}`);
    console.log(`opencode shim removed: ${result.removedOpencodeShim ? "yes" : "no"}`);
    return;
  }

  if (result.mode === "onboard") {
    if (result.onboarding?.status === "completed") {
      console.log("onboard complete");
      if (result.onboarding.authAttempts > 0) {
        console.log(`provider auth attempts: ${result.onboarding.authAttempts}`);
        if (result.onboarding.authRefresh) {
          console.log(`provider auth refresh: ${result.onboarding.authRefresh.ok ? "ok" : "skipped/failed"}`);
        }
      }
      if (result.onboarding.selectedModel) {
        console.log(`default model: ${result.onboarding.selectedModel}`);
      }
      if (result.onboarding.memoryEmbedding) {
        if (result.onboarding.memoryEmbedding.configured === false) {
          console.log(`memory embeddings: skipped (${result.onboarding.memoryEmbedding.reason ?? "not-configured"})`);
        } else {
          console.log(`memory enabled: ${result.onboarding.memoryEmbedding.enabled ? "yes" : "no"}`);
          if (result.onboarding.memoryEmbedding.ollamaBaseUrl) {
            console.log(`memory ollama: ${result.onboarding.memoryEmbedding.ollamaBaseUrl}`);
          }
          if (result.onboarding.memoryEmbedding.embedModel) {
            console.log(`memory embedModel: ${result.onboarding.memoryEmbedding.embedModel}`);
          }
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
      return;
    }
    console.log("onboard complete");
    return;
  }

  if (result.mode === "import-openclaw-preview") {
    const preview = result.preview ?? {};
    console.log("openclaw import preview");
    console.log(`previewId: ${preview.previewId ?? ""}`);
    console.log(`source: ${preview.source?.mode ?? "unknown"} ${preview.source?.resolvedDirectory ?? ""}`);
    if (preview.source?.commit) {
      console.log(`commit: ${preview.source.commit}`);
    }
    console.log(`target: ${preview.targetDirectory ?? ""}`);
    console.log(`files: discovered=${preview.discoveredCount ?? 0}, new=${preview.filesNew?.length ?? 0}, identical=${preview.filesIdentical?.length ?? 0}, conflicting=${preview.filesConflicting?.length ?? 0}`);
    if (Array.isArray(preview.warnings) && preview.warnings.length > 0) {
      console.log(`warnings: ${preview.warnings.length}`);
    }
    return;
  }

  if (result.mode === "import-openclaw-apply") {
    const applied = result.applied ?? {};
    console.log("openclaw import apply");
    console.log(`previewId: ${applied.previewId ?? ""}`);
    console.log(`source: ${applied.sourceDirectory ?? ""}`);
    console.log(`target: ${applied.targetDirectory ?? ""}`);
    console.log(
      `summary: copied=${applied.summary?.copied ?? 0}, skippedExisting=${applied.summary?.skippedExisting ?? 0}, skippedIdentical=${applied.summary?.skippedIdentical ?? 0}, skippedRequested=${applied.summary?.skippedRequested ?? 0}, failed=${applied.summary?.failed ?? 0}`,
    );
    if (applied.memorySync?.status) {
      console.log(`memorySync: ${applied.memorySync.status}`);
      if (applied.memorySync.status === "failed" && applied.memorySync.error) {
        console.log(`memorySyncError: ${applied.memorySync.error}`);
      }
    }
  }
}

function evaluateResult(result) {
  const isActive =
    result?.unitStates?.[UNIT_OPENCODE] === "active" && result?.unitStates?.[UNIT_WAFFLEBOT] === "active";
  if (result.mode === "install" || result.mode === "update") {
    if (!result.health?.ok || !result.verify?.wafflebotServiceOk || !result.verify?.opencodeServiceOk) {
      return 2;
    }
    return 0;
  }
  if (result.mode === "status" || result.mode === "restart" || result.mode === "start") {
    return isActive && result.health?.ok ? 0 : 2;
  }
  if (result.mode === "update-dry-run") {
    return result.precheck.npm && result.precheck.systemdUser ? 0 : 2;
  }
  if (result.mode === "stop") {
    const stopped =
      result?.unitStates?.[UNIT_OPENCODE] !== "active" && result?.unitStates?.[UNIT_WAFFLEBOT] !== "active";
    return stopped ? 0 : 2;
  }
  if (result.mode === "import-openclaw-preview") {
    return result?.preview?.previewId ? 0 : 2;
  }
  if (result.mode === "import-openclaw-apply") {
    return Array.isArray(result?.applied?.failed) && result.applied.failed.length > 0 ? 2 : 0;
  }
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.command === "help") {
    printHelp();
    if (!args.command) {
      console.log("\nHint: run `wafflebot status` to check service health.");
    }
    return;
  }

  let result;
  if (args.command === "install") {
    if (args.dryRun) {
      throw new Error("--dry-run is supported for `wafflebot update` only.");
    }
    result = await installOrUpdate(args, "install");
  } else if (args.command === "update") {
    if (args.dryRun) {
      result = buildUpdateDryRun({ args, paths: pathsFor(args.rootDir, args.scope) });
    } else {
      result = await installOrUpdate(args, "update");
    }
  } else if (args.command === "onboard") {
    if (args.dryRun) {
      throw new Error("--dry-run is not applicable to `wafflebot onboard`.");
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
  } else if (args.command === "import-openclaw-preview") {
    if (args.dryRun) {
      throw new Error("--dry-run is not applicable to `wafflebot import openclaw preview`.");
    }
    result = await importOpenclawPreview(args);
  } else if (args.command === "import-openclaw-apply") {
    if (args.dryRun) {
      throw new Error("--dry-run is not applicable to `wafflebot import openclaw apply`.");
    }
    result = await importOpenclawApply(args);
  } else {
    throw new Error(`Unknown command: ${args.command}`);
  }

  printResult(result, args.json);
  process.exitCode = evaluateResult(result);
}

await main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
