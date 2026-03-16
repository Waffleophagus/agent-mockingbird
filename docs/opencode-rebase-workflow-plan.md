# OpenCode Rebase Workflow Plan

## Goal

Replace the current "copy upstream into `vendor/opencode` and hand-edit it" workflow with a release-tag-pinned, rebasable OpenCode workflow that gives us all of the following at once:

- a pristine local upstream reference checkout
- a reliable way to carry Wafflebot patches forward onto newer OpenCode releases
- a generated shipped source tree instead of a permanently committed vendor tree
- a single source of truth for which OpenCode version we ship
- a pinned installed OpenCode CLI/sidecar version that matches the shipped UI version
- a path that will still work later if we start patching desktop packages in addition to the web UI

This is intentionally a breaking internal workflow change. That is acceptable for this repo.

## Current State

Observed repo facts at planning time:

- `vendor/opencode` is a committed source tree.
- `cleanroom/opencode` is a separate local clone, not tracked by the main repo.
- both local trees currently report `1.2.24` in their OpenCode package metadata
- upstream has newer release tags available through `v1.2.27`
- `bin/agent-mockingbird` currently installs `opencode-ai@latest`, which allows the installed sidecar version to drift away from the vendored UI version
- the repo currently tracks roughly 4,408 files under `vendor/opencode`
- the published package artifact already ships compiled outputs like `dist/app`, not the full vendored source tree
- the current helper docs/scripts are inconsistent and partially stale

This means the main problem is not packaging the final artifact. The problem is maintaining the source-of-truth workflow for upstream sync, local patches, and shipped-version alignment.

## Target Model

The target model is:

- `cleanroom/opencode`
  - local-only upstream reference clone
  - always pristine
  - managed by repo scripts
  - checked out to an exact release tag, not a moving branch
- `vendor/opencode`
  - generated local worktree for the shipped OpenCode source
  - gitignored by the main repo
  - backed by a real git branch/worktree so rebases are native git operations, not file copies
- `patches/opencode`
  - tracked serialized patch stack exported from the local OpenCode patch branch
  - exists so the workflow is portable across machines and fresh clones
- `opencode.lock.json`
  - tracked metadata file defining the shipped OpenCode version and workflow state
  - authoritative source for the upstream ref and pinned npm package version

The shipped application remains built from `vendor/opencode/packages/app`, but that tree is no longer committed to the repo.

## Decisions Already Made

- Track upstream by release tags, not by `origin/dev`.
- Use a git patch branch/worktree as the editing and rebase model.
- Move toward generated-on-demand `vendor/opencode` now, not later.
- Keep `cleanroom/opencode` as a local reference checkout, not a tracked repo artifact.
- Keep the current `vendor/opencode` path for compatibility so existing build code can be migrated with minimal churn.
- Treat desktop support as "workflow-ready but not fully productized in this pass". The patch system must work for desktop paths, but desktop packaging changes are not required unless needed by the current OpenCode patches.

## Non-Goals

- Do not split the repo into multiple publishable packages in this pass.
- Do not redesign the Agent Mockingbird runtime architecture.
- Do not try to support old vendor workflows in parallel after the cutover.
- Do not keep installing `opencode-ai@latest` after this is complete.

## Deliverables

The implementation is complete only when all of these exist and are wired up:

- a tracked `opencode.lock.json`
- a tracked `patches/opencode/` patch series
- a single scripted entrypoint for sync/rebase/rebuild/status
- a script-managed pristine `cleanroom/opencode`
- a script-managed generated `vendor/opencode`
- build/dev/package flows that no longer depend on a committed vendor tree
- installer/update flow pinned to the locked OpenCode version
- updated documentation replacing the stale vendor notes

## File and Interface Additions

### 1. `opencode.lock.json`

Add a new tracked lock file at repo root.

Recommended shape:

```json
{
  "upstream": {
    "remote": "https://github.com/anomalyco/opencode.git",
    "tag": "v1.2.27",
    "commit": "<resolved-commit>"
  },
  "packageVersion": "1.2.27",
  "paths": {
    "cleanroom": "cleanroom/opencode",
    "vendor": "vendor/opencode",
    "patches": "patches/opencode"
  },
  "branch": {
    "name": "wafflebot/opencode"
  }
}
```

Rules:

- `tag` is the human-facing upstream ref.
- `commit` is the exact resolved upstream commit for that tag.
- `packageVersion` is what the installer must use for `opencode-ai@<version>`.
- the lock file only updates after rebase/apply and validation succeed.

### 2. `patches/opencode/`

Add a tracked directory containing the serialized patch stack.

Recommended contents:

- `0001-...patch`
- `0002-...patch`
- etc
- optional `SERIES.md` or `series.json` if needed for metadata

Rules:

