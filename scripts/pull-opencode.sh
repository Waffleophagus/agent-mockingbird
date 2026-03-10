#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec "${ROOT_DIR}/scripts/vendor/sync-opencode.sh" "${1:-https://github.com/anomalyco/opencode}" "${2:-main}"
