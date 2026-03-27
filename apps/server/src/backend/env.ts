import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const explicitBooleanFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return value;
}, z.boolean());

const envSchema = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AGENT_MOCKINGBIRD_DB_PATH: z.string().optional(),
  AGENT_MOCKINGBIRD_CONFIG_PATH: z.string().optional(),
  AGENT_MOCKINGBIRD_OPENCODE_BASE_URL: z.string().url().optional(),
  AGENT_MOCKINGBIRD_OPENCODE_AUTH_HEADER: z.string().optional(),
  AGENT_MOCKINGBIRD_OPENCODE_USERNAME: z.string().optional(),
  AGENT_MOCKINGBIRD_OPENCODE_PASSWORD: z.string().optional(),
  AGENT_MOCKINGBIRD_EXECUTOR_ENABLED: explicitBooleanFromEnv.default(true),
  AGENT_MOCKINGBIRD_EXECUTOR_BASE_URL: z.string().url().optional(),
  AGENT_MOCKINGBIRD_EXECUTOR_WORKSPACE_DIR: z.string().default("./data/executor-workspace"),
  AGENT_MOCKINGBIRD_EXECUTOR_DATA_DIR: z.string().default("./data/executor"),
  AGENT_MOCKINGBIRD_EXECUTOR_UI_MOUNT_PATH: z.string().default("/executor"),
  AGENT_MOCKINGBIRD_EXECUTOR_HEALTHCHECK_PATH: z.string().default("/executor"),
  AGENT_MOCKINGBIRD_EXECUTOR_MODE: z.enum(["embedded-patched", "upstream-fallback"]).default("embedded-patched"),
  AGENT_MOCKINGBIRD_EXPO_PUSH_API_URL: z.string().url().default("https://exp.host/--/api/v2/push/send"),
  AGENT_MOCKINGBIRD_CRON_ENABLED: z.coerce.boolean().default(true),
  AGENT_MOCKINGBIRD_CRON_SCHEDULER_POLL_MS: z.coerce.number().int().min(250).default(1_000),
  AGENT_MOCKINGBIRD_CRON_WORKER_POLL_MS: z.coerce.number().int().min(250).default(1_000),
  AGENT_MOCKINGBIRD_CRON_LEASE_MS: z.coerce.number().int().min(1_000).default(30_000),
  AGENT_MOCKINGBIRD_CRON_MAX_ENQUEUE_PER_JOB_TICK: z.coerce.number().int().min(1).max(1_000).default(25),
  AGENT_MOCKINGBIRD_MEMORY_ENABLED: z.coerce.boolean().default(true),
  AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR: z.string().default("./data/workspace"),
  AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER: z.enum(["ollama", "none"]).default("ollama"),
  AGENT_MOCKINGBIRD_MEMORY_EMBED_MODEL: z.string().min(1).default("granite-embedding:278m"),
  AGENT_MOCKINGBIRD_MEMORY_OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  AGENT_MOCKINGBIRD_MEMORY_CHUNK_TOKENS: z.coerce.number().int().positive().default(400),
  AGENT_MOCKINGBIRD_MEMORY_CHUNK_OVERLAP: z.coerce.number().int().min(0).default(80),
  AGENT_MOCKINGBIRD_MEMORY_MAX_RESULTS: z.coerce.number().int().positive().default(4),
  AGENT_MOCKINGBIRD_MEMORY_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.35),
  AGENT_MOCKINGBIRD_MEMORY_SYNC_COOLDOWN_MS: z.coerce.number().int().min(0).default(10_000),
  AGENT_MOCKINGBIRD_MEMORY_TOOL_MODE: z.enum(["hybrid", "inject_only", "tool_only"]).default("tool_only"),
  AGENT_MOCKINGBIRD_MEMORY_INJECTION_DEDUPE_ENABLED: z.coerce.boolean().default(true),
  AGENT_MOCKINGBIRD_MEMORY_INJECTION_DEDUPE_FALLBACK_RECALL_ONLY: z.coerce.boolean().default(true),
  AGENT_MOCKINGBIRD_MEMORY_INJECTION_DEDUPE_MAX_TRACKED: z.coerce.number().int().min(32).max(10_000).default(256),
} satisfies Record<string, z.ZodTypeAny>;

function loadEnv() {
  return createEnv({
    server: envSchema,
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  });
}

type AppEnv = ReturnType<typeof loadEnv>;

export const env = new Proxy({} as AppEnv, {
  get(_target, property) {
    return loadEnv()[property as keyof AppEnv];
  },
});
