#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";

const DEFAULT_SCOPE = "waffleophagus";
const DEFAULT_REGISTRY_URL = "https://git.waffleophagus.com/api/packages/waffleophagus/npm/";
const DEFAULT_TAG = "main";
const DEFAULT_ROOT_DIR = path.join(os.homedir(), ".wafflebot");
const USER_UNIT_DIR = path.join(os.homedir(), ".config", "systemd", "user");
const UNIT_OPENCODE = "opencode.service";
const UNIT_WAFFLEBOT = "wafflebot.service";

function parseArgs(argv) {
  const args = {
    command: "install",
    yes: false,
    json: false,
    skipLinger: false,
    registryUrl: DEFAULT_REGISTRY_URL,
    scope: DEFAULT_SCOPE,
    tag: DEFAULT_TAG,
    version: undefined,
    rootDir: DEFAULT_ROOT_DIR,
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
    if (arg === "--skip-linger") {
      args.skipLinger = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.command = "help";
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (positionals.length > 0) {
    args.command = positionals[0];
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
  console.log(`wafflebot-installer\n\nUsage:\n  wafflebot-installer <install|update|status|uninstall> [flags]\n\nFlags:\n  --registry-url <url>   Scoped npm registry (default: ${DEFAULT_REGISTRY_URL})\n  --scope <scope>        Package scope (default: ${DEFAULT_SCOPE})\n  --tag <tag>            Dist-tag when --version not set (default: ${DEFAULT_TAG})\n  --version <version>    Exact wafflebot version\n  --root-dir <path>      Install root (default: ${DEFAULT_ROOT_DIR})\n  --yes, -y              Non-interactive\n  --json                 JSON output\n  --skip-linger          Skip loginctl enable-linger\n  --help, -h             Show help`);
}

function shell(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: options.env ?? process.env,
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

function userName() {
  return process.env.USER || process.env.LOGNAME || os.userInfo().username;
}

function pathsFor(rootDir, scope) {
  const normalizedScope = scope.replace(/^@/, "");
  const npmPrefix = path.join(rootDir, "npm");
  const wafflebotAppDir = path.join(npmPrefix, "lib", "node_modules", `@${normalizedScope}`, "wafflebot");
  return {
    rootDir,
    npmPrefix,
    dataDir: path.join(rootDir, "data"),
    workspaceDir: path.join(rootDir, "workspace"),
    logsDir: path.join(rootDir, "logs"),
    etcDir: path.join(rootDir, "etc"),
    npmrcPath: path.join(rootDir, "etc", "npmrc"),
    wafflebotAppDir,
    wafflebotBin: path.join(npmPrefix, "bin", "wafflebot"),
    opencodeBin: path.join(npmPrefix, "bin", "opencode"),
    bunBinManaged: path.join(npmPrefix, "bin", "bun"),
    opencodeUnitPath: path.join(USER_UNIT_DIR, UNIT_OPENCODE),
    wafflebotUnitPath: path.join(USER_UNIT_DIR, UNIT_WAFFLEBOT),
  };
}

function resolveBunBinary(paths) {
  if (commandExists("bun")) {
    const out = shell("bash", ["-lc", "command -v bun"]);
    return out.stdout.trim();
  }
  if (fs.existsSync(paths.bunBinManaged)) {
    return paths.bunBinManaged;
  }
  return null;
}

function writeScopedNpmrc(paths, scope, registryUrl) {
  const normalizedScope = scope.replace(/^@/, "");
  writeFile(paths.npmrcPath, `@${normalizedScope}:registry=${registryUrl}\n`);
}

function npmInstall(prefix, packages, extraArgs = [], env = process.env) {
  const args = ["install", "--no-audit", "--no-fund", "--prefix", prefix, ...extraArgs, ...packages];
  must("npm", args, { stdio: "inherit", env });
}

function unitContents(paths, bunBin) {
  const opencode = `[Unit]\nDescription=OpenCode Sidecar for Wafflebot (user service)\nAfter=network.target\nWants=network.target\n\n[Service]\nType=simple\nWorkingDirectory=${paths.workspaceDir}\nEnvironment=WAFFLEBOT_PORT=3001\nEnvironment=WAFFLEBOT_MEMORY_API_BASE_URL=http://127.0.0.1:3001\nExecStart=${paths.opencodeBin} serve --hostname 127.0.0.1 --port 4096 --print-logs --log-level INFO\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n`;

  const wafflebot = `[Unit]\nDescription=Wafflebot API and Dashboard (user service)\nAfter=network.target ${UNIT_OPENCODE}\nWants=network.target ${UNIT_OPENCODE}\n\n[Service]\nType=simple\nWorkingDirectory=${paths.wafflebotAppDir}\nEnvironment=NODE_ENV=production\nEnvironment=PORT=3001\nEnvironment=WAFFLEBOT_CONFIG_PATH=${path.join(paths.dataDir, "wafflebot.config.json")}\nEnvironment=WAFFLEBOT_DB_PATH=${path.join(paths.dataDir, "wafflebot.db")}\nEnvironment=WAFFLEBOT_OPENCODE_BASE_URL=http://127.0.0.1:4096\nEnvironment=WAFFLEBOT_OPENCODE_DIRECTORY=${paths.workspaceDir}\nExecStart=${bunBin} ${path.join(paths.wafflebotAppDir, "src", "index.ts")}\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n`;

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

async function confirmInstall(args) {
  if (args.yes) {
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Install is interactive by default. Re-run with --yes in non-interactive environments.");
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Install Wafflebot into ${args.rootDir} using @${args.scope}/wafflebot (${args.version ?? `tag:${args.tag}`})? [y/N] `)).trim().toLowerCase();
  rl.close();
  if (answer !== "y" && answer !== "yes") {
    throw new Error("Aborted by user.");
  }
}

function packageSpec(scope, version, tag) {
  const normalizedScope = scope.replace(/^@/, "");
  const target = version || tag;
  return `@${normalizedScope}/wafflebot@${target}`;
}

function readInstalledVersion(paths) {
  const pkgPath = path.join(paths.wafflebotAppDir, "package.json");
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

async function installOrUpdate(args, mode) {
  await confirmInstall(args);
  if (!commandExists("npm")) {
    throw new Error("npm is required. Please install npm and run again.");
  }

  const paths = pathsFor(args.rootDir, args.scope);
  ensureDir(paths.rootDir);
  ensureDir(paths.npmPrefix);
  ensureDir(paths.dataDir);
  ensureDir(paths.workspaceDir);
  ensureDir(paths.logsDir);
  ensureDir(paths.etcDir);

  ensureSystemdUserAvailable();
  writeScopedNpmrc(paths, args.scope, args.registryUrl);

  if (!resolveBunBinary(paths)) {
    npmInstall(paths.npmPrefix, ["bun@latest"]);
  }

  npmInstall(paths.npmPrefix, ["opencode-ai@latest"]);

  const env = {
    ...process.env,
    npm_config_userconfig: paths.npmrcPath,
  };

  npmInstall(paths.npmPrefix, [packageSpec(args.scope, args.version, args.tag)], ["--registry", args.registryUrl], env);

  const bunBin = resolveBunBinary(paths);
  if (!bunBin) {
    throw new Error("bun binary was not found after install.");
  }

  if (!fs.existsSync(paths.wafflebotAppDir)) {
    throw new Error(`wafflebot package directory missing: ${paths.wafflebotAppDir}`);
  }
  if (!fs.existsSync(paths.opencodeBin)) {
    throw new Error(`opencode binary missing: ${paths.opencodeBin}`);
  }

  const units = unitContents(paths, bunBin);
  writeFile(paths.opencodeUnitPath, units.opencode);
  writeFile(paths.wafflebotUnitPath, units.wafflebot);

  must("systemctl", ["--user", "daemon-reload"]);
  must("systemctl", ["--user", "enable", "--now", UNIT_OPENCODE, UNIT_WAFFLEBOT]);

  const linger = ensureLinger(args.skipLinger);
  const health = await healthCheck("http://127.0.0.1:3001/api/health");

  return {
    mode,
    rootDir: paths.rootDir,
    registryUrl: args.registryUrl,
    wafflebotVersion: readInstalledVersion(paths),
    opencodeVersion: readInstalledOpenCodeVersion(paths),
    units: [UNIT_OPENCODE, UNIT_WAFFLEBOT],
    health,
    linger,
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

async function uninstall(args) {
  const paths = pathsFor(args.rootDir, args.scope);

  if (!args.yes && process.stdin.isTTY && process.stdout.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`Remove user services and delete ${paths.rootDir}? [y/N] `)).trim().toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      throw new Error("Aborted by user.");
    }
  } else if (!args.yes) {
    throw new Error("Uninstall requires confirmation. Re-run with --yes in non-interactive environments.");
  }

  shell("systemctl", ["--user", "disable", "--now", UNIT_WAFFLEBOT, UNIT_OPENCODE]);
  if (fs.existsSync(paths.wafflebotUnitPath)) {
    fs.rmSync(paths.wafflebotUnitPath, { force: true });
  }
  if (fs.existsSync(paths.opencodeUnitPath)) {
    fs.rmSync(paths.opencodeUnitPath, { force: true });
  }
  shell("systemctl", ["--user", "daemon-reload"]);

  if (fs.existsSync(paths.rootDir)) {
    fs.rmSync(paths.rootDir, { recursive: true, force: true });
  }

  return {
    mode: "uninstall",
    rootDir: paths.rootDir,
    unitsRemoved: [UNIT_OPENCODE, UNIT_WAFFLEBOT],
    removed: true,
  };
}

function printResult(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.mode === "install" || result.mode === "update") {
    console.log(`${result.mode} complete`);
    console.log(`root: ${result.rootDir}`);
    console.log(`registry: ${result.registryUrl}`);
    console.log(`wafflebot: ${result.wafflebotVersion ?? "unknown"}`);
    console.log(`opencode: ${result.opencodeVersion ?? "unknown"}`);
    console.log(`health: ${result.health.ok ? "ok" : `failed (${result.health.status})`}`);
    if (result.linger.warning) {
      console.log(`linger: ${result.linger.warning}`);
    } else if (result.linger.changed) {
      console.log("linger: enabled");
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

  if (result.mode === "uninstall") {
    console.log(`uninstall complete: removed ${result.rootDir}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help") {
    printHelp();
    return;
  }

  let result;
  if (args.command === "install") {
    result = await installOrUpdate(args, "install");
  } else if (args.command === "update") {
    result = await installOrUpdate(args, "update");
  } else if (args.command === "status") {
    result = await status(args);
  } else if (args.command === "uninstall") {
    result = await uninstall(args);
  } else {
    throw new Error(`Unknown command: ${args.command}`);
  }

  printResult(result, args.json);
}

await main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
