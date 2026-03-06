#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p /var/home/matt/gradle-build-cache
mkdir -p /var/home/matt/build-tmp

export GRADLE_USER_HOME=/var/home/matt/gradle-build-cache
export TMPDIR=/var/home/matt/build-tmp
export TMP=/var/home/matt/build-tmp

echo ""
echo "Android Build"
echo "------------------------------"
echo "Gradle cache: $GRADLE_USER_HOME"
echo "Temp dir:     $TMPDIR"
echo ""
echo "1) Development device build"
echo "2) Preview internal build"
echo "3) Production build"
echo ""

read -r -p "Enter your choice (1-3): " BUILD_CHOICE

case "$BUILD_CHOICE" in
  1)
    BUILD_LABEL="development"
    BUILD_CMD="bun run build:android:dev"
    ;;
  2)
    BUILD_LABEL="preview"
    BUILD_CMD="bun run build:android:preview"
    ;;
  3)
    BUILD_LABEL="production"
    BUILD_CMD="bun run build:android:prod"
    ;;
  *)
    echo "Invalid choice. Enter 1, 2, or 3."
    exit 1
    ;;
esac

echo ""
echo "Starting $BUILD_LABEL Android build..."
echo ""

if $BUILD_CMD; then
  echo ""
  echo "Build completed successfully."
  echo "Build type: $BUILD_LABEL"
else
  echo ""
  echo "Build failed."
  exit 1
fi
