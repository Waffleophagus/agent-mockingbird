#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

OPENCODE_HOST="${OPENCODE_HOST:-127.0.0.1}"
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
WAFFLEBOT_PORT="${WAFFLEBOT_PORT:-3001}"
OPENCODE_LOG_LEVEL="${OPENCODE_LOG_LEVEL:-INFO}"
OPENCODE_URL="http://${OPENCODE_HOST}:${OPENCODE_PORT}"
WAFFLEBOT_URL="http://127.0.0.1:${WAFFLEBOT_PORT}"

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

echo "[stack] starting opencode at ${OPENCODE_URL}"
(
  cd "${ROOT_DIR}"
  export WAFFLEBOT_PORT="${WAFFLEBOT_PORT}"
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

echo "[stack] opencode is reachable"
echo "[stack] starting wafflebot at ${WAFFLEBOT_URL}"
(
  cd "${ROOT_DIR}"
  export PORT="${WAFFLEBOT_PORT}"
  export WAFFLEBOT_OPENCODE_BASE_URL="${OPENCODE_URL}"
  exec bun --hot src/index.ts
) &
WAFFLEBOT_PID=$!

if ! wait_for_http "${WAFFLEBOT_URL}/api/health" "wafflebot"; then
  echo "Wafflebot failed readiness check."
  exit 1
fi

echo "[stack] ready"
echo "[stack] opencode: ${OPENCODE_URL}"
echo "[stack] wafflebot: ${WAFFLEBOT_URL}"
echo "[stack] press Ctrl+C to stop both"

wait "${WAFFLEBOT_PID}"