- export patches in a stable order from the patch branch relative to the locked upstream commit
- keep commits scoped and readable
- separate major areas when possible:
  - app UI
  - core/runtime integration
  - console/docs
  - desktop packages later if needed

### 3. Script entrypoint

Add a single user-facing Bun script, for example:

```json
"opencode:sync": "bun run ./scripts/opencode-sync.ts"
```

The script should support:

- `--status`
- `--ref <tag>`
- `--rebuild-only`
- `--export-patches`
- `--check`

The script can internally call helper modules, but there should be one primary operator command.

## Script Behavior

### `bun run opencode:sync --status`

Must print:

- lock file tag and commit
- cleanroom path and current HEAD
- whether cleanroom is pristine
- patch branch/worktree current HEAD
- whether `vendor/opencode` is clean, dirty, conflicted, or missing
- whether the exported patch series matches the patch branch

This command must not mutate anything.

### `bun run opencode:sync --rebuild-only`

Must:

- verify `opencode.lock.json`
- verify cleanroom exists and is pristine
- recreate or refresh `vendor/opencode` from the locked upstream commit
- reapply the tracked patch series or reset the worktree branch to the expected patch head
- stop before updating the lock file

This is the safe "make my local generated OpenCode tree exist again" command.

### `bun run opencode:sync --ref vX.Y.Z`

This is the full upgrade flow.

Required steps:

1. Validate preconditions.
2. Ensure the cleanroom clone exists.
3. Fetch the requested upstream tag.
4. Resolve the exact upstream commit.
5. Refuse to continue if cleanroom is dirty.
6. Refuse to continue if `vendor/opencode` contains uncommitted/unexported work that would be lost.
7. Move cleanroom to the target tag in a pristine state.
8. Rebase or recreate the patch branch onto the new upstream commit.
9. Stop loudly on merge conflict or failed patch apply.
10. Run OpenCode validation steps.
11. Export the patch series back into `patches/opencode/`.
12. Verify exported patches reproduce the same resulting tree.
13. Update `opencode.lock.json`.
14. Rebuild the shipped app assets.

The lock file must not change before step 10 succeeds.

### `bun run opencode:sync --export-patches`

Must:

- verify `vendor/opencode` exists as the OpenCode patch worktree
- verify worktree is clean
- export commits on top of the locked upstream commit into `patches/opencode`
- verify the export is reproducible

This is mainly for after making intentional OpenCode changes locally.

### `bun run opencode:sync --check`

Must run non-mutating verification suitable for CI:

- lock file is valid
- cleanroom/vendor path expectations are sane when materialized
- patch series applies cleanly to the locked upstream commit
- generated tree passes required validation

If the implementation is simpler, `--check` may internally materialize a temporary worktree rather than using the persistent local one.

## Daily Edit Workflow

This section defines the normal developer loop after the new workflow exists.

### Editing OpenCode locally

When the goal is "change OpenCode code we ship", the expected loop is:

1. Run `bun run opencode:sync --rebuild-only`.
2. Edit files inside `vendor/opencode`.
3. Run the relevant OpenCode-local validation.
4. Commit the changes in the `vendor/opencode` worktree on the OpenCode patch branch.
5. Run `bun run opencode:sync --export-patches`.
6. Rebuild the shipped app bundle if the change affects the shipped UI.

Important rules:

- `vendor/opencode` is the editable patch worktree.
- `cleanroom/opencode` is never edited directly.
- `patches/opencode/*.patch` are exported artifacts of commits on the patch branch.
- the normal flow is commit-first, not "edit files and let the script guess".

### What happens with uncommitted changes

If someone edits files in `vendor/opencode` and does not commit them:

- `bun run opencode:sync --status` must report the worktree as dirty
- `bun run opencode:sync --ref ...` must refuse to continue
- `bun run opencode:sync --export-patches` must refuse to continue

This prevents silent extraction, silent loss, or partially serialized state.

### What the patch files represent

The tracked patch files are not the primary authoring surface.

They represent:

- the serialized commit stack on top of the locked upstream commit
- the portable form used to reconstruct the patch branch/worktree on another machine or fresh clone

This means the real authoring model is:

- edit in `vendor/opencode`
- commit in the patch branch
- export the branch to patch files

## Git Topology

Use a real git-backed workflow instead of file copying.

Recommended shape:

- `cleanroom/opencode` is a normal git clone with `origin` set to upstream.
- `vendor/opencode` is a git worktree attached to a local branch in the cleanroom clone's object database.

Why:

- patch rebases are first-class git operations
- no more replacing directories with `cp -R`
- local history for OpenCode changes becomes inspectable
- object storage is shared instead of duplicated

Important invariant:

- `cleanroom/opencode` is never the patch worktree
- `cleanroom/opencode` must stay pristine so a diff between cleanroom and vendor represents our intentional changes

