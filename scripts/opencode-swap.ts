#!/usr/bin/env bun
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dir, "..");

type ParsedArgs = {
  ref?: string;
  yes: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { yes: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--yes" || arg === "-y") {
      parsed.yes = true;
      continue;
    }
    if (arg === "--ref") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value after --ref.");
      }
      parsed.ref = value;
      index += 1;
      continue;
    }
    if (!parsed.ref) {
      parsed.ref = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function promptForRef(current?: string) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await rl.question(`OpenCode version/tag to hard swap to${current ? ` [${current}]` : ""}: `)).trim();
    return answer || current || "";
  } finally {
    rl.close();
  }
}

function run(ref: string) {
  const result = spawnSync("bun", ["run", "./scripts/opencode-sync.ts", "--hard-ref", ref], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ref = args.ref || (await promptForRef());
  if (!ref) {
    throw new Error("No version/tag provided.");
  }

  if (!args.yes) {
    console.log(`Hard-swapping OpenCode to ${ref}. This discards current vendor/opencode state before rebuilding.`);
  }
  run(ref);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
