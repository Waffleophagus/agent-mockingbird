#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT_DIR = path.join(os.homedir(), ".agent-mockingbird");
const PACKAGE_NAME = "agent-mockingbird";
const DEFAULT_TAG = "latest";
const PUBLIC_NPM_REGISTRY = "https://registry.npmjs.org/";
const MODULE_PATH = fileURLToPath(import.meta.url);
const MODULE_DIR = path.dirname(MODULE_PATH);

function bunInstallRoot(rootDir) {
  return path.join(rootDir, "bun");
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

function resolveRootDir(argv = process.argv, env = process.env) {
  return (
    readRootDirArg(argv.slice(2)) ||
    (env.AGENT_MOCKINGBIRD_ROOT_DIR || "").trim() ||
    DEFAULT_ROOT_DIR
  );
}

function resolveManagedCliPath(rootDir) {
  const candidates = [
    path.join(rootDir, "npm", "lib", "node_modules", PACKAGE_NAME, "bin", "agent-mockingbird-managed"),
    path.join(rootDir, "npm", "node_modules", PACKAGE_NAME, "bin", "agent-mockingbird-managed"),
    path.join(bunInstallRoot(rootDir), "install", "global", "node_modules", PACKAGE_NAME, "bin", "agent-mockingbird-managed"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function managedCliExists(rootDir) {
  return fs.existsSync(resolveManagedCliPath(rootDir));
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
      const parsed = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return parsed.version.trim();
      }
    } catch {
      // Ignore unreadable package metadata and continue searching.
    }
  }

  return "";
}

function currentPackageOwnsManagedCli(rootDir, modulePath = MODULE_PATH) {
  const managedCliPath = resolveManagedCliPath(rootDir);
  if (!fs.existsSync(managedCliPath) || !fs.existsSync(modulePath)) {
    return false;
  }
  const currentPackageDir = path.resolve(path.dirname(modulePath), "..");
  const managedPackageDir = path.resolve(path.dirname(managedCliPath), "..");
  return fs.realpathSync(currentPackageDir) === fs.realpathSync(managedPackageDir);
}

function execManagedCli(rootDir, argv = process.argv, env = process.env) {
  const managedCliPath = resolveManagedCliPath(rootDir);
  const delegated = spawnSync(managedCliPath, argv.slice(2), {
    stdio: "inherit",
    env,
  });
  if (delegated.error) {
    throw delegated.error;
  }
  process.exit(delegated.status ?? 1);
}

function commandExists(command, env = process.env) {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
    stdio: "pipe",
    encoding: "utf8",
    env,
  });
  return (result.status ?? 1) === 0;
}

function resolveBootstrapPackageManager(
  env = process.env,
  commandExistsImpl = commandExists,
) {
  if (commandExistsImpl("npm", env)) {
    return "npm";
  }
  if (commandExistsImpl("bun", env)) {
    return "bun";
  }
  return null;
}

function parseBootstrapInstallTarget(
  argv = process.argv.slice(2),
  moduleDir = MODULE_DIR,
) {
  let tag = DEFAULT_TAG;
  let version;
  let tagExplicit = false;
  let versionExplicit = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--next") {
      tag = "next";
      tagExplicit = true;
      continue;
    }
    if (arg === "--latest") {
      tag = "latest";
      tagExplicit = true;
      continue;
    }
    if (arg === "--tag" && next) {
      tag = next;
      tagExplicit = true;
      index += 1;
      continue;
    }
    if (arg === "--version" && next) {
      version = next;
      versionExplicit = true;
      index += 1;
      continue;
    }
  }

  if (versionExplicit) {
    return version;
  }
  if (tagExplicit) {
    return `${PACKAGE_NAME}@${tag}`;
  }
  const runningVersion = readRunningPackageVersion(moduleDir);
  if (runningVersion) {
    return `${PACKAGE_NAME}@${runningVersion}`;
  }
  return `${PACKAGE_NAME}@${DEFAULT_TAG}`;
}

function bootstrapManagedInstall(rootDir, argv = process.argv, env = process.env) {
  const packageManager = resolveBootstrapPackageManager(env);
  if (!packageManager) {
    throw new Error("npm or bun is required. Please install one and run again.");
  }

  fs.mkdirSync(rootDir, { recursive: true });

  const packageSpec = parseBootstrapInstallTarget(argv.slice(2));
  let result;
  if (packageManager === "npm") {
    const npmPrefix = path.join(rootDir, "npm");
    fs.mkdirSync(npmPrefix, { recursive: true });
    result = spawnSync(
      "npm",
      [
        "install",
        "--global",
        "--no-audit",
        "--no-fund",
        "--prefix",
        npmPrefix,
        packageSpec,
      ],
      {
        stdio: "inherit",
        env,
      },
    );
  } else {
    const managedBunRoot = bunInstallRoot(rootDir);
    fs.mkdirSync(managedBunRoot, { recursive: true });
    result = spawnSync(
      "bun",
      ["install", "--global", "--registry", PUBLIC_NPM_REGISTRY, packageSpec],
      {
        stdio: "inherit",
        env: {
          ...env,
          BUN_INSTALL: managedBunRoot,
        },
      },
    );
  }

  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }

  if (!managedCliExists(rootDir)) {
    throw new Error(
      `Managed CLI missing after bootstrap install: expected ${resolveManagedCliPath(rootDir)}`,
    );
  }
}

function main() {
  const command = process.argv[2] || "";
  const rootDir = resolveRootDir();
  if (currentPackageOwnsManagedCli(rootDir)) {
    execManagedCli(rootDir);
  }
  if (!managedCliExists(rootDir) || command === "install") {
    bootstrapManagedInstall(rootDir);
  }
  execManagedCli(rootDir);
}

export const testing = {
  readRunningPackageVersion,
  currentPackageOwnsManagedCli,
  managedCliExists,
  parseBootstrapInstallTarget,
  readRootDirArg,
  resolveBootstrapPackageManager,
  resolveManagedCliPath,
  resolveRootDir,
};

if (import.meta.main) {
  main();
}
