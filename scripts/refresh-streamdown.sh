#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[streamdown] mobile was removed; refreshing server-side dependencies only"
cd "${ROOT_DIR}"
bun install --force
