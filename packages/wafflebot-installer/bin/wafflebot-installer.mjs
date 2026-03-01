#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const scope = (process.env.WAFFLEBOT_INSTALLER_SCOPE || "waffleophagus").replace(/^@/, "");
const tag = process.env.WAFFLEBOT_INSTALLER_TAG || "latest";
const registry = process.env.WAFFLEBOT_REGISTRY_URL || "https://git.waffleophagus.com/api/packages/waffleophagus/npm/";
const publicRegistry = process.env.WAFFLEBOT_PUBLIC_REGISTRY_URL || "https://registry.npmjs.org/";
const pkg = `@${scope}/wafflebot@${tag}`;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wafflebot-installer-"));
const npmrcPath = path.join(tmpDir, ".npmrc");
fs.writeFileSync(
  npmrcPath,
  `registry=${publicRegistry}\n@${scope}:registry=${registry}\n`,
  "utf8",
);

const result = spawnSync(
  "npm",
  ["exec", "--yes", pkg, "--", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_userconfig: npmrcPath,
      npm_config_registry: publicRegistry,
    },
  },
);

fs.rmSync(tmpDir, { recursive: true, force: true });

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}
