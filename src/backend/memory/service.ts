import crypto from "node:crypto";
import { lstat, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createMemoryRecord,
  extractRecordIdFromChunk,
  formatMemoryRecord,
  parseMemoryRecordBlocks,
  parseMemoryRecords,
} from "./records";
import { blendRrfAndRerank, hasStrongBm25Signal, reciprocalRankFusion, type ExpandedQuery } from "./qmdPort";
import { ensureSqliteVecLoaded, getSqliteVecState } from "./sqliteVec";
import type {
  MemoryChunk,
  MemoryLintReport,
  MemoryRecord,
  MemoryRecordInput,
  MemoryRememberInput,
  MemoryRememberResult,
  MemorySearchResult,
  MemoryStatus,
  MemoryWriteEvent,
  MemoryWriteValidation,
} from "./types";
import { getConfigSnapshot } from "../config/service";
import { sqlite } from "../db/client";
import { getBinaryDir } from "../paths";

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
  confidence: number;
  superseded_by: string | null;
}

interface MemoryWriteEventRow {
  id: string;
  status: "accepted" | "rejected";
  reason: string;
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
const MEMORY_VEC_META_KEY = "memory_vec_meta_v1";
const SOURCE = "memory";
const SNIPPET_MAX_CHARS = 700;
const DEFAULT_CANDIDATE_LIMIT = 48;
const MMR_LAMBDA = 0.75;
const VECTOR_PREFILTER_MIN = 200;
const VECTOR_PREFILTER_MAX = 800;
const SQLITE_IN_BIND_LIMIT = 900;
const MEMORY_VEC_TABLE = "memory_chunks_vec";
const SEARCH_TOKEN_RE = /[a-z0-9]{3,}/g;
const RECALL_INTENT_RE = /\b(?:what\s+do\s+you\s+remember|remind\s+me|recall|from\s+memory|what\s+do\s+you\s+know\s+about\s+me)\b/i;
const MEMORY_MANAGEMENT_RE = /\b(?:memory|remember|recall|note|save)\b/i;
const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "also",
  "and",
  "any",
  "are",
  "because",
  "been",
  "being",
  "between",
  "both",
  "but",
  "can",
  "could",
  "did",
  "does",
  "doing",
  "dont",
  "each",
  "few",
  "for",
  "from",
  "had",
  "has",
  "have",
  "here",
  "how",
  "into",
  "its",
  "just",
  "more",
  "most",
  "not",
  "now",
  "off",
  "our",
  "out",
  "over",
  "same",
  "should",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "until",
  "very",
  "want",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "your",
]);

let schemaReady = false;
let lastSyncMs = 0;
let syncPromise: Promise<void> | null = null;

const nowMs = () => Date.now();
const hashText = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

function currentMemoryConfig() {
  return getConfigSnapshot().config.runtime.memory;
}

function resolveWorkspaceDir() {
  const workspaceDir = currentMemoryConfig().workspaceDir;
  if (path.isAbsolute(workspaceDir)) {
    return workspaceDir;
  }
  return path.resolve(getBinaryDir(), workspaceDir);
}

function normalizeRelPath(absPath: string) {
  return path.relative(resolveWorkspaceDir(), absPath).replaceAll(path.sep, "/");
}

