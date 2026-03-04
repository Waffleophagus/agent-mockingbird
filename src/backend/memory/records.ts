import crypto from "node:crypto";

import type { MemoryRecord, MemoryRecordInput } from "./types";

const RECORD_PREFIX = "memory";
const RECORD_HEADING_RE = /^###\s+\[memory:([a-zA-Z0-9_-]+)\].*$/m;
const RECORD_BLOCK_RE =
  /###\s+\[memory:([a-zA-Z0-9_-]+)\]\s+([^\n]+)\n(?:meta:\s*([^\n]*)\n)?(?:\n)?([\s\S]*?)(?=\n###\s+\[memory:|$)/g;
const LEGACY_RECORD_BLOCK_RE =
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

function parseMetaLine(metaLine: string | undefined): Partial<MemoryRecordInput> {
  if (!metaLine) return {};
  const parsed: Partial<MemoryRecordInput> = {};
  const entries = metaLine
    .split(";")
    .map(item => item.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const delimiter = entry.indexOf("=");
    if (delimiter <= 0) continue;
    const key = entry.slice(0, delimiter).trim().toLowerCase();
    const value = entry.slice(delimiter + 1).trim();
    if (!value) continue;
    if (key === "source") {
      if (value === "user" || value === "assistant" || value === "system") {
        parsed.source = value;
      }
      continue;
    }
    if (key === "confidence") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        parsed.confidence = clampConfidence(numeric);
      }
      continue;
    }
    if (key === "entities") {
      parsed.entities = normalizeList(value.split(","));
      continue;
    }
    if (key === "supersedes") {
      parsed.supersedes = normalizeList(value.split(","));
    }
  }
  return parsed;
}

function buildMetaLine(record: MemoryRecord): string {
  const parts = [`source=${record.source}`];
  const confidence = clampConfidence(record.confidence);
  const entities = normalizeList(record.entities);
  const supersedes = normalizeList(record.supersedes);
  if (confidence !== 1) {
    parts.push(`confidence=${Number(confidence.toFixed(4))}`);
  }
  if (entities.length > 0) {
    parts.push(`entities=${entities.join(", ")}`);
  }
  if (supersedes.length > 0) {
    parts.push(`supersedes=${supersedes.join(",")}`);
  }
  return `meta: ${parts.join("; ")}`;
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
  return [
    `### [memory:${record.id}] ${record.recordedAt}`,
    buildMetaLine(record),
    "",
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
    const recordedAt = match[2]?.trim();
    const metaRaw = match[3]?.trim();
    const bodyRaw = match[4]?.trim() ?? "";
    if (!parsedId || !recordedAt) {
      match = RECORD_BLOCK_RE.exec(normalized);
      continue;
    }

    const metadata = parseMetaLine(metaRaw);
    records.push({
      id: parsedId,
      source: metadata.source ?? "system",
      recordedAt,
      content: bodyRaw,
      entities: normalizeList(metadata.entities),
      supersedes: normalizeList(metadata.supersedes),
      confidence: clampConfidence(metadata.confidence),
    });

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

export function migrateLegacyMemoryMarkdownToV2(content: string): { content: string; migrated: number } {
  const normalized = content.replace(/\r\n/g, "\n");
  const migrated: string[] = [];
  let migratedCount = 0;
  let match: RegExpExecArray | null = LEGACY_RECORD_BLOCK_RE.exec(normalized);
  while (match) {
    const parsedId = match[1]?.trim();
    const metaRaw = match[2]?.trim();
    const bodyRaw = match[3]?.trim() ?? "";
    if (!parsedId || !metaRaw) {
      match = LEGACY_RECORD_BLOCK_RE.exec(normalized);
      continue;
    }

    try {
      const metadata = JSON.parse(metaRaw) as Partial<MemoryRecord>;
      const source = metadata.source ?? "system";
      const recordedAt =
        typeof metadata.recordedAt === "string" && metadata.recordedAt.trim()
          ? metadata.recordedAt.trim()
          : new Date().toISOString();
      const record: MemoryRecord = {
        id: parsedId,
        source: source === "user" || source === "assistant" || source === "system" ? source : "system",
        recordedAt,
        content: bodyRaw,
        entities: normalizeList(metadata.entities),
        supersedes: normalizeList(metadata.supersedes),
        confidence: clampConfidence(metadata.confidence),
      };
      migrated.push(formatMemoryRecord(record).trimEnd());
      migratedCount += 1;
    } catch {
      // ignore malformed legacy records
    }

    match = LEGACY_RECORD_BLOCK_RE.exec(normalized);
  }

  if (migratedCount === 0) {
    return { content: normalized, migrated: 0 };
  }
  return {
    content: `${migrated.join("\n\n")}\n`,
    migrated: migratedCount,
  };
}
