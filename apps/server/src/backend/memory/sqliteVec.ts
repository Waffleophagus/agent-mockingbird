import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";

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

const SQLITE_VEC_ENTRYPOINT_BASENAME = "vec0";
const SQLITE_VEC_DIST_DIRNAME = "sqlite-vec";

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getSqliteVecEntrypointFilename(platformName: NodeJS.Platform = process.platform) {
  if (platformName === "win32") {
    return `${SQLITE_VEC_ENTRYPOINT_BASENAME}.dll`;
  }
  if (platformName === "darwin") {
    return `${SQLITE_VEC_ENTRYPOINT_BASENAME}.dylib`;
  }
  return `${SQLITE_VEC_ENTRYPOINT_BASENAME}.so`;
}

export function findPackagedSqliteVecLoadablePath(options?: {
  cwd?: string;
  execPath?: string;
  platform?: NodeJS.Platform;
}) {
  const filename = getSqliteVecEntrypointFilename(options?.platform);
  const candidates = [
    path.join(path.dirname(options?.execPath ?? process.execPath), SQLITE_VEC_DIST_DIRNAME, filename),
    path.join(options?.cwd ?? process.cwd(), "dist", SQLITE_VEC_DIST_DIRNAME, filename),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function resolveSqliteVecLoadablePath() {
  const errors: string[] = [];

  try {
    const sqliteVec = await import("sqlite-vec");
    const loadablePath =
      typeof sqliteVec.getLoadablePath === "function" ? sqliteVec.getLoadablePath() : "";
    if (!loadablePath) {
      throw new Error("sqlite-vec loadable path is unavailable");
    }
    if (existsSync(loadablePath)) {
      return loadablePath;
    }
    errors.push(formatError(new Error(`sqlite-vec loadable path does not exist: ${loadablePath}`)));
  } catch (error) {
    errors.push(formatError(error));
  }

  const packagedPath = findPackagedSqliteVecLoadablePath();
  if (packagedPath) {
    return packagedPath;
  }

  throw new Error(errors.filter(Boolean).join(" | ") || "sqlite-vec loadable path is unavailable");
}

export async function ensureSqliteVecLoaded(db: Database = sqlite): Promise<SqliteVecState> {
  if (state.loaded) return state;
  try {
    const loadablePath = await resolveSqliteVecLoadablePath();
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
