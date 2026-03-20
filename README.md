# agent-mockingbird

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

Canonical install flow for end users on Linux:

```bash
npx --yes \
  --package "@waffleophagus/agent-mockingbird-installer@latest" \
  agent-mockingbird-installer install
```

That command installs the packaged CLI `agent-mockingbird` from npm, installs and starts the `opencode` and `agent-mockingbird` user services, and then launches the interactive onboarding wizard on TTY installs.

Local development installs a git `pre-commit` hook automatically via `core.hooksPath=.githooks`. The hook runs:

```bash
bun run build:cli
bun run lint
bun run typecheck
bun run build
bun run build:bin
```

and builds local output into `dist/app` plus the tracked CLI shim.

Run agent-mockingbird + OpenCode together for smoke testing:

```bash
bun run dev:stack
```

`dev:stack` now builds the bundled app, starts the local OpenCode sidecar on `127.0.0.1:4096`, and starts the Agent Mockingbird server in one command. `bun run dev:opencode` is also available if you want to run the sidecar separately.

Production build and run:

```bash
bun run build
./dist/agent-mockingbird
```

Code quality:

```bash
bun run test
bun run lint
bun run typecheck
bun run check:ship
```

`bun run test` is intentionally scoped to `src` so local `opencode/` clone tests are not included.

`bun run check:ship` is the full ship-readiness gate. It bootstraps `vendor/opencode` if needed, verifies the OpenCode patch stack is reproducible, runs the repo lint/typecheck/build checks, checks generated artifacts, and compares full OpenCode workspace typecheck results against cleanroom so upstream-only baseline failures can be ignored.

OpenCode workflow:

```bash
bun run opencode:sync --status
bun run opencode:sync --rebuild-only
bun run opencode:sync --check
```

The repo now treats `cleanroom/opencode` as a pristine upstream clone, `vendor/opencode` as a generated editable worktree, and `patches/opencode/*.patch` as the tracked patch stack. If `vendor/opencode` is missing, run `bun run opencode:sync --rebuild-only` before local build/dev commands that need OpenCode sources.

Database migrations (Drizzle + SQLite):

```bash
bun run db:generate
bun run db:migrate
bun run db:check
```

By default the SQLite file is `./data/agent-mockingbird.db`. Override with `AGENT_MOCKINGBIRD_DB_PATH`.

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

`memory:trace:e2e` auto-selects a model from existing sessions (prefers `main`). Override with `AGENT_MOCKINGBIRD_E2E_MODEL=provider/model`.

Memory operator references:

- `docs/memory-ops.md`
- `docs/memory-runtime-contract.md`
- `runtime-assets/workspace/.agents/skills/memory-ops/SKILL.md` (runtime bundle source)
- `.agents/skills/memory-ops/SKILL.md` (development copy)

## Runtime

Agent Mockingbird runs with an OpenCode-backed runtime that forwards prompts to OpenCode and stores mirrored messages locally.

Runtime configuration is stored in JSON (`./data/agent-mockingbird.config.json` by default). On first boot, agent-mockingbird migrates legacy env/DB runtime settings into this file.
Example config template: `agent-mockingbird.config.example.json`.
`./config.json` at repo root is OpenCode config, not agent-mockingbird runtime config.
Runtime behavior is sourced from agent-mockingbird config JSON. OpenCode runtime env vars are no longer accepted for model/provider/timeouts/directory.
If you still have legacy `AGENT_MOCKINGBIRD_OPENCODE_*` runtime vars, run `bun run config:migrate-opencode-env` once, then unset them.

Skill deployment behavior (install/update):

- Runtime bundle source files live in `runtime-assets/workspace` and `runtime-assets/opencode-config`.
- Install/update syncs workspace files into the active workspace root, and syncs OpenCode managed config into an external config dir under `data/opencode-config/...`.
- Sync state is tracked separately in `data/runtime-assets-workspace-state.json` and `data/runtime-assets-opencode-config-state.json`.
- On update, interactive installs prompt only when both:
  - local file changed since last sync
  - packaged runtime asset also changed since last sync
- On non-interactive update conflicts, install creates `<file>.backup-<UTCSTAMP>` then overwrites with packaged content.
- Runtime OpenCode `skills.paths` is synced to include workspace `.agents/skills`.
- If `ui.skills` is empty, install/update initializes defaults:
  - `config-editor`
  - `config-auditor`
  - `runtime-diagnose`
  - `memory-ops`
