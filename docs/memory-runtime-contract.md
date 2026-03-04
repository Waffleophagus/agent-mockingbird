# Memory Runtime Contract

This contract defines how OpenCode runtime memory is expected to behave in Wafflebot.

## Contract

- Memory files in workspace (`MEMORY.md`, `memory/*.md`) are canonical.
- Runtime retrieval uses hybrid ranking over text + vector signals.
- `memory_get` only reads allowed memory paths.
- `memory_remember` validates input and logs accepted/rejected events.

## Tool Modes

- Default mode is `tool_only`.
- `hybrid`: prompt memory injection and memory tool policy are active.
- `inject_only`: prompt memory injection only.
- `tool_only`: no prompt injection; retrieval/writes via tools only.

## Retrieval Rules

- Query flow:
  1. refresh index (cooldown-aware),
  2. run BM25 probe and skip expansion when strong signal thresholds are met,
  3. optionally expand typed queries (`lex|vec|hyde`) and route `lex->FTS`, `vec/hyde->vector`,
  4. fuse result lists with reciprocal rank fusion (RRF), then apply recency and record-state weighting,
  5. blend rank/rerank signals, apply relevance filtering, and return citations (`path#line`) with clipped snippets.
- Prompt injection dedupe tracks already-injected memory keys per session generation and resets on session compaction.
- Retrieval defaults are controlled by `runtime.memory.retrieval.*` and can fall back to `legacy` mode.

## Write Rules

- Empty content is rejected.
- Duplicate active records are rejected.
- Accepted writes append compact structured markdown blocks under `memory/YYYY-MM-DD.md` and are indexed.
- Every write attempt is logged in memory activity.

## Interfaces

- Memory API routes under `/api/memory/*`.
- OpenCode tool wrappers under `.opencode/tools/memory_*.ts`.
- Operator CLI via `bun run memory:*` scripts.
- Retrieval debug can be requested via `POST /api/memory/retrieve` with `{ "debug": true }`.
