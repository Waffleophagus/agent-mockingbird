#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

OPENCODE_HOST="${OPENCODE_HOST:-127.0.0.1}"
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
WAFFLEBOT_PORT="${WAFFLEBOT_PORT:-3001}"
OPENCODE_LOG_LEVEL="${OPENCODE_LOG_LEVEL:-INFO}"
OPENCODE_URL="http://${OPENCODE_HOST}:${OPENCODE_PORT}"
WAFFLEBOT_URL="http://127.0.0.1:${WAFFLEBOT_PORT}"
DEV_WORKSPACE_DIR="${WAFFLEBOT_MEMORY_WORKSPACE_DIR:-${ROOT_DIR}/data/workspace}"
DEV_CONFIG_PATH="${WAFFLEBOT_CONFIG_PATH:-${ROOT_DIR}/data/wafflebot.dev-stack.config.json}"
DEV_RUNTIME_ASSETS_STATE_PATH="${WAFFLEBOT_RUNTIME_ASSETS_STATE_PATH:-${ROOT_DIR}/data/runtime-assets-state.dev-stack.json}"
DEV_DB_PATH="${WAFFLEBOT_DB_PATH:-${ROOT_DIR}/data/wafflebot.db}"
DEV_RESET_RUNTIME_BINDINGS="${WAFFLEBOT_DEV_RESET_BINDINGS:-1}"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required but not found in PATH."
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "opencode is required but not found in PATH."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required but not found in PATH."
  exit 1
fi

OPENCODE_PID=""
WAFFLEBOT_PID=""