- Install/update also seeds managed OpenCode config at `data/opencode-config/<fingerprint>/opencode.jsonc` from `runtime-assets/opencode-config`:
  - default `agent.general.tools` enables `memory_search`, `memory_get`, and `memory_remember`.

Config API:

- `GET /api/config`
- `PATCH /api/config` (partial update with optimistic `expectedHash`)
- `PUT /api/config` (full replace with optimistic `expectedHash`)
- `GET /api/runtime/info` (effective OpenCode connection + directory/config persistence metadata)

After every config change, agent-mockingbird performs:

- schema validation
- semantic provider/model validation via OpenCode `config/providers`
- gateway smoke test prompt (expects an `OK` response pattern)

If any validation step fails, the config change is not persisted.

Auth and path env variables:

- `AGENT_MOCKINGBIRD_DB_PATH` (default `./data/agent-mockingbird.db`)
- `AGENT_MOCKINGBIRD_CONFIG_PATH` (default `./data/agent-mockingbird.config.json`)
- `AGENT_MOCKINGBIRD_OPENCODE_AUTH_HEADER` (optional full `Authorization` header)
- `AGENT_MOCKINGBIRD_OPENCODE_USERNAME` / `AGENT_MOCKINGBIRD_OPENCODE_PASSWORD` (optional Basic auth fallback)

Cron environment variables:

- `AGENT_MOCKINGBIRD_CRON_ENABLED` (default `true`)
- `AGENT_MOCKINGBIRD_CRON_SCHEDULER_POLL_MS` (default `1000`)
- `AGENT_MOCKINGBIRD_CRON_WORKER_POLL_MS` (default `1000`)
- `AGENT_MOCKINGBIRD_CRON_LEASE_MS` (default `30000`)
- `AGENT_MOCKINGBIRD_CRON_MAX_ENQUEUE_PER_JOB_TICK` (default `25`)

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

- `AGENT_MOCKINGBIRD_MEMORY_ENABLED` (default `true`)
- `AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR` (default `./data/workspace`)
- `AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER` (`ollama` or `none`, default `ollama`)
- `AGENT_MOCKINGBIRD_MEMORY_EMBED_MODEL` (default `qwen3-embedding:4b`)
- `AGENT_MOCKINGBIRD_MEMORY_OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`)
- `AGENT_MOCKINGBIRD_MEMORY_CHUNK_TOKENS` (default `400`)
- `AGENT_MOCKINGBIRD_MEMORY_CHUNK_OVERLAP` (default `80`)
- `AGENT_MOCKINGBIRD_MEMORY_MAX_RESULTS` (default `6`)
- `AGENT_MOCKINGBIRD_MEMORY_MIN_SCORE` (default `0.25`)
- `AGENT_MOCKINGBIRD_MEMORY_SYNC_COOLDOWN_MS` (default `10000`)
- `AGENT_MOCKINGBIRD_MEMORY_TOOL_MODE` (`hybrid`, `inject_only`, `tool_only`; default `hybrid`)
- `AGENT_MOCKINGBIRD_MEMORY_INJECTION_DEDUPE_ENABLED` (default `true`)
- `AGENT_MOCKINGBIRD_MEMORY_INJECTION_DEDUPE_FALLBACK_RECALL_ONLY` (default `true`)
- `AGENT_MOCKINGBIRD_MEMORY_INJECTION_DEDUPE_MAX_TRACKED` (default `256`)

OpenCode local Agent Mockingbird plugin:

- `data/opencode-config/<fingerprint>/plugins/agent-mockingbird.ts`

The plugin registers these custom tools against Agent Mockingbird APIs:

- `memory_search`
- `memory_get`
- `memory_remember`
- `cron_manager`
- `config_manager`
- `agent_type_manager`

Set `AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL`, `AGENT_MOCKINGBIRD_CRON_API_BASE_URL`, and/or `AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL` for the OpenCode process if needed (default `http://127.0.0.1:3001`).

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

