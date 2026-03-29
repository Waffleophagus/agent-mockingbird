#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo)."
  exit 1
fi

APP_USER="${AGENT_MOCKINGBIRD_USER:-agent-mockingbird}"
APP_GROUP="${AGENT_MOCKINGBIRD_GROUP:-${APP_USER}}"
APP_DIR="${AGENT_MOCKINGBIRD_APP_DIR:-/srv/agent-mockingbird/app}"
DATA_DIR="${AGENT_MOCKINGBIRD_DATA_DIR:-/var/lib/agent-mockingbird}"
OPENCODE_CONFIG_DIR="${AGENT_MOCKINGBIRD_OPENCODE_CONFIG_DIR:-${DATA_DIR}/opencode-config/systemd}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="/etc/systemd/system"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

read_pinned_bun_version() {
  local candidate
  local package_manager
  for candidate in \
    "${SCRIPT_DIR}/cleanroom/opencode/package.json" \
    "${SCRIPT_DIR}/package.json"
  do
    [[ -f "${candidate}" ]] || continue
    package_manager="$(
      sed -nE 's/.*"packageManager"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "${candidate}" \
        | head -n 1
    )"
    [[ -n "${package_manager}" ]] || continue
    if [[ "${package_manager}" != bun@* ]]; then
      echo "Expected packageManager to start with bun@ in ${candidate}, found ${package_manager}."
      exit 1
    fi
    printf '%s\n' "${package_manager#bun@}"
    return 0
  done

  echo "Unable to locate package.json for Bun version pinning."
  exit 1
}

require_cmd() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "${cmd} is required but not installed."
    exit 1
  fi
}

require_cmd bun
require_cmd opencode
require_cmd systemctl
require_cmd tar

PINNED_BUN_VERSION="$(read_pinned_bun_version)"
HOST_BUN_VERSION="$(bun --version | tr -d '\r\n')"
if [[ "${HOST_BUN_VERSION}" != "${PINNED_BUN_VERSION}" ]]; then
  echo "Pinned Bun runtime mismatch: expected bun@${PINNED_BUN_VERSION}, found bun@${HOST_BUN_VERSION}."
  echo "Install the pinned Bun version or override AGENT_MOCKINGBIRD_BUN_VERSION in the managed installer flow."
  exit 1
fi

if ! getent group "${APP_GROUP}" >/dev/null 2>&1; then
  groupadd --system "${APP_GROUP}"
fi

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_DIR}" --gid "${APP_GROUP}" --shell /usr/sbin/nologin "${APP_USER}"
fi

mkdir -p \
  "${APP_DIR}" \
  "${DATA_DIR}" \
  "${DATA_DIR}/executor-workspace" \
  "${DATA_DIR}/executor/local" \
  "${DATA_DIR}/executor/run" \
  "${OPENCODE_CONFIG_DIR}"

# Copy extracted release content into final app directory.
tar -C "${SCRIPT_DIR}" -cf - . | tar -C "${APP_DIR}" -xf -

chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}" "${DATA_DIR}"

su -s /bin/bash -c "cd \"${APP_DIR}\" && bun install --frozen-lockfile" "${APP_USER}"
su -s /bin/bash -c "cd \"${APP_DIR}\" && bun install --cwd vendor/executor --frozen-lockfile" "${APP_USER}"
su -s /bin/bash -c "cd \"${APP_DIR}\" && EXECUTOR_WEB_BASE_PATH=/executor EXECUTOR_SERVER_BASE_PATH=/executor bun run --cwd vendor/executor/apps/web build" "${APP_USER}"
su -s /bin/bash -c "cd \"${APP_DIR}\" && bun scripts/runtime-assets-sync.mjs --source \"${APP_DIR}/runtime-assets/workspace\" --target \"${APP_DIR}\" --state \"${DATA_DIR}/runtime-assets-workspace-state.json\" --mode install --non-interactive" "${APP_USER}"
su -s /bin/bash -c "cd \"${APP_DIR}\" && bun scripts/runtime-assets-sync.mjs --source \"${APP_DIR}/runtime-assets/opencode-config\" --target \"${OPENCODE_CONFIG_DIR}\" --state \"${DATA_DIR}/runtime-assets-opencode-config-state.json\" --mode install --non-interactive" "${APP_USER}"
if [[ -f "${OPENCODE_CONFIG_DIR}/package.json" ]]; then
  su -s /bin/bash -c "cd \"${OPENCODE_CONFIG_DIR}\" && bun install --frozen-lockfile" "${APP_USER}"
fi

render_unit() {
  local src="$1"
  local dst="$2"

  sed \
    -e "s|^User=.*$|User=${APP_USER}|" \
    -e "s|^Group=.*$|Group=${APP_GROUP}|" \
    -e "s|^WorkingDirectory=.*$|WorkingDirectory=${APP_DIR}|" \
    -e "s|__AGENT_MOCKINGBIRD_OPENCODE_CONFIG_DIR__|${OPENCODE_CONFIG_DIR}|g" \
    -e "s|/srv/agent-mockingbird/app|${APP_DIR}|g" \
    -e "s|/var/lib/agent-mockingbird|${DATA_DIR}|g" \
    "${src}" > "${dst}"
}

render_unit "${APP_DIR}/deploy/systemd/executor.service" "${TMP_DIR}/executor.service"
render_unit "${APP_DIR}/deploy/systemd/opencode.service" "${TMP_DIR}/opencode.service"
render_unit "${APP_DIR}/deploy/systemd/agent-mockingbird.service" "${TMP_DIR}/agent-mockingbird.service"

install -m 0644 "${TMP_DIR}/executor.service" "${UNIT_DIR}/executor.service"
install -m 0644 "${TMP_DIR}/opencode.service" "${UNIT_DIR}/opencode.service"
install -m 0644 "${TMP_DIR}/agent-mockingbird.service" "${UNIT_DIR}/agent-mockingbird.service"

systemctl daemon-reload
systemctl enable --now executor.service opencode.service agent-mockingbird.service

echo "Installed agent-mockingbird with systemd services:"
echo "  executor.service"
echo "  opencode.service"
echo "  agent-mockingbird.service"
echo
echo "Health checks:"
echo "  curl -sS http://127.0.0.1:3001/api/health"
echo "  systemctl status executor.service --no-pager"
echo "  systemctl status agent-mockingbird.service --no-pager"
