import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { sqlite } from "../db/client";
import { DEFAULT_AGENTS, DEFAULT_MCPS, DEFAULT_SKILLS } from "../defaults";
import { env } from "../env";
import {
  agentTypeDefinitionSchema,
  wafflebotConfigSchema,
  specialistAgentSchema,
  type AgentTypeDefinition,
  type WafflebotConfig,
} from "./schema";
import { ConfigApplyError, type WafflebotConfigSnapshot } from "./types";

interface ConfigRow {
  value_json: string;
}

const CONFIG_VERSION = 1 as const;
const DEFAULT_CONFIG_FILENAME = "wafflebot.config.json";
const BACKUP_SUFFIX = ".bak";
const DEFAULT_SMOKE_TEST_PROMPT = 'Just respond "OK" to this to confirm the gateway is working.';
const DEFAULT_SMOKE_TEST_PATTERN = "\\bok\\b";
const legacyStringListSchema = z.array(z.string().min(1));
const legacyAgentListSchema = z.array(specialistAgentSchema);
const legacyAgentTypeListSchema = z.array(agentTypeDefinitionSchema);
type LegacyConfigKey = "skills" | "mcps" | "agents" | "agent_types";

function resolvedConfigPath() {
  const configuredPath = env.WAFFLEBOT_CONFIG_PATH?.trim();
  if (configuredPath) {
    return path.resolve(configuredPath);
  }
  return path.resolve(process.cwd(), "data", DEFAULT_CONFIG_FILENAME);
}