function sqliteTableExists(name: string) {
  const row = sqlite
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1")
    .get(name) as { name: string } | null;
  return Boolean(row?.name);
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

function collectQueryTokens(text: string) {
  const matched = text.toLowerCase().match(SEARCH_TOKEN_RE) ?? [];
  return new Set(matched.filter(token => !STOPWORDS.has(token)));
}

function normalizeSnippetFromChunk(text: string) {
  const structured = text.match(/^(###\s+\[memory:[^\n]+\])\n(?:meta:[^\n]*\n)?\n?([\s\S]*)$/i);
  if (!structured) {
    return clipSnippet(text);
  }
  const heading = structured[1]?.trim();
  const body = structured[2]?.trim();
  if (!heading || !body) {
    return clipSnippet(text);
  }
  return clipSnippet(`${heading}\n${body}`);
}

function isMemoryRecallIntentQuery(query: string) {
  return RECALL_INTENT_RE.test(query);
}

function isMemoryManagementQuery(query: string) {
  return MEMORY_MANAGEMENT_RE.test(query);
}

function hasLexicalSignal(candidate: SearchCandidate, queryTokens: Set<string>) {
  if (!queryTokens.size) return true;
  const candidateTokens = collectQueryTokens(`${candidate.path}\n${candidate.text}`);
  let overlap = 0;
  for (const token of queryTokens) {
    if (!candidateTokens.has(token)) continue;
    overlap += 1;
    if (overlap >= 2) return true;
  }
  return overlap >= 1 && candidate.score >= 0.55;
}

function isLikelyBoilerplateIndexCandidate(candidate: SearchCandidate) {
  if (candidate.path.toLowerCase() !== "memory.md") return false;
  const text = candidate.text.toLowerCase();
  return (
    text.includes("memory index") ||
    text.includes("store durable notes") ||
    text.includes("memory/*.md")
  );
}

function normalizeRecordInput(input: MemoryRecordInput): MemoryRecordInput {
  return {
    source: input.source,
    content: input.content.trim(),
    entities: [...new Set((input.entities ?? []).map(value => value.trim()).filter(Boolean))],
    confidence:
      typeof input.confidence === "number" ? Math.max(0, Math.min(1, input.confidence)) : undefined,
    supersedes: [...new Set((input.supersedes ?? []).map(value => value.trim()).filter(Boolean))],
  };
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
    await writeFile(memoryFile, "# Memory\n\n", "utf8");
  }
}

function memoryIndexMeta() {
  if (!sqliteTableExists("memory_meta")) return null;
  const row = sqlite
    .query("SELECT value_json FROM memory_meta WHERE key = ?1")
    .get(MEMORY_META_KEY) as { value_json: string } | null;
  if (!row?.value_json) return null;
  try {
    return JSON.parse(row.value_json) as {
      provider?: string;
      model?: string;
      chunkTokens?: number;
      chunkOverlap?: number;
      indexedAt?: number;
    };
  } catch {
    return null;
  }
}

function memoryVecMeta() {
  if (!sqliteTableExists("memory_meta")) return null;
  const row = sqlite
    .query("SELECT value_json FROM memory_meta WHERE key = ?1")
    .get(MEMORY_VEC_META_KEY) as { value_json: string } | null;
  if (!row?.value_json) return null;
  try {
    return JSON.parse(row.value_json) as {
      enabled?: boolean;
      dims?: number;
      model?: string;
      provider?: string;
      updatedAt?: number;
      error?: string | null;
    };
  } catch {
    return null;
  }
}

function vecTableInfo() {
  return sqlite
    .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1")
    .get(MEMORY_VEC_TABLE) as { sql: string } | null;
}

function vecTableExists() {
  return Boolean(vecTableInfo());
}

function vecTableDimensions() {
  const info = vecTableInfo();
  if (!info?.sql) return null;
  const match = info.sql.match(/float\[(\d+)\]/);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function recreateVecTableForDimensions(dims: number) {
  sqlite.exec(`DROP TABLE IF EXISTS ${MEMORY_VEC_TABLE}`);
  sqlite.exec(
    `CREATE VIRTUAL TABLE ${MEMORY_VEC_TABLE} USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[${dims}] distance_metric=cosine)`,
  );
}

function ensureVecTableForDimensions(dims: number) {
  if (!Number.isFinite(dims) || dims <= 0) return false;
  const existingDims = vecTableDimensions();
  if (existingDims === dims && vecTableExists()) {
    return false;
  }
  recreateVecTableForDimensions(dims);
  return true;
}

function deleteVecRowsByChunkIds(chunkIds: string[]) {
  if (!chunkIds.length || !vecTableExists()) return;
  const batches: string[][] = [];
  for (let index = 0; index < chunkIds.length; index += SQLITE_IN_BIND_LIMIT) {
    batches.push(chunkIds.slice(index, index + SQLITE_IN_BIND_LIMIT));
  }
  for (const batch of batches) {
    if (!batch.length) continue;
    sqlite
      .query(`DELETE FROM ${MEMORY_VEC_TABLE} WHERE chunk_id IN (${batch.map(() => "?").join(", ")})`)
      .run(...batch);
  }
}

function upsertVecRows(rows: Array<{ chunkId: string; embedding: number[] }>) {
  if (!rows.length || !vecTableExists()) return;
  const insert = sqlite.query(`INSERT OR REPLACE INTO ${MEMORY_VEC_TABLE} (chunk_id, embedding) VALUES (?1, ?2)`);
  for (const row of rows) {
    if (!row.embedding.length) continue;
    insert.run(row.chunkId, new Float32Array(row.embedding));
  }
}

async function ensureSchema() {
  if (schemaReady) return;
  await ensureSqliteVecLoaded(sqlite);
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
  const recordBlocks = parseMemoryRecordBlocks(content);
  const chunks =
    recordBlocks.length > 0
      ? recordBlocks.map(block => {
          const text = block.text;
          const hash = hashText(text);
          const chunk: MemoryChunk = {
            id: "",
            path: relPath,
            startLine: block.startLine,
            endLine: block.endLine,
            text,
            hash,
          };
          return {
            ...chunk,
            id: buildChunkId(relPath, chunk),
          };
        })
      : chunkMarkdown(content, memoryConfig.chunkTokens, memoryConfig.chunkOverlap).map(
          chunk => ({
            ...chunk,
            id: buildChunkId(relPath, chunk),
            path: relPath,
          }),
        );
  const embeddings = await embedChunks(chunks);
  const vecState = getSqliteVecState();
  const retrievalConfig = memoryConfig.retrieval;
  const sqliteVecWriteEnabled = retrievalConfig.vectorBackend === "sqlite_vec" && vecState.available;
  const vecRows = chunks
    .map((chunk, index) => ({ chunkId: chunk.id, embedding: embeddings[index] ?? [] }))
    .filter(row => row.embedding.length > 0);
  const vecDims = vecRows[0]?.embedding.length ?? 0;
  if (sqliteVecWriteEnabled && vecDims > 0) {
    ensureVecTableForDimensions(vecDims);
  }
  const updatedAt = nowMs();

  const tx = sqlite.transaction(() => {
    const existingChunkRows = sqlite
      .query(
        `
        SELECT id
        FROM memory_chunks
        WHERE path = ?1
      `,
      )
      .all(relPath) as Array<{ id: string }>;
    if (sqliteVecWriteEnabled && existingChunkRows.length) {
      deleteVecRowsByChunkIds(existingChunkRows.map(row => row.id));
    }

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
    if (sqliteVecWriteEnabled) {
      upsertVecRows(vecRows);
    }

    const records = parseMemoryRecords(content);
    const insertRecord = sqlite.query(`
      INSERT INTO memory_records (
        id, path, source, content, entities_json, confidence, supersedes_json, superseded_by, recorded_at, updated_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9)
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
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
      const chunkRows = sqlite
        .query(
          `
          SELECT id
          FROM memory_chunks
          WHERE path = ?1
        `,
        )
        .all(stale.path) as Array<{ id: string }>;
      deleteVecRowsByChunkIds(chunkRows.map(row => row.id));
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
  const priorMeta = memoryIndexMeta();
  const embeddingModelChanged =
    priorMeta?.provider !== memoryConfig.embedProvider || priorMeta?.model !== memoryConfig.embedModel;
  const effectiveForce = force || embeddingModelChanged;

  if (effectiveForce && vecTableExists()) {
    sqlite.exec(`DELETE FROM ${MEMORY_VEC_TABLE}`);
  }

  const files = await listMemoryFiles();
  const activePaths = new Set<string>();
  for (const filePath of files) {
    const relPath = normalizeRelPath(filePath);
    if (!isMemoryPath(relPath)) continue;
    activePaths.add(relPath);
    await indexMemoryFile(filePath, { force: effectiveForce });
  }
  await pruneStaleFiles(activePaths);
  const indexedAt = nowMs();
  const vecState = getSqliteVecState();
  const vecDims = vecTableDimensions();
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
  const vecRowCount = vecTableExists()
    ? ((sqlite.query(`SELECT COUNT(*) as count FROM ${MEMORY_VEC_TABLE}`).get() as { count: number }).count ?? 0)
    : 0;
  sqlite
    .query(
      `
      INSERT INTO memory_meta (key, value_json)
      VALUES (?1, ?2)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `,
    )
    .run(
      MEMORY_VEC_META_KEY,
      JSON.stringify({
        enabled: memoryConfig.retrieval.vectorBackend === "sqlite_vec",
        provider: memoryConfig.embedProvider,
        model: memoryConfig.embedModel,
        dims: vecDims,
        count: vecRowCount,
        error: vecState.error,
        updatedAt: indexedAt,
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

async function findDuplicateRecordId(input: MemoryRecordInput) {
  await ensureSchema();
  const row = sqlite
    .query(
      `
      SELECT id
      FROM memory_records
      WHERE content = ?1
        AND superseded_by IS NULL
      ORDER BY recorded_at DESC
      LIMIT 1
    `,
    )
    .get(input.content) as { id: string } | null;
  return row?.id;
}

export async function validateMemoryRememberInput(input: MemoryRememberInput): Promise<MemoryWriteValidation> {
  const normalized = normalizeRecordInput(input);
  const content = normalized.content;
  const confidence = typeof normalized.confidence === "number" ? normalized.confidence : 0.75;

  if (!content) {
    return {
      accepted: false,
      reason: "content is required",
      normalizedContent: content,
      normalizedConfidence: confidence,
    };
  }

  const duplicateRecordId = await findDuplicateRecordId(normalized);
  if (duplicateRecordId) {
    return {
      accepted: false,
      reason: "duplicate memory already exists",
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
        id, status, reason, source, content, confidence, session_id, topic, record_id, path, created_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    `,
    )
    .run(
      crypto.randomUUID(),
      input.status,
      input.reason,
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
      SELECT id, status, reason, source, content, confidence, session_id, topic, record_id, path, created_at
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
      SELECT id, content, supersedes_json, superseded_by
      FROM memory_records
    `,
    )
  .all() as Array<{
    id: string;
    content: string;
    supersedes_json: string;
    superseded_by: string | null;
  }>;
  const idSet = new Set(allRows.map(row => row.id));

  const activeRows = allRows.filter(row => !row.superseded_by);
  const duplicateKeyMap = new Map<string, { content: string; ids: string[] }>();
  for (const row of activeRows) {
    const key = row.content;
    const existing = duplicateKeyMap.get(key);
    if (existing) {
      existing.ids.push(row.id);
    } else {
      duplicateKeyMap.set(key, {
        content: row.content,
        ids: [row.id],
      });
    }
  }

  const duplicateActiveRecords = [...duplicateKeyMap.values()]
    .filter(entry => entry.ids.length > 1)
    .map(entry => ({
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

  if (!validation.accepted) {
    await logMemoryWriteEvent({
      status: "rejected",
      reason: validation.reason,
      source: normalized.source,
      content: validation.normalizedContent,
      confidence: validation.normalizedConfidence,
      sessionId: input.sessionId,
      topic: input.topic,
    });
    return {
      accepted: false,
      reason: validation.reason,
      validation,
    };
  }

  if (options?.validateOnly) {
    return {
      accepted: true,
      reason: validation.reason,
      validation,
    };
  }

  const persisted = await appendStructuredMemory({
    source: normalized.source,
    content: validation.normalizedContent,
    entities: normalized.entities,
    confidence: validation.normalizedConfidence,
    supersedes: normalized.supersedes,
  });

  await logMemoryWriteEvent({
    status: "accepted",
    reason: validation.reason,
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
    validation,
    record: persisted.record,
    path: persisted.path,
  };
}

function parseUpdatedAtFromMeta(): number | null {
  if (!sqliteTableExists("memory_meta")) return null;
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

function resolveVectorBackend() {
  const memoryConfig = currentMemoryConfig();
  const configured = memoryConfig.retrieval.vectorBackend;
  const fallback = memoryConfig.retrieval.vectorUnavailableFallback;
  const vecState = getSqliteVecState();
  if (configured === "disabled") {
    return {
      configured,
      active: "disabled" as const,
      available: false,
      error: null as string | null,
    };
  }
  if (configured === "legacy_json") {
    return {
      configured,
      active: "legacy_json" as const,
      available: true,
      error: null as string | null,
    };
  }
  if (vecState.available) {
    return {
      configured,
      active: "sqlite_vec" as const,
      available: true,
      error: null as string | null,
    };
  }
  if (fallback === "legacy_json") {
    return {
      configured,
      active: "legacy_json" as const,
      available: false,
      error: vecState.error,
    };
  }
  return {
    configured,
    active: "disabled" as const,
    available: false,
    error: vecState.error,
  };
}

function searchVectorCandidates(
  queryVector: number[],
  candidateLimit: number,
  seedChunkIds: string[] = [],
  options?: { exhaustive?: boolean },
) {
  if (!queryVector.length) return new Map<string, number>();
  const backend = resolveVectorBackend();
  const memoryConfig = currentMemoryConfig();
  if (backend.active === "disabled") return new Map<string, number>();
  const hasVecTable = vecTableExists();
  const useLegacyFallback =
    backend.active === "sqlite_vec" && !hasVecTable && memoryConfig.retrieval.vectorUnavailableFallback === "legacy_json";
  if (backend.active === "sqlite_vec" && hasVecTable) {
    const probeLimit = Math.max(1, memoryConfig.retrieval.vectorProbeLimit);
    const configuredK = Math.max(1, memoryConfig.retrieval.vectorK);
    const queryK = Math.max(1, Math.max(candidateLimit, probeLimit, configuredK));
    const rows = sqlite
      .query(
        `
      SELECT chunk_id, distance
      FROM ${MEMORY_VEC_TABLE}
      WHERE embedding MATCH ?1
        AND k = ?2
    `,
      )
      .all(new Float32Array(queryVector), queryK) as Array<{ chunk_id: string; distance: number }>;
    if (!rows.length) return new Map<string, number>();
    const scored = rows
      .map(row => ({
        id: row.chunk_id,
        score: Math.max(0, 1 / (1 + Math.max(0, Number(row.distance ?? 0)))),
      }))
      .filter(row => Number.isFinite(row.score) && row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, candidateLimit);
    return new Map(scored.map(row => [row.id, row.score]));
  }
  if (backend.active === "sqlite_vec" && !useLegacyFallback) {
    return new Map<string, number>();
  }

  const exhaustive = options?.exhaustive === true;
  const prefilterLimit = Math.max(VECTOR_PREFILTER_MIN, Math.min(VECTOR_PREFILTER_MAX, candidateLimit * 12));
  const prefilterIds = exhaustive
    ? []
    : [...new Set([...seedChunkIds, ...selectRecentChunkIds(prefilterLimit)])].slice(0, SQLITE_IN_BIND_LIMIT);

  const rows = exhaustive
    ? (sqlite
        .query(
          `
      SELECT id, embedding_json
      FROM memory_chunks
      WHERE embedding_json IS NOT NULL
    `,
        )
        .all() as Array<{ id: string; embedding_json: string }>)
    : prefilterIds.length
      ? (sqlite
          .query(
            `
      SELECT id, embedding_json
      FROM memory_chunks
      WHERE embedding_json IS NOT NULL
        AND id IN (${prefilterIds.map(() => "?").join(", ")})
    `,
          )
          .all(...prefilterIds) as Array<{ id: string; embedding_json: string }>)
      : [];
  if (!rows.length) return new Map<string, number>();

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

function toRankedResults(scores: Map<string, number>, limit: number) {
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function buildFamilyExpansion(query: string): string[] {
  const normalized = query.toLowerCase();
  const terms = new Set<string>();
  if (normalized.includes("family") || normalized.includes("relative")) {
    terms.add("spouse wife husband partner");
    terms.add("daughter son child children");
    terms.add("parent parents mother father");
    terms.add("siblings sister brother");
  }
  if (normalized.includes("daughter") || normalized.includes("child")) {
    terms.add("daughter child children");
  }
  if (normalized.includes("wife") || normalized.includes("spouse") || normalized.includes("partner")) {
    terms.add("wife spouse partner husband");
  }
  return [...terms];
}

function expandMemoryQuery(query: string): ExpandedQuery[] {
  const expanded: ExpandedQuery[] = [];
  const seen = new Set<string>([query.trim().toLowerCase()]);
  const familyVariants = buildFamilyExpansion(query);
  for (const variant of familyVariants) {
    const key = variant.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    expanded.push({ type: "lex", text: variant });
    expanded.push({ type: "vec", text: `${query} ${variant}`.trim() });
  }
  const hyde = `Information about ${query}`.trim();
  const hydeKey = hyde.toLowerCase();
  if (!seen.has(hydeKey)) {
    expanded.push({ type: "hyde", text: hyde });
  }
  return expanded;
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

function applyRecordStateAdjustments(candidates: SearchCandidate[]) {
  const recordIds = [...new Set(candidates.map(candidate => candidate.recordId).filter((id): id is string => Boolean(id)))];
  if (!recordIds.length) return;
  const placeholders = recordIds.map(() => "?").join(", ");
  const rows = sqlite
    .query(
      `
      SELECT id, confidence, superseded_by
      FROM memory_records
      WHERE id IN (${placeholders})
    `,
    )
    .all(...recordIds) as MemoryRecordRow[];
  const rowById = new Map(rows.map(row => [row.id, row]));
  for (const candidate of candidates) {
    if (!candidate.recordId) continue;
    const row = rowById.get(candidate.recordId);
    if (!row) continue;
    const confidence = Math.max(0, Math.min(1, Number.isFinite(row.confidence) ? row.confidence : 0.75));
    candidate.score *= 0.85 + 0.3 * confidence;
    if (row.superseded_by) {
      candidate.score = Math.max(0, candidate.score - 0.25);
    }
  }
}

function applyRecencyBoost(candidates: SearchCandidate[]) {
  const current = nowMs();
  for (const candidate of candidates) {
    const ageDays = Math.max(0, (current - candidate.updatedAt) / (24 * 60 * 60 * 1000));
    const recency = 1 / (1 + ageDays / 14);
    candidate.score += recency * 0.08;
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

function mapCandidatesToResults(candidates: SearchCandidate[]): MemorySearchResult[] {
  return candidates.map(candidate => ({
    id: candidate.id,
    path: candidate.path,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    source: "memory",
    score: Number(candidate.score.toFixed(4)),
    snippet: normalizeSnippetFromChunk(candidate.text),
    citation: `${candidate.path}#L${candidate.startLine}`,
  }));
}

export interface MemorySearchDebug {
  engine: "legacy" | "qmd_hybrid";
  strongSignalSkippedExpansion: boolean;
  expansionQueries: Array<{ type: string; text: string }>;
  rankedLists: Array<{ name: string; count: number }>;
}

function applyFinalFiltering(
  candidates: SearchCandidate[],
  normalizedQuery: string,
  minScore: number,
  maxResults: number,
) {
  const queryTokens = collectQueryTokens(normalizedQuery);
  const recallIntent = isMemoryRecallIntentQuery(normalizedQuery);
  const memoryManagementQuery = isMemoryManagementQuery(normalizedQuery);

  const filtered = candidates
    .filter(candidate => {
      if (!recallIntent && !memoryManagementQuery && isLikelyBoilerplateIndexCandidate(candidate)) {
        return false;
      }
      if (recallIntent) return true;
      return hasLexicalSignal(candidate, queryTokens);
    })
    .filter(candidate => candidate.score >= minScore);

  return mmrRerank(filtered, maxResults);
}

function loadSearchCandidates(
  candidateIds: string[],
  textScores: Map<string, number>,
  vectorScores: Map<string, number>,
  baseScoreById?: Map<string, number>,
) {
  if (!candidateIds.length) return [] as SearchCandidate[];
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

  return chunkRows.map(row => {
    const vectorScore = vectorScores.get(row.id) ?? 0;
    const textScore = textScores.get(row.id) ?? 0;
    const fallbackHybrid = 0.72 * vectorScore + 0.28 * textScore;
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
      score: baseScoreById?.get(row.id) ?? fallbackHybrid,
      updatedAt: row.updated_at,
      recordId: extractRecordIdFromChunk(row.text),
    };
  });
}

function runLegacySearch(
  normalizedQuery: string,
  maxResults: number,
  minScore: number,
): Promise<{ results: MemorySearchResult[]; debug: MemorySearchDebug }> {
  const candidateLimit = Math.max(maxResults * 6, DEFAULT_CANDIDATE_LIMIT);
  return (async () => {
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
    const candidates = loadSearchCandidates(candidateIds, textScores, vectorScores);
    applyRecencyBoost(candidates);
    applyRecordStateAdjustments(candidates);
    const filtered = applyFinalFiltering(candidates, normalizedQuery, minScore, maxResults);
    return {
      results: mapCandidatesToResults(filtered),
      debug: {
        engine: "legacy",
        strongSignalSkippedExpansion: false,
        expansionQueries: [] as Array<{ type: string; text: string }>,
        rankedLists: [] as Array<{ name: string; count: number }>,
      },
    };
  })();
}

function rerankScoreFromOverlap(candidate: SearchCandidate, queryTokens: Set<string>) {
  if (!queryTokens.size) return candidate.score;
  const candidateTokens = collectQueryTokens(candidate.text);
  let overlap = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }
  const overlapScore = overlap / Math.max(1, queryTokens.size);
  return Math.max(overlapScore, candidate.textScore, candidate.vectorScore);
}

async function runQmdHybridSearch(
  normalizedQuery: string,
  maxResults: number,
  minScore: number,
): Promise<{ results: MemorySearchResult[]; debug: MemorySearchDebug }> {
  const memoryConfig = currentMemoryConfig();
  const retrieval = memoryConfig.retrieval;
  const candidateLimit = Math.max(maxResults * 6, retrieval.candidateLimit);

  const initialFtsScores = searchTextCandidates(normalizedQuery, 20);
  const initialFts = toRankedResults(initialFtsScores, 20);
  const hasStrongSignal = hasStrongBm25Signal(initialFts, {
    minScore: retrieval.strongSignalMinScore,
    minGap: retrieval.strongSignalMinGap,
  });

  const expandedQueries = hasStrongSignal || !retrieval.expansionEnabled ? [] : expandMemoryQuery(normalizedQuery);
  const rankedLists: Array<{ name: string; list: Array<{ id: string; score: number }> }> = [];
  const textScoreById = new Map(initialFtsScores);
  const vectorScoreById = new Map<string, number>();

  if (initialFts.length) {
    rankedLists.push({ name: "fts:original", list: initialFts });
  }

  const vectorQueries = [{ type: "vec", text: normalizedQuery }, ...expandedQueries.filter(q => q.type !== "lex")];
  const vectorTexts = vectorQueries.map(entry => entry.text);
  let queryVectors: number[][] = [];
  try {
    queryVectors = vectorTexts.length ? await embedTexts(vectorTexts) : [];
  } catch {
    queryVectors = [];
  }

  const exhaustiveVector = initialFts.length === 0;
  for (let index = 0; index < vectorQueries.length; index += 1) {
    const queryEntry = vectorQueries[index];
    const vector = queryVectors[index] ?? [];
    const scores = searchVectorCandidates(vector, 20, [...initialFtsScores.keys()], { exhaustive: exhaustiveVector });
    if (!scores.size) continue;
    for (const [id, score] of scores.entries()) {
      const existing = vectorScoreById.get(id) ?? 0;
      if (score > existing) vectorScoreById.set(id, score);
    }
    rankedLists.push({
      name: `${queryEntry?.type ?? "vec"}:${index === 0 ? "original" : "expanded"}`,
      list: toRankedResults(scores, 20),
    });
  }

  for (const expansion of expandedQueries) {
    if (expansion.type !== "lex") continue;
    const lexScores = searchTextCandidates(expansion.text, 20);
    if (!lexScores.size) continue;
    for (const [id, score] of lexScores.entries()) {
      const existing = textScoreById.get(id) ?? 0;
      if (score > existing) textScoreById.set(id, score);
    }
    rankedLists.push({
      name: "fts:lex-expanded",
      list: toRankedResults(lexScores, 20),
    });
  }

  const fused = reciprocalRankFusion(
    rankedLists.map(item => item.list),
    rankedLists.map((_, index) => (index < 2 ? 2 : 1)),
    retrieval.rrfK,
  );

  const candidateIds = fused.slice(0, candidateLimit).map(entry => entry.id);
  const baseScoreById = new Map(fused.map(entry => [entry.id, entry.score]));
  const candidates = loadSearchCandidates(candidateIds, textScoreById, vectorScoreById, baseScoreById);
  applyRecencyBoost(candidates);
  applyRecordStateAdjustments(candidates);

  if (retrieval.rerankEnabled && candidates.length) {
    const queryTokens = collectQueryTokens(normalizedQuery);
    const rankById = new Map(candidateIds.map((id, index) => [id, index + 1]));
    const rerankLimit = Math.max(1, Math.min(candidates.length, retrieval.rerankTopN));
    const sorted = [...candidates].sort((a, b) => b.score - a.score);
    for (let index = 0; index < rerankLimit; index += 1) {
      const candidate = sorted[index];
      if (!candidate) continue;
      const rerankScore = rerankScoreFromOverlap(candidate, queryTokens);
      const rank = rankById.get(candidate.id) ?? index + 1;
      candidate.score = blendRrfAndRerank(rank, rerankScore);
    }
  }

  const filtered = applyFinalFiltering(candidates, normalizedQuery, minScore, maxResults);
  return {
    results: mapCandidatesToResults(filtered),
    debug: {
      engine: "qmd_hybrid",
      strongSignalSkippedExpansion: hasStrongSignal,
      expansionQueries: expandedQueries,
      rankedLists: rankedLists.map(item => ({ name: item.name, count: item.list.length })),
    },
  };
}

export async function searchMemoryDetailed(
  query: string,
  options?: { maxResults?: number; minScore?: number },
): Promise<{ results: MemorySearchResult[]; debug: MemorySearchDebug }> {
  const memoryConfig = currentMemoryConfig();
  if (!memoryConfig.enabled) {
    return {
      results: [] as MemorySearchResult[],
      debug: {
        engine: memoryConfig.retrieval.engine,
        strongSignalSkippedExpansion: false,
        expansionQueries: [],
        rankedLists: [],
      },
    };
  }
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return {
      results: [] as MemorySearchResult[],
      debug: {
        engine: memoryConfig.retrieval.engine,
        strongSignalSkippedExpansion: false,
        expansionQueries: [],
        rankedLists: [],
      },
    };
  }

  await ensureFreshIndex();

  const maxResults = Math.max(1, options?.maxResults ?? memoryConfig.maxResults);
  const minScore = Math.max(0, Math.min(1, options?.minScore ?? memoryConfig.minScore));
  if (memoryConfig.retrieval.engine === "legacy") {
    return runLegacySearch(normalizedQuery, maxResults, minScore);
  }
  return runQmdHybridSearch(normalizedQuery, maxResults, minScore);
}

