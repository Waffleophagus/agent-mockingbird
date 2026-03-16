import path from "node:path";

import type { AgentMockingbirdConfig } from "../config/schema";
import { getBinaryDir, resolveManagedOpencodeConfigDir } from "../paths";

function resolvePathFromBinaryRoot(dirPath: string) {
  if (path.isAbsolute(dirPath)) return path.resolve(dirPath);
  return path.resolve(getBinaryDir(), dirPath);
}

export function resolveMemoryWorkspaceDir(config: AgentMockingbirdConfig) {
  return resolvePathFromBinaryRoot(config.workspace.pinnedDirectory.trim());
}

export function resolveOpencodeWorkspaceDir(config: AgentMockingbirdConfig) {
  return resolvePathFromBinaryRoot(config.workspace.pinnedDirectory.trim());
}

export function resolveOpencodeConfigDir(config: AgentMockingbirdConfig) {
  return resolveManagedOpencodeConfigDir(resolveOpencodeWorkspaceDir(config));
}

export function resolveWorkspaceAlignment(config: AgentMockingbirdConfig) {
  const pinnedWorkspaceDir = resolvePathFromBinaryRoot(config.workspace.pinnedDirectory.trim());
  return {
    memoryWorkspaceDir: pinnedWorkspaceDir,
    opencodeWorkspaceDir: pinnedWorkspaceDir,
    opencodeDirectoryExplicit: true,
    aligned: true,
  };
}
