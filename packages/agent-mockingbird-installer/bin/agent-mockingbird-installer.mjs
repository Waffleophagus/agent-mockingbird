#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const scope = (process.env.AGENT_MOCKINGBIRD_INSTALLER_SCOPE || "waffleophagus").replace(/^@/, "");
const tag = process.env.AGENT_MOCKINGBIRD_INSTALLER_TAG || "latest";
const registry = process.env.AGENT_MOCKINGBIRD_REGISTRY_URL || "https://git.waffleophagus.com/api/packages/waffleophagus/npm/";
const publicRegistry = process.env.AGENT_MOCKINGBIRD_PUBLIC_REGISTRY_URL || "https://registry.npmjs.org/";
const pkg = `@${scope}/agent-mockingbird@${tag}`;
const installerDir = path.dirname(new URL(import.meta.url).pathname);
const opencodeLockPath = path.join(installerDir, "..", "opencode.lock.json");
const opencodeVersion = fs.existsSync(opencodeLockPath)
  ? JSON.parse(fs.readFileSync(opencodeLockPath, "utf8")).packageVersion
  : undefined;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-installer-"));
const npmrcPath = path.join(tmpDir, ".npmrc");
fs.writeFileSync(
  npmrcPath,
  `registry=${publicRegistry}\n@${scope}:registry=${registry}\n`,
  "utf8",
);

const result = spawnSync(
  "npm",
  ["exec", "--yes", "--package", pkg, "agent-mockingbird", "--", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(opencodeVersion ? { AGENT_MOCKINGBIRD_OPENCODE_VERSION: opencodeVersion } : {}),
      npm_config_userconfig: npmrcPath,
      npm_config_registry: publicRegistry,
    },
  },
);

fs.rmSync(tmpDir, { recursive: true, force: true });

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}
