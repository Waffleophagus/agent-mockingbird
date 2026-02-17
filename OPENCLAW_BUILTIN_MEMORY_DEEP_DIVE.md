# OpenClaw Builtin Memory Deep Dive (Non-QMD)

Date: `2026-02-17`
Scope: OpenClaw `memory.backend = "builtin"` (Markdown + SQLite/FTS/sqlite-vec), not QMD sidecar.

## 1) What is canonical vs derived

OpenClaw keeps memory canonical in Markdown files and treats vector/FTS data as rebuildable derived state.

- Canonical files:
  - `workspace/MEMORY.md`
  - `workspace/memory/**/*.md`
- Derived index:
  - SQLite DB with file/chunk/embed metadata, FTS rows, and optional sqlite-vec rows.

References:
- `openclaw/docs/concepts/memory.md:11`
- `openclaw/src/memory/internal.ts:78`
- `openclaw/src/memory/memory-schema.ts:9`

## 2) User-facing memory tools

The builtin memory plugin (`memory-core`) registers two tools:

- `memory_search`: semantic + lexical retrieval over indexed memory.
- `memory_get`: safe file-window reads from memory files.

References:
- `openclaw/extensions/memory-core/index.ts:4`
- `openclaw/src/agents/tools/memory-tool.ts:40`
- `openclaw/src/agents/tools/memory-tool.ts:99`

The system prompt also nudges the model to run memory search/get before answering questions about prior decisions/preferences/todos.

Reference:
- `openclaw/src/agents/system-prompt.ts:41`

## 3) Manager selection and backend routing

All memory tool calls go through a manager factory:

- `getMemorySearchManager(...)` returns:
  - QMD manager (if configured and available), or
  - builtin `MemoryIndexManager` fallback.

For this document, we care about `MemoryIndexManager`.

Reference:
- `openclaw/src/memory/search-manager.ts:19`

## 4) Builtin index schema (SQLite)

Builtin schema is created in `ensureMemoryIndexSchema`:

- `meta`: index metadata (provider/model/chunk config/version-like info).
- `files`: tracked source files (`path`, `source`, `hash`, `mtime`, `size`).
- `chunks`: chunk text + embeddings + line ranges.
- `embedding_cache`: reuse embeddings by `(provider, model, provider_key, hash)`.
- `chunks_fts`: FTS5 virtual table (when available/enabled).

Optional:
- `chunks_vec` sqlite-vec virtual table loaded at runtime when extension is available.

References:
- `openclaw/src/memory/memory-schema.ts:3`
- `openclaw/src/memory/sqlite-vec.ts:3`
- `openclaw/src/memory/manager-sync-ops.ts:134`

## 5) Source discovery and chunking

Source discovery:

- Includes:
  - `MEMORY.md`
  - `memory.md` (alt file)
  - `memory/**/*.md`
  - optional `extraPaths` (dirs/files), markdown-only.
- Skips symlinks.
- Dedupes via realpath.

Chunking:

- Splits markdown text into chunks using a char approximation:
  - `maxChars ~= tokens * 4`
  - overlap `~= overlapTokens * 4`
- Stores `startLine` and `endLine` for citations/snippet reads.

References:
- `openclaw/src/memory/internal.ts:78`
- `openclaw/src/memory/internal.ts:166`

## 6) Embedding pipeline and cache behavior

Provider resolution:

- Supports `openai`, `gemini`, `voyage`, `local` (node-llama-cpp), plus `auto`.
- `auto` selection order:
  1. local (only when configured model path exists),
  2. openai,
  3. gemini,
  4. voyage.
- Falls back on configured provider fallback when primary fails.

Embedding behavior:

- Batch embedding with retries + timeout handling.
- Optional provider batch APIs for OpenAI/Gemini/Voyage.
- Cache lookup by chunk hash and provider key; cache prune by max entries.

References:
- `openclaw/src/memory/embeddings.ts:137`
- `openclaw/src/memory/embeddings.ts:163`
- `openclaw/src/memory/manager-embedding-ops.ts:74`
- `openclaw/src/memory/manager-embedding-ops.ts:488`
- `openclaw/src/memory/manager-embedding-ops.ts:680`

## 7) Vector + lexical retrieval

Query flow in builtin manager:

1. Optional lazy sync if dirty.
2. Embed query.
3. Run vector search:
   - sqlite-vec cosine distance when available, else in-memory cosine over stored JSON embeddings.
4. Run FTS BM25 keyword search when enabled.
5. Merge hybrid results with configured weights.
6. Apply score threshold and result limit.

References:
- `openclaw/src/memory/manager.ts:202`
- `openclaw/src/memory/manager-search.ts:20`
- `openclaw/src/memory/manager-search.ts:136`
- `openclaw/src/memory/hybrid.ts`

## 8) Sync and reindex lifecycle

Dirty-state triggers:

- File watcher (`chokidar`) on memory markdown paths.
- Optional session transcript delta tracking (when session source enabled).
- Optional interval sync.

Reindex behavior:

- Full reindex on provider/model/chunking/meta mismatch.
- Safe atomic reindex uses temp DB + swap.
- Stale files/chunks are removed from files/chunks/fts/vec.

References:
- `openclaw/src/memory/manager-sync-ops.ts:277`
- `openclaw/src/memory/manager-sync-ops.ts:744`
- `openclaw/src/memory/manager-sync-ops.ts:891`

## 9) Read safety boundaries (`memory_get`)

`memory_get` can only read:

- memory files under workspace (`MEMORY.md`, `memory.md`, `memory/**`), or
- explicitly configured extra markdown paths.

It rejects out-of-scope paths and non-markdown files.

Reference:
- `openclaw/src/memory/manager.ts:341`

## 10) How memory gets written in practice

OpenClaw builtin memory retrieval is separate from write policy. Writes happen mainly through:

1. Normal agent file edits (writing markdown memory files).
2. Pre-compaction silent memory flush turn that reminds agent to persist durable notes.
3. Optional bundled `session-memory` hook on `/new` that writes a dated session memory file.

References:
- `openclaw/src/auto-reply/reply/memory-flush.ts:11`
- `openclaw/src/auto-reply/reply/agent-runner-memory.ts:28`
- `openclaw/src/hooks/bundled/session-memory/handler.ts:73`

## 11) Important knobs for a clone

Key config surfaces to mirror:

- `agents.defaults.memorySearch.*`:
  - provider/model/fallback
  - chunking
  - sync (watch, onSearch, interval)
  - query (maxResults, minScore, hybrid weights)
  - store path + vector extension toggle
- `memory.backend` (`builtin` vs `qmd`) and citations mode.
- plugin slot `plugins.slots.memory` (tool availability switch).

References:
- `openclaw/src/config/types.tools.ts:246`
- `openclaw/src/config/types.memory.ts:3`

## 12) What to copy into Wafflebot (minimal)

If we want the same architecture without bloat:

1. Keep Markdown canonical (`MEMORY.md` + `memory/*.md`).
2. Keep derived SQLite schema (`files`, `chunks`, `meta`, `embedding_cache`, FTS).
3. Keep optional sqlite-vec acceleration with pure-SQLite fallback.
4. Keep safe `memory_search` + `memory_get` style API boundaries.
5. Start without session transcript indexing, provider batch APIs, and QMD.

This gives OpenClaw-like memory behavior with a smaller operational footprint.
