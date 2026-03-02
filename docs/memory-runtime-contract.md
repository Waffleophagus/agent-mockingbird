# Memory Runtime Contract

This contract defines how OpenCode runtime memory is expected to behave in Wafflebot.

## Contract

- Memory files in workspace (`MEMORY.md`, `memory/*.md`) are canonical.
- Runtime retrieval uses hybrid ranking over text + vector signals.
- `memory_get` only reads allowed memory paths.
- `memory_remember` validates input and logs accepted/rejected events.

## Tool Modes

- `hybrid`: prompt memory injection and memory tool policy are active.
- `inject_only`: prompt memory injection only.
- `tool_only`: no prompt injection; retrieval/writes via tools only.

## Retrieval Rules

- Query flow:
  1. refresh index (cooldown-aware),
  2. gather text/vector candidates,
  3. apply ranking, recency boost, superseded penalty,
  4. return citations (`path#line`) and clipped snippets.

## Write Rules

- Empty content is rejected.
- Duplicate active records are rejected.
- Accepted writes append structured memory blocks under `memory/YYYY-MM-DD.md` and are indexed.
- Every write attempt is logged in memory activity.

## Interfaces

- Memory API routes under `/api/memory/*`.
- OpenCode tool wrappers under `.opencode/tools/memory_*.ts`.
- Operator CLI via `bun run memory:*` scripts.
