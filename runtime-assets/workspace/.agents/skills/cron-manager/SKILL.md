---
name: cron-manager
description: Create, inspect, update, run, and delete Agent Mockingbird cron jobs using cron_manager with the 3-mode model (background, conditional_agent, agent).
---

# cron-manager

Use this skill when users want to manage scheduled jobs in Agent Mockingbird.

## Cron mode model

- `background`: execute workspace module at `conditionModulePath`; no agent step.
- `conditional_agent`: execute workspace module at `conditionModulePath`; module can request agent invocation with `invokeAgent.shouldInvoke === true`.
- `agent`: agent runs every execution.

## Required fields by mode

- `background`
- requires: `conditionModulePath`
- should include: `conditionDescription` when a short Job Details summary is useful
- should not include: `agentPromptTemplate`

- `conditional_agent`
- requires: `conditionModulePath`
- should include: `conditionDescription` (1-2 sentence plain summary for Job Details UI)
- `agentPromptTemplate` is optional fallback when module does not provide `invokeAgent.prompt`

- `agent`
- requires: `agentPromptTemplate`
- should not include: `conditionModulePath`

## Safe workflow

1. Call `cron_manager` with `action: "describe_contract"` and `action: "list_jobs"` first.
2. Prefer `action: "upsert_job"` with stable `job.id` for idempotent create/update.
3. For create/update, send minimal fields and preserve unrelated job settings.
4. After creating/updating, verify with `action: "get_job"`.
5. Optionally smoke test with `action: "run_job_now"` and inspect `list_instances` / `list_steps`.
6. For deletions, confirm intent before `action: "delete_job"`.
7. Prefer pausing via `action: "disable_job"` when the user wants to stop runs without deleting history.

## Patterns

- Create recurring background job:
- `scheduleKind: "every"`, `everyMs`, `runMode: "background"`, `conditionModulePath`, optional `conditionDescription`.

- Create cron-expression conditional job:
- `scheduleKind: "cron"`, `scheduleExpr`, `runMode: "conditional_agent"`, `conditionModulePath`, `conditionDescription`, optional `agentPromptTemplate`.

- Create one-shot agent job:
- `scheduleKind: "at"`, `atIso`, `runMode: "agent"`, `agentPromptTemplate`.

## Rules

- Prefer `upsert_job` with stable IDs over delete+create.
- Use `enable_job` / `disable_job` for quick pause/resume instead of delete+recreate.
- Keep payloads small and explicit; avoid storing secrets in payload unless user explicitly requests it.
