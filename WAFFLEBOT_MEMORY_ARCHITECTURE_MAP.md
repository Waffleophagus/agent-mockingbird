# Wafflebot Memory Architecture Map (OpenClaw-Inspired, Markdown-First)

Plan date: `2026-02-17`

OpenClaw builtin deep dive: `OPENCLAW_BUILTIN_MEMORY_DEEP_DIVE.md`

## Goal

Adopt OpenClaw's strongest memory idea for Wafflebot:

1. Markdown files are canonical memory.
2. Vector/FTS index is derived and rebuildable.
3. Agent queries memory through tools/APIs, not by stuffing everything into prompt context.

This keeps memory human-auditable while still enabling semantic retrieval.

## Why this direction

Pure vector-only memory is hard to inspect and hard to fix by hand.  
A markdown-first model lets you:

1. inspect and edit memory directly,
2. version it if desired,
3. rebuild index artifacts when models/providers change.

## OpenClaw -> Wafflebot mapping

| OpenClaw built-in component | Wafflebot equivalent | Notes |
| --- | --- | --- |
| `MEMORY.md` + `memory/*.md` canonical files | `workspace/MEMORY.md` + `workspace/memory/*.md` | Source of truth remains files |
| SQLite derived index (`files`, `chunks`, `embedding_cache`, `meta`) | SQLite memory index tables in app DB | Rebuildable, not canonical |
| Optional `sqlite-vec` + FTS5 hybrid | Same: `sqlite-vec` when available, FTS5 fallback always | No hard dependency on vector extension |
| `memory_search` tool | `/api/memory/retrieve` + runtime hook | UI and runtime consume same retrieval layer |
| `memory_get` tool | `/api/memory/read` | Safe file-window reads for explainability |
| file watch + lazy sync + interval sync | start with manual/explicit sync, then add watch/interval | Ship minimal first |
| reindex on model/provider drift | `bun memory:reindex` | Required operational safety |

## Target Wafflebot architecture

## 1) Canonical store (files)

- `workspace/MEMORY.md` for curated durable memory.
- `workspace/memory/YYYY-MM-DD.md` for daily/log-style memory.
- Optional later: `workspace/memory/entities/*.md` for entity summaries.

Rules:

1. These files are the canonical long-term memory.
2. Agent can read/write them via controlled memory/file flows.
3. Index DB is disposable and can always be rebuilt from these files.

## 2) Derived index (SQLite)

Keep this inside app SQLite (or dedicated memory SQLite if we split later).

Recommended v1 tables:

1. `memory_files`
- `path` (pk)
- `source` (`memory`)
- `hash`
- `mtime`
- `size`

2. `memory_chunks`
- `id` (pk, deterministic hash)
- `path`
- `source`
- `start_line`
- `end_line`
- `hash`
- `model`
- `text`
- `embedding_json`
- `updated_at`

3. `memory_embedding_cache`
- `provider`
- `model`
- `provider_key`
- `hash`
- `embedding_json`
- `dims`
- `updated_at`
- composite PK `(provider, model, provider_key, hash)`

4. `memory_meta`
- `key` (pk)
- `value_json`

5. `memory_chunks_fts` (FTS5 virtual table)
- text/snippet lookup for lexical fallback and hybrid ranking.

6. `memory_chunks_vec` (`sqlite-vec` virtual table, optional)
- vector acceleration when extension is available.

## 3) Indexing pipeline

1. Enumerate markdown files from canonical memory paths.
2. Hash each file and skip unchanged files.
3. Chunk by target size + overlap, preserving line ranges.
4. Embed chunk text via Ollama embedding model.
5. Upsert chunks + FTS rows + vec rows (if enabled).
6. Delete stale paths/chunks no longer present in canonical files.
7. Persist meta with provider/model/chunking config.

## 4) Retrieval pipeline

1. Embed query with the same embedding model.
2. Run vector search (vec table) when available.
3. Run FTS5 search for lexical relevance.
4. Merge by weighted score (hybrid).
5. Return bounded snippets with citations (`path#line`).

Fallback behavior:

1. If vec extension unavailable, run FTS-only.
2. If embeddings fail, return safe disabled/error response without breaking chat flow.

## 5) Runtime integration

In `OpencodeRuntime.sendUserMessage`:

1. before prompt send: retrieve top memory snippets,
2. inject small memory context block with citations,
3. after response: queue ingest/sync.

Guardrails:

1. feature flag: `WAFFLEBOT_MEMORY_ENABLED`,
2. strict max injected chars/tokens,
3. fail-open behavior if retrieval/indexing fails.

## Minimal subset (ship first)

This is the recommended first implementation slice.

1. Canonical markdown files only:
- `MEMORY.md`
- `memory/*.md`
- no session transcript indexing yet

2. Indexing:
- manual/explicit sync commands only:
  - `bun memory:sync`
  - `bun memory:reindex`
- no watcher, no interval sync in first cut

3. Retrieval:
- FTS5 first
- vector optional (enabled only when extension loads)
- simple hybrid merge if both are available

4. Runtime:
- retrieval API implemented
- runtime memory injection behind feature flag

5. UI:
- read-only memory status card:
  - indexed files/chunks
  - provider/model
  - vector available/unavailable
  - last index time
- no full memory editor UI in first cut

## Phase expansion after minimal subset

1. Add file watcher + debounce sync.
2. Add periodic background sync.
3. Add session transcript source indexing (optional and scoped).
4. Add curated entity pages generation (`memory/entities/*.md`).
5. Add richer UI for browsing/editing memory files and retrieval traces.

## Decisions this implies for current Wafflebot plan

1. Keep `WAFFLEBOT_MEMORY_PLAN.md` as the broad implementation plan.
2. Use this doc as the architecture policy:
- markdown is canonical,
- index is derived,
- retrieval is hybrid with safe fallbacks.
3. Implement minimal subset before advanced memory capture/automation.

## Immediate next coding tasks

1. Add canonical memory path config and defaults.
2. Add memory index schema migration (`memory_files`, `memory_chunks`, `memory_embedding_cache`, `memory_meta`, FTS).
3. Implement `src/backend/memory/indexer.ts` and `src/backend/memory/retrieve.ts`.
4. Add `bun memory:sync` and `bun memory:reindex` scripts.
5. Wire retrieval into runtime behind `WAFFLEBOT_MEMORY_ENABLED`.
