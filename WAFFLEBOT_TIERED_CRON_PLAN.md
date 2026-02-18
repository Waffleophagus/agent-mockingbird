# Wafflebot Tiered Cron Plan

Plan date: `2026-02-17`

## Goal

Implement a durable cron system with explicit execution tiers so scheduled automation can run cheaply by default and invoke the model only when needed.

This plan extends the OpenCode-native architecture and preserves your core constraint:

- OpenCode remains the model/tool runtime
- Wafflebot owns orchestration, durability, and scheduling

## Why this plan

OpenClaw cron is strong, but it effectively centers model-driven execution. You want three explicit modes:

1. `system` (never invoke model)
2. `agent` (always invoke model)
3. `script` (deterministic logic first, optional model invoke on condition)

This enables cost control while preserving high-flexibility automation.

## Scope

In scope:

- Durable scheduler + queue in SQLite
- Tiered cron execution modes
- Conditional model invoke contract
- API + UI basics for creating and monitoring jobs
- Retry, leases, and restart recovery

Out of scope for first slice:

- Distributed multi-node workers
- User-auth multi-tenant isolation
- Full visual workflow builder

## Execution tiers

## Tier 1: `system` (no model)

Purpose:

- Deterministic periodic state updates

Examples:

- Poll Home Assistant location every 15 minutes
- Poll weather API and cache result
- Run housekeeping tasks (cleanup, compaction, sync)

Rules:

- No model call allowed
- Must be idempotent
- Can write state/memory/metrics/events

## Tier 2: `agent` (always model)

Purpose:

- Scheduled model-driven actions

Examples:

- Daily briefing
- Weekly planning review
- Scheduled follow-up messages

Rules:

- Always invokes OpenCode runtime
- Optional pre-context from deterministic fetch step

## Tier 3: `script` (optional model invoke)

Purpose:

- Deterministic trigger evaluation + selective intelligence

Examples:

- Track stock move; if threshold crossed, invoke model for impact summary
- Watch service metric; invoke model only on anomaly

Rules:

- Script step always runs
- Model invoke controlled by script output policy

## Unified job model

All scheduled work uses one durable pipeline with a mode-specific execution path.

Core fields for `job_definition`:

- `id`
- `name`
- `enabled`
- `schedule_kind` (`at` | `every` | `cron`)
- `schedule_expr` / `every_ms` / `at_iso`
- `timezone`
- `run_mode` (`system` | `agent` | `script`)
- `invoke_policy` (`never` | `always` | `on_condition`)
- `handler_key` (registered system/script handler id)
- `agent_prompt_template` (for `agent` and optional `script` invoke)
- `agent_model_override` (optional)
- `max_attempts`
- `retry_backoff_policy_json`
- `payload_json`
- `created_at`, `updated_at`

Core fields for `job_instance`:

- `id`
- `job_definition_id`
- `scheduled_for`
- `state` (`queued` | `leased` | `running` | `completed` | `failed` | `dead`)
- `attempt`
- `next_attempt_at`
- `lease_owner`
- `lease_expires_at`
- `last_heartbeat_at`
- `result_summary`
- `error_json`
- `created_at`, `updated_at`

Core fields for `job_step` (new):

- `id`
- `job_instance_id`
- `step_kind` (`system` | `script` | `agent`)
- `status` (`pending` | `running` | `completed` | `failed` | `skipped`)
- `input_json`
- `output_json`
- `error_json`
- `started_at`, `finished_at`

Durability key:

- unique `(job_definition_id, scheduled_for)` on `job_instance`

## Handler contract

System/script handlers are registered in-process by key.

Type shape:

```ts
type CronHandlerResult = {
  status: "ok" | "error";
  summary?: string;
  data?: unknown;
  invokeAgent?: {
    shouldInvoke: boolean;
    prompt?: string;
    context?: Record<string, unknown>;
    severity?: "info" | "warn" | "critical";
  };
};
```

For `system` mode:

- `invokeAgent` is ignored

For `script` mode:

- `invoke_policy=on_condition`: invoke model only when `invokeAgent.shouldInvoke === true`
- `invoke_policy=always`: invoke model regardless of script condition
- `invoke_policy=never`: never invoke model

## Execution state machine

1. Scheduler inserts due `job_instance` rows.
2. Worker lease-claims due instances transactionally.
3. Run deterministic step based on `run_mode`.
4. Decide model invoke:
   - `system`: never
   - `agent`: always
   - `script`: policy-driven by handler output
5. If model invoke required, run OpenCode prompt step and persist result.
6. Mark instance complete; on error apply retry/backoff.
7. Move to `dead` after max attempts.

Recovery:

- Lease reaper returns expired `leased/running` jobs to `queued`.
- Restart runs are safe due to durable states and idempotent keying.

