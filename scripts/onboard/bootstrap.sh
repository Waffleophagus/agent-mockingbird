#!/usr/bin/env bash
set -euo pipefail

REGISTRY_URL="${WAFFLEBOT_REGISTRY_URL:-https://git.waffleophagus.com/api/packages/waffleophagus/npm/}"
INSTALLER_SCOPE="${WAFFLEBOT_INSTALLER_SCOPE:-waffleophagus}"
INSTALLER_TAG="${WAFFLEBOT_INSTALLER_TAG:-main}"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Please install npm and run again."
  exit 1
fi

if [[ $# -eq 0 ]]; then
  set -- install
fi

exec npm exec \
  --yes \
  --registry "${REGISTRY_URL}" \
  "@${INSTALLER_SCOPE}/wafflebot-installer@${INSTALLER_TAG}" \
  -- "$@"
