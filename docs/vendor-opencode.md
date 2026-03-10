# Vendored OpenCode

- Upstream remote: `https://github.com/anomalyco/opencode`
- Current pinned commit: `6b9f8fb9b3ec48859c2db0c230d0cab69f6ae727`
- Vendored path: `vendor/opencode`

## Patch Policy

- Keep OpenCode chat/session behavior as close to upstream as possible.
- Put Agent Mockingbird-specific integration changes in the vendored fork only when they are required for:
  - same-origin local app serving
  - pinned single-workspace UI behavior
  - Agent Mockingbird settings tabs and API wiring
- Keep product-specific backend services in `apps/server` under `/api/waffle/*`.

## Update Procedure

1. Run `scripts/vendor/sync-opencode.sh <ref>` to refresh `vendor/opencode`.
2. Reapply or reconcile local Agent Mockingbird patches under `vendor/opencode`.
3. Run `bun run vendor:opencode:install`.
4. Run `bun run vendor:opencode:build`.
5. Run `bun run build` and `bun run typecheck`.
