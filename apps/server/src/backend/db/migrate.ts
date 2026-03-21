import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { getResolvedDbPath } from "./client";
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

function tableExists(tableName: string) {
  const resolvedDbPath = getResolvedDbPath();
  mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
  const db = new Database(resolvedDbPath);
  try {
    const row = db
      .query(
        `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?1
        LIMIT 1
      `,
      )
      .get(tableName) as { name?: string } | null;
    return row?.name === tableName;
  } finally {
    db.close(false);
  }
}

const migrationsFolder = resolveMigrationsFolder();
const resolvedDbPath = getResolvedDbPath();
mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
const migrationSqlite = new Database(resolvedDbPath);
const migrationDb = drizzle({ client: migrationSqlite, schema });

console.log(`Running SQLite migrations from ${migrationsFolder}`);
console.log(`Target database: ${resolvedDbPath}`);

if (!tableExists("__drizzle_migrations") && tableExists("sessions")) {
  console.log("Bootstrap schema detected; running migrations");
}

try {
  migrate(migrationDb, { migrationsFolder });
} finally {
  migrationSqlite.close(false);
}

console.log("Migrations complete");
