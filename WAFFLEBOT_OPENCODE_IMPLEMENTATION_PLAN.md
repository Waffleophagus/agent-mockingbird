# Wafflebot v1 Implementation Plan (OpenCode + SQLite + Ollama)

Analysis date: `2026-02-16`

## Goals

- Use OpenCode as the underlying model/tool/subagent runtime with minimal reinvention.
- Build your own durable orchestration layer around it (jobs, cron, heartbeat, memory, recovery).
- Keep runtime on Bun and SQLite first; leave Turso as a later swap-in path.
- Support Ollama for:
  - subagent/chat model execution
  - embedding generation

## Decision Summary

1. Integrate OpenCode as a **sidecar service** (HTTP + SSE event stream), not via deep internal imports.
2. Use `cron` from `kelektiv/node-cron` for cron parsing/ticking, but execute via a **durable DB-backed job queue**.
3. Use SQLite (Bun `bun:sqlite` + Drizzle) for app state.
4. Use `sqlite-vec` for local vector search in SQLite, with FTS5 fallback if extension load fails.
5. Use Ollama `/v1` for OpenCode model provider and Ollama `/api/embed` (or `/v1/embeddings`) for embeddings.

## What We Reuse From OpenCode

Reuse as-is (treat as product boundary):

- Agent runtime + prompt/tool loop + subagent spawning:
  - `opencode/packages/opencode/src/session/prompt.ts`
  - `opencode/packages/opencode/src/session/processor.ts`
  - `opencode/packages/opencode/src/tool/task.ts`
- Tooling and MCP support:
  - `opencode/packages/opencode/src/tool/registry.ts`
  - `opencode/packages/opencode/src/mcp/index.ts`
- API surface and event stream:
  - `opencode/packages/opencode/src/server/server.ts`
  - `opencode/packages/opencode/src/server/routes/session.ts`
- ACP support when useful for external clients:
  - `opencode/packages/opencode/src/acp/README.md`

Do not reuse as-is:

- OpenCode scheduler (`setInterval` in-process, non-durable):
  - `opencode/packages/opencode/src/scheduler/index.ts`

## Why Sidecar Over Internal Import

OpenCode internals are powerful but not a stable library API. Sidecar integration via HTTP/SSE gives:

- isolation from upstream refactors
- easier upgrades (pin OpenCode version)
- clean failure boundaries (restart/retry OpenCode independently)
- compatibility with your own orchestration database and UX layer

## Target Architecture

## 1) `orchestrator` service (Bun)

- Owns durable state, cron scheduling, retries, heartbeat, and memory indexing.
- Calls OpenCode API to create/prompt sessions.
- Subscribes to OpenCode `/event` SSE and mirrors relevant events into your DB/event bus.
- Exposes your own API/UI-friendly stream endpoint with replay/resume tokens.

## 2) `opencode` sidecar

- Runs as separate process (`opencode serve ...`).
- Configured to use Ollama via OpenAI-compatible provider config.
- Continues to run MCP/ACP/tools/subagent task flows.

## 3) SQLite app DB (`wafflebot.db`)

- Separate from OpenCode’s own DB.
- Stores orchestrator runs, jobs, leases, memory docs/chunks/embeddings, stream checkpoints.

## 4) Browser/UI transport

- Use SSE (not WebSocket) for run timeline updates.
- Server heartbeat every ~15-30s.
- Resume with `last_event_id` (or cursor token) to recover after tab sleep/reconnect.

## Libraries

Required:

- `cron` (repo: `kelektiv/node-cron`) for cron expression scheduling.
- `drizzle-orm` + `drizzle-kit` for schema + migrations.
- `zod` for payload/event contracts.
- `sqlite-vec` for vector indexing/query in SQLite.
- Ollama API (HTTP) for embeddings.

Good additions:

- `pino` for structured logs.
- `ulid` for sortable IDs.
- `hono` for API routes.

Investigated alternatives:

- `sidequest`: feature-rich durable jobs, but current docs explicitly state it does **not run with Bun**; not suitable right now.
- Redis/Postgres queue stacks (`bullmq`, `pg-boss`, `graphile-worker`): not aligned with your SQLite-first constraint.

## Data Model (v1)

Core orchestration tables:

- `agent_run`
  - `id`, `status`, `created_at`, `updated_at`, `opencode_session_id`, `input`, `result`, `error`
- `agent_run_event`
  - append-only event log for UI replay: `id`, `run_id`, `seq`, `event_type`, `payload`, `created_at`
- `job_definition`
  - `id`, `name`, `cron_expr`, `timezone`, `enabled`, `handler`, `payload_template`
- `job_instance`
  - durable execution: `id`, `definition_id`, `scheduled_for`, `state`, `attempt`, `max_attempts`, `last_error`
- `job_lease`
  - `job_instance_id`, `worker_id`, `lease_expires_at`, `heartbeat_at`

Memory tables:

- `memory_document`
  - source-level items (conversation/docs/files)
- `memory_chunk`
  - chunked text with metadata (`source`, `tags`, `run_id`, timestamps)
- `memory_embedding`
  - `chunk_id`, `model`, `dim`, `vector_blob`, `checksum`
