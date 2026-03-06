#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

const repoRoot = import.meta.dir;
const outdir = path.join(repoRoot, "dist");

if (existsSync(outdir)) {
  await rm(outdir, { recursive: true, force: true });
}

const webRoot = path.join(repoRoot, "apps", "web");
const webOutdir = path.join(outdir, "web");

const entrypoints = [path.join(webRoot, "index.html")];

const result = await Bun.build({
  entrypoints,
  outdir: webOutdir,
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

console.log(`Built ${result.outputs.length} assets into ${webOutdir}`);
