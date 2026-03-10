#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENDOR_DIR="${ROOT_DIR}/vendor/opencode"
UPSTREAM_URL="${OPENCODE_UPSTREAM_URL:-https://github.com/anomalyco/opencode}"
REF="${1:-main}"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required"
  exit 1
fi

if [[ ! -d "${VENDOR_DIR}" ]]; then
  echo "vendor/opencode is missing"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "[vendor:opencode] cloning ${UPSTREAM_URL} (${REF})"
git clone --depth 1 --branch "${REF}" "${UPSTREAM_URL}" "${TMP_DIR}/opencode"

echo "[vendor:opencode] replacing vendor/opencode contents"
find "${VENDOR_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -R "${TMP_DIR}/opencode"/. "${VENDOR_DIR}/"
rm -rf "${VENDOR_DIR}/.git"

echo "[vendor:opencode] synced to $(git -C "${TMP_DIR}/opencode" rev-parse HEAD)"
