# Convex vs SQLite/Turso + Custom Scheduler

Analysis date: `2026-02-16`

## TL;DR

Your instinct is valid: **Convex can feel limiting** if you want full control over agent runtime semantics, event streaming, and custom orchestration behavior.

- Choose **Convex** if you want fast delivery of durable scheduling + reactive UI state with minimal infrastructure work.
- Choose **SQLite/Turso + your own scheduler** if you want maximum control and are willing to own reliability mechanics (leases, retries, idempotency, replay, observability).

For your OpenCode-centered “simpler OpenClaw with resiliency” goal, a self-managed path is reasonable if you deliberately build the durability layer.

## What changes between approaches

### Option A: Convex-centered orchestration

- Realtime subscriptions and reconnect behavior are built in.
- Durable scheduling/cron/workflow primitives are built in.
- Strong TS codegen and function model.
- But runtime model is opinionated (query/mutation/action boundaries, action retry semantics, platform limits).

### Option B: OpenClaw-style custom orchestration (SQLite or Turso)

- Full control over runtime, queues, retries, event protocol, and data model.
- Easier to align exactly with OpenCode session/tool stream semantics.
- But you must build your own durable scheduler, retry policies, dedupe/idempotency, and operational tooling.

## Compare matrix

| Dimension | Convex | SQLite/Turso + custom scheduler |
|---|---|---|
| Realtime UI sync | Excellent out of box | You implement (SSE/WS + resume tokens) |
| Browser reconnect behavior | Built in client behavior | You design/own behavior |
| Durable scheduling | Built in (`runAfter`, `runAt`, cron) | You build/operate |
| Retry semantics | Strong for queries/mutations; actions need manual retry patterns | Fully custom |
| Agent runtime flexibility | Medium | High |
| Vendor/runtime lock-in | Medium-High | Low-Medium |
| Data model control | Medium | High |
| Operational burden | Lower | Higher |
| Type safety end-to-end | Excellent with Convex codegen | Excellent possible, but you build discipline/tooling |
| Time-to-first-reliable-version | Faster | Slower |

## Evidence-based tradeoffs

### 1) Reliability and reconnect

Convex is strong here:

- Convex React client reconnects and re-establishes session automatically after connection drops.
- Convex subscriptions are reactive and consistent-snapshot.

Inference: this directly addresses the “browser websocket died” class of issues better than most ad-hoc WS setups.

Self-managed can still match this quality, but only if you explicitly implement:

- resume tokens / cursor-based stream replay,
- heartbeat + missed-heartbeat recovery,
- idempotent event application on client.

### 2) Scheduling and background work

Convex gives durable scheduling primitives:

- scheduled functions persisted in DB, resilient to restarts,
- mutation-scheduled jobs are atomic with mutation success,
- cron built in.

But important constraints:

- scheduled **actions** are at-most-once and not automatically retried,
- long-running cron executions can cause later runs to be skipped.

Inference: for mission-critical multi-step agent jobs, you still need idempotency and workflow patterns.

In a self-managed system, you can implement exactly-once-ish behavior with:

- durable jobs table,
- lease-based claim/renew,
- idempotency keys,
- retry with backoff + dead letter.

### 3) State + memory + vector retrieval

Convex:

- text search is reactive and transactional,
- vector search is built in, but action-oriented.

SQLite/Turso:

- SQLite gives FTS5 and mature local transactional behavior.
- Turso/libSQL adds native vector data/index/query (`vector_top_k`) and embedded replicas.
- Turso consistency model is networked/replicated and differs from strict local SQLite assumptions.

Inference: Turso is a strong candidate for “state + vector in one store,” especially with local-first replica reads.

### 4) Control and product fit

Convex is a platform with opinions. Great when those opinions align.

If your product needs:

- custom session semantics tightly coupled to OpenCode events,
- custom retry/compensation logic,
- custom scheduling behavior beyond platform constraints,

then the OpenClaw-style custom orchestration path is usually a better long-term fit.

## SQLite vs Turso inside custom orchestration

## SQLite (single-node first)

Best when:

- one primary orchestrator process,
- local-first execution,
- simplest failure domain.

Tradeoff:

- one writer at a time (WAL still single-writer),
- no built-in cross-node replication/coordination.

## Turso/libSQL (distributed-ready)

Best when:

- you want SQLite semantics + managed remote durability,
- edge/local read performance with embedded replicas,
- built-in vector features without separate vector DB.

Tradeoff:

- distributed behavior and sync model adds complexity,
- you still need your own scheduler/orchestrator semantics.

## Recommendation for your project

Given your direction (OpenCode harness + custom bot platform + better resiliency):

1. Prefer **custom orchestration** over Convex-core orchestration.
2. Use **SQLite first** if you want fastest path and single-node control.
3. Move to **Turso/libSQL** when you need replication/cloud durability and low-latency local reads.
4. Keep scheduler and agent execution control in your own code, not DB platform primitives.

This path avoids Convex constraints while preserving reliability if you implement the durability layer intentionally.

## Minimal durable scheduler design (self-managed)

Use a `jobs` table with:

- `id`, `kind`, `payload`, `state`,
- `next_run_at`, `attempt`, `max_attempts`,
- `lease_owner`, `lease_expires_at`,
- `idempotency_key`, `created_at`, `updated_at`.

Core rules:

1. Claim with lease in transaction.
2. Renew lease while running.
3. On success, mark done and persist outputs.
4. On failure, compute backoff and reschedule.
5. Enforce idempotency key on side effects.
6. Run recovery loop for expired leases.

## Practical hybrid compromise

If you still want some Convex benefits:

- Keep orchestration in SQLite/Turso.
- Expose a Convex-backed UI projection/read model only.
- Mirror run-state events into Convex for realtime client UX.

That gives Convex UX strengths without surrendering runtime control.

## Sources

- Convex Realtime: https://docs.convex.dev/realtime  
- Convex React client reconnect/retries: https://docs.convex.dev/client/react  
- Convex Scheduling: https://docs.convex.dev/scheduling.html  
- Convex Scheduled Functions: https://docs.convex.dev/scheduling/scheduled-functions  
- Convex Scheduler API guarantees: https://docs.convex.dev/api/interfaces/server.Scheduler  
- Convex Limits: https://docs.convex.dev/production/state/limits  
- Convex Mutations (ordering/transactions): https://docs.convex.dev/functions/mutation-functions  
- Turso AI & Embeddings (native vector): https://docs.turso.tech/features/ai-and-embeddings  
- Turso Data & Connections (consistency model): https://docs.turso.tech/data-and-connections  
- Turso Embedded Replicas: https://docs.turso.tech/features/embedded-replicas/introduction  
- Turso Branching: https://docs.turso.tech/features/branching  
- Turso Durability Guarantees: https://docs.turso.tech/cloud/durability  
- SQLite WAL: https://www.sqlite.org/wal.html  
- SQLite Isolation: https://www.sqlite.org/isolation.html  
- SQLite Locking: https://www.sqlite.org/lockingv3.html  
- SQLite FTS5: https://www.sqlite.org/fts5.html  
- sqlite-vec project: https://github.com/asg017/sqlite-vec
