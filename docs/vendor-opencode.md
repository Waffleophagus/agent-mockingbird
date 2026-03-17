# OpenCode Workflow

## Layout

- `opencode.lock.json` is the source of truth for the shipped OpenCode tag, commit, package version, local paths, and patch branch name.
- `cleanroom/opencode` is a local-only pristine upstream clone managed by `bun run opencode:sync`.
- `vendor/opencode` is a generated git worktree on the Wafflebot patch branch. It is editable, but it is not tracked by the main repo.
- `patches/opencode/*.patch` is the tracked serialized patch stack exported from the patch branch.

## Commands

- `bun run opencode:sync --status`
  - Show the locked version, cleanroom state, vendor worktree state, and whether the patch series matches the branch.
- `bun run opencode:sync --status --json`
  - Machine-readable version of the same state.
- `bun run opencode:sync --rebuild-only`
  - Recreate `vendor/opencode` from `opencode.lock.json` plus the tracked patches.
- `bun run opencode:sync --export-patches`
  - Export committed OpenCode changes from the patch branch back into `patches/opencode`.
- `bun run opencode:sync --ref vX.Y.Z`
  - Fetch a new upstream release tag, apply the tracked patch series, validate it, and update the lock only after success.
- `bun run opencode:sync --check`
  - CI-safe validation that reproduces the generated tree from the lock and patches in temporary state.
- `bun run check:ship`
  - Canonical ship gate. Bootstraps the generated vendor worktree if needed, requires a clean/exported patch state, runs `opencode:sync --check`, and compares full cleanroom vs vendor OpenCode typecheck results so upstream-only baseline failures do not fail the ship check.

## Edit Loop

1. Run `bun run opencode:sync --rebuild-only`.
2. Edit files in `vendor/opencode`.
3. Commit those changes inside the `vendor/opencode` worktree on branch `wafflebot/opencode`.
4. Run `bun run opencode:sync --export-patches`.
5. Run `bun run check:ship`.

## Rules

- Never edit `cleanroom/opencode` directly.
- Never hand-maintain a copied `vendor/opencode` tree.
- If `vendor/opencode` is dirty, do not run `--ref` or `--export-patches`.
- `bun run check:ship` only validates clean, exported vendor state. Dirty `vendor/opencode` is a hard failure.
- Treat `patches/opencode` as exported artifacts of the patch branch, not as the primary editing surface.
