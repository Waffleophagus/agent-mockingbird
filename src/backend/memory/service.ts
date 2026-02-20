import crypto from "node:crypto";
import { lstat, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createMemoryRecord,
  extractRecordIdFromChunk,
  formatMemoryRecord,
  parseMemoryRecords,
} from "./records";
import type {
  MemoryChunk,
  MemoryLintReport,
  MemoryPolicyInfo,
  MemoryRecord,
  MemoryRecordInput,
  MemoryRememberInput,
  MemoryRememberResult,
  MemorySearchResult,
  MemoryStatus,
  MemoryWriteEvent,
  MemoryWritePolicy,
  MemoryWriteValidation,
} from "./types";
import { getConfigSnapshot } from "../config/service";
import { sqlite } from "../db/client";

interface MemoryFileRow {
  path: string;
  hash: string;
}

interface MemoryChunkRow {
  id: string;
  path: string;
  start_line: number;
  end_line: number;
  text: string;
  embedding_json: string | null;
  updated_at: number;
}

interface MemoryFtsRow {
  chunk_id: string;
  path: string;
  start_line: number;
  end_line: number;
  text: string;
  rank: number;
}

interface MemoryRecordRow {
  id: string;
  superseded_by: string | null;
}

interface MemoryWriteEventRow {
  id: string;
  status: "accepted" | "rejected";
  reason: string;
  type: string;
  source: string;
  content: string;
  confidence: number;
  session_id: string | null;
  topic: string | null;
  record_id: string | null;
  path: string | null;
  created_at: number;
}

interface SearchCandidate {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  embedding: number[] | null;
  vectorScore: number;
  textScore: number;
  score: number;
  updatedAt: number;
  recordId: string | null;
}

const MEMORY_META_KEY = "memory_index_meta_v1";
const SOURCE = "memory";
const SNIPPET_MAX_CHARS = 700;
const DEFAULT_CANDIDATE_LIMIT = 48;
const MMR_LAMBDA = 0.75;
const VECTOR_PREFILTER_MIN = 200;
const VECTOR_PREFILTER_MAX = 800;
const SQLITE_IN_BIND_LIMIT = 900;
const EPHEMERAL_CONTENT_RE =
  /^(hi|hello|hey|yo|thanks|thank you|ok|okay|cool|nice|lol|lmao|ping|test|testing|what's up|sup)[\s.!?]*$/i;
const MIN_CONTENT_LENGTH_BY_POLICY: Record<MemoryWritePolicy, number> = {
  conservative: 24,
  moderate: 16,
  aggressive: 8,
};
const MIN_WORDS_BY_POLICY: Record<MemoryWritePolicy, number> = {
  conservative: 5,
  moderate: 4,
  aggressive: 2,
};
const ALLOWED_TYPES_BY_POLICY: Record<MemoryWritePolicy, MemoryRecordInput["type"][]> = {
  conservative: ["decision", "preference", "fact", "todo"],
  moderate: ["decision", "preference", "fact", "todo", "observation"],
  aggressive: ["decision", "preference", "fact", "todo", "observation"],
};

let schemaReady = false;
let lastSyncMs = 0;
let syncPromise: Promise<void> | null = null;

const nowMs = () => Date.now();
const hashText = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

function currentMemoryConfig() {
  return getConfigSnapshot().config.runtime.memory;
}

function resolveWorkspaceDir() {
  return path.resolve(currentMemoryConfig().workspaceDir);
}

function normalizeRelPath(absPath: string) {
  return path.relative(resolveWorkspaceDir(), absPath).replaceAll(path.sep, "/");
}

function isMemoryPath(relPath: string) {
  const normalized = relPath.trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("../")) {
    return false;
  }
  if (normalized === "MEMORY.md" || normalized === "memory.md") {
    return true;
  }
  return normalized.startsWith("memory/") && normalized.endsWith(".md");
}

function buildChunkId(relPath: string, chunk: MemoryChunk) {
  return hashText(`${SOURCE}:${relPath}:${chunk.startLine}:${chunk.endLine}:${chunk.hash}`);
}

