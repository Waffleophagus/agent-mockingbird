#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

const repoRoot = import.meta.dir;
const outdir = path.join(repoRoot, "dist");
const webSourceDir = path.join(repoRoot, "apps", "web", "dist");
const webOutdir = path.join(outdir, "web");

if (existsSync(outdir)) {
  await rm(outdir, { recursive: true, force: true });
}
mkdirSync(outdir, { recursive: true });

await Bun.$`bun run ./build.ts`.cwd(path.join(repoRoot, "apps", "web")).quiet();

cpSync(webSourceDir, webOutdir, { recursive: true });

if (!existsSync(path.join(webOutdir, "index.html"))) {
  console.error(`Missing built dashboard assets in ${webOutdir}`);
  process.exit(1);
}

console.log(`Copied built web assets into ${webOutdir}`);
