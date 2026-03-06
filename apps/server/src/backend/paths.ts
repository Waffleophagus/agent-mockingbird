import path from "node:path";

export function getBinaryDir(): string {
  return process.cwd();
}

export function getProjectRoot(): string {
  return process.cwd();
}

export function resolveDataPath(...segments: string[]): string {
  return path.resolve(getProjectRoot(), "data", ...segments);
}
