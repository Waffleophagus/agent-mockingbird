import type { MemorySearchResult } from "../memory/types";

const MEMORY_RECORD_MARKER_RE = /###\s+\[memory:([a-zA-Z0-9_-]+)\]/i;
const TOKEN_RE = /[a-z0-9]{3,}/g;
const WRITE_INTENT_RE = /\b(?:remember|note\s+that|save\s+this)\b/i;

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

export function buildMemoryContextFingerprint(results: MemorySearchResult[]): string {
  const ids = [...new Set(results.map(result => result.id.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return JSON.stringify(ids);
}

export function isWriteIntentMemoryQuery(query: string): boolean {
  return WRITE_INTENT_RE.test(query);
}

export function prepareMemoryInjectionResults(query: string, results: MemorySearchResult[]): MemorySearchResult[] {
  const queryTokens = collectTokens(query);
  const deduped = new Map<string, MemorySearchResult>();

  for (const result of results) {
    const recordId = extractRecordId(result.snippet);
    const snippetTokens = collectTokens(`${result.citation}\n${result.snippet}`);
    const hasOverlap = [...snippetTokens].some(token => queryTokens.has(token));
    if (!recordId && queryTokens.size > 0 && !hasOverlap) {
      continue;
    }

    const key = recordId ? `record:${recordId}` : `snippet:${normalizeSnippetForDedupe(result.snippet)}`;
    if (!deduped.has(key)) {
      deduped.set(key, result);
    }
  }

  return [...deduped.values()];
}
