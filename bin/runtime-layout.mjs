import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function workspaceFingerprint(workspaceDir) {
  return createHash("sha256").update(path.resolve(workspaceDir)).digest("hex").slice(0, 16);
}

function resolveManagedOpencodeConfigDir({
  rootDir,
  dataDir = path.join(rootDir, "data"),
  workspaceDir = path.join(rootDir, "workspace"),
  explicitConfigDir = process.env.OPENCODE_CONFIG_DIR,
}) {
  if (typeof explicitConfigDir === "string" && explicitConfigDir.trim()) {
    return path.resolve(explicitConfigDir.trim());
  }
  return path.join(dataDir, "opencode-config", workspaceFingerprint(workspaceDir));
}

export function opencodeEnvironment(paths, baseEnv = process.env) {
  return {
    ...baseEnv,
    OPENCODE_CONFIG_DIR: paths.opencodeConfigDir,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  };
}

export function pathsFor({ rootDir, scope, userUnitDir }) {
  const normalizedScope = scope.replace(/^@/, "");
  const npmPrefix = path.join(rootDir, "npm");
  const workspaceDir = path.join(rootDir, "workspace");
  const dataDir = path.join(rootDir, "data");
  const localBinDir = path.join(process.env.HOME || "", ".local", "bin");

  return {
    rootDir,
    npmPrefix,
    localBinDir,
    agentMockingbirdShimPath: path.join(localBinDir, "agent-mockingbird"),
    opencodeShimPath: path.join(localBinDir, "opencode"),
    dataDir,
    workspaceDir,
    opencodeConfigDir: resolveManagedOpencodeConfigDir({ rootDir, dataDir, workspaceDir }),
    logsDir: path.join(rootDir, "logs"),
    etcDir: path.join(rootDir, "etc"),
    npmrcPath: path.join(rootDir, "etc", "npmrc"),
    agentMockingbirdAppDirGlobal: path.join(npmPrefix, "lib", "node_modules", `@${normalizedScope}`, "agent-mockingbird"),
    agentMockingbirdAppDirLocal: path.join(npmPrefix, "node_modules", `@${normalizedScope}`, "agent-mockingbird"),
    agentMockingbirdBinGlobal: path.join(npmPrefix, "bin", "agent-mockingbird"),
    agentMockingbirdBinLocal: path.join(npmPrefix, "node_modules", ".bin", "agent-mockingbird"),
    opencodeBinGlobal: path.join(npmPrefix, "bin", "opencode"),
    opencodeBinLocal: path.join(npmPrefix, "node_modules", ".bin", "opencode"),
    bunBinManagedGlobal: path.join(npmPrefix, "bin", "bun"),
    bunBinManagedLocal: path.join(npmPrefix, "node_modules", ".bin", "bun"),
    bunBinTools: path.join(rootDir, "tools", "bun", "bin", "bun"),
    opencodeUnitPath: path.join(userUnitDir, "opencode.service"),
    agentMockingbirdUnitPath: path.join(userUnitDir, "agent-mockingbird.service"),
  };
}

export function prepareRuntimeAssetSources(agentMockingbirdAppDir) {
  const workspaceSourceDir = path.join(agentMockingbirdAppDir, "runtime-assets", "workspace");
  const opencodeConfigSourceDir = path.join(agentMockingbirdAppDir, "runtime-assets", "opencode-config");
  if (!fs.existsSync(workspaceSourceDir) || !fs.existsSync(opencodeConfigSourceDir)) {
    throw new Error(
      `runtime assets missing in package: expected ${workspaceSourceDir} and ${opencodeConfigSourceDir}`,
    );
  }
  return {
    workspaceSourceDir,
    opencodeConfigSourceDir,
  };
}
