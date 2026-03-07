#!/usr/bin/env bun
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const rootDir = import.meta.dir;
const workspaceRoot = path.resolve(rootDir, "..", "..");
const outDir = path.join(rootDir, "dist");
const frontendEntry = path.join(rootDir, "src", "frontend.tsx");
const cssEntry = path.join(rootDir, "src", "index.css");
const cssOutfile = path.join(outDir, "index.css");
const htmlOutfile = path.join(outDir, "index.html");
const tailwindCliEntry = path.join(workspaceRoot, "node_modules", "@tailwindcss", "cli", "dist", "index.mjs");
const requiredCssMarkers = [
  "counter(line)",
  "sdm-c",
  "muted\\/80",
];

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}
mkdirSync(outDir, { recursive: true });

if (!existsSync(tailwindCliEntry)) {
  console.error(`Missing Tailwind CLI at ${tailwindCliEntry}. Run bun install before building.`);
  process.exit(1);
}

const build = await Bun.build({
  entrypoints: [frontendEntry],
  outdir: outDir,
  minify: true,
  sourcemap: "linked",
  target: "browser",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

if (!build.success) {
  for (const message of build.logs) {
    console.error(message);
  }
  process.exit(1);
}

const jsOutput = build.outputs.find(output => output.path.endsWith(".js"));
if (!jsOutput) {
  console.error("Expected a JavaScript bundle for the web frontend build.");
  process.exit(1);
}

const tailwindProcess = Bun.spawn([process.execPath, tailwindCliEntry, "-i", cssEntry, "-o", cssOutfile, "--minify"], {
  cwd: rootDir,
  stdout: "inherit",
  stderr: "inherit",
});

if ((await tailwindProcess.exited) !== 0) {
  console.error("Tailwind CSS compilation failed.");
  process.exit(1);
}

const cssText = await Bun.file(cssOutfile).text();
for (const marker of requiredCssMarkers) {
  if (!cssText.includes(marker)) {
    console.error(`Bundled CSS is missing Streamdown marker: ${marker}`);
    process.exit(1);
  }
}

const jsFile = path.basename(jsOutput.path);
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent Mockingbird Control Dashboard</title>
    <link rel="stylesheet" href="./index.css" />
    <script type="module" src="./${jsFile}"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

await Bun.write(htmlOutfile, html);

console.log(`Built web assets into ${outDir}`);
