import path from "node:path";

export function resolveExampleConfigPath() {
  return path.resolve(import.meta.dir, "../../../../../agent-mockingbird.config.example.json");
}
