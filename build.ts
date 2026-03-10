#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

const repoRoot = import.meta.dir;
const outdir = path.join(repoRoot, "dist");
const vendorRoot = path.join(repoRoot, "vendor", "opencode");
const appSourceDir = path.join(repoRoot, "vendor", "opencode", "packages", "app", "dist");
const appOutdir = path.join(outdir, "app");

if (existsSync(outdir)) {
  await rm(outdir, { recursive: true, force: true });
}
mkdirSync(outdir, { recursive: true });

if (!existsSync(path.join(vendorRoot, "node_modules"))) {
  await Bun.$`bun install`.cwd(vendorRoot);
}

await Bun.$`bun run build`.cwd(path.join(vendorRoot, "packages", "app")).quiet();

cpSync(appSourceDir, appOutdir, { recursive: true });

if (!existsSync(path.join(appOutdir, "index.html"))) {
  console.error(`Missing built OpenCode app assets in ${appOutdir}`);
  process.exit(1);
}

console.log(`Copied built OpenCode app assets into ${appOutdir}`);
