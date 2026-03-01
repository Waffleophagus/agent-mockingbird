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
bun run build:cli
```

Run wafflebot + OpenCode together for smoke testing:

```bash
bun run dev:stack
```

`dev:stack` runs `build:cli` first so the local `bin/wafflebot` command stays in sync.

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
`./config.json` at repo root is OpenCode config, not wafflebot runtime config.
Runtime behavior is sourced from wafflebot config JSON. OpenCode runtime env vars are no longer accepted for model/provider/timeouts/directory.
If you still have legacy `WAFFLEBOT_OPENCODE_*` runtime vars, run `bun run config:migrate-opencode-env` once, then unset them.

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

Signal channel runtime config (JSON config file: `runtime.channels.signal`):

- `enabled` (default `false`)
- `httpUrl` (default `http://127.0.0.1:8080`)
- `account` (optional E.164 or UUID account identity)
- `dmPolicy` (`pairing`, `allowlist`, `open`, `disabled`; default `pairing`)
- `allowFrom` (sender allowlist; include `"*"` for open DM mode)
- `groupPolicy` (`open`, `allowlist`, `disabled`; default `allowlist`)
- `groupAllowFrom` (group sender allowlist; falls back to `allowFrom`)
- `groups` (per-group overrides; supports `"*"` default)
- `mentionPatterns` (regex list for mention detection)
- `groupActivationDefault` (`mention` or `always`; default `mention`)
- `textChunkLimit` / `chunkMode` (`length` or `newline`)
- `pairing.ttlMs` / `pairing.maxPending`

Memory mode environment variables:

- `WAFFLEBOT_MEMORY_ENABLED` (default `true`)
- `WAFFLEBOT_MEMORY_WORKSPACE_DIR` (default `./data/workspace`)
- `WAFFLEBOT_MEMORY_EMBED_PROVIDER` (`ollama` or `none`, default `ollama`)
- `WAFFLEBOT_MEMORY_EMBED_MODEL` (default `qwen3-embedding:4b`)
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

Signal channel API endpoints:

- `GET /api/channels/signal/status`
- `GET /api/channels/signal/pairing`
- `POST /api/channels/signal/pairing/approve`
- `POST /api/channels/signal/pairing/reject`

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

- Save target is `<workspace>/.opencode/opencode.jsonc`.
- OpenCode also loads `.opencode/agent/*.md` and `.opencode/agents/*.md`; deleting an agent in Wafflebot removes matching files as well.
- Agents UI shows `Saving to` and `Bound directory` so you can verify which workspace is authoritative.

## Workspace Bootstrap Context (OpenClaw-style)

Wafflebot now injects workspace markdown context into runtime system prompts using OpenClaw-style files from your bound workspace root (not `.opencode/`):

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `MEMORY.md` / `memory.md`

Behavior:

- Per-file and total prompt injection caps are configurable at `runtime.opencode.bootstrap`.
- If a selected OpenCode agent is `mode: "subagent"` and `runtime.opencode.bootstrap.subagentMinimal=true`, only `AGENTS.md` and `TOOLS.md` are injected.
- `IDENTITY.md` is parsed for metadata (name/emoji/avatar/theme/creature/vibe) and returned via `GET /api/runtime/info`.
- Selected agent prompt text can also be mirrored into runtime system prompts with `runtime.opencode.bootstrap.includeAgentPrompt=true`.

OpenClaw import helpers:

- `POST /api/config/opencode/bootstrap/import-openclaw/preview`
  - Body:
    - Local source: `{ "source": { "mode": "local", "path": "/path/to/openclaw/workspace" } }`
    - Git source: `{ "source": { "mode": "git", "url": "git@github.com:you/openclaw-memory.git", "ref": "main" } }`
  - Response includes `previewId`, discovered files, and conflict/new/identical breakdown.
- `POST /api/config/opencode/bootstrap/import-openclaw/apply`
  - Body: `{ "previewId": "<id-from-preview>", "overwritePaths": ["AGENTS.md","memory/notes.md"], "runMemorySync": true }`
  - Applies selected conflicts/new files and runs memory sync by default.

CLI:

- `wafflebot import openclaw preview --path /path/to/openclaw/workspace`
- `wafflebot import openclaw preview --git git@github.com:you/openclaw-memory.git --ref main`
- `wafflebot import openclaw apply --preview-id <id> --overwrite AGENTS.md --overwrite memory/notes.md`

