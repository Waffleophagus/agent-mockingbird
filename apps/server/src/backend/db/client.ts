import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { env } from "../env";
import { resolveDataPath } from "../paths";

const resolvedDbPath = env.AGENT_MOCKINGBIRD_DB_PATH
  ? path.resolve(env.AGENT_MOCKINGBIRD_DB_PATH)
  : resolveDataPath("agent-mockingbird.db");

mkdirSync(path.dirname(resolvedDbPath), { recursive: true });

let sqliteHandle: Database | null = null;

function configureDatabase(db: Database) {
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=NORMAL;");
  db.exec("PRAGMA busy_timeout=5000;");
  db.exec("PRAGMA foreign_keys=ON;");
}

function getSqliteHandle() {
  if (!sqliteHandle) {
    sqliteHandle = new Database(resolvedDbPath);
    configureDatabase(sqliteHandle);
  }
  return sqliteHandle;
}

export const sqlite = new Proxy({} as Database, {
  get(_target, prop) {
    const db = getSqliteHandle();
    const value = Reflect.get(db as object, prop);
    if (prop === "close" && typeof value === "function") {
      return (...args: unknown[]) => {
        try {
          return (value as (...closeArgs: unknown[]) => unknown).apply(db, args);
        } finally {
          sqliteHandle = null;
        }
      };
    }
    if (typeof value === "function") {
      return value.bind(db);
    }
    return value;
  },
  set(_target, prop, value) {
    Reflect.set(getSqliteHandle() as object, prop, value);
    return true;
  },
});

export { resolvedDbPath };
