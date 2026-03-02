import crypto from "node:crypto";

import type { MemoryRecord, MemoryRecordInput } from "./types";

const RECORD_PREFIX = "memory";
const RECORD_HEADING_RE = /^###\s+\[memory:([a-zA-Z0-9_-]+)\].*$/m;
const RECORD_BLOCK_RE =
  /###\s+\[memory:([a-zA-Z0-9_-]+)\][^\n]*\n```json\n([\s\S]*?)\n```\n([\s\S]*?)(?=\n###\s+\[memory:|$)/g;

export interface ParsedMemoryRecordBlock {
  recordId: string;
  startLine: number;
  endLine: number;
  text: string;
}

function normalizeList(values: string[] | undefined): string[] {
  if (!values?.length) {
    return [];
  }
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.75;
  }
  return Math.max(0, Math.min(1, value));
}

function normalizeContent(content: string): string {
  return content.trim().replace(/\r\n/g, "\n");
}

export function createMemoryRecord(input: MemoryRecordInput): MemoryRecord {
  const createdAt = new Date().toISOString();
  const id = `${RECORD_PREFIX}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  return {
    id,
    recordedAt: createdAt,
    source: input.source,
    content: normalizeContent(input.content),
    entities: normalizeList(input.entities),
    confidence: clampConfidence(input.confidence),
    supersedes: normalizeList(input.supersedes),
  };
}

export function formatMemoryRecord(record: MemoryRecord): string {
  const meta = JSON.stringify(
    {
      id: record.id,
      source: record.source,
      confidence: clampConfidence(record.confidence),
      entities: normalizeList(record.entities),
      supersedes: normalizeList(record.supersedes),
      recordedAt: record.recordedAt,
    },
    null,
    2,
  );

  return [
    `### [memory:${record.id}] ${record.recordedAt}`,
    "```json",
    meta,
    "```",
    record.content,
    "",
  ].join("\n");
}

export function hasMemoryRecord(content: string, recordId: string): boolean {
  const heading = `### [memory:${recordId}]`;
  return content.includes(heading);
}

export function parseMemoryRecords(content: string): MemoryRecord[] {
  const records: MemoryRecord[] = [];
  const normalized = content.replace(/\r\n/g, "\n");

  let match: RegExpExecArray | null = RECORD_BLOCK_RE.exec(normalized);
  while (match) {
    const parsedId = match[1]?.trim();
    const metaRaw = match[2]?.trim();
    const bodyRaw = match[3]?.trim() ?? "";
    if (!parsedId || !metaRaw) {
      match = RECORD_BLOCK_RE.exec(normalized);
      continue;
    }

    try {
      const metadata = JSON.parse(metaRaw) as Partial<MemoryRecord>;
      const id = typeof metadata.id === "string" && metadata.id.trim() ? metadata.id.trim() : parsedId;
      const source = metadata.source ?? "system";
      const recordedAt =
        typeof metadata.recordedAt === "string" && metadata.recordedAt.trim()
          ? metadata.recordedAt.trim()
          : new Date().toISOString();

      records.push({
        id,
        source,
        recordedAt,
        content: bodyRaw,
        entities: normalizeList(metadata.entities),
        supersedes: normalizeList(metadata.supersedes),
        confidence: clampConfidence(metadata.confidence),
      });
    } catch {
      // ignore malformed metadata blocks
    }

    match = RECORD_BLOCK_RE.exec(normalized);
  }

  return records;
}

export function parseMemoryRecordBlocks(content: string): ParsedMemoryRecordBlock[] {
  const blocks: ParsedMemoryRecordBlock[] = [];
  const normalized = content.replace(/\r\n/g, "\n");
  let match: RegExpExecArray | null = RECORD_BLOCK_RE.exec(normalized);
  while (match) {
    const full = match[0] ?? "";
    const recordId = match[1]?.trim();
    const startOffset = match.index;
    const endOffsetExclusive = startOffset + full.length;
    if (!recordId || startOffset < 0 || !full.trim()) {
      match = RECORD_BLOCK_RE.exec(normalized);
      continue;
    }
    const startLine = normalized.slice(0, startOffset).split("\n").length;
    const endLine = normalized.slice(0, Math.max(startOffset, endOffsetExclusive - 1)).split("\n").length;
    blocks.push({
      recordId,
      startLine,
      endLine,
      text: full.trimEnd(),
    });
    match = RECORD_BLOCK_RE.exec(normalized);
  }
  return blocks;
}

export function extractRecordIdFromChunk(text: string): string | null {
  const headingMatch = text.match(RECORD_HEADING_RE);
  const rawId = headingMatch?.[1]?.trim();
  if (!rawId) {
    return null;
  }
  return rawId;
}
