#!/usr/bin/env bun
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const { console } = globalThis;

const root = process.cwd();
const src = path.join(root, "src", "cli", "wafflebot.mjs");
const runtimeAssetsSrc = path.join(root, "src", "cli", "runtime-assets.mjs");
const outDir = path.join(root, "bin");
const out = path.join(outDir, "wafflebot");
const runtimeAssetsOut = path.join(outDir, "runtime-assets.mjs");

if (!existsSync(src)) {
  console.error(`Missing CLI source: ${src}`);
  process.exit(1);
}
if (!existsSync(runtimeAssetsSrc)) {
  console.error(`Missing CLI helper source: ${runtimeAssetsSrc}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
copyFileSync(src, out);
copyFileSync(runtimeAssetsSrc, runtimeAssetsOut);
chmodSync(out, 0o755);

console.log(`Built CLI: ${out}`);
console.log(`Built CLI helper: ${runtimeAssetsOut}`);
