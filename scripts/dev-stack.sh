#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WAFFLEBOT_PORT="${PORT:-${AGENT_MOCKINGBIRD_PORT:-3001}}"
DEV_WORKSPACE_DIR="${AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR:-${ROOT_DIR}/data/workspace}"
DEV_CONFIG_PATH="${AGENT_MOCKINGBIRD_CONFIG_PATH:-${ROOT_DIR}/data/agent-mockingbird.dev-stack.config.json}"
DEV_RUNTIME_ASSETS_STATE_PATH="${AGENT_MOCKINGBIRD_RUNTIME_ASSETS_STATE_PATH:-${ROOT_DIR}/data/runtime-assets-state.dev-stack.json}"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required but not found in PATH."
  exit 1
fi

echo "[stack] syncing runtime assets into ${DEV_WORKSPACE_DIR}"
(
  cd "${ROOT_DIR}"
  bun scripts/runtime-assets-sync.mjs \
    --source "${ROOT_DIR}/runtime-assets/workspace" \
    --target "${DEV_WORKSPACE_DIR}" \
    --state "${DEV_RUNTIME_ASSETS_STATE_PATH}" \
    --mode install \
    --non-interactive \
    --quiet
)

if [[ -f "${DEV_WORKSPACE_DIR}/.opencode/package.json" ]]; then
  echo "[stack] installing workspace .opencode dependencies"
  (
    cd "${DEV_WORKSPACE_DIR}/.opencode"
    bun install --frozen-lockfile >/dev/null
  )
fi

echo "[stack] starting agent-mockingbird on http://127.0.0.1:${WAFFLEBOT_PORT}"
echo "[stack] workspace: ${DEV_WORKSPACE_DIR}"
echo "[stack] config: ${DEV_CONFIG_PATH}"

cd "${ROOT_DIR}"
export PORT="${WAFFLEBOT_PORT}"
export AGENT_MOCKINGBIRD_PORT="${WAFFLEBOT_PORT}"
export AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR="${DEV_WORKSPACE_DIR}"
export AGENT_MOCKINGBIRD_CONFIG_PATH="${DEV_CONFIG_PATH}"
exec bun --hot apps/server/src/index.ts
