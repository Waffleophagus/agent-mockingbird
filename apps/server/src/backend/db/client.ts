import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { env } from "../env";
import { resolveDataPath } from "../paths";

const resolvedDbPath = env.AGENT_MOCKINGBIRD_DB_PATH
  ? path.resolve(env.AGENT_MOCKINGBIRD_DB_PATH)
  : resolveDataPath("agent-mockingbird.db");

mkdirSync(path.dirname(resolvedDbPath), { recursive: true });

export const sqlite = new Database(resolvedDbPath);
sqlite.exec("PRAGMA journal_mode=WAL;");
sqlite.exec("PRAGMA synchronous=NORMAL;");
sqlite.exec("PRAGMA busy_timeout=5000;");
sqlite.exec("PRAGMA foreign_keys=ON;");

export { resolvedDbPath };
