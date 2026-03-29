#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

const repoRoot = import.meta.dir;
const outdir = path.join(repoRoot, "dist");
const vendorRoot = path.join(repoRoot, "vendor", "opencode");
const appSourceDir = path.join(repoRoot, "vendor", "opencode", "packages", "app", "dist");
const appOutdir = path.join(outdir, "app");

console.log("Refreshing vendored OpenCode worktree...");
await Bun.$`bun run opencode:sync --rebuild-only`.cwd(repoRoot);
console.log("Installing vendored OpenCode dependencies...");
await Bun.$`bun install --cwd vendor/opencode --frozen-lockfile`.cwd(repoRoot);

if (!existsSync(vendorRoot)) {
  console.error(
    "Missing generated OpenCode worktree at vendor/opencode. Run `bun run opencode:sync --rebuild-only` first.",
  );
  process.exit(1);
}

if (existsSync(outdir)) {
  await rm(outdir, { recursive: true, force: true });
}
mkdirSync(outdir, { recursive: true });

await Bun.$`bun run build`.cwd(path.join(vendorRoot, "packages", "app")).quiet();

cpSync(appSourceDir, appOutdir, { recursive: true });

if (!existsSync(path.join(appOutdir, "index.html"))) {
  console.error(`Missing built OpenCode app assets in ${appOutdir}`);
  process.exit(1);
}

console.log(`Copied built OpenCode app assets into ${appOutdir}`);
