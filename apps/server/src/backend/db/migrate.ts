import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
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

function hasTable(db: Database, tableName: string) {
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
}

function hasColumn(db: Database, tableName: string, columnName: string) {
  const rows = db
    .query(`PRAGMA table_info(${JSON.stringify(tableName)})`)
    .all() as Array<{ name?: string }>;
  return rows.some(row => row.name === columnName);
}

function looksLikeCurrentBootstrapSchema(db: Database) {
  const requiredTables = [
    "sessions",
    "messages",
    "usage_events",
    "heartbeat_events",
    "runtime_config",
    "runtime_session_bindings",
    "background_runs",
    "message_memory_traces",
    "cron_job_definitions",
    "cron_job_instances",
    "cron_job_steps",
    "memory_records",
    "memory_write_events",
    "channel_conversation_bindings",
    "channel_pairing_requests",
    "channel_allowlist_entries",
    "channel_inbound_dedupe",
  ];
  if (requiredTables.some(tableName => !hasTable(db, tableName))) {
    return false;
  }

  const requiredColumns: Array<[string, string]> = [
    ["usage_events", "provider_id"],
    ["usage_events", "model_id"],
    ["cron_job_definitions", "condition_module_path"],
    ["cron_job_definitions", "condition_description"],
    ["cron_job_definitions", "thread_session_id"],
    ["cron_job_instances", "agent_invoked"],
  ];
  return requiredColumns.every(([tableName, columnName]) => hasColumn(db, tableName, columnName));
}

function seedBundledMigrationJournal(db: Database, migrationsFolder: string) {
  const migrations = readMigrationFiles({ migrationsFolder });
  db.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    );
  `);

  const insert = db.prepare(`
    INSERT INTO "__drizzle_migrations" ("hash", "created_at")
    VALUES (?1, ?2)
  `);
  for (const migration of migrations) {
    insert.run(migration.hash, migration.folderMillis);
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

if (!tableExists("__drizzle_migrations")) {
  const repairDb = new Database(resolvedDbPath);
  try {
    if (looksLikeCurrentBootstrapSchema(repairDb)) {
      console.log(
        "Current bootstrap schema detected without __drizzle_migrations; seeding migration journal",
      );
      seedBundledMigrationJournal(repairDb, migrationsFolder);
    }
  } finally {
    repairDb.close(false);
  }
}

try {
  migrate(migrationDb, { migrationsFolder });
} finally {
  migrationSqlite.close(false);
}

console.log("Migrations complete");
