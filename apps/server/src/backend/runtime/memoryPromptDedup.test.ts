import { describe, expect, test } from "bun:test";

import {
  analyzeMemoryInjectionResults,
  buildMemoryContextFingerprint,
  isMemoryRecallIntentQuery,
  isWriteIntentMemoryQuery,
  memoryInjectionResultKey,
  prepareMemoryInjectionResults,
} from "./memoryPromptDedup";
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

describe("prepareMemoryInjectionResults", () => {
  test("drops low-signal boilerplate with no query overlap", () => {
    const results = prepareMemoryInjectionResults("favorite pokemon", [
      result({
        id: "index",
        score: 0.8,
        path: "MEMORY.md",
        snippet: "# Memory Index\nStore durable notes in memory/*.md",
        citation: "MEMORY.md#L1",
      }),
      result({
        id: "pokemon",
        score: 0.7,
        snippet: "User's favorite Pokemon is Vulpix.",
        citation: "memory/2026-03-02.md#L10",
      }),
    ]);
    expect(results.length).toBe(1);
    expect(results[0]?.id).toBe("pokemon");
  });

  test("dedupes structured snippets by memory record id", () => {
    const sharedSnippetA = [
      "### [memory:memory_abc123] 2026-03-02T20:41:01.037Z",
      "```json",
      '{"id":"memory_abc123"}',
      "```",
      "User's favorite Pokemon is Vulpix.",
    ].join("\n");
    const sharedSnippetB = `${sharedSnippetA}\n(extra context)`;
    const results = prepareMemoryInjectionResults("pokemon", [
      result({ id: "chunk-1", score: 0.9, snippet: sharedSnippetA }),
      result({ id: "chunk-2", score: 0.7, snippet: sharedSnippetB }),
    ]);
    expect(results.length).toBe(1);
    expect(results[0]?.id).toBe("chunk-1");
  });

  test("filters structured snippets that are irrelevant to non-recall queries", () => {
    const structured = [
      "### [memory:memory_abc123] 2026-03-02T20:41:01.037Z",
      "```json",
      '{"id":"memory_abc123"}',
      "```",
      "User has a daughter named Lucy Lee in the NICU.",
    ].join("\n");
    const results = prepareMemoryInjectionResults("pokemon evolution chart", [
      result({ id: "chunk-1", score: 0.9, snippet: structured }),
    ]);
    expect(results.length).toBe(0);
  });

  test("keeps structured snippets for explicit recall-intent queries", () => {
    const structured = [
      "### [memory:memory_abc123] 2026-03-02T20:41:01.037Z",
      "```json",
      '{"id":"memory_abc123"}',
      "```",
      "User has a daughter named Lucy Lee in the NICU.",
    ].join("\n");
    const analyzed = analyzeMemoryInjectionResults("what do you remember about me?", [
      result({ id: "chunk-1", score: 0.9, snippet: structured }),
    ]);
    expect(analyzed.results.length).toBe(1);
    expect(analyzed.filteredIrrelevantCount).toBe(0);
  });
});

describe("memoryInjectionResultKey", () => {
  test("uses memory record id when present", () => {
    const structured = [
      "### [memory:memory_abc123] 2026-03-02T20:41:01.037Z",
      "```json",
      '{"id":"memory_abc123"}',
      "```",
      "User has a daughter named Lucy Lee in the NICU.",
    ].join("\n");
    expect(memoryInjectionResultKey(result({ id: "chunk-1", score: 0.8, snippet: structured }))).toBe("record:memory_abc123");
  });

  test("falls back to chunk id for unstructured snippets", () => {
    expect(memoryInjectionResultKey(result({ id: "chunk-plain", score: 0.8, snippet: "plain snippet" }))).toBe(
      "chunk:chunk-plain",
    );
  });
});

describe("isWriteIntentMemoryQuery", () => {
  test("detects write-intent phrases", () => {
    expect(isWriteIntentMemoryQuery("also remember that I have an android phone")).toBe(true);
    expect(isWriteIntentMemoryQuery("please note that this is important")).toBe(true);
    expect(isWriteIntentMemoryQuery("what is my favorite pokemon?")).toBe(false);
  });
});

describe("isMemoryRecallIntentQuery", () => {
  test("detects recall-intent phrases", () => {
    expect(isMemoryRecallIntentQuery("what do you remember about me?")).toBe(true);
    expect(isMemoryRecallIntentQuery("remind me what you know from memory")).toBe(true);
    expect(isMemoryRecallIntentQuery("what is my favorite pokemon?")).toBe(false);
  });
});
