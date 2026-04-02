#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

import { createStandaloneBuildOptions } from "./apps/server/src/cli/standaloneBuild";

const repoRoot = import.meta.dir;
const outdir = path.join(repoRoot, "dist");
const outfile = path.join(outdir, "agent-mockingbird");
const drizzleOutdir = path.join(outdir, "drizzle");
const vendorRoot = path.join(repoRoot, "vendor", "opencode");
const appSourceDir = path.join(vendorRoot, "packages", "app", "dist");
const appOutdir = path.join(outdir, "app");
const sqliteVecOutdir = path.join(outdir, "sqlite-vec");
const opencodeBundleRoot = path.join(outdir, "packages", "opencode");
const opencodeServerOutdir = path.join(opencodeBundleRoot, "src", "server");
const opencodeMigrationOutdir = path.join(opencodeBundleRoot, "migration");
const embeddedOpenCodeEntrypoint = path.join(repoRoot, "embedded-opencode.ts");
const opencodeMigrationSourceDir = path.join(vendorRoot, "packages", "opencode", "migration");

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

console.log("Building standalone binary...");
const standaloneBuild = await Bun.build(createStandaloneBuildOptions(repoRoot, outfile));

if (!standaloneBuild.success) {
  for (const message of standaloneBuild.logs) {
    console.error(message);
  }
  process.exit(1);
}

console.log("Building vendored OpenCode app...");
await Bun.$`bun run build`.cwd(path.join(vendorRoot, "packages", "app")).quiet();

console.log("Building embedded OpenCode server bundle...");
const openCodeServerBuild = await Bun.build({
  entrypoints: [embeddedOpenCodeEntrypoint],
  outdir: opencodeServerOutdir,
  target: "bun",
});

if (!openCodeServerBuild.success) {
  for (const message of openCodeServerBuild.logs) {
    console.error(message);
  }
  process.exit(1);
}

console.log("Resolving sqlite-vec loadable extension...");
const sqliteVec = await import("sqlite-vec");
const sqliteVecLoadablePath =
  typeof sqliteVec.getLoadablePath === "function" ? sqliteVec.getLoadablePath() : "";

if (!sqliteVecLoadablePath || !existsSync(sqliteVecLoadablePath)) {
  console.error("Missing sqlite-vec loadable extension in installed dependencies.");
  process.exit(1);
}

console.log("Copying packaged assets...");
cpSync(appSourceDir, appOutdir, { recursive: true });
cpSync(opencodeMigrationSourceDir, opencodeMigrationOutdir, { recursive: true });
cpSync(path.join(repoRoot, "drizzle"), drizzleOutdir, { recursive: true });
mkdirSync(sqliteVecOutdir, { recursive: true });
cpSync(sqliteVecLoadablePath, path.join(sqliteVecOutdir, path.basename(sqliteVecLoadablePath)));

if (!existsSync(path.join(appOutdir, "index.html"))) {
  console.error(`Missing built OpenCode app assets in ${appOutdir}`);
  process.exit(1);
}
if (!existsSync(outfile)) {
  console.error(`Missing standalone binary at ${outfile}`);
  process.exit(1);
}
if (!existsSync(path.join(sqliteVecOutdir, path.basename(sqliteVecLoadablePath)))) {
  console.error(`Missing sqlite-vec extension at ${sqliteVecOutdir}`);
  process.exit(1);
}

console.log(`Build complete: ${outdir}`);
