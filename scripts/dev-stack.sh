#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

OPENCODE_HOST="${OPENCODE_HOST:-127.0.0.1}"
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
AGENT_MOCKINGBIRD_PORT="${AGENT_MOCKINGBIRD_PORT:-3001}"
OPENCODE_LOG_LEVEL="${OPENCODE_LOG_LEVEL:-INFO}"
OPENCODE_URL="http://${OPENCODE_HOST}:${OPENCODE_PORT}"
AGENT_MOCKINGBIRD_URL="http://127.0.0.1:${AGENT_MOCKINGBIRD_PORT}"
DEV_WORKSPACE_DIR="${AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR:-${ROOT_DIR}/data/workspace}"
DEV_CONFIG_PATH="${AGENT_MOCKINGBIRD_CONFIG_PATH:-${ROOT_DIR}/data/agent-mockingbird.dev-stack.config.json}"
DEV_RUNTIME_ASSETS_STATE_PATH="${AGENT_MOCKINGBIRD_RUNTIME_ASSETS_STATE_PATH:-${ROOT_DIR}/data/runtime-assets-state.dev-stack.json}"
DEV_DB_PATH="${AGENT_MOCKINGBIRD_DB_PATH:-${ROOT_DIR}/data/agent-mockingbird.db}"
DEV_RESET_RUNTIME_BINDINGS="${AGENT_MOCKINGBIRD_DEV_RESET_BINDINGS:-0}"

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
AGENT_MOCKINGBIRD_PID=""

cleanup() {
  local exit_code=$?
  set +e
  if [[ -n "${AGENT_MOCKINGBIRD_PID}" ]] && kill -0 "${AGENT_MOCKINGBIRD_PID}" 2>/dev/null; then
    kill "${AGENT_MOCKINGBIRD_PID}" 2>/dev/null
    wait "${AGENT_MOCKINGBIRD_PID}" 2>/dev/null
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
    export AGENT_MOCKINGBIRD_PORT="${AGENT_MOCKINGBIRD_PORT}"
    export AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR="${DEV_WORKSPACE_DIR}"
    export AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL="${AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL:-http://127.0.0.1:${AGENT_MOCKINGBIRD_PORT}}"
    export OPENCODE_DISABLE_EXTERNAL_SKILLS="${OPENCODE_DISABLE_EXTERNAL_SKILLS:-1}"
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
echo "[stack] syncing runtime.opencode settings into agent-mockingbird config (workspace: ${DEV_WORKSPACE_DIR})"
(
  cd "${ROOT_DIR}"
  unset AGENT_MOCKINGBIRD_OPENCODE_PROVIDER_ID
  unset AGENT_MOCKINGBIRD_OPENCODE_MODEL_ID
  unset AGENT_MOCKINGBIRD_OPENCODE_MODEL_FALLBACKS
  unset AGENT_MOCKINGBIRD_OPENCODE_SMALL_MODEL
  unset AGENT_MOCKINGBIRD_OPENCODE_TIMEOUT_MS
  unset AGENT_MOCKINGBIRD_OPENCODE_PROMPT_TIMEOUT_MS
  unset AGENT_MOCKINGBIRD_OPENCODE_RUN_WAIT_TIMEOUT_MS
  AGENT_MOCKINGBIRD_CONFIG_PATH="${DEV_CONFIG_PATH}" \
  AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR="${DEV_WORKSPACE_DIR}" \
    AGENT_MOCKINGBIRD_OPENCODE_BASE_URL="${OPENCODE_URL}" \
    AGENT_MOCKINGBIRD_OPENCODE_DIRECTORY="${DEV_WORKSPACE_DIR}" \
    bun run config:migrate-opencode-env >/dev/null || true
)
if [[ "${DEV_RESET_RUNTIME_BINDINGS}" == "1" ]]; then
  echo "[stack] resetting stale opencode session bindings in ${DEV_DB_PATH}"
  (
    cd "${ROOT_DIR}"
    AGENT_MOCKINGBIRD_DB_PATH="${DEV_DB_PATH}" bun -e '
      import { Database } from "bun:sqlite";
      const dbPath = process.env.AGENT_MOCKINGBIRD_DB_PATH;
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
echo "[stack] starting agent-mockingbird at ${AGENT_MOCKINGBIRD_URL}"
existing_agent_mockingbird_code="$(curl -sS -m 2 -o /dev/null -w "%{http_code}" "${AGENT_MOCKINGBIRD_URL}/api/health" || true)"
if [[ "${existing_agent_mockingbird_code}" != "000" ]]; then
  echo "[stack] reusing existing agent-mockingbird at ${AGENT_MOCKINGBIRD_URL}"
else
  (
    cd "${ROOT_DIR}"
    export PORT="${AGENT_MOCKINGBIRD_PORT}"
    export AGENT_MOCKINGBIRD_DB_PATH="${DEV_DB_PATH}"
    export AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR="${DEV_WORKSPACE_DIR}"
    export AGENT_MOCKINGBIRD_CONFIG_PATH="${DEV_CONFIG_PATH}"
    export AGENT_MOCKINGBIRD_OPENCODE_DIRECTORY="${DEV_WORKSPACE_DIR}"
    exec bun --hot apps/server/src/index.ts
  ) &
  AGENT_MOCKINGBIRD_PID=$!

  if ! wait_for_http "${AGENT_MOCKINGBIRD_URL}/api/health" "agent-mockingbird"; then
    echo "Agent Mockingbird failed readiness check."
    exit 1
  fi
fi

echo "[stack] ready"
echo "[stack] opencode: ${OPENCODE_URL}"
echo "[stack] agent-mockingbird: ${AGENT_MOCKINGBIRD_URL}"
echo "[stack] workspace: ${DEV_WORKSPACE_DIR}"
echo "[stack] config: ${DEV_CONFIG_PATH}"
echo "[stack] press Ctrl+C to stop both"

if [[ -n "${AGENT_MOCKINGBIRD_PID}" ]]; then
  wait "${AGENT_MOCKINGBIRD_PID}"
elif [[ -n "${OPENCODE_PID}" ]]; then
  wait "${OPENCODE_PID}"
else
  while true; do
    sleep 3600
  done
fi