function backupPathFor(configPath: string) {
  return `${configPath}${BACKUP_SUFFIX}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringList(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(",")}]`;
  if (!isPlainObject(value)) return JSON.stringify(value);
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  const serializedEntries = entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${serializedEntries.join(",")}}`;
}

function computeConfigHash(config: WafflebotConfig) {
  return createHash("sha256").update(stableStringify(config)).digest("hex");
}

function parseFallbackModels(raw: string | undefined) {
  if (!raw) return [];
  return normalizeStringList(raw.split(","));
}

function readLegacyConfigRow(key: LegacyConfigKey) {
  const row = sqlite.query("SELECT value_json FROM runtime_config WHERE key = ?1").get(key) as ConfigRow | null;
  if (!row?.value_json) return null;
  try {
    return JSON.parse(row.value_json) as unknown;
  } catch {
    return null;
  }
}

function readLegacyStringListConfig(key: "skills" | "mcps", fallback: string[]) {
  const value = readLegacyConfigRow(key);
  const parsed = legacyStringListSchema.safeParse(value);
  if (!parsed.success) return fallback;
  return normalizeStringList(parsed.data);
}

function readLegacyAgentConfig(fallback: WafflebotConfig["ui"]["agents"]) {
  const value = readLegacyConfigRow("agents");
  const parsed = legacyAgentListSchema.safeParse(value);
  if (!parsed.success) return fallback;
  return parsed.data;
}

function readLegacyAgentTypeConfig(fallback: WafflebotConfig["ui"]["agentTypes"]) {
  const value = readLegacyConfigRow("agent_types");
  const parsed = legacyAgentTypeListSchema.safeParse(value);
  if (!parsed.success) return fallback;
  return parsed.data;
}

function mapLegacyAgentToAgentType(agent: WafflebotConfig["ui"]["agents"][number]): AgentTypeDefinition {
  return {
    id: agent.id.trim(),
    name: agent.name.trim() || undefined,
    description: agent.specialty.trim() || undefined,
    prompt: agent.summary.trim() || undefined,
    model: agent.model.trim() || undefined,
    mode: "subagent",
    disable: agent.status === "offline",
    hidden: false,
    options: {
      wafflebotManagedLegacy: true,
      wafflebotDisplayName: agent.name.trim(),
      wafflebotStatus: agent.status,
    },
  };
}

function mergeAgentTypesWithLegacyAgents(
  agentTypes: WafflebotConfig["ui"]["agentTypes"],
  agents: WafflebotConfig["ui"]["agents"],
) {
  const merged = new Map(agentTypes.map(agentType => [agentType.id, agentType]));
  for (const agent of agents) {
    const id = agent.id.trim();
    if (!id || merged.has(id)) continue;
    merged.set(id, mapLegacyAgentToAgentType(agent));
  }
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function buildLegacyBootstrappedConfig() {
  const candidate: WafflebotConfig = {
    version: CONFIG_VERSION,
    runtime: {
      opencode: {
        baseUrl: env.WAFFLEBOT_OPENCODE_BASE_URL,
        providerId: env.WAFFLEBOT_OPENCODE_PROVIDER_ID.trim(),
        modelId: env.WAFFLEBOT_OPENCODE_MODEL_ID.trim(),
        fallbackModels: parseFallbackModels(env.WAFFLEBOT_OPENCODE_MODEL_FALLBACKS),
        smallModel: env.WAFFLEBOT_OPENCODE_SMALL_MODEL.trim(),
        timeoutMs: env.WAFFLEBOT_OPENCODE_TIMEOUT_MS,
        promptTimeoutMs: env.WAFFLEBOT_OPENCODE_PROMPT_TIMEOUT_MS,
        runWaitTimeoutMs: env.WAFFLEBOT_OPENCODE_RUN_WAIT_TIMEOUT_MS,
        childSessionHideAfterDays: 3,
        directory: env.WAFFLEBOT_OPENCODE_DIRECTORY?.trim() || null,
      },
      smokeTest: {
        prompt: DEFAULT_SMOKE_TEST_PROMPT,
        expectedResponsePattern: DEFAULT_SMOKE_TEST_PATTERN,
      },
      runStream: {
        heartbeatMs: 15_000,
        replayPageSize: 200,
      },
      memory: {
        enabled: env.WAFFLEBOT_MEMORY_ENABLED,
        workspaceDir: env.WAFFLEBOT_MEMORY_WORKSPACE_DIR,
        embedProvider: env.WAFFLEBOT_MEMORY_EMBED_PROVIDER,
        embedModel: env.WAFFLEBOT_MEMORY_EMBED_MODEL,
        ollamaBaseUrl: env.WAFFLEBOT_MEMORY_OLLAMA_BASE_URL,
        chunkTokens: env.WAFFLEBOT_MEMORY_CHUNK_TOKENS,
        chunkOverlap: env.WAFFLEBOT_MEMORY_CHUNK_OVERLAP,
        maxResults: env.WAFFLEBOT_MEMORY_MAX_RESULTS,
        minScore: env.WAFFLEBOT_MEMORY_MIN_SCORE,
        syncCooldownMs: env.WAFFLEBOT_MEMORY_SYNC_COOLDOWN_MS,
        toolMode: env.WAFFLEBOT_MEMORY_TOOL_MODE,
      },
      cron: {
        defaultMaxAttempts: 3,
        defaultRetryBackoffMs: 30_000,
        retryBackoffCapMs: 3_600_000,
      },
      configPolicy: {
        mode: "builder",
        denyPaths: ["version", "runtime.configPolicy", "runtime.smokeTest"],
        strictAllowPaths: [
          "runtime.opencode.runWaitTimeoutMs",
          "runtime.opencode.childSessionHideAfterDays",
          "runtime.runStream",
          "runtime.memory",
          "runtime.cron",
          "ui.skills",
          "ui.mcps",
          "ui.mcpServers",
          "ui.agents",
          "ui.agentTypes",
        ],
        requireExpectedHash: true,
        requireSmokeTest: true,
        autoRollbackOnFailure: true,
      },
    },
    ui: {
      skills: readLegacyStringListConfig("skills", DEFAULT_SKILLS),
      mcps: readLegacyStringListConfig("mcps", DEFAULT_MCPS),
      mcpServers: [],
      agents: readLegacyAgentConfig(DEFAULT_AGENTS),
      agentTypes: readLegacyAgentTypeConfig([]),
    },
  };
  candidate.ui.agentTypes = mergeAgentTypesWithLegacyAgents(candidate.ui.agentTypes, candidate.ui.agents);
  return wafflebotConfigSchema.parse(candidate);
}

function stripLegacyMemoryWriteConfig(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  const root = { ...raw };
  const runtime = isPlainObject(root.runtime) ? { ...root.runtime } : null;
  if (!runtime) return root;
  const memory = isPlainObject(runtime.memory) ? { ...runtime.memory } : null;
  if (!memory) return root;

  delete memory.writePolicy;
  delete memory.minConfidence;

  runtime.memory = memory;
  root.runtime = runtime;
  return root;
}

export function parseConfig(raw: unknown) {
  const parsed = wafflebotConfigSchema.safeParse(stripLegacyMemoryWriteConfig(raw));
  if (!parsed.success) {
    throw new ConfigApplyError("schema", "Config schema validation failed", parsed.error.flatten());
  }
  const config = parsed.data;
  config.ui.agentTypes = mergeAgentTypesWithLegacyAgents(config.ui.agentTypes, config.ui.agents);
  return config;
}

function createSnapshot(configPath: string, config: WafflebotConfig): WafflebotConfigSnapshot {
  const updatedAt = existsSync(configPath) ? new Date(statSync(configPath).mtimeMs).toISOString() : new Date().toISOString();
  return {
    path: configPath,
    hash: computeConfigHash(config),
    updatedAt,
    config,
  };
}

function readSnapshotFromDisk(configPath: string): WafflebotConfigSnapshot {
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = parseConfig(JSON.parse(raw) as unknown);
    return createSnapshot(configPath, parsed);
  } catch (error) {
    if (error instanceof ConfigApplyError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Failed to parse config file";
    throw new ConfigApplyError("schema", message);
  }
}

function writeConfigAtomic(configPath: string, config: WafflebotConfig) {
  const directory = path.dirname(configPath);
  mkdirSync(directory, { recursive: true });

  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  const backupPath = backupPathFor(configPath);
  const serialized = `${JSON.stringify(config, null, 2)}\n`;

  if (existsSync(configPath)) {
    writeFileSync(backupPath, readFileSync(configPath));
  }

  writeFileSync(tempPath, serialized, "utf8");
  renameSync(tempPath, configPath);
}

export function ensureConfigSnapshot() {
  const configPath = resolvedConfigPath();
  if (existsSync(configPath)) {
    return readSnapshotFromDisk(configPath);
  }
  const config = buildLegacyBootstrappedConfig();
  writeConfigAtomic(configPath, config);
  return readSnapshotFromDisk(configPath);
}

export function getConfigSnapshot() {
  return ensureConfigSnapshot();
}

export function getConfig() {
  return getConfigSnapshot().config;
}

export function getConfigPath() {
  return getConfigSnapshot().path;
}

export function mergeConfigPatch(baseConfig: WafflebotConfig, patch: unknown): unknown {
  return deepMerge(baseConfig, patch);
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (typeof patch === "undefined") return base;
  if (Array.isArray(patch)) return patch;
  if (isPlainObject(base) && isPlainObject(patch)) {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (typeof value === "undefined") continue;
      merged[key] = key in merged ? deepMerge(merged[key], value) : value;
    }
    return merged;
  }
  return patch;
}

export function assertExpectedHashMatches(currentHash: string, expectedHash?: string) {
  if (expectedHash && expectedHash !== currentHash) {
    throw new ConfigApplyError("conflict", "Config has changed; refresh and retry");
  }
}

export function persistConfigSnapshot(configPath: string, config: WafflebotConfig): WafflebotConfigSnapshot {
  try {
    writeConfigAtomic(configPath, config);
    return ensureConfigSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to write config file";
    throw new ConfigApplyError("write", message);
  }
}
