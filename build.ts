#!/usr/bin/env bun
import plugin from "bun-plugin-tailwind";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

const outdir = path.join(process.cwd(), "dist");

if (existsSync(outdir)) {
  await rm(outdir, { recursive: true, force: true });
}

const entrypoints = [...new Bun.Glob("**/*.html").scanSync("src")]
  .map(file => path.resolve("src", file))
  .filter(file => !file.includes("node_modules"));

const result = await Bun.build({
  entrypoints,
  outdir,
  plugins: [plugin],
  minify: true,
  target: "browser",
  sourcemap: "linked",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

if (!result.success) {
  for (const message of result.logs) {
    console.error(message);
  }
  process.exit(1);
}

console.log(`Built ${result.outputs.length} assets into ${outdir}`);
