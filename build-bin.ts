#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const outdir = path.join(process.cwd(), "dist");

if (existsSync(outdir)) {
  rmSync(outdir, { recursive: true, force: true });
}
mkdirSync(outdir, { recursive: true });

console.log("Building standalone binary...");
const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  compile: {
    outfile: "./dist/wafflebot",
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
cpSync(path.join(process.cwd(), "drizzle"), path.join(outdir, "drizzle"), { recursive: true });

console.log(`Build complete: ${outdir}/wafflebot`);
console.log("\nTo deploy, copy the entire 'dist' folder to your target location.");
