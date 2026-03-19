import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { env } from "./env";

function sourceRoot() {
  return path.resolve(import.meta.dir, "../../../../");
}

export function getBinaryDir(): string {
  return process.cwd();
}

function getProjectRoot(): string {
  return process.cwd();
}

export function resolveDataPath(...segments: string[]): string {
  return path.resolve(getProjectRoot(), "data", ...segments);
}

function resolveAgentMockingbirdDataDir(): string {
  const configuredPath = env.AGENT_MOCKINGBIRD_CONFIG_PATH?.trim();
  if (!configuredPath) {
    return resolveDataPath();
  }
  return path.dirname(path.resolve(configuredPath));
}

function workspaceFingerprint(workspaceDir: string): string {
  return createHash("sha256").update(path.resolve(workspaceDir)).digest("hex").slice(0, 16);
}

export function resolveManagedOpencodeConfigDir(workspaceDir: string): string {
  const explicitConfigDir = process.env.OPENCODE_CONFIG_DIR?.trim();
  if (explicitConfigDir) {
    return path.resolve(explicitConfigDir);
  }
  return path.join(resolveAgentMockingbirdDataDir(), "opencode-config", workspaceFingerprint(workspaceDir));
}

export function resolveAppDistDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "dist", "app"),
    path.resolve(process.cwd(), "vendor", "opencode", "packages", "app", "dist"),
    path.resolve(sourceRoot(), "dist", "app"),
    path.resolve(sourceRoot(), "vendor", "opencode", "packages", "app", "dist"),
    path.resolve(path.dirname(process.execPath), "app"),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}