function parseEmbedding(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as number[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cosineSimilarity(a: number[], b: number[]) {
  if (!a.length || !b.length) return 0;
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  if (magA <= 0 || magB <= 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function clipSnippet(text: string, maxChars = SNIPPET_MAX_CHARS) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}…`;
}

function normalizeRecordInput(input: MemoryRecordInput): MemoryRecordInput {
  return {
    type: input.type,
    source: input.source,
    content: input.content.trim(),
    entities: [...new Set((input.entities ?? []).map(value => value.trim()).filter(Boolean))],
    confidence:
      typeof input.confidence === "number" ? Math.max(0, Math.min(1, input.confidence)) : undefined,
    supersedes: [...new Set((input.supersedes ?? []).map(value => value.trim()).filter(Boolean))],
  };
}

function resolveWritePolicy(): MemoryWritePolicy {
  return currentMemoryConfig().writePolicy;
}

function resolveAllowedTypes(policy: MemoryWritePolicy) {
  return ALLOWED_TYPES_BY_POLICY[policy];
}

function splitWords(content: string) {
  return content
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean);
}

function isLikelyEphemeral(content: string) {
  if (EPHEMERAL_CONTENT_RE.test(content)) return true;
  const lowered = content.toLowerCase();
  return (
    lowered.includes("this message") ||
    lowered.includes("current prompt") ||
    lowered.includes("current request") ||
    lowered.includes("just said")
  );
}

function chunkMarkdown(content: string, tokens: number, overlap: number): MemoryChunk[] {
  const lines = content.split("\n");
  if (!lines.length) return [];

  const maxChars = Math.max(64, tokens * 4);
  const overlapChars = Math.max(0, overlap * 4);

  const chunks: MemoryChunk[] = [];
  let current: Array<{ line: string; lineNo: number }> = [];
  let charCount = 0;

  const flush = () => {
    if (!current.length) return;
    const first = current[0];
    const last = current[current.length - 1];
    if (!first || !last) return;
    const text = current.map(entry => entry.line).join("\n");
    chunks.push({
      id: "",
      path: "",
      startLine: first.lineNo,
      endLine: last.lineNo,
      text,
      hash: hashText(text),
    });
  };

  const carryOverlap = () => {
    if (overlapChars <= 0 || !current.length) {
      current = [];
      charCount = 0;
      return;
    }

    let tracked = 0;
    const kept: Array<{ line: string; lineNo: number }> = [];
    for (let i = current.length - 1; i >= 0; i -= 1) {
      const entry = current[i];
      if (!entry) continue;
      tracked += entry.line.length + 1;
      kept.unshift(entry);
      if (tracked >= overlapChars) break;
    }

    current = kept;
    charCount = kept.reduce((sum, entry) => sum + entry.line.length + 1, 0);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNo = index + 1;
    const segments: string[] = line.length
      ? Array.from({ length: Math.ceil(line.length / maxChars) }, (_, segmentIndex) =>
          line.slice(segmentIndex * maxChars, segmentIndex * maxChars + maxChars),
        )
      : [""];

    for (const segment of segments) {
      const segmentSize = segment.length + 1;
      if (charCount + segmentSize > maxChars && current.length) {
        flush();
        carryOverlap();
      }
      current.push({ line: segment, lineNo });
      charCount += segmentSize;
    }
  }

  flush();
  return chunks.filter(chunk => chunk.text.trim().length > 0);
}

function buildFtsQuery(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map(token => token.trim())
    .filter(token => token.length >= 2);
  if (!tokens.length) return null;
  return tokens.map(token => `${token}*`).join(" AND ");
}

async function walkDirectory(dir: string, output: string[]) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walkDirectory(full, output);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    output.push(full);
  }
}

async function listMemoryFiles(): Promise<string[]> {
  const workspaceDir = resolveWorkspaceDir();
  const files: string[] = [];
  const baseCandidates = ["MEMORY.md", "memory.md"].map(name => path.join(workspaceDir, name));
  for (const candidate of baseCandidates) {
    try {
      const candidateStat = await lstat(candidate);
      if (candidateStat.isFile() && !candidateStat.isSymbolicLink()) {
        files.push(candidate);
      }
    } catch {
      // noop
    }
  }

  const memoryDir = path.join(workspaceDir, "memory");
  try {
    const memoryStat = await lstat(memoryDir);
    if (memoryStat.isDirectory() && !memoryStat.isSymbolicLink()) {
      await walkDirectory(memoryDir, files);
    }
  } catch {
    // noop
  }

  return [...new Set(files)];
}

async function ensureWorkspaceScaffold() {
  const workspaceDir = resolveWorkspaceDir();
  await mkdir(path.join(workspaceDir, "memory"), { recursive: true });
  const memoryFile = path.join(workspaceDir, "MEMORY.md");
  try {
    await stat(memoryFile);
  } catch {
    await writeFile(memoryFile, "# Durable Memory\n\n", "utf8");
  }
}

async function ensureSchema() {
  if (schemaReady) return;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS memory_meta (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_files (
      path TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'memory',
      hash TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'memory',
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding_json TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS memory_chunks_path_idx ON memory_chunks(path);
    CREATE INDEX IF NOT EXISTS memory_chunks_updated_idx ON memory_chunks(updated_at);

    CREATE TABLE IF NOT EXISTS memory_embedding_cache (
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      hash TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      dims INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(provider, model, hash)
    );

    CREATE INDEX IF NOT EXISTS memory_embedding_cache_updated_idx ON memory_embedding_cache(updated_at);

    CREATE TABLE IF NOT EXISTS memory_records (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      entities_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      supersedes_json TEXT NOT NULL,
      superseded_by TEXT,
      recorded_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS memory_records_path_idx ON memory_records(path);
    CREATE INDEX IF NOT EXISTS memory_records_superseded_idx ON memory_records(superseded_by);

    CREATE TABLE IF NOT EXISTS memory_write_events (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL NOT NULL,
      session_id TEXT,
      topic TEXT,
      record_id TEXT,
      path TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS memory_write_events_created_idx ON memory_write_events(created_at DESC);
  `);

  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
      text,
      chunk_id UNINDEXED,
      path UNINDEXED,
      start_line UNINDEXED,
      end_line UNINDEXED,
      updated_at UNINDEXED
    );
  `);

  schemaReady = true;
}

function getEmbeddingProviderConfig() {
  const memoryConfig = currentMemoryConfig();
  return {
    provider: memoryConfig.embedProvider,
    model: memoryConfig.embedModel,
    ollamaBaseUrl: memoryConfig.ollamaBaseUrl,
  };
}

async function embedWithOllama(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];

  const { ollamaBaseUrl, model } = getEmbeddingProviderConfig();
  const baseUrl = ollamaBaseUrl.replace(/\/+$/, "");
  const embedResponse = await fetch(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
  });

  if (embedResponse.ok) {
    const payload = (await embedResponse.json()) as { embeddings?: number[][] };
    const embeddings = payload.embeddings ?? [];
    if (embeddings.length === texts.length) {
      return embeddings.map(vector => vector.map(value => (Number.isFinite(value) ? value : 0)));
    }
  }

  const vectors: number[][] = [];
  for (const text of texts) {
    const fallbackResponse = await fetch(`${baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!fallbackResponse.ok) {
      const payload = await fallbackResponse.text();
      throw new Error(`Ollama embedding failed: ${fallbackResponse.status} ${payload}`);
    }
    const payload = (await fallbackResponse.json()) as { embedding?: number[] };
    vectors.push((payload.embedding ?? []).map(value => (Number.isFinite(value) ? value : 0)));
  }

  return vectors;
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const provider = currentMemoryConfig().embedProvider;
  if (provider === "none") {
    return texts.map(() => []);
  }
  return embedWithOllama(texts);
}

