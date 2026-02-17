# Wafflebot Memory Plan (OpenCode-Native, SQLite-First)

Plan date: `2026-02-17`

Companion architecture map: `WAFFLEBOT_MEMORY_ARCHITECTURE_MAP.md`

## Goal

Add durable, useful memory to Wafflebot so future prompts can retrieve relevant prior context with low operational overhead.

The plan is designed for the current stack:

- Bun runtime
- SQLite (`bun:sqlite`) with Drizzle for migrations only
- OpenCode as agent runtime sidecar
- Ollama for embeddings

## Scope of this plan

In scope:

1. Persistent long-term memory store in SQLite.
2. Ingestion pipeline from session messages into memory chunks.
3. Embedding generation via Ollama.
4. Retrieval API (vector-first, lexical fallback).
5. Prompt-context injection path in runtime.
6. Basic observability, maintenance, and reindex tooling.

Out of scope for first cut:

- Complex knowledge graph/link reasoning.
- Multi-tenant isolation.
- Cross-node/distributed memory.
- Aggressive auto-summarization pipelines.

## Current baseline (already in repo)

- Sessions/messages are persisted in `sessions` and `messages`.
- Runtime flow is handled in `src/backend/runtime/opencodeRuntime.ts`.
- DB operations are raw SQL in `src/backend/db/repository.ts`.
- Drizzle schema + migration flow already exists in `src/backend/db/schema.ts` and `drizzle/`.

## Architecture decisions

1. Keep memory as a separate module behind a small interface (`ingest`, `retrieve`, `reindex`).
2. Use append/upsert semantics with checksums for idempotency.
3. Prefer `sqlite-vec` for semantic retrieval if extension is available.
4. Always support FTS5 lexical fallback so memory still works without vector extension.
5. Store embedding model on each row and never compare across models.

## Data model additions

Add these tables via Drizzle migration:

1. `memory_documents`
- `id` (text pk)
- `source_kind` (`session_message`, `manual_note`, `imported_doc`)
- `source_ref` (unique-ish source pointer, ex: `sessionId:messageId`)
- `session_id` (nullable fk to `sessions.id`)
- `title`
- `metadata_json`
- `checksum`
- `created_at`, `updated_at`

2. `memory_chunks`
- `id` (text pk)
- `document_id` (fk to `memory_documents.id`)
- `chunk_index`
- `content`
- `token_estimate`
- `metadata_json`
- `checksum`
- `created_at`
- unique `(document_id, chunk_index)`

3. `memory_embeddings`
- `chunk_id` (pk/fk to `memory_chunks.id`)
- `provider` (`ollama`)
- `model`
- `dimensions`
- `vector_blob` (or extension-backed value)
- `checksum`
- `created_at`

4. `memory_retrieval_logs`
- `id`
- `session_id`
- `query_text`
- `strategy` (`vector`, `fts`, `hybrid`)
- `top_k`
- `result_chunk_ids_json`
- `created_at`

5. `memory_settings` (or extend `runtime_config`)
- active embedding model
- chunk size/overlap
- retrieval top-k and score thresholds

## Ingestion pipeline

Primary source (v1):

- assistant responses and user messages from `messages` table
- optional filtering to skip very short/noisy content

Flow:

1. Select candidate messages not yet indexed (track by `source_ref` + checksum).
2. Create/update `memory_documents`.
3. Chunk content (character/token target + overlap).
4. Upsert `memory_chunks`.
5. Embed chunks through Ollama.
6. Upsert `memory_embeddings`.
7. Mark index status complete (via checksum match).

Chunking defaults (starting point):

- target size: 700-1000 tokens (or char approximation initially)
- overlap: 100-150 tokens
- hard cap to prevent giant chunks

## Embedding integration (Ollama)

Provider contract:

1. `embed(texts: string[], model: string): Promise<number[][]>`
2. `health(): Promise<boolean>`
3. deterministic error normalization for retry logic

Operational rules:

- batch requests for throughput (example batch size: 16-64).
- retry transient failures with bounded backoff.
- write dimensions/model per chunk.
- if model changes, mark stale rows and reindex.

## Retrieval strategy

Retrieval modes:

