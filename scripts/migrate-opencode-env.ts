import { applyConfigPatch, getConfigSnapshot } from "../src/backend/config/service";

const LEGACY_OPENCODE_ENV_KEYS = [
  "WAFFLEBOT_OPENCODE_BASE_URL",
  "WAFFLEBOT_OPENCODE_PROVIDER_ID",
  "WAFFLEBOT_OPENCODE_MODEL_ID",
  "WAFFLEBOT_OPENCODE_MODEL_FALLBACKS",
  "WAFFLEBOT_OPENCODE_SMALL_MODEL",
  "WAFFLEBOT_OPENCODE_TIMEOUT_MS",
  "WAFFLEBOT_OPENCODE_PROMPT_TIMEOUT_MS",
  "WAFFLEBOT_OPENCODE_RUN_WAIT_TIMEOUT_MS",
  "WAFFLEBOT_OPENCODE_DIRECTORY",
] as const;

function listLegacyOpencodeRuntimeEnvVars(source: Record<string, string | undefined> = process.env) {
  return LEGACY_OPENCODE_ENV_KEYS.filter((key) => {
    const value = source[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function parseStringList(raw: string | undefined) {
  if (!raw) return [];
  const normalized = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(normalized)];
}

function parsePositiveInt(raw: string | undefined) {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function trimOrNull(raw: string | undefined) {
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function main() {
  const present = listLegacyOpencodeRuntimeEnvVars();
  if (present.length === 0) {
    console.log("[config:migrate-opencode-env] No deprecated WAFFLEBOT_OPENCODE_* runtime vars found.");
    return;
  }

  const patch: Record<string, unknown> = {};

  const baseUrl = trimOrNull(process.env.WAFFLEBOT_OPENCODE_BASE_URL);
  if (baseUrl) patch.baseUrl = baseUrl;
  const providerId = trimOrNull(process.env.WAFFLEBOT_OPENCODE_PROVIDER_ID);
  if (providerId) patch.providerId = providerId;
  const modelId = trimOrNull(process.env.WAFFLEBOT_OPENCODE_MODEL_ID);
  if (modelId) patch.modelId = modelId;
  const fallbackModels = parseStringList(process.env.WAFFLEBOT_OPENCODE_MODEL_FALLBACKS);
  if (fallbackModels.length > 0) patch.fallbackModels = fallbackModels;
  const smallModel = trimOrNull(process.env.WAFFLEBOT_OPENCODE_SMALL_MODEL);
  if (smallModel) patch.smallModel = smallModel;
  const timeoutMs = parsePositiveInt(process.env.WAFFLEBOT_OPENCODE_TIMEOUT_MS);
  if (timeoutMs) patch.timeoutMs = timeoutMs;
  const promptTimeoutMs = parsePositiveInt(process.env.WAFFLEBOT_OPENCODE_PROMPT_TIMEOUT_MS);
  if (promptTimeoutMs) patch.promptTimeoutMs = promptTimeoutMs;
  const runWaitTimeoutMs = parsePositiveInt(process.env.WAFFLEBOT_OPENCODE_RUN_WAIT_TIMEOUT_MS);
  if (runWaitTimeoutMs) patch.runWaitTimeoutMs = runWaitTimeoutMs;
  const directory = trimOrNull(process.env.WAFFLEBOT_OPENCODE_DIRECTORY);
  if (directory) patch.directory = directory;

  if (Object.keys(patch).length === 0) {
    console.log("[config:migrate-opencode-env] Deprecated vars are present but no valid values were parsed.");
    return;
  }

  const snapshot = getConfigSnapshot();
  const result = await applyConfigPatch({
    expectedHash: snapshot.hash,
    runSmokeTest: false,
    patch: {
      runtime: {
        opencode: patch,
      },
    },
  });

  console.log("[config:migrate-opencode-env] Migrated values into wafflebot config.");
  console.log(
    JSON.stringify(
      {
        configPath: result.snapshot.path,
        previousHash: snapshot.hash,
        nextHash: result.snapshot.hash,
        appliedFields: Object.keys(patch).sort(),
        migratedEnvVars: present,
      },
      null,
      2,
    ),
  );
  console.log("[config:migrate-opencode-env] Remove deprecated WAFFLEBOT_OPENCODE_* runtime vars before starting wafflebot.");
}

void main().catch((error) => {
  console.error("[config:migrate-opencode-env] Failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
