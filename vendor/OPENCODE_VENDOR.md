# OpenCode Vendor Notes

- Upstream remote: `https://github.com/anomalyco/opencode`
- Current pinned commit: `6b9f8fb9b3ec48859c2db0c230d0cab69f6ae727`
- Local patch policy:
  - Keep product-specific changes inside `vendor/opencode/**`.
  - Prefer patching app/server integration only.
  - Keep Wafflebot-only APIs and config ownership outside the vendor tree.
- Update procedure:
  1. Run `scripts/vendor/sync-opencode.sh [remote] [ref]`.
  2. Run `bun install --cwd vendor/opencode`.
  3. Re-apply or port Wafflebot patches inside `vendor/opencode`.
  4. Rebuild with `bun run build:app`.
