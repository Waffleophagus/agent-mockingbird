# OpenCode Startup Sync Plan

## Problem

Hosted startup logs showed:

```text
[opencode] Config sync failed: Unable to connect. Is the computer able to access the url?
```

This happened during `agent-mockingbird` boot even though the app itself still started.

## Diagnosis

The failure was a startup race between:

- `agent-mockingbird.service`
- `opencode.service`

`agent-mockingbird` constructed `OpencodeRuntime` during process boot, and the runtime constructor immediately kicked off OpenCode config sync. Under systemd, `After=opencode.service` only guarantees service ordering, not that OpenCode is already accepting HTTP connections on `127.0.0.1:4096`.

That meant startup could log a sync failure if Agent Mockingbird reached OpenCode before the sidecar had finished binding its port.

## Fix

Remove eager OpenCode config sync from the `OpencodeRuntime` constructor.

Keep runtime config sync lazy so it still runs before real OpenCode operations, such as:

- health checks
- normal prompts
- background session creation
- background prompt dispatch

This preserves runtime behavior while avoiding noisy false failures during service startup.

## Important Clarification

This change does **not** remove runtime config sync.

It only changes **when** sync happens:

- before: immediately during process construction
- after: on first actual runtime use

## Code Change

Updated:

- `apps/server/src/backend/runtime/opencodeRuntime.ts`

Removed the constructor-triggered call that forced sync during startup.

## Regression Coverage

Updated:

- `apps/server/src/backend/runtime/opencodeRuntime.test.ts`

Added coverage to assert that constructing the runtime does not hit OpenCode config immediately, while normal prompt flow still performs sync later.

## Verification

Run:

```sh
bun test apps/server/src/backend/runtime/opencodeRuntime.test.ts
```

Expected result:

- tests pass
- runtime construction does not contact OpenCode
- prompt path still performs runtime config sync

## Rollout

1. Push the fix.
2. Redeploy or update the hosted install.
3. Restart the user services if needed.
4. Check:

```sh
journalctl --user -u agent-mockingbird
```

Expected startup behavior:

- Agent Mockingbird starts cleanly
- no immediate OpenCode config sync connection error during boot

## Follow-up

If we want stronger startup guarantees later, we can add an explicit retry/backoff around first OpenCode sync or a readiness probe for the sidecar, but that is not required for this fix.
