# Memory Ops Runbook

This runbook is for Wafflebot operators maintaining OpenCode-backed memory.

## Source of Truth

- Durable files in workspace:
  - `MEMORY.md`
  - `memory/*.md`
- Indexed state in Wafflebot SQLite tables:
  - `memory_files`
  - `memory_chunks`
  - `memory_chunks_fts`
  - `memory_records`
  - `memory_embedding_cache`
  - `memory_write_events`

## Routine Operations

- Check status:

```bash
bun run memory:status
```

- Incremental sync (normal path):

```bash
bun run memory:sync
```

- Forced rebuild (index corruption/config drift):

```bash
bun run memory:reindex
```

- Write-path validation and history:

```bash
bun run memory:activity 20
bun run memory:lint
bun run memory:migrate-format
```

## API Equivalents

- `GET /api/memory/status`
- `GET /api/memory/activity?limit=20`
- `POST /api/memory/sync`
- `POST /api/memory/reindex`
- `POST /api/memory/retrieve`
- `POST /api/memory/read`
- `POST /api/memory/remember`
- `POST /api/memory/remember/validate`

## When to Use Sync vs Reindex

- Use `sync` for normal operation and regular maintenance.
- Use `reindex` when:
  - embedding provider/model changed,
  - file/index mismatch is suspected,
  - retrieval quality regressed after significant workspace updates.

## Recommended Baseline Knobs

- `runtime.memory.toolMode`: `tool_only`
- `runtime.memory.maxResults`: `4`
- `runtime.memory.minScore`: `0.35`
- `runtime.memory.retrieval.engine`: `qmd_hybrid`
- `runtime.memory.retrieval.strongSignalMinScore`: `0.85`
- `runtime.memory.retrieval.strongSignalMinGap`: `0.15`
- `runtime.memory.retrieval.conceptExpansionEnabled`: `true`
- `runtime.memory.retrieval.conceptExpansionMaxPacks`: `3`
- `runtime.memory.retrieval.conceptExpansionMaxTerms`: `10`
- `runtime.memory.retrieval.semanticRescueEnabled`: `true`
- `runtime.memory.retrieval.semanticRescueMinVectorScore`: `0.75`
- `runtime.memory.retrieval.semanticRescueMaxResults`: `2`

## Failure Handling

- `Memory is disabled.`
  - Check `runtime.memory.enabled` in config.
- Ollama/embed failures
  - Verify `runtime.memory.ollamaBaseUrl`, provider/model availability, and network reachability.
- Empty retrieval despite expected content
  - Run `reindex`, then test with `memory:search`.
  - Use `memory:search --debug "<query>"` to inspect retrieval legs and expansion behavior.
- Duplicate write rejections
  - Expected behavior; check `memory_write_events`/`memory:activity` and write with supersession intent when replacing data.

## Operational Notes

- Keep OpenCode workspace and memory workspace aligned.
- Prefer deterministic maintenance via cron `memory.maintenance` if periodic sync is needed.
- Treat memory markdown as canonical; do not manually edit SQLite memory tables.
