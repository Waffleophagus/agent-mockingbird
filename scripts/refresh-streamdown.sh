#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY_URL="${PACKAGE_REGISTRY_URL:-https://git.waffleophagus.com/api/packages/waffleophagus/npm/}"

react_native_version="$(npm view @streamdown/react-native version --registry "$REGISTRY_URL")"
core_version="$(npm view @streamdown/core version --registry "$REGISTRY_URL")"
code_native_version="$(npm view @streamdown/code-native version --registry "$REGISTRY_URL")"

node - "$ROOT_DIR/package.json" "$ROOT_DIR/apps/mobile/package.json" "$ROOT_DIR/apps/server/package.json" "$react_native_version" "$core_version" "$code_native_version" <<'EOF'
const fs = require("node:fs");

const [rootPath, mobilePath, serverPath, reactNativeVersion, coreVersion, codeNativeVersion] =
  process.argv.slice(2);

const root = JSON.parse(fs.readFileSync(rootPath, "utf8"));
const mobile = JSON.parse(fs.readFileSync(mobilePath, "utf8"));
const server = JSON.parse(fs.readFileSync(serverPath, "utf8"));

root.overrides["@streamdown/react-native"] = reactNativeVersion;
root.overrides["@streamdown/core"] = coreVersion;
root.overrides["@streamdown/code-native"] = codeNativeVersion;

mobile.dependencies["@streamdown/react-native"] = reactNativeVersion;
mobile.dependencies["@streamdown/core"] = coreVersion;
mobile.dependencies["@streamdown/code-native"] = codeNativeVersion;
server.dependencies["@streamdown/core"] = coreVersion;

fs.writeFileSync(rootPath, JSON.stringify(root, null, 2) + "\n");
fs.writeFileSync(mobilePath, JSON.stringify(mobile, null, 2) + "\n");
fs.writeFileSync(serverPath, JSON.stringify(server, null, 2) + "\n");
EOF

rm -rf "$ROOT_DIR/apps/mobile/node_modules/@streamdown" "$ROOT_DIR/apps/server/node_modules/@streamdown" "$ROOT_DIR/node_modules/@streamdown"

cd "$ROOT_DIR"
bun install --force
