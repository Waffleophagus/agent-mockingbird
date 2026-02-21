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

Reset local database to defaults (including cron job tables):

```bash
bun run db:wipe
```

Memory CLI:

```bash
bun run memory:status
bun run memory:sync
bun run memory:reindex
bun run memory:search "query"
bun run memory:e2e
bun run memory:trace:e2e
bun run src/backend/memory/cli.ts remember "some note to store"
bun run src/backend/memory/cli.ts activity 20
bun run memory:lint
```

`memory:trace:e2e` auto-selects a model from existing sessions (prefers `main`). Override with `WAFFLEBOT_E2E_MODEL=provider/model`.

## Runtime

Wafflebot runs with an OpenCode-backed runtime that forwards prompts to OpenCode and stores mirrored messages locally.

Runtime configuration is stored in JSON (`./data/wafflebot.config.json` by default). On first boot, wafflebot migrates legacy env/DB runtime settings into this file.
Example config template: `wafflebot.config.example.json`.

Config API:

- `GET /api/config`
- `PATCH /api/config` (partial update with optimistic `expectedHash`)
- `PUT /api/config` (full replace with optimistic `expectedHash`)
- `GET /api/runtime/info` (effective OpenCode connection + directory/config persistence metadata)

After every config change, wafflebot performs:

- schema validation
- semantic provider/model validation via OpenCode `config/providers`
- gateway smoke test prompt (expects an `OK` response pattern)

If any validation step fails, the config change is not persisted.

Auth and path env variables:

- `WAFFLEBOT_DB_PATH` (default `./data/wafflebot.db`)
- `WAFFLEBOT_CONFIG_PATH` (default `./data/wafflebot.config.json`)
- `WAFFLEBOT_OPENCODE_AUTH_HEADER` (optional full `Authorization` header)
- `WAFFLEBOT_OPENCODE_USERNAME` / `WAFFLEBOT_OPENCODE_PASSWORD` (optional Basic auth fallback)

Cron environment variables:

- `WAFFLEBOT_CRON_ENABLED` (default `true`)
- `WAFFLEBOT_CRON_SCHEDULER_POLL_MS` (default `1000`)
- `WAFFLEBOT_CRON_WORKER_POLL_MS` (default `1000`)
- `WAFFLEBOT_CRON_LEASE_MS` (default `30000`)
- `WAFFLEBOT_CRON_MAX_ENQUEUE_PER_JOB_TICK` (default `25`)

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

OpenCode local memory tools:

- `.opencode/tools/memory_search.ts`
- `.opencode/tools/memory_get.ts`
- `.opencode/tools/memory_remember.ts`
- `.opencode/tools/cron_manager.ts`

These tools call Wafflebot APIs. Set `WAFFLEBOT_MEMORY_API_BASE_URL` and/or `WAFFLEBOT_CRON_API_BASE_URL` for the OpenCode process if needed (default `http://127.0.0.1:3001`).

Memory API endpoints used by tools:

- `POST /api/memory/retrieve`
- `POST /api/memory/read`
- `POST /api/memory/remember`
- `POST /api/memory/remember/validate`
- `GET /api/memory/activity`

Run API endpoints:

- `POST /api/runs`
- `GET /api/runs/:id`
- `GET /api/runs/:id/events`
- `GET /api/runs/:id/events/stream`

Cron API endpoints:

- `GET /api/cron/handlers`
- `GET /api/cron/health`
- `GET /api/cron/jobs`
- `POST /api/cron/jobs`
- `GET /api/cron/jobs/:id`
- `PATCH /api/cron/jobs/:id`
- `DELETE /api/cron/jobs/:id`
- `POST /api/cron/jobs/:id/run`
- `GET /api/cron/instances`
- `GET /api/cron/instances/:id/steps`
- `POST /api/cron/manage` (used by `cron_manager`)

Environment variables are parsed and validated at startup via `@t3-oss/env-core` + `zod`.

`bun run dev:stack` launcher env knobs:

- `OPENCODE_HOST` (default `127.0.0.1`)
- `OPENCODE_PORT` (default `4096`)
- `WAFFLEBOT_PORT` (default `3001`)
- `OPENCODE_LOG_LEVEL` (default `INFO`)

## OpenCode Agent Persistence

Wafflebot now manages OpenCode agents directly in project-scoped OpenCode config.

- Save target is typically `<workspace>/.opencode/opencode.jsonc` under `WAFFLEBOT_OPENCODE_DIRECTORY`.
- OpenCode also loads `.opencode/agent/*.md` and `.opencode/agents/*.md`; deleting an agent in Wafflebot removes matching files as well.
- Agents UI shows `Saving to` and `Bound directory` so you can verify which workspace is authoritative.

If OpenCode UI/TUI looks different from Wafflebot:

1. Confirm `GET /api/runtime/info` reports the directory you expect.
2. Launch/attach OpenCode against the same workspace directory.
3. Verify the same `.opencode/opencode.jsonc` file path is being used.

## Deployment

Recommended production topology is **single VM + systemd sidecar**:

- `opencode.service` running on `127.0.0.1:4096`
- `wafflebot.service` running on `127.0.0.1:3001`
- both pinned to one workspace path via `WAFFLEBOT_OPENCODE_DIRECTORY`

Deployment artifacts:

- `deploy/systemd/opencode.service`
- `deploy/systemd/wafflebot.service`
- `deploy/systemd/README.md`
- `deploy/docker-compose.yml` (reference stack)

## CI/CD Release Bundles

This repo uses one CI/CD workflow:

- `.github/workflows/ci.yml` runs lint/typecheck/build, then publishes the same packed artifact to your npm-compatible package registry.
- Pull requests run checks only (no publish).
- Pushes to `main` publish a prerelease (`0.0.0-main.<run>.<sha>`) with npm tag `main`.
- Pushes to `v*` tags (and manual dispatch with `version`) publish with npm tag `latest`.

Published package artifact:

- `@<scope>/wafflebot@<version>` generated from a single packed `.tgz` built in CI after lint/typecheck/build.

Detailed install instructions are in `deploy/RELEASE_INSTALL.md`.

## Install Directly From GitHub (No npmjs.org)

You can install this project as a global Bun CLI directly from git:

1. Install globally from a tag:

```bash
OWNER="<github-owner>"
REPO="<repo-name>"
VERSION="v0.1.0"
bun add -g "github:${OWNER}/${REPO}#${VERSION}"
```

2. Run:

```bash
wafflebot
```

## Publish To Package Registry

`ci.yml` publish steps expect these repository secrets:

- `PACKAGE_REGISTRY_URL` example: `https://gitea.example.com/api/packages/matt/npm/`
- `PACKAGE_REGISTRY_TOKEN` token with package write permission
- `PACKAGE_REGISTRY_SCOPE` scope/user/org, example: `matt`

On tag push like `v0.1.0`, CI publishes `@<scope>/wafflebot@0.1.0` to that registry.

Install from that registry with Bun:

```bash
SCOPE="<scope>"
REGISTRY_URL="https://gitea.example.com/api/packages/${SCOPE}/npm/"
TOKEN="<gitea-token>"

registry_no_proto="${REGISTRY_URL#https://}"
registry_no_proto="${registry_no_proto#http://}"
printf "@%s:registry=%s\n//%s:_authToken=%s\n" "$SCOPE" "$REGISTRY_URL" "$registry_no_proto" "$TOKEN" >> ~/.npmrc

bun add -g "@${SCOPE}/wafflebot"
wafflebot
```
