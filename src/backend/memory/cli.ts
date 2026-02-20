import {
  getMemoryStatus,
  lintMemory,
  listMemoryWriteEvents,
  rememberMemory,
  searchMemory,
  syncMemoryIndex,
} from "./service";

function usage() {
  console.log("Usage:");
  console.log("  bun run src/backend/memory/cli.ts status");
  console.log("  bun run src/backend/memory/cli.ts sync");
  console.log("  bun run src/backend/memory/cli.ts reindex");
  console.log("  bun run src/backend/memory/cli.ts search <query>");
  console.log("  bun run src/backend/memory/cli.ts remember <content>");
  console.log("  bun run src/backend/memory/cli.ts activity [limit]");
  console.log("  bun run src/backend/memory/cli.ts lint");
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
      const query = args.join(" ").trim();
      if (!query) {
        console.error("search requires a query");
        process.exitCode = 1;
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
    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exitCode = 1;
  }
}

void run();
