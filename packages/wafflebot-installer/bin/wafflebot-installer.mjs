#!/usr/bin/env node
import process from "node:process";
import { spawnSync } from "node:child_process";

const scope = process.env.WAFFLEBOT_INSTALLER_SCOPE || "waffleophagus";
const tag = process.env.WAFFLEBOT_INSTALLER_TAG || "latest";
const registry = process.env.WAFFLEBOT_REGISTRY_URL || "https://git.waffleophagus.com/api/packages/waffleophagus/npm/";
const pkg = `@${scope.replace(/^@/, "")}/wafflebot@${tag}`;

const result = spawnSync(
  "npm",
  ["exec", "--yes", "--registry", registry, pkg, "--", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: process.env,
  },
);

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}
