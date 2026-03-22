# Executor Integration Plan

## Status

This document proposes how to integrate `executor` into Agent Mockingbird with the same basic release discipline we use for OpenCode:

- pin to a specific upstream release per Agent Mockingbird release
- keep local changes as a small exported patch stack
- deploy it as a sidecar, not as part of the agent workspace

Current non-goal:

- do not support the old Docker Compose deployment for this work
- `deploy/docker-compose.yml` is considered stale and should be removed rather than updated

Current implementation checkpoint:

- Slice 1 is complete:
  - executor vendor workflow exists
  - executor runtime config exists
  - executor systemd sidecar management exists
  - OpenCode is wired to executor as its single MCP server entry
- Slice 2 is complete:
  - executor supports serving under `/executor`
  - Mockingbird proxies `/executor` to the executor sidecar
  - the patched OpenCode shell has an `Executor` sidebar entry
- Current known gap:
  - local development ergonomics are not finished
  - `dev:stack` has not been updated to launch executor
  - repo-based install testing should use the local checkout build outputs rather than assuming the published npm package is fully self-contained

## Goals

1. Run `executor` on the deployed machine, but outside the OpenCode agent workspace.
2. Use `executor` as the system that owns external tool and MCP source connections.
3. Preserve Agent Mockingbird's ability to create recurring jobs and local skills on demand.
4. Surface `executor` UI inside the OpenCode-based Mockingbird UI without requiring it to own `/assets` at the root.

## Constraints And Current State

### Existing Mockingbird model

Agent Mockingbird currently assumes one pinned workspace, and OpenCode is aligned to that same workspace path. The current resolver makes that explicit.

