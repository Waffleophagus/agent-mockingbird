import path from "node:path";

export function getBinaryDir(): string {
  const execPath = process.execPath;
  if (execPath) {
    return path.dirname(execPath);
  }
  return process.cwd();
}

export function resolveDataPath(...segments: string[]): string {
  return path.resolve(getBinaryDir(), "data", ...segments);
}
