import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { migrateLegacyMemoryMarkdownToV2 } from "./records";
import {
  getMemoryStatus,
  lintMemory,
  listMemoryWriteEvents,
  rememberMemory,
  searchMemoryDetailed,
  searchMemory,
  syncMemoryIndex,
} from "./service";

function usage() {
  console.log("Usage:");
  console.log("  bun run src/backend/memory/cli.ts status");
  console.log("  bun run src/backend/memory/cli.ts sync");
  console.log("  bun run src/backend/memory/cli.ts reindex");
  console.log("  bun run src/backend/memory/cli.ts search <query>");
  console.log("  bun run src/backend/memory/cli.ts search --debug <query>");
  console.log("  bun run src/backend/memory/cli.ts remember <content>");
  console.log("  bun run src/backend/memory/cli.ts activity [limit]");
  console.log("  bun run src/backend/memory/cli.ts lint");
  console.log("  bun run src/backend/memory/cli.ts migrate-format");
}

async function listMarkdownFiles(dir: string, output: string[]) {
  let entries: Array<{ name: string; isFile: () => boolean; isDirectory: () => boolean }> = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await listMarkdownFiles(fullPath, output);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      output.push(fullPath);
    }
  }
}

async function collectWorkspaceMemoryFiles(workspaceDir: string) {
  const files: string[] = [];
  for (const candidate of [path.join(workspaceDir, "MEMORY.md"), path.join(workspaceDir, "memory.md")]) {
    try {
      const fileStat = await stat(candidate);
      if (fileStat.isFile()) files.push(candidate);
    } catch {
      // noop
    }
  }
  await listMarkdownFiles(path.join(workspaceDir, "memory"), files);
  return [...new Set(files)];
}

async function run() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    usage();
    process.exitCode = 1;
    return;
  }

  switch (command) {
    case "status": {
      const status = await getMemoryStatus();
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    case "sync": {
      await syncMemoryIndex();
      const status = await getMemoryStatus();
      console.log(`Memory sync complete. Files=${status.files} Chunks=${status.chunks}`);
      return;
    }
    case "reindex": {
      await syncMemoryIndex({ force: true });
      const status = await getMemoryStatus();
      console.log(`Memory reindex complete. Files=${status.files} Chunks=${status.chunks}`);
      return;
    }
    case "search": {
      const debug = args.includes("--debug");
      const normalizedArgs = args.filter(arg => arg !== "--debug");
      const query = normalizedArgs.join(" ").trim();
      if (!query) {
        console.error("search requires a query");
        process.exitCode = 1;
        return;
      }
      if (debug) {
        const detailed = await searchMemoryDetailed(query);
        console.log(JSON.stringify({ query, results: detailed.results, debug: detailed.debug }, null, 2));
        return;
      }
      const results = await searchMemory(query);
      console.log(JSON.stringify({ query, results }, null, 2));
      return;
    }
    case "remember": {
      const content = args.join(" ").trim();
      if (!content) {
        console.error("remember requires <content>");
        process.exitCode = 1;
        return;
      }
      const result = await rememberMemory({
        source: "system",
        content,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case "activity": {
      const rawLimit = Number(args[0] ?? "20");
      const limit = Number.isFinite(rawLimit) ? rawLimit : 20;
      const events = await listMemoryWriteEvents(limit);
      console.log(JSON.stringify({ count: events.length, events }, null, 2));
      return;
    }
    case "lint": {
      const report = await lintMemory();
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.ok ? 0 : 2;
      return;
    }
    case "migrate-format": {
      const status = await getMemoryStatus();
      const files = await collectWorkspaceMemoryFiles(status.workspaceDir);
      let migratedFiles = 0;
      let migratedRecords = 0;

      for (const filePath of files) {
        const raw = await readFile(filePath, "utf8");
        const migrated = migrateLegacyMemoryMarkdownToV2(raw);
        if (migrated.migrated <= 0) continue;
        await writeFile(filePath, migrated.content, "utf8");
        migratedFiles += 1;
        migratedRecords += migrated.migrated;
      }

      await syncMemoryIndex({ force: true });
      console.log(
        JSON.stringify(
          {
            ok: true,
            workspaceDir: status.workspaceDir,
            filesScanned: files.length,
            migratedFiles,
            migratedRecords,
          },
          null,
          2,
        ),
      );
      return;
    }
    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exitCode = 1;
  }
}

void run();