export async function searchMemory(query: string, options?: { maxResults?: number; minScore?: number }) {
  const detailed = await searchMemoryDetailed(query, options);
  return detailed.results;
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
    const vectorBackend = resolveVectorBackend();
    return {
      enabled: false,
      workspaceDir: resolveWorkspaceDir(),
      provider: memoryConfig.embedProvider,
      model: memoryConfig.embedModel,
      toolMode: memoryConfig.toolMode,
      vectorBackendConfigured: memoryConfig.retrieval.vectorBackend,
      vectorBackendActive: vectorBackend.active,
      vectorAvailable: vectorBackend.available,
      vectorDims: null,
      vectorIndexedChunks: 0,
      vectorLastError: vectorBackend.error,
      files: 0,
      chunks: 0,
      records: 0,
      cacheEntries: 0,
      indexedAt: null,
    };
  }

  await ensureSchema();
  const vectorBackend = resolveVectorBackend();
  const vecMeta = memoryVecMeta();
  const vecDims = vecTableDimensions();
  const vecCount = vecTableExists()
    ? ((sqlite.query(`SELECT COUNT(*) as count FROM ${MEMORY_VEC_TABLE}`).get() as { count: number }).count ?? 0)
    : 0;
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
    vectorBackendConfigured: memoryConfig.retrieval.vectorBackend,
    vectorBackendActive: vectorBackend.active,
    vectorAvailable: vectorBackend.available,
    vectorDims: vecDims ?? vecMeta?.dims ?? null,
    vectorIndexedChunks: vecCount,
    vectorLastError: vectorBackend.error ?? vecMeta?.error ?? null,
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