1. Vector (`sqlite-vec`) when available.
2. FTS5 lexical when vector unavailable or degraded.
3. Hybrid merge (weighted combine of normalized ranks) when both available.

Retrieval API sketch:

- `POST /api/memory/retrieve`
  - input: `sessionId`, `query`, `topK`, optional `filters`
  - output: matched chunks with score, source metadata, and citations

Default guardrails:

- restrict to same embedding model per query.
- max chunks injected into prompt (token budget).
- dedupe near-identical chunks.

## Runtime integration

Integrate retrieval into send flow in `OpencodeRuntime.sendUserMessage`:

1. Before calling OpenCode prompt, run retrieval on user input.
2. Build a compact memory preamble (citations + snippets).
3. Inject preamble as additional context in prompt parts.
4. Send prompt to OpenCode.
5. After response, enqueue ingestion of new message pair.

Important:

- keep memory enrichment feature-flagged (`WAFFLEBOT_MEMORY_ENABLED`).
- fail open: if memory fails, chat still succeeds.

## Rollout phases

## Phase 1: Schema + plumbing

1. Add memory tables and indexes through Drizzle migration.
2. Add repository helpers for create/upsert/query.
3. Add settings defaults in seed/config path.

Done when:

- migration applies cleanly on empty and existing DB
- repository tests cover core CRUD/upsert semantics

## Phase 2: Ingestion + embedding

1. Implement chunker and checksum-based idempotency.
2. Add Ollama embedding client module.
3. Add ingest worker/service callable from API/CLI.

Done when:

- new messages can be ingested repeatedly without duplicates
- embeddings exist for ingested chunks

## Phase 3: Retrieval API

1. Add vector retrieval path (if extension loaded).
2. Add FTS fallback path.
3. Add hybrid merge + retrieval logs.

Done when:

- retrieval returns relevant chunks on local test corpus
- fallback works when vector extension is unavailable

## Phase 4: Runtime wiring

1. Add memory context injection before prompt dispatch.
2. Add post-response ingest trigger.
3. Add feature flags + safe degradation behavior.

Done when:

- memory-augmented prompt path works end-to-end
- disabling memory returns existing behavior exactly

## Phase 5: Reindex + maintenance

1. Add `bun memory:reindex` command for full rebuild.
2. Add `bun memory:ingest` for manual/backfill.
3. Add retention and compaction controls.

Done when:

- model change can be recovered with one command
- DB size and query performance remain predictable

## Testing plan

1. Unit tests:
- chunking boundaries/overlap behavior
- checksum/idempotency logic
- rank merge logic

2. Integration tests:
- ingest -> embed -> retrieve end-to-end with mocked Ollama
- vector unavailable -> FTS fallback path
- runtime send path still succeeds when memory fails

3. Smoke tests:
- run local stack, send prompts, verify retrieval logs and citations

## Risks and mitigations

1. Embedding quality variance by model
- Mitigation: model pinning, quick eval corpus, one-command reindex.

2. SQLite growth and query slowdown
- Mitigation: chunk caps, pruning policy, indexes, periodic vacuum.

3. `sqlite-vec` operational fragility on some hosts
- Mitigation: FTS fallback first-class, extension health check on boot.

4. Prompt bloat from too much memory
- Mitigation: strict top-k and token budget with truncation.

## Suggested implementation order in this repo

1. `src/backend/db/schema.ts` + new migration for memory tables.
2. `src/backend/db/repository.ts` memory CRUD/upsert helpers.
3. `src/backend/memory/` module:
- `chunking.ts`
- `embeddings/ollama.ts`
- `ingest.ts`
- `retrieve.ts`
4. `src/backend/runtime/opencodeRuntime.ts` memory pre-prompt hook.
5. CLI scripts:
- `bun run memory:ingest`
- `bun run memory:reindex`

## Acceptance criteria for "memory MVP"

1. Messages can be indexed into persistent memory.
2. Retrieval returns useful prior context for follow-up questions.
3. Runtime can use retrieved memory without breaking normal chat flow.
4. Memory remains functional when vector extension is missing (lexical fallback).
5. Model change and rebuild are operationally simple (single command).