- [resolve.ts](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/apps/server/src/backend/workspace/resolve.ts#L11)

Mockingbird also serves the patched OpenCode app at the site root and proxies selected OpenCode runtime routes as same-origin requests.

- [index.ts](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/apps/server/src/index.ts#L17)
- [index.ts](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/apps/server/src/index.ts#L72)
- [index.ts](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/apps/server/src/index.ts#L86)

The existing OpenCode UI integration pattern is:

- add Mockingbird-specific nav entry points in the vendored OpenCode app
- route those entry points to same-origin paths
- fetch data from Mockingbird APIs with a small frontend helper

Relevant examples:

- [layout.tsx](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/vendor/opencode/packages/app/src/pages/layout.tsx#L2215)
- [mockingbird.ts](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/vendor/opencode/packages/app/src/utils/mockingbird.ts#L22)
- [0004-Add-heartbeat-settings-and-usage-nav.patch](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/patches/opencode/0004-Add-heartbeat-settings-and-usage-nav.patch)

### Existing Mockingbird scheduler and skill model

Agent Mockingbird already has the pieces needed for "check this every 20 minutes":

- cron jobs as a first-class runtime feature
- workspace-local skills under `.agents/skills`
- runtime guidance that tells the agent to use those tools and skills

Relevant references:

- [agent-mockingbird.ts](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/runtime-assets/opencode-config/plugins/agent-mockingbird.ts#L498)
- [AGENTS.md](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/runtime-assets/workspace/AGENTS.md#L17)

### Executor model

`executor` already wants to be a separate local daemon with:

- its own API server
- its own UI
- its own MCP endpoint
- its own `workspaceRoot`
- its own local control-plane state

Relevant references:

- [server index](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/vendor/executor/packages/platform/server/src/index.ts#L77)
- [credentials-and-auth](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/vendor/executor/apps/docs/developer/credentials-and-auth.mdx#L62)
- [opencode.json](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/vendor/executor/opencode.json#L1)

That is a good fit for sidecar deployment and for keeping secrets out of the agent workspace.

### Asset collision

The attempted co-install collision makes sense. Both applications assume root-oriented static serving. Executor's server serves UI assets directly from the request pathname and its Vite config does not currently declare a non-root base path.

- [executor server static handling](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/vendor/executor/packages/platform/server/src/index.ts#L262)
- [executor vite config](/var/home/matt/Documents/random-vibecoded-stuff/wafflebot/vendor/executor/apps/web/vite.config.ts#L26)

This means "just put both apps under one shared `/assets` root" is not a safe plan.

## Recommended Architecture

### 1. Deploy executor as a third sidecar

Run three logical processes per deployment:

- Agent Mockingbird API/dashboard
- OpenCode runtime
- Executor daemon

Executor should not run inside the OpenCode workspace.

Recommended v1 layout:

- Mockingbird workspace: `~/.agent-mockingbird/workspace`
- Executor workspace: `~/.agent-mockingbird/executor-workspace`
- Executor local data: `~/.agent-mockingbird/data/executor` or similar

This satisfies the current v1 isolation requirement because the agent starts inside the Mockingbird workspace and needs explicit permission to operate outside it.

### 2. Use executor as the external tool hub

OpenCode should connect to `executor` through a single MCP server entry, instead of directly owning the growing set of MCP/OpenAPI/GraphQL integrations.

That makes `executor` the control plane for:

- external MCP servers
- imported OpenAPI APIs
- imported GraphQL APIs
- associated credentials and OAuth flows

OpenCode remains the coding/runtime host, but external tool connectivity is delegated to executor.

### 3. Keep recurring jobs and skill activation in Mockingbird

For requests like "check this stock price every 20 minutes":

1. the agent creates or updates a local skill in `.agents/skills`
2. the agent creates or updates a Mockingbird cron job
3. that skill or cron flow calls a tool exposed through executor

This split is intentional:

- `executor` owns source connection, auth, and typed tool access
- Mockingbird owns recurring orchestration, job history, local memory, and skill files

This is a better fit than trying to make executor become the scheduler in v1.

### 4. Surface executor UI inside the existing OpenCode-based shell

Use the same broad pattern as the current Usage integration:

- add a new Agent Mockingbird nav entry in the patched OpenCode shell
- point it at a same-origin Mockingbird route such as `/executor`
- have Mockingbird proxy that route to the executor sidecar

Recommended route design:

- `/executor` -> executor UI root
- `/executor/assets/*` -> executor static assets
- `/executor/v1/*` -> executor API
- `/executor/mcp` -> executor MCP endpoint if needed for browser-visible flows

This avoids root `/assets` conflicts and keeps the user experience inside the existing shell.

## Required Changes

### A. Add executor vendor workflow

Mirror the OpenCode release workflow.

Add:

- `executor.lock.json`
- `cleanroom/executor`
- `vendor/executor`
- `patches/executor/*.patch`
- `scripts/executor-sync.ts`
- `docs/vendor-executor.md`

Expected workflow:

1. `bun run executor:sync --rebuild-only`
2. edit `vendor/executor`
3. commit changes in the `vendor/executor` worktree branch
4. `bun run executor:sync --export-patches`
5. run ship validation

This keeps executor upgrades disciplined and reproducible.

### B. Add executor runtime config to Mockingbird

Mockingbird should gain explicit config for executor, similar in spirit to the current OpenCode runtime config.

Minimum fields:

- `runtime.executor.enabled`
- `runtime.executor.baseUrl`
- `runtime.executor.workspaceDir`
- `runtime.executor.dataDir`
- `runtime.executor.uiMountPath`

Default intent:

- enabled in deployed installs
- local-only bind, for example `127.0.0.1:8788`
- workspace outside `~/.agent-mockingbird/workspace`
- mount path `/executor`

### C. Add executor process management

Whichever service manager is current should start and monitor executor as a first-class sidecar.

For now, this means:

- do not update `deploy/docker-compose.yml`
- add systemd or equivalent deployment support only in the current supported path
- document executor health checks and restart behavior

### D. Patch executor for base-path-aware serving

To embed executor cleanly inside Mockingbird's same-origin shell, we should carry a small vendored patch that adds configurable base-path support.

Desired capabilities:

- build assets for a mount path such as `/executor/`
- serve index and static assets under that prefix
- serve API and MCP routes under that prefix when proxied
- avoid hard dependency on root `/assets`

Likely patch areas:

- `vendor/executor/apps/web/vite.config.ts`
- `vendor/executor/packages/platform/server/src/index.ts`
- any frontend router/base helpers in `vendor/executor/apps/web/src`

If keeping a same-origin embed proves awkward early on, a temporary fallback is:

- leave executor on its own port
- add a nav item that opens the external/local executor URL

That fallback is acceptable during development, but not the preferred shipped UX.

### E. Add Mockingbird proxy routes for executor

Mockingbird should proxy executor similarly to how it already proxies OpenCode runtime routes, but under a dedicated prefix.

Suggested responsibilities:

- strip `/executor` prefix before forwarding
- preserve streaming responses where needed
- support HTML, JS, CSS, fonts, and API calls
- keep same-origin browser behavior for executor auth and UI flows

### F. Add OpenCode UI entry points

Carry a small OpenCode patch that adds an Agent Mockingbird sidebar item for executor management, following the same approach used for Usage and Settings.

The new entry should:

- appear in the Agent Mockingbird section of the sidebar
- navigate to `/executor`
- reuse the same shell-level discoverability pattern as Usage

## Security And Isolation Notes

### v1

v1 isolation is path separation, not hard sandbox isolation.

That means:

- OpenCode agent workspace stays in `~/.agent-mockingbird/workspace`
- executor state and workspace live elsewhere
- the agent does not automatically start inside executor's workspace

This is acceptable for MVP because the agent already needs permission to go outside its workspace.

### Later hardening

Future work could strengthen this by:

- storing executor data under a directory unreadable by the OpenCode user
- placing executor behind an internal auth or capability gate for sensitive operations
- reducing or removing direct agent visibility into executor-managed secret material entirely
- Sandboxing the opencode execution area.

## Release Strategy

Per Agent Mockingbird release:

1. pin exact OpenCode version
2. pin exact executor version
3. export both patch stacks
4. validate that the shipped deployment wiring targets the pinned sidecars

For executor upgrades:

1. update `executor.lock.json` to an upstream tag and commit through `executor:sync --ref`
2. rebuild vendor tree
3. reapply tracked patches
4. validate base-path serving, MCP connectivity, and UI embedding

## Rollout Phases

### Phase 1: foundation

- add executor lock + sync workflow
- define Mockingbird executor config
- add supported service-management wiring
- run executor outside the agent workspace
- connect OpenCode to executor MCP

Outcome:

- executor is deployed, pinned, and reachable
- OpenCode can use executor-managed tools
- no same-origin UI embed yet required

### Phase 2: same-origin UI integration

- patch executor for base-path support
- add Mockingbird reverse proxy routes under `/executor`
- add OpenCode nav entry for executor

Outcome:

- executor UI is surfaced inside the existing OpenCode-based shell
- no `/assets` collision

### Phase 3: agent-authored tooling workflows

- add agent guidance for when to prefer executor-managed tool creation
- make stock-check and similar recurring tasks use Mockingbird cron plus executor tools
- optionally add helper APIs or templates for creating local skills that call executor-backed tools

Outcome:

- the agent can operationalize recurring jobs with better tool hygiene

## Proposed First Implementation Slice

The best first slice is:

1. add `docs/vendor-executor.md` and the executor sync workflow
2. add executor runtime config to Mockingbird
3. deploy executor outside the main workspace
4. register executor as a single MCP endpoint for OpenCode

Then build the UI embed as the next slice.

That order gives immediate value without blocking on the trickiest frontend/path-prefix work.

## Decisions Captured

- one executor workspace per deployment is enough for now
- executor workspace must be clearly outside `~/.agent-mockingbird/workspace`
- same-origin UI integration is desired
- same-origin integration does not need to live at root
- stale Docker Compose deployment should not be carried forward and can be safely deleted for now.
