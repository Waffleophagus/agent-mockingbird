#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_DIR="${OPENCODE_WORKSPACE_DIR:-${ROOT_DIR}/apps/server/data/workspace}"
OPENCODE_HOST="${OPENCODE_HOST:-127.0.0.1}"
OPENCODE_PORT="${OPENCODE_PORT:-4096}"

mkdir -p "${WORKSPACE_DIR}"
cd "${WORKSPACE_DIR}"

exec bun run "${ROOT_DIR}/vendor/opencode/packages/opencode/src/index.ts" \
  serve \
  --hostname "${OPENCODE_HOST}" \
  --port "${OPENCODE_PORT}" \
  --print-logs \
  --log-level INFO
