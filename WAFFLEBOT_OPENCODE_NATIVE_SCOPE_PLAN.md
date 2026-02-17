# Wafflebot OpenCode-Native Scope Plan

Plan date: `2026-02-16`

## Goal

Build a smaller, refined "OpenClaw-like" system using **OpenCode-native runtime** as the core agent/tool loop, with:

- durable orchestration
- reliable reconnect behavior
- simpler, cleaner web UI than OpenClaw
- SQLite-first state/memory
- Ollama for local models + embeddings
- single-node deployment first (cloud-init/ignition friendly)

## Scope decision

This plan is intentionally **OpenCode-native only**.

Excluded for this phase:

- Sandbox Agent / Gigacode compatibility layer
- Rivet Engine / Actors orchestration
- multi-node sharding and SaaS tenancy

## Product principles

1. Keep architecture understandable by one developer.
2. Favor operational simplicity over abstract flexibility.
3. Make failure recovery explicit and testable.
4. Keep UI event delivery resilient (SSE + resume).
5. Prioritize a usable dashboard in MVP over "infrastructure perfection."

## Technical constraints

- Runtime: Bun
- Agent harness: OpenCode (native API/events)
- State DB: SQLite (`bun:sqlite` + Drizzle migrations)
- Cron parser: `cron` (`kelektiv/node-cron`)
- Vector memory: SQLite + `sqlite-vec` (FTS5 fallback)
- Embeddings + local subagent models: Ollama

## Non-goals (v1)

- Horizontal scaling across multiple hosts
- Hosted multi-tenant auth/billing
- Replacing OpenCode’s internal tool runtime
- Workflow DSL/engine abstraction layer

## High-level architecture

## 1) Orchestrator service (your app, Bun)

- Owns runs, durable jobs, memory indexing, UI streams.
- Calls OpenCode server APIs for sessions/prompts/abort.
- Ingests OpenCode events and stores normalized run events.

## 2) OpenCode sidecar

- Started and supervised by orchestrator (or systemd).
- Treated as external runtime boundary.
- Upgraded independently with pinned version.

## 3) SQLite datastore

- Single source of truth for orchestration state.
- Separate from OpenCode internal DB.

## 4) UI stream gateway

- Orchestrator exposes SSE event stream with cursor resume.
- Heartbeat events to avoid dead connections.

## 5) Web dashboard (MVP)

- Chat-first web app for interacting with the bot.
- Session browser for switching between past and active sessions.
- Config surface for OpenCode-native settings (skills, MCP, and advanced config editing).
- Usage screen for token/cost/API metrics from day 1.

## Core modules

1. `runtime/opencode`
- Session create/prompt/abort adapter.
- Event subscriber + parser + mapper.

2. `orchestration/runs`
- Run state machine (`queued`, `running`, `blocked`, `failed`, `completed`, `cancelled`).
- Idempotent transitions and terminal-state guarantees.

3. `orchestration/jobs`
- Durable job queue with lease + retry + dead-letter.
- Cron ticker only schedules jobs; workers execute jobs.

4. `memory`
- Chunking + embedding + retrieval APIs.
- Vector + lexical fallback.

5. `transport/sse`
- Per-run and global event streams.
- Replay from last sequence.

6. `dashboard`
- `chat`: prompt input, timeline, abort/retry controls.
- `sessions`: list, search, archive, open.
- `config`: skills + MCP + advanced raw config editor.
- `usage`: run-level and aggregate provider/model usage.

## Data model (v1)

## Run tables

- `run`
  - `id`, `status`, `title`, `input_json`, `opencode_session_id`, `error_json`, `created_at`, `updated_at`
- `run_event`
  - `id`, `run_id`, `seq`, `type`, `payload_json`, `created_at`
  - unique `(run_id, seq)`
- `run_checkpoint`
  - `run_id`, `last_seq`, `last_open_code_offset`, `updated_at`

## Job tables

- `job_definition`
  - `id`, `name`, `handler`, `cron_expr`, `timezone`, `enabled`, `payload_template_json`
- `job_instance`
  - `id`, `definition_id`, `scheduled_for`, `state`, `attempt`, `max_attempts`, `next_attempt_at`, `error_json`, `created_at`, `updated_at`
  - unique `(definition_id, scheduled_for)`
