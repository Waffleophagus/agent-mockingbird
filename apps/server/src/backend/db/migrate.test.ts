import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("db:migrate seeds bundled migrations when current bootstrap schema exists without drizzle journal", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-migrate-"));
  tempDirs.push(tempDir);
  const dbPath = path.join(tempDir, "agent-mockingbird.db");

  const previousDbPath = process.env.AGENT_MOCKINGBIRD_DB_PATH;
  process.env.AGENT_MOCKINGBIRD_DB_PATH = dbPath;

  try {
    const { sqlite } = await import(`./client.ts?bootstrap=${Date.now()}`);
    sqlite.query("SELECT name FROM sqlite_master LIMIT 1").all();
    sqlite.close(false);

    const migrationRun = Bun.spawnSync({
      cmd: ["bun", "run", "src/backend/db/migrate.ts"],
      cwd: path.resolve(import.meta.dir, "../../.."),
      env: {
        ...process.env,
        AGENT_MOCKINGBIRD_DB_PATH: dbPath,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(migrationRun.exitCode).toBe(0);
    expect(migrationRun.stderr.toString()).toBe("");
    expect(migrationRun.stdout.toString()).toContain(
      "seeding migration journal",
    );

    const { Database } = await import("bun:sqlite");
    const db = new Database(dbPath, { readonly: true });
    try {
      const migrationCount = db
        .query('SELECT COUNT(*) AS count FROM "__drizzle_migrations"')
        .get() as { count: number };
      expect(migrationCount.count).toBe(8);
    } finally {
      db.close(false);
    }
  } finally {
    if (previousDbPath === undefined) {
      delete process.env.AGENT_MOCKINGBIRD_DB_PATH;
    } else {
      process.env.AGENT_MOCKINGBIRD_DB_PATH = previousDbPath;
    }
  }
});
