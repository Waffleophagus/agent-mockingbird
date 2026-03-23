# Executor Workflow

## Layout

- `executor.lock.json` is the source of truth for the shipped executor tag, commit, package version, local paths, and patch branch name.
- `cleanroom/executor` is a local-only pristine upstream clone managed by `bun run executor:sync`.
- `vendor/executor` is a generated git worktree on the Agent Mockingbird patch branch. It is editable, but it is not tracked by the main repo.
- `patches/executor/*.patch` is the tracked serialized patch stack exported from the patch branch.

## Commands

- `bun run executor:sync --status`
  - Show the locked version, cleanroom state, vendor worktree state, and whether the patch series matches the branch.
- `bun run executor:sync --status --json`
  - Machine-readable version of the same state.
- `bun run executor:sync --rebuild-only`
  - Recreate `vendor/executor` from `executor.lock.json` plus the tracked patches.
- `bun run executor:sync --export-patches`
  - Export committed executor changes from the patch branch back into `patches/executor`.
- `bun run executor:sync --ref vX.Y.Z`
  - Fetch a new upstream release tag, apply the tracked patch series, validate it, and update the lock only after success.
- `bun run executor:sync --hard-ref vX.Y.Z`
  - Force-reset the vendor patch branch onto a new upstream tag before exporting patches again. Use this when the upgrade requires a manual patch rebase instead of a clean apply.
- `bun run executor:sync --check`
  - CI-safe validation that reproduces the generated tree from the lock and patches in temporary state.

## Edit Loop

1. Run `bun run executor:sync --rebuild-only`.
2. Edit files in `vendor/executor`.
3. Commit those changes inside the `vendor/executor` worktree on branch `agent-mockingbird/executor`.
4. Run `bun run executor:sync --export-patches`.
5. Run ship validation.

## Upgrade Loop

For a normal upstream bump:

1. Run `bun run executor:sync --status`.
2. Run `bun run executor:sync --ref vX.Y.Z`.
3. If patch application succeeds, review the result in `vendor/executor`.
4. Run `bun run executor:sync --check`.

If the patch stack needs a manual rebase:

1. Run `bun run executor:sync --hard-ref vX.Y.Z`.
2. Re-apply or rewrite the required changes in `vendor/executor`.
3. Commit those changes inside the `vendor/executor` worktree.
4. Run `bun run executor:sync --export-patches`.
5. Run `bun run executor:sync --check`.

## Rules

- Never edit `cleanroom/executor` directly.
- Never hand-maintain a copied `vendor/executor` tree.
- If `vendor/executor` is dirty, do not run `--ref` or `--export-patches`.
- `bun run check:ship` validates clean, exported vendor state for both OpenCode and Executor. Dirty `vendor/executor` is a hard failure.
- Treat `patches/executor` as exported artifacts of the patch branch, not as the primary editing surface.
