import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import path from "node:path";

import { resolvedDbPath, sqlite } from "./client";
import * as schema from "./schema";

const migrationsFolder = path.resolve(process.cwd(), "drizzle");
const migrationDb = drizzle({ client: sqlite, schema });

console.log(`Running SQLite migrations from ${migrationsFolder}`);
console.log(`Target database: ${resolvedDbPath}`);

migrate(migrationDb, { migrationsFolder });

console.log("Migrations complete");
