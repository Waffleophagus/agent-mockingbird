import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync } from "node:fs";
import path from "node:path";

import { resolvedDbPath, sqlite } from "./client";
import * as schema from "./schema";
import { getBinaryDir } from "../paths";

function hasMigrationJournal(candidate: string) {
  return existsSync(path.join(candidate, "meta", "_journal.json"));
}

function resolveMigrationsFolder() {
  const candidates = [
    path.resolve(process.cwd(), "drizzle"),
    path.resolve(import.meta.dir, "../../../../../drizzle"),
    path.resolve(path.dirname(process.execPath), "drizzle"),
    path.resolve(getBinaryDir(), "drizzle"),
  ];
  for (const candidate of candidates) {
    if (hasMigrationJournal(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `SQLite migrations are missing meta/_journal.json. Checked: ${candidates.join(", ")}`,
  );
}

const migrationsFolder = resolveMigrationsFolder();
const migrationDb = drizzle({ client: sqlite, schema });

console.log(`Running SQLite migrations from ${migrationsFolder}`);
console.log(`Target database: ${resolvedDbPath}`);

migrate(migrationDb, { migrationsFolder });

console.log("Migrations complete");
