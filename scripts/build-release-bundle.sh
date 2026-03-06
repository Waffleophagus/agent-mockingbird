#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"

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

mkdir -p "${DIST_DIR}"
ARCHIVE_PATH="${DIST_DIR}/agent-mockingbird-${VERSION}.tar.gz"
CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"
PREFIX="agent-mockingbird-${VERSION}/"

git -C "${ROOT_DIR}" archive --format=tar.gz --prefix="${PREFIX}" -o "${ARCHIVE_PATH}" HEAD

(
  cd "${DIST_DIR}"
  sha256sum "agent-mockingbird-${VERSION}.tar.gz" > "agent-mockingbird-${VERSION}.tar.gz.sha256"
)

echo "Created:"
echo "  ${ARCHIVE_PATH}"
echo "  ${CHECKSUM_PATH}"
