# wafflebot

Bun-native orchestration dashboard scaffold for a long-running agent stack.

## Stack

- Runtime: `bun`
- Frontend: `react` + `typescript`
- Styling: `tailwindcss v4`
- UI primitives: `@base-ui-components/react` with shadcn-style component structure
- Linting: `eslint` (flat config) + `typescript-eslint` + `react-hooks` + `jsx-a11y`

## Commands

```bash
bun install
bun run dev
```

Run wafflebot + OpenCode together for smoke testing:

```bash
bun run dev:stack
```

Production build and run:

```bash
bun run build
bun run start
```

Code quality:

```bash
bun run lint
bun run typecheck
```

Database migrations (Drizzle + SQLite):

```bash
bun run db:generate
bun run db:migrate
bun run db:check
```

By default the SQLite file is `./data/wafflebot.db`. Override with `WAFFLEBOT_DB_PATH`.

Memory CLI:

```bash
bun run memory:status
bun run memory:sync
bun run memory:reindex
bun run memory:search "query"
bun run memory:e2e
bun run memory:trace:e2e
bun run src/backend/memory/cli.ts policy
bun run src/backend/memory/cli.ts activity 20
bun run memory:lint
```

`memory:trace:e2e` auto-selects a model from existing sessions (prefers `main`). Override with `WAFFLEBOT_E2E_MODEL=provider/model`.

## Runtime

Wafflebot runs with an OpenCode-backed runtime that forwards prompts to OpenCode and stores mirrored messages locally.

OpenCode runtime environment variables:

- `WAFFLEBOT_OPENCODE_BASE_URL` (default `http://127.0.0.1:4096`)
- `WAFFLEBOT_OPENCODE_PROVIDER_ID` (default `ollama`)
- `WAFFLEBOT_OPENCODE_MODEL_ID` (default `qwen3-coder`)
- `WAFFLEBOT_OPENCODE_TIMEOUT_MS` (default `120000`)
- `WAFFLEBOT_OPENCODE_DIRECTORY` (optional, passed as `directory` query param)
- `WAFFLEBOT_OPENCODE_AUTH_HEADER` (optional full `Authorization` header)
- `WAFFLEBOT_OPENCODE_USERNAME` / `WAFFLEBOT_OPENCODE_PASSWORD` (optional Basic auth fallback)

Memory mode environment variables:

- `WAFFLEBOT_MEMORY_ENABLED` (default `true`)
- `WAFFLEBOT_MEMORY_WORKSPACE_DIR` (default `./data/workspace`)
- `WAFFLEBOT_MEMORY_EMBED_PROVIDER` (`ollama` or `none`, default `ollama`)
- `WAFFLEBOT_MEMORY_EMBED_MODEL` (default `nomic-embed-text`)
- `WAFFLEBOT_MEMORY_OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`)
- `WAFFLEBOT_MEMORY_CHUNK_TOKENS` (default `400`)
- `WAFFLEBOT_MEMORY_CHUNK_OVERLAP` (default `80`)
- `WAFFLEBOT_MEMORY_MAX_RESULTS` (default `6`)
- `WAFFLEBOT_MEMORY_MIN_SCORE` (default `0.25`)
- `WAFFLEBOT_MEMORY_SYNC_COOLDOWN_MS` (default `10000`)
- `WAFFLEBOT_MEMORY_TOOL_MODE` (`hybrid`, `inject_only`, `tool_only`; default `hybrid`)
- `WAFFLEBOT_MEMORY_WRITE_POLICY` (`conservative`, `moderate`, `aggressive`; default `conservative`)
- `WAFFLEBOT_MEMORY_MIN_CONFIDENCE` (default `0.7`)

OpenCode local memory tools:

- `.opencode/tools/memory_search.ts`
- `.opencode/tools/memory_get.ts`
- `.opencode/tools/memory_remember.ts`

These tools call Wafflebot's memory API. Set `WAFFLEBOT_MEMORY_API_BASE_URL` for the OpenCode process if needed (default `http://127.0.0.1:3001`).

Memory API endpoints used by tools:

- `POST /api/memory/retrieve`
- `POST /api/memory/read`
- `POST /api/memory/remember`
- `POST /api/memory/remember/validate`
- `GET /api/memory/policy`
- `GET /api/memory/activity`

Environment variables are parsed and validated at startup via `@t3-oss/env-core` + `zod`.

`bun run dev:stack` launcher env knobs:

- `OPENCODE_HOST` (default `127.0.0.1`)
- `OPENCODE_PORT` (default `4096`)
- `WAFFLEBOT_PORT` (default `3001`)
- `OPENCODE_LOG_LEVEL` (default `INFO`)
