import type { MemorySearchResult } from "../memory/types";

const MEMORY_RECORD_MARKER_RE = /###\s+\[memory:([a-zA-Z0-9_-]+)\]/i;
const TOKEN_RE = /[a-z0-9]{3,}/g;
const WRITE_INTENT_RE = /\b(?:remember\s+that|note\s+that|save\s+this)\b/i;
const RECALL_INTENT_RE = /\b(?:what\s+do\s+you\s+remember|remind\s+me|recall|from\s+memory|what\s+do\s+you\s+know\s+about\s+me)\b/i;

function collectTokens(text: string) {
  const matched = text.toLowerCase().match(TOKEN_RE);
  return new Set(matched ?? []);
}

function normalizeSnippetForDedupe(snippet: string) {
  return snippet.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractRecordId(snippet: string): string | null {
  const matched = snippet.match(MEMORY_RECORD_MARKER_RE);
  const recordId = matched?.[1]?.trim();
  return recordId || null;
}

export function isMemoryRecallIntentQuery(query: string): boolean {
  return RECALL_INTENT_RE.test(query);
}

export function buildMemoryContextFingerprint(results: MemorySearchResult[]): string {
  const ids = [...new Set(results.map(result => result.id.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return JSON.stringify(ids);
}

export function isWriteIntentMemoryQuery(query: string): boolean {
  return WRITE_INTENT_RE.test(query);
}

export function memoryInjectionResultKey(result: MemorySearchResult): string {
  const recordId = extractRecordId(result.snippet);
  if (recordId) return `record:${recordId}`;
  return `chunk:${result.id.trim() || normalizeSnippetForDedupe(result.snippet)}`;
}

export function analyzeMemoryInjectionResults(query: string, results: MemorySearchResult[]): {
  results: MemorySearchResult[];
  filteredIrrelevantCount: number;
  dedupedCount: number;
} {
  const queryTokens = collectTokens(query);
  const recallIntent = isMemoryRecallIntentQuery(query);
  const deduped = new Map<string, MemorySearchResult>();
  let filteredIrrelevantCount = 0;

  for (const result of results) {
    const snippetTokens = collectTokens(`${result.citation}\n${result.snippet}`);
    const hasOverlap = [...snippetTokens].some(token => queryTokens.has(token));
    if (!recallIntent && queryTokens.size > 0 && !hasOverlap) {
      filteredIrrelevantCount += 1;
      continue;
    }

    const key = memoryInjectionResultKey(result);
    if (!deduped.has(key)) {
      deduped.set(key, result);
    }
  }

  const dedupedResults = [...deduped.values()];
  return {
    results: dedupedResults,
    filteredIrrelevantCount,
    dedupedCount: Math.max(0, results.length - filteredIrrelevantCount - dedupedResults.length),
  };
}

export function prepareMemoryInjectionResults(query: string, results: MemorySearchResult[]): MemorySearchResult[] {
  return analyzeMemoryInjectionResults(query, results).results;
}
