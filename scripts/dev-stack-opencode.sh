#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCODE_HOST="${OPENCODE_HOST:-127.0.0.1}"
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
OPENCODE_WORKSPACE_DIR="${OPENCODE_WORKSPACE_DIR:-${ROOT_DIR}/apps/server/data/workspace}"
OPENCODE_HEALTH_URL="http://${OPENCODE_HOST}:${OPENCODE_PORT}/global/health"
EXECUTOR_HOST="${EXECUTOR_HOST:-127.0.0.1}"
EXECUTOR_PORT="${EXECUTOR_PORT:-8788}"
EXECUTOR_BASE_URL="http://${EXECUTOR_HOST}:${EXECUTOR_PORT}"
EXECUTOR_HEALTH_URL="${EXECUTOR_BASE_URL}${AGENT_MOCKINGBIRD_EXECUTOR_HEALTHCHECK_PATH:-/executor}"
STARTUP_TIMEOUT_SECONDS="${DEV_STACK_STARTUP_TIMEOUT_SECONDS:-30}"
STACK_DATA_DIR="${DEV_STACK_DATA_DIR:-${ROOT_DIR}/apps/server/data/dev-stack}"
STACK_DB_PATH="${AGENT_MOCKINGBIRD_DB_PATH:-${STACK_DATA_DIR}/agent-mockingbird.db}"
STACK_CONFIG_PATH="${AGENT_MOCKINGBIRD_CONFIG_PATH:-${STACK_DATA_DIR}/agent-mockingbird.config.json}"
DEV_OPENCODE_CONFIG_DIR="$(
  bun -e "import { createHash } from 'node:crypto'; import path from 'node:path'; const workspaceDir = path.resolve('${OPENCODE_WORKSPACE_DIR}'); const configDataDir = path.dirname(path.resolve('${STACK_CONFIG_PATH}')); const fingerprint = createHash('sha256').update(workspaceDir).digest('hex').slice(0, 16); process.stdout.write(path.join(configDataDir, 'opencode-config', fingerprint));"
)"
EXECUTOR_WORKSPACE_DIR="${EXECUTOR_WORKSPACE_DIR:-${ROOT_DIR}/apps/server/data/executor-workspace}"
EXECUTOR_DATA_DIR="${EXECUTOR_DATA_DIR:-${ROOT_DIR}/apps/server/data/executor}"
EXECUTOR_LOCAL_DATA_DIR="${EXECUTOR_LOCAL_DATA_DIR:-${EXECUTOR_DATA_DIR}/local}"
EXECUTOR_RUN_DIR="${EXECUTOR_RUN_DIR:-${EXECUTOR_DATA_DIR}/run}"
EXECUTOR_WEB_ASSETS_DIR="${EXECUTOR_WEB_ASSETS_DIR:-${ROOT_DIR}/vendor/executor/apps/web/dist}"

cd "${ROOT_DIR}"

mkdir -p "${OPENCODE_WORKSPACE_DIR}" "${STACK_DATA_DIR}" "${EXECUTOR_WORKSPACE_DIR}" "${EXECUTOR_LOCAL_DATA_DIR}" "${EXECUTOR_RUN_DIR}"

bun run build:app
echo "Refreshing vendored Executor worktree..."
bun run executor:sync --rebuild-only
echo "Installing vendored Executor dependencies..."
bun install --cwd vendor/executor --frozen-lockfile
echo "Building vendored Executor web assets..."
(
  cd "${ROOT_DIR}/vendor/executor/apps/web"
  EXECUTOR_WEB_BASE_PATH="/executor" \
  EXECUTOR_SERVER_BASE_PATH="/executor" \
  bun x vite build --config vite.config.ts
)

