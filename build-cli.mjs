#!/usr/bin/env bun
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const { console } = globalThis;

const repoRoot = import.meta.dir;
const src = path.join(repoRoot, "apps", "server", "src", "cli", "agent-mockingbird.mjs");
const runtimeAssetsSrc = path.join(repoRoot, "apps", "server", "src", "cli", "runtime-assets.mjs");
const runtimeLayoutSrc = path.join(repoRoot, "apps", "server", "src", "cli", "runtime-layout.mjs");
const outDir = path.join(repoRoot, "bin");
const out = path.join(outDir, "agent-mockingbird");
const runtimeAssetsOut = path.join(outDir, "runtime-assets.mjs");
const runtimeLayoutOut = path.join(outDir, "runtime-layout.mjs");

if (!existsSync(src)) {
  console.error(`Missing CLI source: ${src}`);
  process.exit(1);
}
if (!existsSync(runtimeAssetsSrc)) {
  console.error(`Missing CLI helper source: ${runtimeAssetsSrc}`);
  process.exit(1);
}
if (!existsSync(runtimeLayoutSrc)) {
  console.error(`Missing CLI helper source: ${runtimeLayoutSrc}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
copyFileSync(src, out);
copyFileSync(runtimeAssetsSrc, runtimeAssetsOut);
copyFileSync(runtimeLayoutSrc, runtimeLayoutOut);
chmodSync(out, 0o755);

console.log(`Built CLI: ${out}`);
console.log(`Built CLI helper: ${runtimeAssetsOut}`);
console.log(`Built CLI helper: ${runtimeLayoutOut}`);
