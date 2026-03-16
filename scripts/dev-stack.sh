#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WAFFLEBOT_PORT="${PORT:-${AGENT_MOCKINGBIRD_PORT:-3001}}"
DEV_WORKSPACE_DIR="${AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR:-${ROOT_DIR}/data/workspace}"
DEV_CONFIG_PATH="${AGENT_MOCKINGBIRD_CONFIG_PATH:-${ROOT_DIR}/data/agent-mockingbird.dev-stack.config.json}"
DEV_OPENCODE_CONFIG_DIR="${AGENT_MOCKINGBIRD_OPENCODE_CONFIG_DIR:-${ROOT_DIR}/data/opencode-config/dev-stack}"
DEV_WORKSPACE_ASSETS_STATE_PATH="${AGENT_MOCKINGBIRD_RUNTIME_WORKSPACE_ASSETS_STATE_PATH:-${ROOT_DIR}/data/runtime-assets-workspace.dev-stack.json}"
DEV_OPENCODE_ASSETS_STATE_PATH="${AGENT_MOCKINGBIRD_RUNTIME_OPENCODE_ASSETS_STATE_PATH:-${ROOT_DIR}/data/runtime-assets-opencode-config.dev-stack.json}"

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
    --state "${DEV_WORKSPACE_ASSETS_STATE_PATH}" \
    --mode install \
    --non-interactive \
    --quiet
)

echo "[stack] syncing OpenCode config assets into ${DEV_OPENCODE_CONFIG_DIR}"
(
  cd "${ROOT_DIR}"
  bun scripts/runtime-assets-sync.mjs \
    --source "${ROOT_DIR}/runtime-assets/opencode-config" \
    --target "${DEV_OPENCODE_CONFIG_DIR}" \
    --state "${DEV_OPENCODE_ASSETS_STATE_PATH}" \
    --mode install \
    --non-interactive \
    --quiet
)

if [[ -f "${DEV_OPENCODE_CONFIG_DIR}/package.json" ]]; then
  echo "[stack] installing managed OpenCode config dependencies"
  (
    cd "${DEV_OPENCODE_CONFIG_DIR}"
    bun install --frozen-lockfile >/dev/null
  )
fi

echo "[stack] starting agent-mockingbird on http://127.0.0.1:${WAFFLEBOT_PORT}"
echo "[stack] workspace: ${DEV_WORKSPACE_DIR}"
echo "[stack] opencode-config: ${DEV_OPENCODE_CONFIG_DIR}"
echo "[stack] config: ${DEV_CONFIG_PATH}"

cd "${ROOT_DIR}"
export PORT="${WAFFLEBOT_PORT}"
export AGENT_MOCKINGBIRD_PORT="${WAFFLEBOT_PORT}"
export AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR="${DEV_WORKSPACE_DIR}"
export AGENT_MOCKINGBIRD_CONFIG_PATH="${DEV_CONFIG_PATH}"
export OPENCODE_CONFIG_DIR="${DEV_OPENCODE_CONFIG_DIR}"
export OPENCODE_DISABLE_PROJECT_CONFIG="1"
exec bun --hot apps/server/src/index.ts
