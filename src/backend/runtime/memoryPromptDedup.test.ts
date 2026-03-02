import { describe, expect, test } from "bun:test";

import { buildMemoryContextFingerprint } from "./memoryPromptDedup";
import type { MemorySearchResult } from "../memory/types";

function result(input: {
  id: string;
  score: number;
  path?: string;
  startLine?: number;
  endLine?: number;
  snippet?: string;
  citation?: string;
}): MemorySearchResult {
  return {
    id: input.id,
    path: input.path ?? "memory/2026-03-02.md",
    startLine: input.startLine ?? 1,
    endLine: input.endLine ?? 3,
    source: "memory",
    score: input.score,
    snippet: input.snippet ?? "snippet",
    citation: input.citation ?? "memory/2026-03-02.md#L1",
  };
}

describe("buildMemoryContextFingerprint", () => {
  test("ignores score and ordering jitter for same chunk set", () => {
    const first = buildMemoryContextFingerprint([result({ id: "chunk-b", score: 0.93 }), result({ id: "chunk-a", score: 0.71 })]);
    const second = buildMemoryContextFingerprint([result({ id: "chunk-a", score: 0.12 }), result({ id: "chunk-b", score: 0.44 })]);
    expect(first).toBe(second);
  });

  test("changes when chunk identity set changes", () => {
    const baseline = buildMemoryContextFingerprint([result({ id: "chunk-a", score: 0.9 }), result({ id: "chunk-b", score: 0.5 })]);
    const changed = buildMemoryContextFingerprint([result({ id: "chunk-a", score: 0.2 }), result({ id: "chunk-c", score: 0.1 })]);
    expect(changed).not.toBe(baseline);
  });

  test("returns stable empty fingerprint", () => {
    expect(buildMemoryContextFingerprint([])).toBe("[]");
  });
});
