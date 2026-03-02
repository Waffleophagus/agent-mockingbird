# memory-ops

Operate and troubleshoot Wafflebot memory for OpenCode runtime.

## Use When

- memory retrieval quality drops,
- writes are rejected unexpectedly,
- indexing/provider configuration changes,
- post-import validation is required.

## Playbook

1. Baseline health

```bash
bun run memory:status
bun run memory:activity 20
```

2. Refresh index

```bash
bun run memory:sync
```

3. Force rebuild if needed

```bash
bun run memory:reindex
```

4. Validate retrieval and integrity

```bash
bun run memory:search "<known marker>"
bun run memory:lint
```

## Troubleshooting

- `Memory is disabled`:
  - enable `runtime.memory.enabled`.
- Embedding failures:
  - verify provider/model/base URL and endpoint health.
- Duplicate write rejection:
  - expected for identical active content; write replacement with `supersedes` where appropriate.

## API Fallback

If CLI is unavailable, use:

- `GET /api/memory/status`
- `POST /api/memory/sync`
- `POST /api/memory/reindex`
- `GET /api/memory/activity?limit=20`
- `POST /api/memory/retrieve`
