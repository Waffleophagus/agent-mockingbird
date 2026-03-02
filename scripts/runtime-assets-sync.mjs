#!/usr/bin/env bun
import process from "node:process";
import { syncRuntimeWorkspaceAssets } from "../src/cli/runtime-assets.mjs";

const { console } = globalThis;

function parseArgs(argv) {
  const args = {
    source: "",
    target: "",
    state: "",
    mode: "install",
    interactive: false,
    quiet: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if ((arg === "--source" || arg === "--target" || arg === "--state" || arg === "--mode") && next) {
      if (arg === "--source") args.source = next;
      if (arg === "--target") args.target = next;
      if (arg === "--state") args.state = next;
      if (arg === "--mode") args.mode = next;
      index += 1;
      continue;
    }
    if (arg === "--interactive") {
      args.interactive = true;
      continue;
    }
    if (arg === "--non-interactive") {
      args.interactive = false;
      continue;
    }
    if (arg === "--quiet") {
      args.quiet = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log("Usage: bun scripts/runtime-assets-sync.mjs --source <dir> --target <dir> --state <file> [--mode install|update] [--interactive|--non-interactive] [--quiet]");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.source || !args.target || !args.state) {
    throw new Error("--source, --target, and --state are required");
  }

  const result = await syncRuntimeWorkspaceAssets({
    sourceWorkspaceDir: args.source,
    targetWorkspaceDir: args.target,
    stateFilePath: args.state,
    mode: args.mode === "update" ? "update" : "install",
    interactive: Boolean(args.interactive),
    logger: args.quiet ? undefined : message => console.log(message),
  });

  if (!args.quiet) {
    console.log(
      `runtime-assets summary: scanned=${result.scannedFiles}, copied=${result.copied}, overwritten=${result.overwritten}, unchanged=${result.unchanged}, keptLocal=${result.keptLocal}, conflicts=${result.conflicts}, backups=${result.backupsCreated}`,
    );
  }
}

await main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
