#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
STAGE_DIR="${DIST_DIR}/release-stage"

VERSION="${1:-}"
if [[ -z "${VERSION}" ]]; then
  echo "usage: $0 <version>"
  echo "example: $0 v0.1.0"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required"
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required"
  exit 1
fi

mkdir -p "${DIST_DIR}"
rm -rf "${STAGE_DIR}"

ARCHIVE_PATH="${DIST_DIR}/agent-mockingbird-${VERSION}.tar.gz"
CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"
PREFIX="agent-mockingbird-${VERSION}"

echo "Building vendored OpenCode app + standalone runtime..."
(
  cd "${ROOT_DIR}"
  bun run build
  bun run build:bin
)

mkdir -p "${STAGE_DIR}/${PREFIX}"

echo "Exporting tracked files..."
git -C "${ROOT_DIR}" archive --format=tar HEAD | tar -x -C "${STAGE_DIR}/${PREFIX}"

echo "Refreshing built dist artifacts..."
rm -rf "${STAGE_DIR:?}/${PREFIX}/dist"
cp -R "${ROOT_DIR}/dist" "${STAGE_DIR}/${PREFIX}/dist"
rm -rf "${STAGE_DIR:?}/${PREFIX}/dist/release-stage"

test -f "${STAGE_DIR}/${PREFIX}/dist/agent-mockingbird"
test -f "${STAGE_DIR}/${PREFIX}/dist/drizzle/meta/_journal.json"
test -f "${STAGE_DIR}/${PREFIX}/dist/app/index.html"
test -f "${STAGE_DIR}/${PREFIX}/drizzle/meta/_journal.json"

echo "Packing release bundle..."
tar -C "${STAGE_DIR}" -czf "${ARCHIVE_PATH}" "${PREFIX}"

(
  cd "${DIST_DIR}"
  sha256sum "agent-mockingbird-${VERSION}.tar.gz" > "agent-mockingbird-${VERSION}.tar.gz.sha256"
)

rm -rf "${STAGE_DIR}"

echo "Created:"
echo "  ${ARCHIVE_PATH}"
echo "  ${CHECKSUM_PATH}"