- `job_lease`
  - `job_instance_id`, `worker_id`, `lease_expires_at`, `heartbeat_at`

## Memory tables

- `memory_document`
  - `id`, `source_kind`, `source_ref`, `metadata_json`, `created_at`
- `memory_chunk`
  - `id`, `document_id`, `chunk_index`, `text`, `token_count`, `metadata_json`, `created_at`
- `memory_embedding`
  - `chunk_id`, `model`, `dim`, `vector_blob`, `checksum`, `created_at`
- `memory_link`
  - `from_chunk_id`, `to_chunk_id`, `kind`, `weight`

## Usage tables

- `usage_ledger`
  - `id`, `run_id`, `session_id`, `provider`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `estimated_cost`, `currency`, `created_at`
- `usage_daily`
  - `day`, `provider`, `model`, `input_tokens`, `output_tokens`, `estimated_cost`

## Event transport strategy

Use SSE end-to-end (not WebSocket) for UI:

- `GET /events/runs/:id?after_seq=...`
- `GET /events/global?after_id=...`

Rules:

1. Every emitted event persists before publish.
2. Client reconnect sends last seen cursor.
3. Server replays missed events, then switches to live.
4. Heartbeat event every 15-30s.

## Scheduler design

`cron` provides trigger times only. Durability is in DB.

Tick loop:

1. Parse all enabled cron definitions.
2. For due schedule times, insert `job_instance` with unique key.
3. Ignore duplicate inserts safely.

Worker loop:

1. Claim due job with transactional lease.
2. Execute handler idempotently.
3. On success -> `completed`.
4. On failure -> compute backoff and requeue until `max_attempts`.
5. Expired lease reaper returns stale jobs to `queued`.

## OpenCode-native integration contract

Start with the minimum stable surface:

- Create/list/get session
- Send prompt (sync or async)
- Abort session
- Subscribe to event stream
- Read/update relevant OpenCode config and MCP/skills config endpoints

Keep a mapper layer:

- `OpenCodeEvent -> RunEvent` transformation in one module.
- No UI should depend directly on raw OpenCode event payloads.

Config strategy:

1. Safe forms for common settings:
- MCP servers
- skills sources
- commonly changed runtime flags
2. Advanced raw JSON/JSONC editor for full OpenCode config passthrough.

## Memory + retrieval plan

Ingestion:

1. Select final run artifacts (assistant text, selected tool outputs, summaries).
2. Chunk text (fixed target size + overlap).
3. Embed each chunk using Ollama embeddings endpoint.
4. Upsert into `sqlite-vec` index.

Query:

1. Vector top-k retrieval from `sqlite-vec`.
2. FTS5 lexical retrieval fallback.
3. Hybrid rank merge (weighted sum).

Guardrails:

- Store `embedding_model` per chunk.
- Never mix embeddings from different models in same similarity query.

## Deployment target (single-node first)

Single Ubuntu/CoreOS host with:

- `wafflebot-orchestrator` service
- `opencode` service
- optional `ollama` service

Persisted paths:

- `/var/lib/wafflebot/wafflebot.db`
- `/var/lib/wafflebot/logs/`
- OpenCode data dir under `/var/lib/wafflebot/opencode/`

System health checks:

- orchestrator `/health`
- OpenCode `/health` or startup readiness probe
- DB writable + migration version check

## Implementation phases

## Phase 0: Skeleton + process control

- Scaffold Bun app modules.
- Add OpenCode sidecar start/stop/health.
- Add baseline logging + config loading.

Done when:

- one command boots orchestrator + OpenCode

## Phase 1: Runs + events

- Implement run creation and OpenCode prompt execution.
- Persist and stream run events over SSE with resume.
- Implement cancel/abort.
- Deliver dashboard pages:
  - chat with bot
  - multiple session browsing
  - config management (skills + MCP + raw config editor)
  - basic usage counters per run/session
- Capture usage into `usage_ledger` from run events/tooling metadata.

Done when:

- browser refresh/reconnect does not lose timeline
- user can chat and switch sessions in the dashboard
- user can manage skills/MCP/config from dashboard without manual file edits
- usage appears in UI for new runs

