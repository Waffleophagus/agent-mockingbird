---
name: runtime-diagnose
description: Diagnose runtime failures (timeouts, send failures, model/provider issues) and recommend config fixes.
---

# runtime-diagnose

Use this skill when the runtime is reachable but requests fail, stall, or time out.

## Workflow

1. Read current config and hash via `config_manager` (`get_config`).
2. Correlate failures with settings:
   - `runtime.opencode.timeoutMs`
   - `runtime.opencode.promptTimeoutMs`
   - `runtime.opencode.runWaitTimeoutMs`
   - `runtime.runStream.*`
3. Propose one minimal fix at a time.
4. If asked to apply, use `patch_config` with `expectedHash` and `runSmokeTest: true`.

## Rules

- Prefer timeout tuning before model/provider swaps.
- Avoid broad config replacement during incident response.
- After each applied change, verify the smoke test result in the response.