cleanup() {
  local exit_code=$?
  set +e
  if [[ -n "${WAFFLEBOT_PID}" ]] && kill -0 "${WAFFLEBOT_PID}" 2>/dev/null; then
    kill "${WAFFLEBOT_PID}" 2>/dev/null
    wait "${WAFFLEBOT_PID}" 2>/dev/null
  fi
  if [[ -n "${OPENCODE_PID}" ]] && kill -0 "${OPENCODE_PID}" 2>/dev/null; then
    kill "${OPENCODE_PID}" 2>/dev/null
    wait "${OPENCODE_PID}" 2>/dev/null
  fi
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

wait_for_http() {
  local url="$1"
  local name="$2"
  local max_attempts="${3:-60}"
  local delay_seconds="${4:-0.5}"

  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    local code
    code="$(curl -sS -m 2 -o /dev/null -w "%{http_code}" "${url}" || true)"
    if [[ "${code}" != "000" ]]; then
      return 0
    fi
    sleep "${delay_seconds}"
  done

  echo "Timed out waiting for ${name} at ${url}"
  return 1
}

existing_http_code="$(curl -sS -m 2 -o /dev/null -w "%{http_code}" "${OPENCODE_URL}/session" || true)"
if [[ "${existing_http_code}" != "000" ]]; then
  echo "[stack] reusing existing opencode at ${OPENCODE_URL}"
else
  echo "[stack] starting opencode at ${OPENCODE_URL}"
  (
    cd "${ROOT_DIR}"
    export WAFFLEBOT_PORT="${WAFFLEBOT_PORT}"
    export WAFFLEBOT_MEMORY_WORKSPACE_DIR="${DEV_WORKSPACE_DIR}"
    export WAFFLEBOT_MEMORY_API_BASE_URL="${WAFFLEBOT_MEMORY_API_BASE_URL:-http://127.0.0.1:${WAFFLEBOT_PORT}}"
    exec opencode serve \
      --hostname "${OPENCODE_HOST}" \
      --port "${OPENCODE_PORT}" \
      --print-logs \
      --log-level "${OPENCODE_LOG_LEVEL}"
  ) &
  OPENCODE_PID=$!

  if ! wait_for_http "${OPENCODE_URL}/session" "opencode"; then
    echo "OpenCode failed readiness check."
    exit 1
  fi
fi

echo "[stack] opencode is reachable"
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
echo "[stack] syncing runtime.opencode settings into wafflebot config (workspace: ${DEV_WORKSPACE_DIR})"
(
  cd "${ROOT_DIR}"
  unset WAFFLEBOT_OPENCODE_PROVIDER_ID
  unset WAFFLEBOT_OPENCODE_MODEL_ID
  unset WAFFLEBOT_OPENCODE_MODEL_FALLBACKS
  unset WAFFLEBOT_OPENCODE_SMALL_MODEL
  unset WAFFLEBOT_OPENCODE_TIMEOUT_MS
  unset WAFFLEBOT_OPENCODE_PROMPT_TIMEOUT_MS
  unset WAFFLEBOT_OPENCODE_RUN_WAIT_TIMEOUT_MS
  WAFFLEBOT_CONFIG_PATH="${DEV_CONFIG_PATH}" \
  WAFFLEBOT_MEMORY_WORKSPACE_DIR="${DEV_WORKSPACE_DIR}" \
    WAFFLEBOT_OPENCODE_BASE_URL="${OPENCODE_URL}" \
    WAFFLEBOT_OPENCODE_DIRECTORY="${DEV_WORKSPACE_DIR}" \
    bun run config:migrate-opencode-env >/dev/null || true
)
if [[ "${DEV_RESET_RUNTIME_BINDINGS}" == "1" ]]; then
  echo "[stack] resetting stale opencode session bindings in ${DEV_DB_PATH}"
  (
    cd "${ROOT_DIR}"
    WAFFLEBOT_DB_PATH="${DEV_DB_PATH}" bun -e '
      import { Database } from "bun:sqlite";
      const dbPath = process.env.WAFFLEBOT_DB_PATH;
      if (!dbPath) process.exit(0);
      const db = new Database(dbPath);
      try {
        db.query("DELETE FROM runtime_session_bindings WHERE runtime = ?1").run("opencode");
      } catch {
        // Table may not exist before first migration.
      }
    ' >/dev/null
  )
fi
echo "[stack] starting wafflebot at ${WAFFLEBOT_URL}"
existing_wafflebot_code="$(curl -sS -m 2 -o /dev/null -w "%{http_code}" "${WAFFLEBOT_URL}/api/health" || true)"
if [[ "${existing_wafflebot_code}" != "000" ]]; then
  echo "[stack] reusing existing wafflebot at ${WAFFLEBOT_URL}"
else
  (
    cd "${ROOT_DIR}"
    export PORT="${WAFFLEBOT_PORT}"
    export WAFFLEBOT_DB_PATH="${DEV_DB_PATH}"
    export WAFFLEBOT_MEMORY_WORKSPACE_DIR="${DEV_WORKSPACE_DIR}"
    export WAFFLEBOT_CONFIG_PATH="${DEV_CONFIG_PATH}"
    export WAFFLEBOT_OPENCODE_DIRECTORY="${DEV_WORKSPACE_DIR}"
    exec bun --hot src/index.ts
  ) &
  WAFFLEBOT_PID=$!

  if ! wait_for_http "${WAFFLEBOT_URL}/api/health" "wafflebot"; then
    echo "Wafflebot failed readiness check."
    exit 1
  fi
fi

echo "[stack] ready"
echo "[stack] opencode: ${OPENCODE_URL}"
echo "[stack] wafflebot: ${WAFFLEBOT_URL}"
echo "[stack] workspace: ${DEV_WORKSPACE_DIR}"
echo "[stack] config: ${DEV_CONFIG_PATH}"
echo "[stack] press Ctrl+C to stop both"

if [[ -n "${WAFFLEBOT_PID}" ]]; then
  wait "${WAFFLEBOT_PID}"
elif [[ -n "${OPENCODE_PID}" ]]; then
  wait "${OPENCODE_PID}"
else
  while true; do
    sleep 3600
  done
fi
