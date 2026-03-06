import path from "node:path";

import type { WafflebotConfig } from "../config/schema";
import { getBinaryDir } from "../paths";

function resolvePathFromBinaryRoot(dirPath: string) {
  if (path.isAbsolute(dirPath)) return path.resolve(dirPath);
  return path.resolve(getBinaryDir(), dirPath);
}

export function resolveMemoryWorkspaceDir(config: WafflebotConfig) {
  return resolvePathFromBinaryRoot(config.runtime.memory.workspaceDir.trim());
}

export function resolveOpencodeWorkspaceDir(config: WafflebotConfig) {
  const configured = config.runtime.opencode.directory?.trim();
  if (configured) return resolvePathFromBinaryRoot(configured);
  return resolveMemoryWorkspaceDir(config);
}

export function resolveWorkspaceAlignment(config: WafflebotConfig) {
  const memoryWorkspaceDir = resolveMemoryWorkspaceDir(config);
  const opencodeConfigured = config.runtime.opencode.directory?.trim();
  const opencodeWorkspaceDir = opencodeConfigured
    ? resolvePathFromBinaryRoot(opencodeConfigured)
    : memoryWorkspaceDir;
  return {
    memoryWorkspaceDir,
    opencodeWorkspaceDir,
    opencodeDirectoryExplicit: Boolean(opencodeConfigured),
    aligned: memoryWorkspaceDir === opencodeWorkspaceDir,
  };
}
