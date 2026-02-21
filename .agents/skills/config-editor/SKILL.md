---
name: config-editor
description: Safely read and update Wafflebot runtime configuration with hash-aware, smoke-tested writes.
---

# config-editor

Use this skill for runtime configuration updates.

## Required workflow

1. Call `config_manager` with `action: "get_config"` and capture `hash`.
2. Build a minimal `patch`.
3. Call `config_manager` with:
   - `action: "patch_config"`
   - `expectedHash` from step 1
   - `runSmokeTest: true`
4. If a hash conflict occurs, refresh with `get_config` and retry once with a fresh hash.

## Rules

- Prefer `patch_config` over `replace_config`.
- Keep patches narrow and reversible.
- Do not attempt to modify smoke-test policy fields unless explicitly instructed by the user.
