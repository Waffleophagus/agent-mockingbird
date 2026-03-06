#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const repoRoot = import.meta.dir;
const outdir = path.join(repoRoot, "dist");

if (existsSync(outdir)) {
  rmSync(outdir, { recursive: true, force: true });
}
mkdirSync(outdir, { recursive: true });

console.log("Building standalone binary...");
const result = await Bun.build({
  entrypoints: [path.join(repoRoot, "apps/server/src/index.ts")],
  compile: {
    outfile: path.join(repoRoot, "dist/wafflebot"),
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
cpSync(path.join(repoRoot, "drizzle"), path.join(outdir, "drizzle"), { recursive: true });

console.log(`Build complete: ${outdir}/wafflebot`);
console.log("\nTo deploy, copy the entire 'dist' folder to your target location.");
