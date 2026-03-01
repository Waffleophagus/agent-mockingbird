#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ -f ".env" ]]; then
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" =~ ^[[:space:]]*# ]] || [[ "${line}" =~ ^[[:space:]]*$ ]]; then
      continue
    fi
    if [[ "${line}" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      if [[ -z "${!key+x}" ]]; then
        export "${key}=${value}"
      fi
    fi
  done < ".env"
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "[memory:e2e] bun is required but not found in PATH."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[memory:e2e] curl is required but not found in PATH."
  exit 1
fi

MEMORY_ENABLED="${WAFFLEBOT_MEMORY_ENABLED:-true}"
EMBED_PROVIDER="${WAFFLEBOT_MEMORY_EMBED_PROVIDER:-ollama}"
OLLAMA_BASE_URL="${WAFFLEBOT_MEMORY_OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
EMBED_MODEL="${WAFFLEBOT_MEMORY_EMBED_MODEL:-qwen3-embedding:4b}"

echo "[memory:e2e] starting"
echo "[memory:e2e] provider=${EMBED_PROVIDER} model=${EMBED_MODEL}"

if [[ "${MEMORY_ENABLED}" != "true" ]]; then
  echo "[memory:e2e] WAFFLEBOT_MEMORY_ENABLED must be true."
  exit 1
fi

if [[ "${EMBED_PROVIDER}" == "ollama" ]]; then
  echo "[memory:e2e] checking ollama at ${OLLAMA_BASE_URL}"
  if ! curl -fsS "${OLLAMA_BASE_URL}/api/tags" >/dev/null; then
    echo "[memory:e2e] failed to reach Ollama tags endpoint."
    echo "[memory:e2e] set WAFFLEBOT_MEMORY_OLLAMA_BASE_URL or run with WAFFLEBOT_MEMORY_EMBED_PROVIDER=none."
    exit 1
  fi
fi

echo "[memory:e2e] memory status"
bun run src/backend/memory/cli.ts status

echo "[memory:e2e] forcing reindex"
bun run src/backend/memory/cli.ts reindex

MARKER="memory-e2e-$(date +%s)-$RANDOM"
CONTENT="E2E marker ${MARKER} created at $(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "[memory:e2e] writing marker"
bun run src/backend/memory/cli.ts remember fact "${CONTENT}" >/tmp/wafflebot-memory-e2e-remember.json

echo "[memory:e2e] searching marker"
SEARCH_OUTPUT="$(bun run src/backend/memory/cli.ts search "${MARKER}")"
printf '%s\n' "${SEARCH_OUTPUT}" >/tmp/wafflebot-memory-e2e-search.json

if [[ "${SEARCH_OUTPUT}" != *"${MARKER}"* ]]; then
  echo "[memory:e2e] marker was not found in retrieval output."
  echo "[memory:e2e] wrote debug output to /tmp/wafflebot-memory-e2e-search.json"
  exit 1
fi

echo "[memory:e2e] PASS marker=${MARKER}"