concurrently -k -n executor,opencode,server -c magenta,cyan,green \
  "bash -lc 'set -euo pipefail; cd \"${EXECUTOR_WORKSPACE_DIR}\"; export EXECUTOR_DATA_DIR=\"${EXECUTOR_DATA_DIR}\"; export EXECUTOR_LOCAL_DATA_DIR=\"${EXECUTOR_LOCAL_DATA_DIR}\"; export EXECUTOR_SERVER_PID_FILE=\"${EXECUTOR_RUN_DIR}/server.pid\"; export EXECUTOR_SERVER_LOG_FILE=\"${EXECUTOR_RUN_DIR}/server.log\"; export EXECUTOR_SERVER_BASE_PATH=\"/executor\"; export EXECUTOR_WEB_ASSETS_DIR=\"${EXECUTOR_WEB_ASSETS_DIR}\"; exec bun run \"${ROOT_DIR}/vendor/executor/apps/executor/src/cli/main.ts\" server start --port \"${EXECUTOR_PORT}\"'" \
  "bash -lc 'set -euo pipefail; export OPENCODE_WORKSPACE_DIR=\"${OPENCODE_WORKSPACE_DIR}\"; export OPENCODE_CONFIG_DIR=\"${DEV_OPENCODE_CONFIG_DIR}\"; export OPENCODE_DISABLE_PROJECT_CONFIG=1; export OPENCODE_DISABLE_EXTERNAL_SKILLS=1; exec bun run dev:opencode'" \
  "bash -lc 'set -euo pipefail; deadline=\$((SECONDS + ${STARTUP_TIMEOUT_SECONDS})); echo \"[stack] waiting for Executor at ${EXECUTOR_HEALTH_URL}\"; until curl -fsS \"${EXECUTOR_HEALTH_URL}\" >/dev/null 2>&1; do if (( SECONDS >= deadline )); then echo \"[stack] timed out waiting for Executor health after ${STARTUP_TIMEOUT_SECONDS}s\"; exit 1; fi; sleep 0.25; done; echo \"[stack] waiting for OpenCode at ${OPENCODE_HEALTH_URL}\"; until curl -fsS \"${OPENCODE_HEALTH_URL}\" >/dev/null 2>&1; do if (( SECONDS >= deadline )); then echo \"[stack] timed out waiting for OpenCode health after ${STARTUP_TIMEOUT_SECONDS}s\"; exit 1; fi; sleep 0.25; done; echo \"[stack] sidecars are healthy, starting Agent Mockingbird\"; export PORT=3001; export AGENT_MOCKINGBIRD_PORT=3001; export AGENT_MOCKINGBIRD_DB_PATH=\"${STACK_DB_PATH}\"; export AGENT_MOCKINGBIRD_CONFIG_PATH=\"${STACK_CONFIG_PATH}\"; export AGENT_MOCKINGBIRD_OPENCODE_BASE_URL=\"http://${OPENCODE_HOST}:${OPENCODE_PORT}\"; export AGENT_MOCKINGBIRD_OPENCODE_DIRECTORY=\"${OPENCODE_WORKSPACE_DIR}\"; export AGENT_MOCKINGBIRD_EXECUTOR_ENABLED=true; export AGENT_MOCKINGBIRD_EXECUTOR_BASE_URL=\"${EXECUTOR_BASE_URL}\"; export AGENT_MOCKINGBIRD_EXECUTOR_WORKSPACE_DIR=\"${EXECUTOR_WORKSPACE_DIR}\"; export AGENT_MOCKINGBIRD_EXECUTOR_DATA_DIR=\"${EXECUTOR_DATA_DIR}\"; export AGENT_MOCKINGBIRD_EXECUTOR_UI_MOUNT_PATH=\"/executor\"; export AGENT_MOCKINGBIRD_EXECUTOR_HEALTHCHECK_PATH=\"/executor\"; export AGENT_MOCKINGBIRD_EXECUTOR_MODE=\"embedded-patched\"; export AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR=\"${OPENCODE_WORKSPACE_DIR}\"; cd \"${ROOT_DIR}/apps/server\"; exec bun --hot src/index.ts'"