## Validation and Failure Gates

The workflow must fail loudly and early.

### Gate 1: cleanroom cleanliness

Fail if:

- `cleanroom/opencode` has tracked or untracked changes
- its current ref does not match the expected upstream ref after checkout/reset

Reason:

- cleanroom is meant to be the pristine upstream reference

### Gate 2: patch worktree safety

Fail if:

- `vendor/opencode` contains uncommitted changes
- the patch branch has commits that are not represented by the tracked patch series when attempting a ref move

Reason:

- avoid silently discarding local OpenCode work

### Gate 3: rebase/apply conflicts

Fail if:

- `git rebase` stops on conflict
- `git am` or equivalent patch apply fails

Required operator output:

- which commit/patch failed
- which files conflicted
- clear statement that the lock file was not updated

### Gate 4: OpenCode build/type validation

After a successful rebase/apply, run validation in `vendor/opencode`.

Minimum required validation:

- `bun install --cwd vendor/opencode`
- web app build
- targeted typecheck/tests for touched OpenCode packages when practical

The exact commands can be refined during implementation, but the script must fail non-zero if any validation step fails.

Reason:

- a clean rebase is not enough
- upstream type or runtime changes can still break our patch stack

### Gate 5: patch export reproducibility

After exporting `patches/opencode`, verify that applying the exported series onto the locked upstream commit yields the same resulting tree.

Fail if:

- export order is unstable
- local patch branch contains state not represented in the tracked series
- the reproduced tree does not match the current patch worktree

Reason:

- the tracked patch series must be portable and trustworthy

### Gate 6: lock update

Only after all previous gates are green:

- update `opencode.lock.json`
- update any docs that echo the pinned version if we choose to keep them

## One-Time Migration Plan

### Phase A: Add metadata and scripts

1. Add `opencode.lock.json` pinned to `v1.2.27`.
2. Add the new sync script and helper modules.
3. Add `patches/opencode/` directory.
4. Add ignore rules for generated OpenCode paths.

### Phase B: Capture current patch stack

1. Create a pristine upstream cleanroom checkout at the current baseline.
2. Recreate `vendor/opencode` as a git worktree.
3. Port the current Wafflebot changes from the committed vendor tree into the patch worktree.
4. Commit those changes as a readable stack rather than one giant blob if feasible.
5. Export that stack to `patches/opencode/`.

Important note:

- if splitting the existing vendor delta into multiple commits is too risky during migration, it is acceptable to land an initial single large baseline patch commit and improve patch granularity later
- correctness matters more than perfect history on day one

### Phase C: Remove committed vendor source

1. Remove `vendor/opencode` from git tracking.
2. Keep the path itself available locally as a generated worktree.
3. Update docs and scripts so `vendor/opencode` is understood as generated, not committed.

### Phase D: Rebase to `v1.2.27`

1. Run the full sync flow onto `v1.2.27`.
2. Resolve conflicts if any.
3. Rebuild the shipped web assets.
4. Update the pinned installer version.

## Build, Dev, and Packaging Changes

### Build

Current `build.ts` already builds from `vendor/opencode/packages/app`.

Keep that path, but change the contract:

- before: source tree is committed and expected to exist
- after: source tree is generated locally and expected to be materialized by the sync workflow

Implementation options:

- make `build.ts` fail with a clear message if `vendor/opencode` is missing
- optionally add a small "ensure materialized" helper before build/dev scripts

### Dev

Any dev flow that depends on the OpenCode source tree must either:

- require `bun run opencode:sync --rebuild-only` first
- or call a lightweight ensure step automatically

The error message must tell the operator exactly which command to run.

### Packaging

The npm package and release bundle should continue shipping:

- compiled `dist/app`
- standalone runtime binary
- runtime assets
- installer scripts

They should not depend on the OpenCode source tree being committed to git.

### CI

CI must evolve from "verify committed vendor-derived app bundle exists" to:

- materialize the generated OpenCode tree from lock + patch series
- build the app bundle
- verify packaged outputs

If we want to avoid larger CI churn immediately, an acceptable intermediate state is:

- keep verifying committed `dist/app`
- but stop assuming `vendor/opencode` itself is tracked

## Agent and Tooling Guidance

The implementation should include explicit agent-facing guidance so future coding agents can follow the workflow without rediscovering it.

### `AGENTS.md` changes

Add a short OpenCode workflow section to the repo `AGENTS.md`.

That section should state:

