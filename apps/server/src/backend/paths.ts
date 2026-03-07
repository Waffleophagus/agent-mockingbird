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

export function resolveWebDistDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "dist", "web"),
    path.resolve(process.cwd(), "apps", "web", "dist"),
    path.resolve(sourceRoot(), "dist", "web"),
    path.resolve(sourceRoot(), "apps", "web", "dist"),
    path.resolve(path.dirname(process.execPath), "web"),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}
