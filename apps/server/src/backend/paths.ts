import { existsSync } from "node:fs";
import path from "node:path";

function sourceRoot() {
  return path.resolve(import.meta.dir, "../../../../");
}

export function getBinaryDir(): string {
  return process.cwd();
}

export function getProjectRoot(): string {
  return process.cwd();
}

export function resolveDataPath(...segments: string[]): string {
  return path.resolve(getProjectRoot(), "data", ...segments);
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
