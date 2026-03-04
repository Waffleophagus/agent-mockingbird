import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    WAFFLEBOT_DB_PATH: z.string().optional(),
    WAFFLEBOT_CONFIG_PATH: z.string().optional(),
    WAFFLEBOT_OPENCODE_AUTH_HEADER: z.string().optional(),
    WAFFLEBOT_OPENCODE_USERNAME: z.string().optional(),
    WAFFLEBOT_OPENCODE_PASSWORD: z.string().optional(),
    WAFFLEBOT_CRON_ENABLED: z.coerce.boolean().default(true),
    WAFFLEBOT_CRON_SCHEDULER_POLL_MS: z.coerce.number().int().min(250).default(1_000),
    WAFFLEBOT_CRON_WORKER_POLL_MS: z.coerce.number().int().min(250).default(1_000),
    WAFFLEBOT_CRON_LEASE_MS: z.coerce.number().int().min(1_000).default(30_000),
    WAFFLEBOT_CRON_MAX_ENQUEUE_PER_JOB_TICK: z.coerce.number().int().min(1).max(1_000).default(25),
    WAFFLEBOT_MEMORY_ENABLED: z.coerce.boolean().default(true),
    WAFFLEBOT_MEMORY_WORKSPACE_DIR: z.string().default("./data/workspace"),
    WAFFLEBOT_MEMORY_EMBED_PROVIDER: z.enum(["ollama", "none"]).default("ollama"),
    WAFFLEBOT_MEMORY_EMBED_MODEL: z.string().min(1).default("qwen3-embedding:4b"),
    WAFFLEBOT_MEMORY_OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
    WAFFLEBOT_MEMORY_CHUNK_TOKENS: z.coerce.number().int().positive().default(400),
    WAFFLEBOT_MEMORY_CHUNK_OVERLAP: z.coerce.number().int().min(0).default(80),
    WAFFLEBOT_MEMORY_MAX_RESULTS: z.coerce.number().int().positive().default(4),
    WAFFLEBOT_MEMORY_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.35),
    WAFFLEBOT_MEMORY_SYNC_COOLDOWN_MS: z.coerce.number().int().min(0).default(10_000),
    WAFFLEBOT_MEMORY_TOOL_MODE: z.enum(["hybrid", "inject_only", "tool_only"]).default("tool_only"),
    WAFFLEBOT_MEMORY_INJECTION_DEDUPE_ENABLED: z.coerce.boolean().default(true),
    WAFFLEBOT_MEMORY_INJECTION_DEDUPE_FALLBACK_RECALL_ONLY: z.coerce.boolean().default(true),
    WAFFLEBOT_MEMORY_INJECTION_DEDUPE_MAX_TRACKED: z.coerce.number().int().min(32).max(10_000).default(256),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