- `GET /api/mockingbird/cron/health`
- `GET /api/mockingbird/cron/jobs`
- `POST /api/mockingbird/cron/jobs`
- `GET /api/mockingbird/cron/jobs/:id`
- `PATCH /api/mockingbird/cron/jobs/:id`
- `DELETE /api/mockingbird/cron/jobs/:id`
- `POST /api/mockingbird/cron/jobs/:id/run`
- `GET /api/mockingbird/cron/instances`
- `GET /api/mockingbird/cron/instances/:id/steps`
- `POST /api/mockingbird/cron/manage` (used by `cron_manager` and `describe_contract`)

Cron jobs no longer support `handlerKey`; use the current `runMode` contract with `conditionModulePath` and/or `agentPromptTemplate` instead.

Environment variables are parsed and validated at startup via `@t3-oss/env-core` + `zod`.

`bun run dev:stack` launcher env knobs:

- `OPENCODE_HOST` (default `127.0.0.1`)
- `OPENCODE_PORT` (default `4096`)
- `AGENT_MOCKINGBIRD_PORT` (default `3001`)
- `OPENCODE_LOG_LEVEL` (default `INFO`)

## OpenCode Agent Persistence

Agent Mockingbird now manages OpenCode agents directly in an external managed OpenCode config dir.

- Save target is `data/opencode-config/<fingerprint>/opencode.jsonc` by default.
- Managed agent markdown files live under that external config dir as well.
- Agents UI shows both the bound workspace and the effective config path.

## Workspace Bootstrap Context (OpenClaw-style)

Agent Mockingbird now injects workspace markdown context into runtime system prompts using OpenClaw-style files from your bound workspace root (not `.opencode/`):

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

- `POST /api/config/opencode/bootstrap/import-openclaw`
  - Body:
    - Local source: `{ "source": { "mode": "local", "path": "/path/to/openclaw/workspace" } }`
    - Git source: `{ "source": { "mode": "git", "url": "git@github.com:you/openclaw-memory.git", "ref": "main" } }`
  - Optional: `targetDirectory`
  - Performs one-shot migration with conflict rules:
    - Missing target path: copy source file wholesale.
    - Existing target path: keep target by default.
    - `AGENTS.md` conflicts: attempt model-assisted rewrite/merge; if unavailable/invalid, keep target.
    - Compatibility bridge: if source has no `AGENTS.md` but has `CLAUDE.md`, importer maps `CLAUDE.md -> AGENTS.md` during migration.
  - Preserves protected Agent Mockingbird runtime files and triggers a memory index sync after import.

CLI migration UX is now integrated into `agent-mockingbird onboard`:

- Choose onboarding path: `quickstart`, `model-only`, `memory-only`, `openclaw-only`, or `skip`.
- OpenClaw migration runs through an onboarding wizard (git clone or local folder source).
- `AGENTS.md` conflicts go through a model-assisted rewrite/merge pass via OpenCode; on failure, existing target content is kept.
- If memory is enabled, onboarding runs memory sync after successful migration.
- Legacy `agent-mockingbird import openclaw ...` commands are removed.

If OpenCode UI/TUI looks different from Agent Mockingbird:

1. Confirm `GET /api/runtime/info` reports the directory you expect.
2. Launch/attach OpenCode against the same workspace directory.
3. Verify the same external `opencode.jsonc` file path is being used.

## Deployment

Recommended production topology is **single VM + systemd sidecar**:

- `opencode.service` running on `127.0.0.1:4096`
- `agent-mockingbird.service` running on `127.0.0.1:3001`
- both pinned to one workspace path via `runtime.opencode.directory` in agent-mockingbird config
- `runtime.memory.workspaceDir` must resolve to the same path as `runtime.opencode.directory`

Deployment artifacts:

- `deploy/systemd/opencode.service`
- `deploy/systemd/agent-mockingbird.service`
- `deploy/systemd/README.md`
- `deploy/docker-compose.yml` (reference stack)

## CI/CD Release Bundles

This repo uses one CI/CD workflow:

- `.github/workflows/ci.yml` runs `bun run check:ship`, verifies the committed ship artifacts, and publishes the same packed artifact to npm from GitHub Actions.
- Pull requests run checks only (no publish).
- Pushes to `main` run checks only. `latest` is reserved for versioned releases.
- Pushes to matching `v*` tags publish the exact `package.json` version with npm tag `latest`.
- Pushes to non-`main` branches by `waffleophagus` publish preview builds to npm tag `next`.
- Manual dispatch runs the workflow but does not publish by itself.
- Tag pushes must match `v<package.json version>` or CI fails.