## API plan

Initial endpoints:

- `GET /api/cron/jobs`
- `POST /api/cron/jobs`
- `PATCH /api/cron/jobs/:id`
- `POST /api/cron/jobs/:id/run`
- `GET /api/cron/jobs/:id/instances`
- `GET /api/cron/instances/:id`
- `GET /api/cron/health`

Validation:

- Enforce `run_mode` + `invoke_policy` combinations
- Enforce schedule correctness and timezone validation
- Enforce handler existence for `system`/`script`

## Model-facing cron skill plan

Expose a dedicated model tool/skill so the primary agent can manage scheduled work without raw DB access.

Planned skill id:

- `cron_manager`

Planned actions:

- `status` (scheduler health + queue depth)
- `list_jobs`
- `get_job` / `list_job_instances`
- `create_job`
- `update_job`
- `enable_job` / `disable_job`
- `run_job_now`
- `delete_job`

Creation contract:

- `run_mode=system` requires allowlisted `handler_key`
- `run_mode=agent` requires `agent_prompt_template`
- `run_mode=script` requires allowlisted `handler_key`, with optional `agent_prompt_template` for invoke path
- `invoke_policy` allowed values:
  - `never`
  - `always`
  - `on_condition` (script mode primary use)

Guardrails:

- Skill cannot register arbitrary handlers or execute arbitrary shell in MVP
- Skill cannot bypass `run_mode`/`invoke_policy` constraints
- Skill writes through normal API validation only
- Destructive operations (`delete_job`) should require explicit user intent in the requesting prompt

Return payload shape (high level):

- `ok`
- `action`
- `job` and/or `instance`
- `warnings`
- `error` (when not ok)

## UI plan (MVP-aligned)

Cron list view:

- name
- mode badge (`system`/`agent`/`script`)
- next run
- status
- enabled toggle

Cron create/edit form:

- schedule
- mode
- invoke policy
- handler picker (for `system`/`script`)
- prompt template (for `agent` or script-invoke)

Run history drawer:

- instance status timeline
- deterministic step output
- model step output (if invoked)

## Observability

Emit structured events for:

- `cron.job.scheduled`
- `cron.job.leased`
- `cron.step.started`
- `cron.step.finished`
- `cron.agent.invoked`
- `cron.instance.completed`
- `cron.instance.failed`
- `cron.instance.dead`

Metrics:

- jobs scheduled/executed per mode
- retries/dead-letter counts
- model invocations caused by script condition
- cost/tokens by cron definition

## Security and safety

- System/script handlers run from allowlisted registry only (no arbitrary shell in MVP)
- Script outputs validated before policy decisions
- Secrets pulled from env/provider, never stored in job payload plaintext if avoidable
- Idempotency requirements documented per handler

## Delivery phases

## Phase 1: durable scheduler core

- DB tables + migrations
- scheduler tick + enqueue
- lease claim/reaper
- base retries/backoff

Exit criteria:

- restart-safe scheduling and execution

## Phase 2: `system` mode

- handler registry
- first built-ins:
  - `home_assistant.location_sync`
  - `memory.maintenance`

Exit criteria:

- no-model jobs run reliably and write state

## Phase 3: `agent` mode

- scheduled OpenCode invocation path
- prompt template + model override support

Exit criteria:

- agent cron parity with current chat runtime behavior

## Phase 4: `script` mode with conditional invoke

- script handler contract implemented
- `invoke_policy` logic enforced
- first built-in:
  - `market.price_watch` with threshold-triggered model assessment

Exit criteria:

- script jobs can run thousands of cheap checks with sparse model usage

## Phase 5: UI + ops hardening

- cron CRUD UI
- run history view
- metrics panels
- failure injection tests
- `cron_manager` skill/tool wired to runtime with validation and audit logs

Exit criteria:

- feature is operable without CLI-only workflows

## Test plan

Unit:

- schedule parser and next-run calculator
- lease expiration and reclaim logic
- invoke policy branching

Integration:

- end-to-end `system` job (no model)
- end-to-end `agent` job
- end-to-end `script` job with both no-invoke and invoke paths

Chaos/recovery:

- worker crash mid-step
- OpenCode unavailable during agent step
- duplicate scheduler tick attempts

## Open decisions

1. Should `script` handlers run only from built-ins in v1, or include user-authored TS modules?
2. Should we support per-job concurrency limits beyond global worker concurrency in v1?
3. Should `system` handlers be allowed to enqueue ad-hoc follow-up jobs directly?

## Recommendation

Proceed with this tiered architecture and implement in order:

1. Durable core
2. `system`
3. `agent`
4. `script` conditional invoke

This gives immediate practical value (cheap automation) while preserving a clean path to higher-intelligence workflows.
