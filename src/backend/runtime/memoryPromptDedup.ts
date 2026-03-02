import type { MemorySearchResult } from "../memory/types";

export function buildMemoryContextFingerprint(results: MemorySearchResult[]): string {
  const ids = [...new Set(results.map(result => result.id.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return JSON.stringify(ids);
}
