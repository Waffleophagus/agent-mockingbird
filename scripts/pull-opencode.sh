#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCODE_DIR="${ROOT_DIR}/opencode"

if [[ ! -d "${OPENCODE_DIR}/.git" ]]; then
  echo "opencode/ clone not found; cloning..."
  git clone https://github.com/anomalyco/opencode.git "${OPENCODE_DIR}"
fi

cd "${OPENCODE_DIR}"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "Updating opencode (${CURRENT_BRANCH})..."
git fetch origin "${CURRENT_BRANCH}"
git pull --ff-only origin "${CURRENT_BRANCH}"

echo "opencode is up to date at $(git rev-parse --short HEAD)"