function loadEmbeddingCache(hashes: string[]) {
  if (!hashes.length) return new Map<string, number[]>();
  const { provider, model } = getEmbeddingProviderConfig();
  const unique = [...new Set(hashes)];
  const placeholders = unique.map(() => "?").join(", ");
  const rows = sqlite
    .query(
      `
      SELECT hash, embedding_json
      FROM memory_embedding_cache
      WHERE provider = ?1 AND model = ?2 AND hash IN (${placeholders})
    `,
    )
    .all(provider, model, ...unique) as Array<{ hash: string; embedding_json: string }>;

  return new Map(rows.map(row => [row.hash, parseEmbedding(row.embedding_json)]));
}

function upsertEmbeddingCache(entries: Array<{ hash: string; embedding: number[] }>) {
  if (!entries.length) return;
  const { provider, model } = getEmbeddingProviderConfig();
  const upsert = sqlite.query(`
    INSERT INTO memory_embedding_cache (provider, model, hash, embedding_json, dims, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(provider, model, hash) DO UPDATE SET
      embedding_json = excluded.embedding_json,
      dims = excluded.dims,
      updated_at = excluded.updated_at
  `);
  const updatedAt = nowMs();
  for (const entry of entries) {
    upsert.run(provider, model, entry.hash, JSON.stringify(entry.embedding), entry.embedding.length, updatedAt);
  }
}

async function embedChunks(chunks: MemoryChunk[]) {
  if (!chunks.length) return [];
  const cache = loadEmbeddingCache(chunks.map(chunk => chunk.hash));
  const result: number[][] = Array.from({ length: chunks.length }, () => []);
  const missing: Array<{ index: number; chunk: MemoryChunk }> = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (!chunk) continue;
    const cached = cache.get(chunk.hash);
    if (cached?.length) {
      result[i] = cached;
    } else {
      missing.push({ index: i, chunk });
    }
  }

  if (!missing.length) return result;

  const embeddings = await embedTexts(missing.map(item => item.chunk.text));
  const cacheEntries: Array<{ hash: string; embedding: number[] }> = [];
  for (let i = 0; i < missing.length; i += 1) {
    const missingItem = missing[i];
    const embedding = embeddings[i] ?? [];
    if (!missingItem) continue;
    result[missingItem.index] = embedding;
    cacheEntries.push({ hash: missingItem.chunk.hash, embedding });
  }
  upsertEmbeddingCache(cacheEntries);
  return result;
}

