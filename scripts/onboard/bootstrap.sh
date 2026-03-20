#!/usr/bin/env bash
set -euo pipefail

REGISTRY_URL="${AGENT_MOCKINGBIRD_REGISTRY_URL:-https://registry.npmjs.org/}"
AGENT_MOCKINGBIRD_SCOPE="${AGENT_MOCKINGBIRD_SCOPE:-waffleophagus}"
AGENT_MOCKINGBIRD_TAG="${AGENT_MOCKINGBIRD_TAG:-latest}"
PUBLIC_NPM_REGISTRY_URL="${AGENT_MOCKINGBIRD_PUBLIC_REGISTRY_URL:-https://registry.npmjs.org/}"
AGENT_MOCKINGBIRD_SCOPE="${AGENT_MOCKINGBIRD_SCOPE#@}"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Please install npm and run again."
  exit 1
fi

if [[ $# -eq 0 ]]; then
  set -- install
fi

tmp_npmrc="$(mktemp)"
cleanup() {
  rm -f "${tmp_npmrc}"
}
trap cleanup EXIT

{
  printf "registry=%s\n" "${PUBLIC_NPM_REGISTRY_URL}"
  if [[ "${REGISTRY_URL}" != "${PUBLIC_NPM_REGISTRY_URL}" ]]; then
    printf "@%s:registry=%s\n" "${AGENT_MOCKINGBIRD_SCOPE}" "${REGISTRY_URL}"
  fi
} > "${tmp_npmrc}"

exec npm exec \
  --yes \
  --userconfig "${tmp_npmrc}" \
  --package "@${AGENT_MOCKINGBIRD_SCOPE}/agent-mockingbird-installer@${AGENT_MOCKINGBIRD_TAG}" \
  agent-mockingbird-installer \
  -- "$@"
