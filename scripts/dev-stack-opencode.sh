#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCODE_HOST="${OPENCODE_HOST:-127.0.0.1}"
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
OPENCODE_HEALTH_URL="http://${OPENCODE_HOST}:${OPENCODE_PORT}/global/health"
STARTUP_TIMEOUT_SECONDS="${OPENCODE_STARTUP_TIMEOUT_SECONDS:-30}"

cd "${ROOT_DIR}"

bun run build:app
concurrently -k -n opencode,server -c cyan,green \
  "bun run dev:opencode" \
  "bash -lc 'set -euo pipefail; echo \"[stack] waiting for OpenCode at ${OPENCODE_HEALTH_URL}\"; deadline=\$((SECONDS + ${STARTUP_TIMEOUT_SECONDS})); until curl -fsS \"${OPENCODE_HEALTH_URL}\" >/dev/null 2>&1; do if (( SECONDS >= deadline )); then echo \"[stack] timed out waiting for OpenCode health after ${STARTUP_TIMEOUT_SECONDS}s\"; exit 1; fi; sleep 0.25; done; echo \"[stack] OpenCode is healthy, starting Agent Mockingbird\"; exec bun run dev:server'"
