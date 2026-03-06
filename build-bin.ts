#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const repoRoot = import.meta.dir;
const outdir = path.join(repoRoot, "dist");
const outfile = path.join(outdir, "agent-mockingbird");
const drizzleOutdir = path.join(outdir, "drizzle");

mkdirSync(outdir, { recursive: true });
if (existsSync(outfile)) {
  rmSync(outfile, { force: true });
}
if (existsSync(drizzleOutdir)) {
  rmSync(drizzleOutdir, { recursive: true, force: true });
}

console.log("Building standalone binary...");
const result = await Bun.build({
  entrypoints: [path.join(repoRoot, "apps/server/src/index.ts")],
  compile: {
    outfile,
  },
  minify: true,
  sourcemap: "linked",
});

if (!result.success) {
  for (const message of result.logs) {
    console.error(message);
  }
  process.exit(1);
}

console.log("Copying migrations...");
cpSync(path.join(repoRoot, "drizzle"), drizzleOutdir, { recursive: true });

console.log(`Build complete: ${outdir}/agent-mockingbird`);
console.log("\nTo deploy, copy the entire 'dist' folder to your target location.");