async function indexMemoryFile(filePath: string, options?: { force?: boolean }) {
  const fileStat = await stat(filePath);
  const content = await readFile(filePath, "utf8");
  const fileHash = hashText(content);
  const relPath = normalizeRelPath(filePath);

  const row = sqlite
    .query("SELECT path, hash FROM memory_files WHERE path = ?1")
    .get(relPath) as MemoryFileRow | null;
  if (!options?.force && row?.hash === fileHash) {
    return false;
  }

  const memoryConfig = currentMemoryConfig();
  const chunks = chunkMarkdown(content, memoryConfig.chunkTokens, memoryConfig.chunkOverlap).map(
    chunk => ({
      ...chunk,
      id: buildChunkId(relPath, chunk),
      path: relPath,
    }),
  );
  const embeddings = await embedChunks(chunks);
  const updatedAt = nowMs();

  const tx = sqlite.transaction(() => {
    sqlite.query("DELETE FROM memory_chunks_fts WHERE path = ?1").run(relPath);
    sqlite.query("DELETE FROM memory_chunks WHERE path = ?1").run(relPath);
    sqlite.query("DELETE FROM memory_records WHERE path = ?1").run(relPath);

    const insertChunk = sqlite.query(`
      INSERT INTO memory_chunks (
        id, path, source, start_line, end_line, hash, text, embedding_json, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    `);
    const insertFts = sqlite.query(`
      INSERT INTO memory_chunks_fts (text, chunk_id, path, start_line, end_line, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `);

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      if (!chunk) continue;
      const embedding = embeddings[index] ?? [];
      insertChunk.run(
        chunk.id,
        relPath,
        SOURCE,
        chunk.startLine,
        chunk.endLine,
        chunk.hash,
        chunk.text,
        embedding.length ? JSON.stringify(embedding) : null,
        updatedAt,
      );
      insertFts.run(chunk.text, chunk.id, relPath, chunk.startLine, chunk.endLine, updatedAt);
    }

    const records = parseMemoryRecords(content);
    const insertRecord = sqlite.query(`
      INSERT INTO memory_records (
        id, path, type, source, content, entities_json, confidence, supersedes_json, superseded_by, recorded_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10)
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        type = excluded.type,
        source = excluded.source,
        content = excluded.content,
        entities_json = excluded.entities_json,
        confidence = excluded.confidence,
        supersedes_json = excluded.supersedes_json,
        recorded_at = excluded.recorded_at,
        updated_at = excluded.updated_at
    `);
    const markSuperseded = sqlite.query(`
      UPDATE memory_records
      SET superseded_by = ?2, updated_at = ?3
      WHERE id = ?1
    `);

    for (const record of records) {
      const recordedMs = Number.isFinite(Date.parse(record.recordedAt))
        ? Date.parse(record.recordedAt)
        : updatedAt;
      insertRecord.run(
        record.id,
        relPath,
        record.type,
        record.source,
        record.content,
        JSON.stringify(record.entities ?? []),
        typeof record.confidence === "number" ? record.confidence : 0.75,
        JSON.stringify(record.supersedes ?? []),
        recordedMs,
        updatedAt,
      );
    }

    for (const record of records) {
      for (const supersededId of record.supersedes ?? []) {
        markSuperseded.run(supersededId, record.id, updatedAt);
      }
    }

    sqlite
      .query(
        `
        INSERT INTO memory_files (path, source, hash, mtime, size, indexed_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(path) DO UPDATE SET
          source = excluded.source,
          hash = excluded.hash,
          mtime = excluded.mtime,
          size = excluded.size,
          indexed_at = excluded.indexed_at
      `,
      )
      .run(relPath, SOURCE, fileHash, Math.floor(fileStat.mtimeMs), fileStat.size, updatedAt);
  });

  tx();
  return true;
}

async function pruneStaleFiles(activePaths: Set<string>) {
  const staleRows = sqlite.query("SELECT path FROM memory_files").all() as Array<{ path: string }>;
  const tx = sqlite.transaction(() => {
    for (const stale of staleRows) {
      if (activePaths.has(stale.path)) continue;
      sqlite.query("DELETE FROM memory_files WHERE path = ?1").run(stale.path);
      sqlite.query("DELETE FROM memory_chunks WHERE path = ?1").run(stale.path);
      sqlite.query("DELETE FROM memory_chunks_fts WHERE path = ?1").run(stale.path);
      sqlite.query("DELETE FROM memory_records WHERE path = ?1").run(stale.path);
    }
  });
  tx();
}

async function runSync(force = false) {
  const memoryConfig = currentMemoryConfig();
  await ensureWorkspaceScaffold();
  await ensureSchema();
  const files = await listMemoryFiles();
  const activePaths = new Set<string>();
  for (const filePath of files) {
    const relPath = normalizeRelPath(filePath);
    if (!isMemoryPath(relPath)) continue;
    activePaths.add(relPath);
    await indexMemoryFile(filePath, { force });
  }
  await pruneStaleFiles(activePaths);
  const indexedAt = nowMs();
  sqlite
    .query(
      `
      INSERT INTO memory_meta (key, value_json)
      VALUES (?1, ?2)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `,
    )
    .run(
      MEMORY_META_KEY,
      JSON.stringify({
        provider: memoryConfig.embedProvider,
        model: memoryConfig.embedModel,
        chunkTokens: memoryConfig.chunkTokens,
        chunkOverlap: memoryConfig.chunkOverlap,
        indexedAt,
      }),
    );
  lastSyncMs = indexedAt;
}

export async function syncMemoryIndex(options?: { force?: boolean }) {
  if (!currentMemoryConfig().enabled) {
    return;
  }
  if (syncPromise) {
    await syncPromise;
    return;
  }
  syncPromise = runSync(Boolean(options?.force)).finally(() => {
    syncPromise = null;
  });
  await syncPromise;
}

async function ensureFreshIndex() {
  const needsSync = lastSyncMs === 0 || nowMs() - lastSyncMs > currentMemoryConfig().syncCooldownMs;
  if (needsSync) {
    await syncMemoryIndex();
  }
}