- `memory_link`
  - optional graph edges between chunks/documents/runs

Vector index:

- `vec_memory` virtual table (`sqlite-vec`) keyed to `memory_chunk` row IDs.

## Execution Flow

1. API receives user task -> creates `agent_run`.
2. Orchestrator creates/uses OpenCode session, posts prompt.
3. OpenCode emits events (`/event`) -> orchestrator stores normalized `agent_run_event`.
4. UI consumes orchestrator SSE stream with heartbeat + resume cursor.
5. On completion, orchestrator extracts useful artifacts -> chunk -> embed via Ollama -> upsert into vector index.

## Cron + Durable Jobs Design

`cron` is used for schedule evaluation only. Durability is enforced in DB.

Rules:

1. On cron tick, insert `job_instance` with unique key `(definition_id, scheduled_for)` to prevent duplicates.
2. Workers claim due jobs transactionally using lease semantics.
3. Worker heartbeats update lease while running.
4. Expired leases are requeued by recovery loop.
5. Retries use exponential backoff + jitter; terminal failures go `dead`.
6. All external side effects use idempotency keys.

This avoids the classic in-memory cron problems after process restart.

## Ollama Integration Plan

## OpenCode models/subagents

- Configure OpenCode provider as `@ai-sdk/openai-compatible` with `baseURL: http://localhost:11434/v1`.
- Define preferred local models for primary + subagents in OpenCode config.

## Embeddings

- Primary endpoint: `POST /api/embed` (batch support, normalized vectors).
- Store `embedding_model` on each chunk to prevent cross-model similarity errors.
- Start with one embedding model for all indices (for example `embeddinggemma` or `qwen3-embedding`).

## Phased Implementation

## Phase 0: Foundation (1-2 days)

- Create repo structure:
  - `apps/orchestrator`
  - `packages/db`
  - `packages/contracts`
- Add DB bootstrap + migrations.
- Add OpenCode sidecar process manager + health check.

Exit criteria:

- can start orchestrator + OpenCode together
- can call OpenCode create/prompt API from orchestrator

## Phase 1: Run Orchestration (2-4 days)

- Implement `agent_run` lifecycle and event ingestion from OpenCode `/event`.
- Build orchestrator SSE endpoint with heartbeat and cursor resume.
- Add cancellation path (map to OpenCode session abort API).

Exit criteria:

- browser reload does not lose run timeline
- reconnect resumes from cursor without duplicate rendering

## Phase 2: Durable Scheduler (2-4 days)

- Add `job_definition`, `job_instance`, lease/recovery workers.
- Integrate `cron` ticks -> enqueue durable jobs.
- Add retry/backoff/dead-letter behavior.

Exit criteria:

- restart during active jobs recovers correctly
- duplicate cron firing prevented by DB uniqueness

## Phase 3: Memory + Vector (2-4 days)

- Implement chunking pipeline.
- Wire Ollama embeddings generation.
- Add `sqlite-vec` index and query API.
- Add FTS5 fallback mode.

Exit criteria:

- semantic retrieval returns relevant chunks
- extension-load failure gracefully degrades to lexical search

## Phase 4: Hardening (2-5 days)

- Observability: structured logs, metrics counters, run/job dashboards.
- Chaos tests: kill OpenCode sidecar mid-run, network flap, DB lock contention.
- Backups and DB maintenance tasks.

Exit criteria:

- documented SLO targets met for job completion and reconnect recovery

## Risks and Mitigations

- `sqlite-vec` is pre-v1:
  - pin exact version, add migration strategy, keep FTS fallback.
- OpenCode API/event schema changes:
  - version pin + adapter layer in orchestrator.
- Long-running tool calls:
  - enforce run timeouts and recovery watchdog.
- Multi-process duplicate work:
  - lease + unique constraints + idempotency keys.

## Immediate Next Build Steps

1. Scaffold `apps/orchestrator` with Bun + Hono + Drizzle.
2. Add OpenCode sidecar controller (`start`, `health`, `shutdown`, `restart`).
3. Implement minimal run API:
   - `POST /runs`
   - `GET /runs/:id/events` (SSE with heartbeat)
4. Add first migration for `agent_run` and `agent_run_event`.
5. Prove end-to-end with one prompt and resumable timeline.

## Source Notes

- OpenCode internals reviewed from local clone under `opencode/packages/opencode`.
- Cron library reference: https://github.com/kelektiv/node-cron
- Bun SQLite extension support (`loadExtension`): https://bun.sh/docs/runtime/sqlite
- SQLite vector extension docs + Bun example: https://alexgarcia.xyz/sqlite-vec/js.html
- sqlite-vec repository status (pre-v1): https://github.com/asg017/sqlite-vec
- Ollama OpenAI compatibility + OpenCode integration:
  - https://docs.ollama.com/openai
  - https://docs.ollama.com/integrations/opencode
- Ollama embeddings API:
  - https://docs.ollama.com/api/embed
  - https://docs.ollama.com/capabilities/embeddings
- Sidequest Bun limitation:
  - https://docs.sidequestjs.com/installation