Legacy compatibility helper remains available:

- `POST /api/config/opencode/bootstrap/import-openclaw`
- Body: `{ "sourceDirectory": "/path/to/openclaw/workspace", "overwrite": false, "files": ["AGENTS.md","SOUL.md","IDENTITY.md"] }`

If OpenCode UI/TUI looks different from Wafflebot:

1. Confirm `GET /api/runtime/info` reports the directory you expect.
2. Launch/attach OpenCode against the same workspace directory.
3. Verify the same `.opencode/opencode.jsonc` file path is being used.

## Deployment

Recommended production topology is **single VM + systemd sidecar**:

- `opencode.service` running on `127.0.0.1:4096`
- `wafflebot.service` running on `127.0.0.1:3001`
- both pinned to one workspace path via `runtime.opencode.directory` in wafflebot config

Deployment artifacts:

- `deploy/systemd/opencode.service`
- `deploy/systemd/wafflebot.service`
- `deploy/systemd/README.md`
- `deploy/docker-compose.yml` (reference stack)

## CI/CD Release Bundles

This repo uses one CI/CD workflow:

- `.github/workflows/ci.yml` runs lint/typecheck/build, then publishes the same packed artifact to your npm-compatible package registry.
- Pull requests run checks only (no publish).
- `main` pushes auto-increment patch version from the currently published stable version (`0.0.1` -> `0.0.2` -> `0.0.3`) and publish with npm tag `latest`.
- Pushes to matching `v*` tags publish the exact `package.json` version with npm tag `latest`.
- Manual dispatch publishes `package.json` version with npm tag `latest`.
- Tag pushes must match `v<package.json version>` or CI fails.

Published package artifact:

- `@<scope>/wafflebot@<version>` generated from a single packed `.tgz` built in CI after lint/typecheck/build.

Detailed install instructions are in `deploy/RELEASE_INSTALL.md`.

## Linux Onboarding (Private Gitea)

Primary path (interactive by default):

```bash
curl -fsSL "https://git.waffleophagus.com/waffleophagus/wafflebot/raw/branch/main/scripts/onboard/bootstrap.sh" | bash
```

Run a different lifecycle command:

```bash
curl -fsSL "https://git.waffleophagus.com/waffleophagus/wafflebot/raw/branch/main/scripts/onboard/bootstrap.sh" | bash -s -- status
```

Direct package execution from private registry:

```bash
npx --yes --registry "https://git.waffleophagus.com/api/packages/waffleophagus/npm/" \
  "@waffleophagus/wafflebot-installer@latest" install
```

```bash
bunx --bun npm exec --yes --registry "https://git.waffleophagus.com/api/packages/waffleophagus/npm/" \
  "@waffleophagus/wafflebot-installer@latest" -- install
```

Wafflebot commands:

```bash
wafflebot install
wafflebot update
wafflebot onboard
wafflebot status
wafflebot restart
wafflebot start
wafflebot stop
wafflebot uninstall
```

`wafflebot install` and `wafflebot update` now show a mode-specific action plan before confirmation.

- `install` flow now launches interactive provider/model onboarding immediately (interactive installs).
- `update` plan explicitly calls out what is refreshed vs what is preserved (data/workspace/config are not reset).
- `update --dry-run` previews planned update actions without mutating files/services.
- `onboard` reruns interactive provider/model onboarding without reinstalling.
- Install/update now also maintain an `opencode` shim in `~/.local/bin` so the OpenCode CLI is directly available.
- Onboarding model selection is searchable + paginated (works with providers that expose large model catalogs).
- During onboarding, provider-auth changes trigger a transparent `opencode.service` refresh before model selection, so newly added providers/models show up immediately.

Compatibility alias remains available:

```bash
wafflebot-installer install
```

Default install root is `~/.wafflebot`, with systemd **user** services:

- `opencode.service` (local sidecar on `127.0.0.1:4096`)
- `wafflebot.service` (dashboard/API on `127.0.0.1:3001`)

On Linux, installer attempts `loginctl enable-linger $USER` so services keep running after logout.

## Install Directly From GitHub (No npmjs.org)

You can still install the main CLI directly from git:

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