export function getMemoryPolicy(): MemoryPolicyInfo {
  const memoryConfig = currentMemoryConfig();
  const policy = resolveWritePolicy();
  const allowedTypes = [...resolveAllowedTypes(policy)];
  const disallowedTypes = (["decision", "preference", "fact", "todo", "observation"] as const).filter(
    type => !allowedTypes.includes(type),
  );
  return {
    mode: memoryConfig.toolMode,
    writePolicy: policy,
    minConfidence: memoryConfig.minConfidence,
    allowedTypes,
    disallowedTypes,
    guidance: [
      "Remember only durable facts/preferences/decisions/todos.",
      "Avoid transient chat, greetings, and one-off operational chatter.",
      "Use supersedes when updating prior memory entries.",
    ],
  };
}

async function findDuplicateRecordId(input: MemoryRecordInput) {
  await ensureSchema();
  const row = sqlite
    .query(
      `
      SELECT id
      FROM memory_records
      WHERE type = ?1
        AND content = ?2
        AND superseded_by IS NULL
      ORDER BY recorded_at DESC
      LIMIT 1
    `,
    )
    .get(input.type, input.content) as { id: string } | null;
  return row?.id;
}

export async function validateMemoryRememberInput(input: MemoryRememberInput): Promise<MemoryWriteValidation> {
  const memoryConfig = currentMemoryConfig();
  const normalized = normalizeRecordInput(input);
  const content = normalized.content;
  const confidence = typeof normalized.confidence === "number" ? normalized.confidence : 0.75;
  const policy = resolveWritePolicy();
  const allowedTypes = resolveAllowedTypes(policy);

  if (!content) {
    return {
      accepted: false,
      reason: "content is required",
      normalizedContent: content,
      normalizedConfidence: confidence,
    };
  }

  if (!allowedTypes.includes(normalized.type)) {
    return {
      accepted: false,
      reason: `type '${normalized.type}' is not allowed by ${policy} policy`,
      normalizedContent: content,
      normalizedConfidence: confidence,
    };
  }

  if (confidence < memoryConfig.minConfidence) {
    return {
      accepted: false,
      reason: `confidence ${confidence.toFixed(2)} is below minimum ${memoryConfig.minConfidence.toFixed(2)}`,
      normalizedContent: content,
      normalizedConfidence: confidence,
    };
  }

  if (content.length < MIN_CONTENT_LENGTH_BY_POLICY[policy]) {
    return {
      accepted: false,
      reason: "content is too short for durable memory",
      normalizedContent: content,
      normalizedConfidence: confidence,
    };
  }

  if (splitWords(content).length < MIN_WORDS_BY_POLICY[policy]) {
    return {
      accepted: false,
      reason: "content has too few words for durable memory",
      normalizedContent: content,
      normalizedConfidence: confidence,
    };
  }

  if (isLikelyEphemeral(content)) {
    return {
      accepted: false,
      reason: "content appears ephemeral and was rejected",
      normalizedContent: content,
      normalizedConfidence: confidence,
    };
  }

  const duplicateRecordId = await findDuplicateRecordId(normalized);
  if (duplicateRecordId) {
    return {
      accepted: false,
      reason: "duplicate durable memory already exists",
      normalizedContent: content,
      normalizedConfidence: confidence,
      duplicateRecordId,
    };
  }

  return {
    accepted: true,
    reason: "accepted",
    normalizedContent: content,
    normalizedConfidence: confidence,
  };
}

async function logMemoryWriteEvent(input: {
  status: "accepted" | "rejected";
  reason: string;
  type: MemoryRecordInput["type"];
  source: MemoryRecordInput["source"];
  content: string;
  confidence: number;
  sessionId?: string;
  topic?: string;
  recordId?: string;
  path?: string;
}) {
  await ensureSchema();
  const createdAt = nowMs();
  sqlite
    .query(
      `
      INSERT INTO memory_write_events (
        id, status, reason, type, source, content, confidence, session_id, topic, record_id, path, created_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    `,
    )
    .run(
      crypto.randomUUID(),
      input.status,
      input.reason,
      input.type,
      input.source,
      input.content,
      input.confidence,
      input.sessionId ?? null,
      input.topic ?? null,
      input.recordId ?? null,
      input.path ?? null,
      createdAt,
    );
}

