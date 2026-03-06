---
name: config-auditor
description: Audit Agent Mockingbird config for drift, risky values, and operability issues, then suggest minimal safe patches.
---

# config-auditor

Use this skill to evaluate config quality before changing it.

## Workflow

1. Fetch current config with `config_manager` using `get_config`.
2. Inspect runtime settings for:
   - timeouts that are too low for current providers
   - memory settings that can cause noisy retrieval
   - cron defaults that may cause retry storms
   - invalid model/provider references
3. Propose explicit patch candidates.
4. Apply only when the user asks to apply.

## Rules

- Favor small, isolated changes.
- Explain expected impact of each proposed patch.
- Never apply multiple unrelated config changes in one patch unless requested.
