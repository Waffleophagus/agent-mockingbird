#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo)."
  exit 1
fi

APP_USER="${WAFFLEBOT_USER:-wafflebot}"
APP_GROUP="${WAFFLEBOT_GROUP:-${APP_USER}}"
APP_DIR="${WAFFLEBOT_APP_DIR:-/srv/wafflebot/app}"
DATA_DIR="${WAFFLEBOT_DATA_DIR:-/var/lib/wafflebot}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="/etc/systemd/system"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

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

if ! getent group "${APP_GROUP}" >/dev/null 2>&1; then
  groupadd --system "${APP_GROUP}"
fi

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_DIR}" --gid "${APP_GROUP}" --shell /usr/sbin/nologin "${APP_USER}"
fi

mkdir -p "${APP_DIR}" "${DATA_DIR}"

# Copy extracted release content into final app directory.
tar -C "${SCRIPT_DIR}" -cf - . | tar -C "${APP_DIR}" -xf -

chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}" "${DATA_DIR}"

su -s /bin/bash -c "cd \"${APP_DIR}\" && bun install --frozen-lockfile" "${APP_USER}"
su -s /bin/bash -c "cd \"${APP_DIR}\" && bun scripts/runtime-assets-sync.mjs --source \"${APP_DIR}/runtime-assets/workspace\" --target \"${APP_DIR}\" --state \"${DATA_DIR}/runtime-assets-state.json\" --mode install --non-interactive" "${APP_USER}"

render_unit() {
  local src="$1"
  local dst="$2"

  sed \
    -e "s|^User=.*$|User=${APP_USER}|" \
    -e "s|^Group=.*$|Group=${APP_GROUP}|" \
    -e "s|^WorkingDirectory=.*$|WorkingDirectory=${APP_DIR}|" \
    -e "s|/srv/wafflebot/app|${APP_DIR}|g" \
    -e "s|/var/lib/wafflebot|${DATA_DIR}|g" \
    "${src}" > "${dst}"
}

render_unit "${APP_DIR}/deploy/systemd/opencode.service" "${TMP_DIR}/opencode.service"
render_unit "${APP_DIR}/deploy/systemd/wafflebot.service" "${TMP_DIR}/wafflebot.service"

install -m 0644 "${TMP_DIR}/opencode.service" "${UNIT_DIR}/opencode.service"
install -m 0644 "${TMP_DIR}/wafflebot.service" "${UNIT_DIR}/wafflebot.service"

systemctl daemon-reload
systemctl enable --now opencode.service wafflebot.service

echo "Installed wafflebot with systemd services:"
echo "  opencode.service"
echo "  wafflebot.service"
echo
echo "Health checks:"
echo "  curl -sS http://127.0.0.1:3001/api/health"
echo "  systemctl status wafflebot.service --no-pager"