## Deferred UX item: Config UX v2 (Skills, MCP, Agents)

Current MVP keeps config editing simple and functional. Next iteration should improve structure and usability:

- Main dashboard shows concise read-only summaries:
  - available agents
  - enabled skills
  - configured MCP servers
- Dedicated config workspace (separate route/view) for deep edits:
  - markdown-style editor for human-friendly config sections, or
  - JSON/JSONC editor with validation and schema hints
- Prefer guided UI over raw OpenCode config where possible:
  - form fields for common settings
  - hide internal complexity by mapping UI controls to OpenCode config
  - keep a raw "advanced" panel only for edge cases

Acceptance targets:

1. User can understand active runtime config from the main screen without scrolling through raw lists.
2. User can perform complex config edits in one dedicated place with validation feedback before save.
3. Common agent/skill/MCP setup requires no manual JSON editing.

## Deferred integration item: OpenCode Question Inbox

This is in scope for the product, but explicitly **not in the current implementation slice**.

Why this matters:

- OpenCode can pause execution and ask the user a question.
- Wafflebot should surface those prompts cleanly instead of looking "stuck."

Planned behavior:

1. Subscribe to question lifecycle events and normalize them into local run/session events.
2. Persist pending questions so they survive refresh/restart.
3. Expose API endpoints for:
   - listing pending questions
   - replying with user input
   - rejecting/cancelling a question
4. Add a lightweight UI treatment:
   - session-level "action required" indicator
   - pending question panel with reply/reject actions
   - timeline event when question is asked/resolved

Acceptance targets:

1. A pending question appears in dashboard without polling page refresh.
2. User reply/reject is sent through OpenCode and reflected in timeline state.
3. Pending question state survives service restart and browser reconnect.

## Phase 2: Durable scheduler

- Add cron definitions and durable job queue.
- Implement lease, retries, and dead-letter.
- Add periodic maintenance jobs (lease reaper, compaction hooks).

Done when:

- restart during active jobs recovers safely

## Phase 3: Memory system

- Implement chunking and embeddings via Ollama.
- Add vector search + FTS fallback.
- Add retrieval endpoint for future "memory-aware prompts".

Done when:

- retrieval is relevant and stable on test corpus

## Phase 4: Reliability hardening

- Add integration tests for reconnect, restart, duplicate delivery, and retry behavior.
- Add backup/restore and DB integrity checks.
- Add observability counters and failure alerts/logging.

Done when:

- core resilience scenarios pass repeatedly

## MVP definition

MVP includes:

1. Web dashboard chat with the bot.
2. Web dashboard support for multiple sessions.
3. Web dashboard config management for OpenCode-native skills/MCP/basic config.
4. API usage tracking visible in dashboard from day 1.
5. Run prompts through OpenCode and see live timeline in UI.
6. Recover from page disconnect without losing events.
7. Execute scheduled jobs durably across service restarts.
8. Save/retrieve semantic memory via Ollama embeddings.

MVP excludes:

- advanced multi-agent orchestration policies
- distributed deployment
- non-OpenCode runtimes
- OpenCode question inbox/reply UX (deferred integration item above)

## Risks and mitigations

1. OpenCode event/API drift
- Mitigation: pin OpenCode version + adapter translation layer + compatibility tests.

2. SQLite lock contention under burst load
- Mitigation: WAL mode, bounded worker concurrency, short transactions.

3. Embedding model drift/quality variance
- Mitigation: model pinning + reindex command + retrieval quality tests.

4. SSE stalls in browser/network edges
- Mitigation: heartbeat + cursor replay + backoff reconnect logic.

## Design knobs for discussion

1. Should run events be retained forever or TTL-pruned?
2. Preferred Ollama embedding model for v1?
3. Should scheduler and run workers be one process or separate workers?
4. How much tool output should be memory-indexed by default?
5. Do we want "strict deterministic replay" for jobs, or pragmatic idempotency only?
6. For config UX, do we prefer "forms-first" or "raw JSON-first"?
7. Should usage show estimated USD only, or provider-native units + USD estimate?

## Suggested immediate next step

Approve this scope, then implement **Phase 0 + Phase 1** only before adding memory and scheduler complexity. This gives a usable, testable baseline quickly and prevents overbuilding.
