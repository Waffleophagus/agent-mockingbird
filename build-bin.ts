#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { createStandaloneBuildOptions } from "./apps/server/src/cli/standaloneBuild";

const repoRoot = import.meta.dir;
const outdir = path.join(repoRoot, "dist");
const outfile = path.join(outdir, "agent-mockingbird");
const drizzleOutdir = path.join(outdir, "drizzle");
const opencodeBundleRoot = path.join(outdir, "packages", "opencode");
const legacyOpencodeServerOutdir = path.join(outdir, "opencode-server");
const opencodeServerOutdir = path.join(opencodeBundleRoot, "src", "server");
const opencodeMigrationOutdir = path.join(opencodeBundleRoot, "migration");
const embeddedOpenCodeEntrypoint = path.join(repoRoot, "embedded-opencode.ts");
const opencodeMigrationSourceDir = path.join(
  repoRoot,
  "vendor",
  "opencode",
  "packages",
  "opencode",
  "migration",
);

console.log("Refreshing vendored Executor worktree...");
await Bun.$`bun run executor:sync --rebuild-only`.cwd(repoRoot);
console.log("Installing vendored Executor dependencies...");
await Bun.$`bun install --cwd vendor/executor --frozen-lockfile`.cwd(repoRoot);
console.log("Refreshing vendored OpenCode worktree...");
await Bun.$`bun run opencode:sync --rebuild-only`.cwd(repoRoot);
console.log("Installing vendored OpenCode dependencies...");
await Bun.$`bun install --cwd vendor/opencode --frozen-lockfile`.cwd(repoRoot);

mkdirSync(outdir, { recursive: true });
if (existsSync(outfile)) {
  rmSync(outfile, { force: true });
}
if (existsSync(drizzleOutdir)) {
  rmSync(drizzleOutdir, { recursive: true, force: true });
}
if (existsSync(opencodeBundleRoot)) {
  rmSync(opencodeBundleRoot, { recursive: true, force: true });
}
if (existsSync(legacyOpencodeServerOutdir)) {
  rmSync(legacyOpencodeServerOutdir, { recursive: true, force: true });
}

console.log("Building standalone binary...");
const result = await Bun.build(createStandaloneBuildOptions(repoRoot, outfile));

if (!result.success) {
  for (const message of result.logs) {
    console.error(message);
  }
  process.exit(1);
}

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

console.log("Copying embedded OpenCode migrations...");
cpSync(opencodeMigrationSourceDir, opencodeMigrationOutdir, { recursive: true });

console.log("Copying migrations...");
cpSync(path.join(repoRoot, "drizzle"), drizzleOutdir, { recursive: true });

console.log(`Build complete: ${outdir}/agent-mockingbird`);
console.log("\nTo deploy, copy the entire 'dist' folder to your target location.");