- do not edit `cleanroom/opencode`
- if the task requires changing shipped OpenCode code, materialize it with `bun run opencode:sync --rebuild-only`
- make OpenCode code changes only in `vendor/opencode`
- commit OpenCode changes in the patch worktree before exporting
- do not hand-edit `patches/opencode/*.patch` except for deliberate patch-series repair work
- use `bun run opencode:sync --export-patches` after committing OpenCode changes
- use `bun run opencode:sync --ref <tag>` for upstream bumps
- if the OpenCode worktree is dirty, do not attempt a ref bump or patch export

The AGENTS instructions should be short and behavioral, not a full re-explanation of the workflow.

### Agent-readable status output

The sync tooling should support a machine-readable status mode, for example:

- `bun run opencode:sync --status --json`

Recommended JSON payload:

- locked upstream tag and commit
- cleanroom path and cleanliness
- patch branch name and HEAD
- vendor worktree status
- whether exported patches match current branch state

This gives agents and scripts a reliable way to check whether they are allowed to proceed.

### Optional local skill

If we want a stronger agent experience, add a local skill such as:

- `.agents/skills/opencode-maintenance/SKILL.md`

The skill should contain:

- when to use the OpenCode workflow
- which command to run first
- what to edit and what not to edit
- how to export patches
- how to handle a dirty worktree
- how to bump upstream refs

This is optional, but recommended if OpenCode edits are going to be a recurring task.

### Minimum tooling contract for agents

At minimum, agents need:

- one command to materialize the editable OpenCode worktree
- one command to report current workflow state
- one command to export committed OpenCode changes
- one command to perform an upstream ref bump

Without those, the workflow remains too implicit and future agent edits will drift back into ad hoc vendor changes.

## Installer and Runtime Version Alignment

This is required. Do not leave the installer on `opencode-ai@latest`.

Change the installer/update flow so it installs:

- `opencode-ai@<packageVersion from opencode.lock.json>`

Reasons:

- the shipped UI version and sidecar version must match
- it removes silent drift
- it makes bug reports and upgrades reproducible

Acceptance rule:

- when the lock says `1.2.27`, install/update must install `opencode-ai@1.2.27`

## Documentation Changes

Update or replace:

- `docs/vendor-opencode.md`
- `vendor/OPENCODE_VENDOR.md`
- any README references to `scripts/pull-opencode.sh` or copy-based vendor sync

The docs after the change must explain:

- what cleanroom is
- what `vendor/opencode` is
- where the patch series lives
- which command to run for status, rebuild, and upgrade
- how to resolve conflicts

## Scripts That Need Review or Removal

At minimum, revisit:

- `scripts/vendor/sync-opencode.sh`
- `scripts/pull-opencode.sh`

The old copy-based sync scripts should either:

- be removed
- or become thin wrappers around the new workflow with updated behavior

Do not leave stale scripts around that still imply `cp -R` replacement is the supported model.

## Desktop Readiness

This pass does not need to ship desktop deliverables.

It does need to ensure that the patch model can handle future desktop edits without redesign:

- patch commits may touch `packages/desktop*`
- validation can remain web-focused for now unless desktop patches are active
- docs should note that desktop-specific validation can be added later as an additional gate

## Acceptance Criteria

The work is done when all of the following are true:

- `vendor/opencode` is no longer tracked by the main repo
- `cleanroom/opencode` is script-managed and pristine
- `bun run opencode:sync --status` reports valid workflow state
- `bun run opencode:sync --rebuild-only` can recreate the local shipped OpenCode tree
- `bun run opencode:sync --ref v1.2.27` works or fails loudly without partial lock updates
- `patches/opencode/` reproduces the shipped OpenCode tree from the locked upstream commit
- the installer pins `opencode-ai` to the locked version
- the app bundle still builds and packages successfully
- docs describe the new workflow instead of the old vendor-copy process

## Recommended Implementation Order

1. Add `opencode.lock.json`.
2. Add the new sync script skeleton with `--status`.
3. Add path/ignore changes for generated vendor and local cleanroom.
4. Create cleanroom clone bootstrap logic.
5. Create git worktree logic for `vendor/opencode`.
6. Export/import patch series support.
7. Port the current vendor delta into the new patch stack.
8. Remove tracked `vendor/opencode`.
9. Wire `build.ts` and developer flows to the generated tree contract.
10. Pin installer OpenCode version from the lock file.
11. Update docs and remove stale scripts.
12. Run full validation and package checks.

## Operator Notes for Future Me

- Expect the first migration to be the hardest part. Capturing the existing patch delta correctly matters more than perfect commit hygiene.
- If the existing delta is too large to split safely, take the initial baseline as one patch stack and improve granularity only after the workflow is working.
- The most important invariant is that the lock file is never advanced on a broken rebase.
- The second most important invariant is that `cleanroom/opencode` never becomes the place where local Wafflebot changes live.
- If this gets messy, favor correctness and repeatability over elegance. The whole point of this work is to stop having an opaque hand-maintained vendor tree.