export async function listMemoryWriteEvents(limit = 20): Promise<MemoryWriteEvent[]> {
  if (!currentMemoryConfig().enabled) {
    return [];
  }
  await ensureSchema();
  const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : 20;
  const safeLimit = Math.max(1, Math.min(100, normalizedLimit));
  const rows = sqlite
    .query(
      `
      SELECT id, status, reason, type, source, content, confidence, session_id, topic, record_id, path, created_at
      FROM memory_write_events
      ORDER BY created_at DESC
      LIMIT ?1
    `,
    )
    .all(safeLimit) as MemoryWriteEventRow[];
  return rows.map(row => ({
    id: row.id,
    status: row.status,
    reason: row.reason,
    type: row.type as MemoryRecordInput["type"],
    source: row.source as MemoryRecordInput["source"],
    content: row.content,
    confidence: row.confidence,
    sessionId: row.session_id,
    topic: row.topic,
    recordId: row.record_id,
    path: row.path,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function lintMemory(): Promise<MemoryLintReport> {
  if (!currentMemoryConfig().enabled) {
    return {
      ok: true,
      totalRecords: 0,
      duplicateActiveRecords: [],
      danglingSupersedes: [],
    };
  }

  await ensureSchema();
  const allRows = sqlite
    .query(
      `
      SELECT id, type, content, supersedes_json, superseded_by
      FROM memory_records
    `,
    )
    .all() as Array<{
    id: string;
    type: string;
    content: string;
    supersedes_json: string;
    superseded_by: string | null;
  }>;
  const idSet = new Set(allRows.map(row => row.id));

  const activeRows = allRows.filter(row => !row.superseded_by);
  const duplicateKeyMap = new Map<string, { type: string; content: string; ids: string[] }>();
  for (const row of activeRows) {
    const key = `${row.type}\n${row.content}`;
    const existing = duplicateKeyMap.get(key);
    if (existing) {
      existing.ids.push(row.id);
    } else {
      duplicateKeyMap.set(key, {
        type: row.type,
        content: row.content,
        ids: [row.id],
      });
    }
  }

  const duplicateActiveRecords = [...duplicateKeyMap.values()]
    .filter(entry => entry.ids.length > 1)
    .map(entry => ({
      type: entry.type as MemoryRecordInput["type"],
      content: clipSnippet(entry.content, 240),
      count: entry.ids.length,
      recordIds: entry.ids,
    }));

  const danglingSupersedes = allRows
    .map(row => {
      let supersedes: string[] = [];
      try {
        const parsed = JSON.parse(row.supersedes_json) as unknown;
        if (Array.isArray(parsed)) {
          supersedes = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
        }
      } catch {
        supersedes = [];
      }
      const missing = supersedes.filter(id => !idSet.has(id));
      if (!missing.length) return null;
      return {
        recordId: row.id,
        missingSupersedes: missing,
      };
    })
    .filter((item): item is { recordId: string; missingSupersedes: string[] } => Boolean(item));

  return {
    ok: duplicateActiveRecords.length === 0 && danglingSupersedes.length === 0,
    totalRecords: allRows.length,
    duplicateActiveRecords,
    danglingSupersedes,
  };
}

export async function rememberMemory(
  input: MemoryRememberInput,
  options?: { validateOnly?: boolean },
): Promise<MemoryRememberResult> {
  if (!currentMemoryConfig().enabled) {
    throw new Error("Memory is disabled.");
  }

  const normalized = normalizeRecordInput(input);
  const validation = await validateMemoryRememberInput(input);
  const policy = resolveWritePolicy();

  if (!validation.accepted) {
    await logMemoryWriteEvent({
      status: "rejected",
      reason: validation.reason,
      type: normalized.type,
      source: normalized.source,
      content: validation.normalizedContent,
      confidence: validation.normalizedConfidence,
      sessionId: input.sessionId,
      topic: input.topic,
    });
    return {
      accepted: false,
      reason: validation.reason,
      policy,
      validation,
    };
  }

  if (options?.validateOnly) {
    return {
      accepted: true,
      reason: validation.reason,
      policy,
      validation,
    };
  }

  const persisted = await appendStructuredMemory({
    type: normalized.type,
    source: normalized.source,
    content: validation.normalizedContent,
    entities: normalized.entities,
    confidence: validation.normalizedConfidence,
    supersedes: normalized.supersedes,
  });

  await logMemoryWriteEvent({
    status: "accepted",
    reason: validation.reason,
    type: normalized.type,
    source: normalized.source,
    content: validation.normalizedContent,
    confidence: validation.normalizedConfidence,
    sessionId: input.sessionId,
    topic: input.topic,
    recordId: persisted.record.id,
    path: persisted.path,
  });

  return {
    accepted: true,
    reason: validation.reason,
    policy,
    validation,
    record: persisted.record,
    path: persisted.path,
  };
}

function parseUpdatedAtFromMeta(): number | null {
  const row = sqlite
    .query("SELECT value_json FROM memory_meta WHERE key = ?1")
    .get(MEMORY_META_KEY) as { value_json: string } | null;
  if (!row?.value_json) return null;
  try {
    const parsed = JSON.parse(row.value_json) as { indexedAt?: number };
    return typeof parsed.indexedAt === "number" ? parsed.indexedAt : null;
  } catch {
    return null;
  }
}

function selectRecentChunkIds(limit: number): string[] {
  if (limit <= 0) return [];
  const rows = sqlite
    .query(
      `
      SELECT id
      FROM memory_chunks
      ORDER BY updated_at DESC
      LIMIT ?1
    `,
    )
    .all(limit) as Array<{ id: string }>;
  return rows.map(row => row.id);
}

function searchVectorCandidates(queryVector: number[], candidateLimit: number, seedChunkIds: string[] = []) {
  if (!queryVector.length) return new Map<string, number>();

  const prefilterLimit = Math.max(
    VECTOR_PREFILTER_MIN,
    Math.min(VECTOR_PREFILTER_MAX, candidateLimit * 12),
  );
  const prefilterIds = [...new Set([...seedChunkIds, ...selectRecentChunkIds(prefilterLimit)])].slice(
    0,
    SQLITE_IN_BIND_LIMIT,
  );
  if (!prefilterIds.length) return new Map<string, number>();

  const placeholders = prefilterIds.map(() => "?").join(", ");
  const rows = sqlite
    .query(
      `
      SELECT id, embedding_json
      FROM memory_chunks
      WHERE embedding_json IS NOT NULL
        AND id IN (${placeholders})
    `,
    )
    .all(...prefilterIds) as Array<{ id: string; embedding_json: string }>;

  const scored = rows
    .map(row => ({
      id: row.id,
      score: cosineSimilarity(queryVector, parseEmbedding(row.embedding_json)),
    }))
    .filter(row => Number.isFinite(row.score) && row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, candidateLimit);
  return new Map(scored.map(row => [row.id, row.score]));
}

function searchTextCandidates(query: string, candidateLimit: number) {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return new Map<string, number>();
  const rows = sqlite
    .query(
      `
      SELECT chunk_id, path, start_line, end_line, text, bm25(memory_chunks_fts) AS rank
      FROM memory_chunks_fts
      WHERE memory_chunks_fts MATCH ?1
      ORDER BY rank ASC
      LIMIT ?2
    `,
    )
    .all(ftsQuery, candidateLimit) as MemoryFtsRow[];
  const scores = new Map<string, number>();
  for (const row of rows) {
    const rank = Number.isFinite(row.rank) ? Math.abs(row.rank) : 1;
    scores.set(row.chunk_id, 1 / (1 + rank));
  }
  return scores;
}

function applySupersededPenalty(candidates: SearchCandidate[]) {
  const recordIds = [...new Set(candidates.map(candidate => candidate.recordId).filter((id): id is string => Boolean(id)))];
  if (!recordIds.length) return;
  const placeholders = recordIds.map(() => "?").join(", ");
  const rows = sqlite
    .query(
      `
      SELECT id, superseded_by
      FROM memory_records
      WHERE id IN (${placeholders})
    `,
    )
    .all(...recordIds) as MemoryRecordRow[];
  const superseded = new Set(rows.filter(row => row.superseded_by).map(row => row.id));
  for (const candidate of candidates) {
    if (candidate.recordId && superseded.has(candidate.recordId)) {
      candidate.score = Math.max(0, candidate.score - 0.15);
    }
  }
}

function applyRecencyBoost(candidates: SearchCandidate[]) {
  const current = nowMs();
  for (const candidate of candidates) {
    const ageDays = Math.max(0, (current - candidate.updatedAt) / (24 * 60 * 60 * 1000));
    const recency = 1 / (1 + ageDays / 14);
    candidate.score += recency * 0.15;
  }
}

function mmrRerank(candidates: SearchCandidate[], maxResults: number) {
  if (candidates.length <= maxResults) {
    return [...candidates].sort((a, b) => b.score - a.score);
  }

  const selected: SearchCandidate[] = [];
  const pool = [...candidates];

  while (selected.length < maxResults && pool.length) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index];
      if (!candidate) continue;
      const relevance = candidate.score;
      let maxSimilarity = 0;
      if (candidate.embedding?.length) {
        for (const picked of selected) {
          if (!picked.embedding?.length) continue;
          maxSimilarity = Math.max(maxSimilarity, cosineSimilarity(candidate.embedding, picked.embedding));
        }
      }
      const mmrScore = MMR_LAMBDA * relevance - (1 - MMR_LAMBDA) * maxSimilarity;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = index;
      }
    }

    const [picked] = pool.splice(bestIndex, 1);
    if (!picked) break;
    selected.push(picked);
  }

  return selected;
}

