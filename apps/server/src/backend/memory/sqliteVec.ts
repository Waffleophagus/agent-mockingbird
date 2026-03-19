import type { Database } from "bun:sqlite";

import { sqlite } from "../db/client";

interface SqliteVecState {
  available: boolean;
  version: string | null;
  error: string | null;
  loaded: boolean;
}

let state: SqliteVecState = {
  available: false,
  version: null,
  error: null,
  loaded: false,
};

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function ensureSqliteVecLoaded(db: Database = sqlite): Promise<SqliteVecState> {
  if (state.loaded) return state;
  try {
    const sqliteVec = await import("sqlite-vec");
    const loadablePath =
      typeof sqliteVec.getLoadablePath === "function" ? sqliteVec.getLoadablePath() : "";
    if (!loadablePath) {
      throw new Error("sqlite-vec loadable path is unavailable");
    }
    db.loadExtension(loadablePath);
    const row = db
      .query("SELECT vec_version() as version")
      .get() as { version?: string } | null;
    if (!row?.version || typeof row.version !== "string") {
      throw new Error("vec_version() returned no version");
    }
    state = {
      available: true,
      version: row.version,
      error: null,
      loaded: true,
    };
  } catch (error) {
    state = {
      available: false,
      version: null,
      error: formatError(error),
      loaded: true,
    };
  }
  return state;
}

export function getSqliteVecState() {
  return state;
}