Published package artifact:

- `agent-mockingbird@<version>` generated from a single packed `.tgz` built in CI after `bun run check:ship`.
- `@waffleophagus/agent-mockingbird-installer@<version>` published alongside it.

Detailed install instructions are in `deploy/RELEASE_INSTALL.md`.

## Linux Onboarding (GitHub + npm)

Primary path (interactive by default):

```bash
curl -fsSL "https://raw.githubusercontent.com/waffleophagus/agent-mockingbird/main/scripts/onboard/bootstrap.sh" | bash
```

Run a different lifecycle command:

```bash
curl -fsSL "https://raw.githubusercontent.com/waffleophagus/agent-mockingbird/main/scripts/onboard/bootstrap.sh" | bash -s -- status
```

Install from a feature branch preview:

```bash
BRANCH="<branch-name>"
VERSION="<published-preview-version>"
AGENT_MOCKINGBIRD_TAG="${VERSION}" \
  curl -fsSL "https://raw.githubusercontent.com/waffleophagus/agent-mockingbird/${BRANCH}/scripts/onboard/bootstrap.sh" | bash
```

Branch preview installs should pin `AGENT_MOCKINGBIRD_TAG` to the exact published `next` version so the bootstrap script and installed package stay aligned.

Direct package execution from npm:

```bash
npx --yes \
  --package "@waffleophagus/agent-mockingbird-installer@latest" \
  agent-mockingbird-installer install
```

```bash
bunx --bun npm exec --yes \
  --package "@waffleophagus/agent-mockingbird-installer@latest" \
  agent-mockingbird-installer -- install
```

Agent Mockingbird commands:

```bash
agent-mockingbird install
agent-mockingbird update
agent-mockingbird onboard
agent-mockingbird status
agent-mockingbird restart
agent-mockingbird start
agent-mockingbird stop
agent-mockingbird uninstall
```

`agent-mockingbird install` and `agent-mockingbird update` now show a mode-specific action plan before confirmation.

- `install` flow now launches interactive provider/model onboarding immediately (interactive installs).
- `update` plan explicitly calls out what is refreshed vs what is preserved (data/workspace/config are not reset).
- `update --dry-run` previews planned update actions without mutating files/services.
- `onboard` reruns interactive provider/model onboarding without reinstalling.
- Install/update now also maintain an `opencode` shim in `~/.local/bin` so the OpenCode CLI is directly available.
- Onboarding model selection is searchable + paginated (works with providers that expose large model catalogs).
- During onboarding, provider-auth changes trigger a transparent `opencode.service` refresh before model selection, so newly added providers/models show up immediately.
- Onboarding can now configure memory embeddings for Ollama: set the Ollama URL, discover `/api/tags` models live, then select an embedding model with searchable pagination.
- `agent-mockingbird onboard` supports `memory-only` and `openclaw-only` paths for focused setup.

Compatibility alias remains available:

```bash
agent-mockingbird-installer install
```

Default install root is `~/.agent-mockingbird`, with systemd **user** services:

- `opencode.service` (local sidecar on `127.0.0.1:4096`)
- `agent-mockingbird.service` (dashboard/API on `127.0.0.1:3001`)

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
agent-mockingbird
```

## Publish To Package Registry

`ci.yml` publish steps expect this repository secret:

- `NPM_TOKEN` with publish permission for `agent-mockingbird` and `@waffleophagus/agent-mockingbird-installer` on npmjs

On a tag push like `v0.1.0`, CI publishes `agent-mockingbird@0.1.0` and `@waffleophagus/agent-mockingbird-installer@0.1.0` to npm with the `latest` tag.

`main` pushes do not publish. To update `latest`, tag a version from `main`.

Non-`main` branch pushes by `waffleophagus` publish preview builds like `0.0.1-next.<branch>.<run-number>` with the `next` tag.

Install from npm with Bun:

```bash
bun add -g agent-mockingbird
agent-mockingbird
```

If you need to publish or consume the package from a non-default registry later, `AGENT_MOCKINGBIRD_REGISTRY_URL` and `--registry-url` still exist, but the repo now assumes npmjs by default.