export async function searchMemory(query: string, options?: { maxResults?: number; minScore?: number }) {
  const memoryConfig = currentMemoryConfig();
  if (!memoryConfig.enabled) {
    return [] as MemorySearchResult[];
  }
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [] as MemorySearchResult[];
  }

  await ensureFreshIndex();

  const maxResults = Math.max(1, options?.maxResults ?? memoryConfig.maxResults);
  const minScore = Math.max(0, Math.min(1, options?.minScore ?? memoryConfig.minScore));
  const candidateLimit = Math.max(maxResults * 6, DEFAULT_CANDIDATE_LIMIT);

  let queryVector: number[] = [];
  try {
    const vectors = await embedTexts([normalizedQuery]);
    queryVector = vectors[0] ?? [];
  } catch {
    queryVector = [];
  }

  const textScores = searchTextCandidates(normalizedQuery, candidateLimit);
  const vectorScores = searchVectorCandidates(queryVector, candidateLimit, [...textScores.keys()]);
  const candidateIds = [...new Set([...vectorScores.keys(), ...textScores.keys()])];
  if (!candidateIds.length) return [] as MemorySearchResult[];

  const placeholders = candidateIds.map(() => "?").join(", ");
  const chunkRows = sqlite
    .query(
      `
      SELECT id, path, start_line, end_line, text, embedding_json, updated_at
      FROM memory_chunks
      WHERE id IN (${placeholders})
    `,
    )
    .all(...candidateIds) as MemoryChunkRow[];

  const candidates: SearchCandidate[] = chunkRows.map(row => {
    const vectorScore = vectorScores.get(row.id) ?? 0;
    const textScore = textScores.get(row.id) ?? 0;
    const hybrid = 0.72 * vectorScore + 0.28 * textScore;
    const embedding = parseEmbedding(row.embedding_json);
    return {
      id: row.id,
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      text: row.text,
      embedding: embedding.length ? embedding : null,
      vectorScore,
      textScore,
      score: hybrid,
      updatedAt: row.updated_at,
      recordId: extractRecordIdFromChunk(row.text),
    };
  });

  applyRecencyBoost(candidates);
  applySupersededPenalty(candidates);

  const filtered = candidates.filter(candidate => candidate.score >= minScore);
  const reranked = mmrRerank(filtered, maxResults);

  return reranked.map(candidate => ({
    id: candidate.id,
    path: candidate.path,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    source: "memory",
    score: Number(candidate.score.toFixed(4)),
    snippet: clipSnippet(candidate.text),
    citation: `${candidate.path}#L${candidate.startLine}`,
  }));
}

