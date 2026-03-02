---
name: cron-manager
description: Create, inspect, update, run, and delete Wafflebot cron jobs using cron_manager with the 3-mode model (background, conditional_agent, agent).
---

# cron-manager

Use this skill when users want to manage scheduled jobs in Wafflebot.

## Cron mode model

- `background`: deterministic handler only, no agent step.
- `conditional_agent`: deterministic handler first, then agent only if handler returns `invokeAgent.shouldInvoke === true`.
- `agent`: agent runs every execution.

## Required fields by mode

- `background`
- requires: `handlerKey`
- should not include: empty `handlerKey`

- `conditional_agent`
- requires: `handlerKey`, `agentPromptTemplate`
- note: `agentPromptTemplate` is fallback when handler does not provide `invokeAgent.prompt`

- `agent`
- requires: `agentPromptTemplate`
- `handlerKey` is optional and typically omitted

## Safe workflow

1. Call `cron_manager` with `action: "list_handlers"` and `action: "list_jobs"` first.
2. For create/update, send minimal fields and preserve unrelated job settings.
3. After creating/updating, verify with `action: "get_job"`.
4. Optionally smoke test with `action: "run_job_now"` and inspect `list_instances` / `list_steps`.
5. For deletions, confirm intent before `action: "delete_job"`.

## Patterns

- Create recurring background job:
- `scheduleKind: "every"`, `everyMs`, `runMode: "background"`, `handlerKey`.

- Create cron-expression conditional job:
- `scheduleKind: "cron"`, `scheduleExpr`, `runMode: "conditional_agent"`, `handlerKey`, `agentPromptTemplate`.

- Create one-shot agent job:
- `scheduleKind: "at"`, `atIso`, `runMode: "agent"`, `agentPromptTemplate`.

## Rules

- Always validate handler availability via `list_handlers` before assigning `handlerKey`.
- Prefer `update_job` over delete+create when changing an existing job.
- Keep payloads small and explicit; avoid storing secrets in payload unless user explicitly requests it.