export async function readMemoryFileSlice(input: { relPath: string; from?: number; lines?: number }) {
  if (!currentMemoryConfig().enabled) {
    throw new Error("Memory is disabled.");
  }

  const relPath = input.relPath.trim();
  if (!isMemoryPath(relPath)) {
    throw new Error("Invalid memory path.");
  }

  const workspaceDir = resolveWorkspaceDir();
  const absPath = path.resolve(workspaceDir, relPath);
  if (normalizeRelPath(absPath) !== relPath.replaceAll("\\", "/")) {
    throw new Error("Invalid memory path.");
  }

  const content = await readFile(absPath, "utf8");
  if (!input.from && !input.lines) {
    return { path: relPath, text: content };
  }

  const from = Math.max(1, input.from ?? 1);
  const lines = Math.max(1, input.lines ?? 120);
  const slice = content.split("\n").slice(from - 1, from - 1 + lines).join("\n");
  return { path: relPath, text: slice };
}

export async function appendStructuredMemory(input: MemoryRecordInput): Promise<{
  record: MemoryRecord;
  path: string;
}> {
  if (!currentMemoryConfig().enabled) {
    throw new Error("Memory is disabled.");
  }
  const normalized = normalizeRecordInput(input);
  if (!normalized.content) {
    throw new Error("Memory content is required.");
  }

  await ensureWorkspaceScaffold();
  await ensureSchema();

  const record = createMemoryRecord(normalized);
  const dayStamp = record.recordedAt.slice(0, 10);
  const relPath = `memory/${dayStamp}.md`;
  const absPath = path.join(resolveWorkspaceDir(), relPath);
  await mkdir(path.dirname(absPath), { recursive: true });

  let previous = "";
  try {
    previous = await readFile(absPath, "utf8");
  } catch {
    previous = "";
  }

  const block = formatMemoryRecord(record);
  const separator = previous.trim().length ? "\n" : "";
  await writeFile(absPath, `${previous}${separator}${block}`, "utf8");

  await indexMemoryFile(absPath, { force: true });
  lastSyncMs = nowMs();

  return { record, path: relPath };
}

export async function getMemoryStatus(): Promise<MemoryStatus> {
  const memoryConfig = currentMemoryConfig();
  if (!memoryConfig.enabled) {
    return {
      enabled: false,
      workspaceDir: resolveWorkspaceDir(),
      provider: memoryConfig.embedProvider,
      model: memoryConfig.embedModel,
      toolMode: memoryConfig.toolMode,
      writePolicy: memoryConfig.writePolicy,
      minConfidence: memoryConfig.minConfidence,
      files: 0,
      chunks: 0,
      records: 0,
      cacheEntries: 0,
      indexedAt: null,
    };
  }

  await ensureSchema();
  const files = sqlite.query("SELECT COUNT(*) as count FROM memory_files").get() as { count: number };
  const chunks = sqlite.query("SELECT COUNT(*) as count FROM memory_chunks").get() as { count: number };
  const records = sqlite.query("SELECT COUNT(*) as count FROM memory_records").get() as { count: number };
  const cache = sqlite.query("SELECT COUNT(*) as count FROM memory_embedding_cache").get() as {
    count: number;
  };
  const indexedAt = parseUpdatedAtFromMeta();

  return {
    enabled: true,
    workspaceDir: resolveWorkspaceDir(),
    provider: memoryConfig.embedProvider,
    model: memoryConfig.embedModel,
    toolMode: memoryConfig.toolMode,
    writePolicy: memoryConfig.writePolicy,
    minConfidence: memoryConfig.minConfidence,
    files: files.count,
    chunks: chunks.count,
    records: records.count,
    cacheEntries: cache.count,
    indexedAt: indexedAt ? new Date(indexedAt).toISOString() : null,
  };
}

export async function initializeMemory() {
  if (!currentMemoryConfig().enabled) {
    return;
  }
  await ensureWorkspaceScaffold();
  await ensureSchema();
}
