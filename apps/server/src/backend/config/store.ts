import { legacySpecialistToAgentType } from "@agent-mockingbird/contracts/agentTypes";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { sqlite } from "../db/client";
import { DEFAULT_AGENTS, DEFAULT_AGENT_TYPES, DEFAULT_MCPS, DEFAULT_SKILLS } from "../defaults";
import { env } from "../env";
import { resolveDataPath } from "../paths";
import {
  agentTypeDefinitionSchema,
  agentMockingbirdConfigSchema,
  specialistAgentSchema,
  type AgentTypeDefinition,
  type AgentMockingbirdConfig,
} from "./schema";
import { ConfigApplyError, type AgentMockingbirdConfigSnapshot } from "./types";
import { resolveWorkspaceAlignment } from "../workspace/resolve";

interface ConfigRow {
  value_json: string;
}

const CONFIG_VERSION = 2 as const;
const DEFAULT_CONFIG_FILENAME = "agent-mockingbird.config.json";
const LEGACY_CONFIG_FILENAME = "mockingbird.config.json";
const BACKUP_SUFFIX = ".bak";
const DEFAULT_SMOKE_TEST_PROMPT = 'Just respond "OK" to this to confirm the gateway is working.';
const DEFAULT_SMOKE_TEST_PATTERN = "\\bok\\b";
const DEFAULT_OPENCODE_BASE_URL =
  process.env.AGENT_MOCKINGBIRD_OPENCODE_BASE_URL?.trim() ||
  `http://127.0.0.1:${process.env.OPENCODE_PORT?.trim() || "4096"}`;
const DEFAULT_OPENCODE_PROVIDER_ID = "opencode";
const DEFAULT_OPENCODE_MODEL_ID = "big-pickle";
const DEFAULT_OPENCODE_SMALL_MODEL = "opencode/big-pickle";
const DEFAULT_OPENCODE_TIMEOUT_MS = 120_000;
const DEFAULT_OPENCODE_PROMPT_TIMEOUT_MS = 300_000;
const DEFAULT_OPENCODE_RUN_WAIT_TIMEOUT_MS = 180_000;
const DEFAULT_HEARTBEAT_PROMPT =
  'Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.';
const legacyStringListSchema = z.array(z.string().min(1));
const legacyAgentListSchema = z.array(specialistAgentSchema);
const legacyAgentTypeListSchema = z.array(agentTypeDefinitionSchema);
type LegacyConfigKey = "skills" | "mcps" | "agents" | "agent_types";

function resolvedConfigPath() {
  const configuredPath = env.AGENT_MOCKINGBIRD_CONFIG_PATH?.trim();
  if (configuredPath) {
    return path.resolve(configuredPath);
  }
  return resolveDataPath(DEFAULT_CONFIG_FILENAME);
}

function legacyDefaultConfigPath() {
  return resolveDataPath(LEGACY_CONFIG_FILENAME);
}

function backupPathFor(configPath: string) {
  return `${configPath}${BACKUP_SUFFIX}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function appearsToBeOpencodeConfig(raw: unknown) {
  if (!isPlainObject(raw)) return false;
  const schema = raw.$schema;
  return typeof schema === "string" && schema.trim() === "https://opencode.ai/config.json";
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

function computeConfigHash(config: AgentMockingbirdConfig) {
  return createHash("sha256").update(stableStringify(config)).digest("hex");
}

function hasExplicitEnvValue(key: string) {
  const raw = process.env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

function readExplicitEnvString(key: string) {
  if (!hasExplicitEnvValue(key)) return undefined;
  return process.env[key]?.trim();
}

function readExplicitEnvNumber(key: string) {
  const raw = readExplicitEnvString(key);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readExplicitEnvBoolean(key: string) {
  const raw = readExplicitEnvString(key)?.toLowerCase();
  if (!raw) return undefined;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return undefined;
}

function buildExplicitEnvConfigDefaultsPatch(): Record<string, unknown> {
  const opencodePatch: Record<string, unknown> = {};
  const opencodeBaseUrl = readExplicitEnvString("AGENT_MOCKINGBIRD_OPENCODE_BASE_URL");
  if (opencodeBaseUrl) opencodePatch.baseUrl = opencodeBaseUrl;
  const opencodeDirectory = readExplicitEnvString("AGENT_MOCKINGBIRD_OPENCODE_DIRECTORY");
  if (opencodeDirectory) opencodePatch.directory = opencodeDirectory;
  const opencodeProviderId = readExplicitEnvString("AGENT_MOCKINGBIRD_OPENCODE_PROVIDER_ID");
  if (opencodeProviderId) opencodePatch.providerId = opencodeProviderId;
  const opencodeModelId = readExplicitEnvString("AGENT_MOCKINGBIRD_OPENCODE_MODEL_ID");
  if (opencodeModelId) opencodePatch.modelId = opencodeModelId;
  const opencodeSmallModel = readExplicitEnvString("AGENT_MOCKINGBIRD_OPENCODE_SMALL_MODEL");
  if (opencodeSmallModel) opencodePatch.smallModel = opencodeSmallModel;
  const opencodeTimeoutMs = readExplicitEnvNumber("AGENT_MOCKINGBIRD_OPENCODE_TIMEOUT_MS");
  if (typeof opencodeTimeoutMs === "number") opencodePatch.timeoutMs = opencodeTimeoutMs;
  const opencodePromptTimeoutMs = readExplicitEnvNumber("AGENT_MOCKINGBIRD_OPENCODE_PROMPT_TIMEOUT_MS");
  if (typeof opencodePromptTimeoutMs === "number") opencodePatch.promptTimeoutMs = opencodePromptTimeoutMs;
  const opencodeRunWaitTimeoutMs = readExplicitEnvNumber("AGENT_MOCKINGBIRD_OPENCODE_RUN_WAIT_TIMEOUT_MS");
  if (typeof opencodeRunWaitTimeoutMs === "number") opencodePatch.runWaitTimeoutMs = opencodeRunWaitTimeoutMs;

  const memoryPatch: Record<string, unknown> = {};

  const memoryEnabled = readExplicitEnvBoolean("AGENT_MOCKINGBIRD_MEMORY_ENABLED");
  if (typeof memoryEnabled === "boolean") memoryPatch.enabled = memoryEnabled;
  const memoryWorkspaceDir = readExplicitEnvString("AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR");
  if (memoryWorkspaceDir) memoryPatch.workspaceDir = memoryWorkspaceDir;
  const memoryEmbedProvider = readExplicitEnvString("AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER");
  if (memoryEmbedProvider) memoryPatch.embedProvider = memoryEmbedProvider;
  const memoryEmbedModel = readExplicitEnvString("AGENT_MOCKINGBIRD_MEMORY_EMBED_MODEL");
  if (memoryEmbedModel) memoryPatch.embedModel = memoryEmbedModel;
  const memoryOllamaBaseUrl = readExplicitEnvString("AGENT_MOCKINGBIRD_MEMORY_OLLAMA_BASE_URL");
  if (memoryOllamaBaseUrl) memoryPatch.ollamaBaseUrl = memoryOllamaBaseUrl;
  const memoryChunkTokens = readExplicitEnvNumber("AGENT_MOCKINGBIRD_MEMORY_CHUNK_TOKENS");
  if (typeof memoryChunkTokens === "number") memoryPatch.chunkTokens = memoryChunkTokens;
  const memoryChunkOverlap = readExplicitEnvNumber("AGENT_MOCKINGBIRD_MEMORY_CHUNK_OVERLAP");
  if (typeof memoryChunkOverlap === "number") memoryPatch.chunkOverlap = memoryChunkOverlap;
  const memoryMaxResults = readExplicitEnvNumber("AGENT_MOCKINGBIRD_MEMORY_MAX_RESULTS");
  if (typeof memoryMaxResults === "number") memoryPatch.maxResults = memoryMaxResults;
  const memoryMinScore = readExplicitEnvNumber("AGENT_MOCKINGBIRD_MEMORY_MIN_SCORE");
  if (typeof memoryMinScore === "number") memoryPatch.minScore = memoryMinScore;
  const memorySyncCooldownMs = readExplicitEnvNumber("AGENT_MOCKINGBIRD_MEMORY_SYNC_COOLDOWN_MS");
  if (typeof memorySyncCooldownMs === "number") memoryPatch.syncCooldownMs = memorySyncCooldownMs;
  const memoryToolMode = readExplicitEnvString("AGENT_MOCKINGBIRD_MEMORY_TOOL_MODE");
  if (memoryToolMode) memoryPatch.toolMode = memoryToolMode;
  const memoryInjectionDedupeEnabled = readExplicitEnvBoolean("AGENT_MOCKINGBIRD_MEMORY_INJECTION_DEDUPE_ENABLED");
  if (typeof memoryInjectionDedupeEnabled === "boolean") memoryPatch.injectionDedupeEnabled = memoryInjectionDedupeEnabled;
  const memoryInjectionDedupeFallbackRecallOnly = readExplicitEnvBoolean(
    "AGENT_MOCKINGBIRD_MEMORY_INJECTION_DEDUPE_FALLBACK_RECALL_ONLY",
  );
  if (typeof memoryInjectionDedupeFallbackRecallOnly === "boolean") {
    memoryPatch.injectionDedupeFallbackRecallOnly = memoryInjectionDedupeFallbackRecallOnly;
  }
  const memoryInjectionDedupeMaxTracked = readExplicitEnvNumber("AGENT_MOCKINGBIRD_MEMORY_INJECTION_DEDUPE_MAX_TRACKED");
  if (typeof memoryInjectionDedupeMaxTracked === "number") {
    memoryPatch.injectionDedupeMaxTracked = memoryInjectionDedupeMaxTracked;
  }

  if (!Object.keys(opencodePatch).length && !Object.keys(memoryPatch).length) {
    return {};
  }
  return {
    runtime: {
      ...(Object.keys(opencodePatch).length ? { opencode: opencodePatch } : {}),
      ...(Object.keys(memoryPatch).length ? { memory: memoryPatch } : {}),
    },
  };
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

function readLegacyAgentConfig(fallback: AgentMockingbirdConfig["ui"]["agents"]) {
  const value = readLegacyConfigRow("agents");
  const parsed = legacyAgentListSchema.safeParse(value);
  if (!parsed.success) return fallback;
  return parsed.data;
}

function readLegacyAgentTypeConfig(fallback: AgentMockingbirdConfig["ui"]["agentTypes"]) {
  const value = readLegacyConfigRow("agent_types");
  const parsed = legacyAgentTypeListSchema.safeParse(value);
  if (!parsed.success) return fallback;
  return parsed.data;
}

function mergeAgentTypesWithLegacyAgents(
  agentTypes: AgentMockingbirdConfig["ui"]["agentTypes"],
  agents: AgentMockingbirdConfig["ui"]["agents"],
) {
  const merged = new Map(agentTypes.map(agentType => [agentType.id, agentType]));
  for (const agent of agents) {
    const id = agent.id.trim();
    if (!id || merged.has(id)) continue;
    merged.set(id, legacySpecialistToAgentType(agent) as AgentTypeDefinition);
  }
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeOpencodeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim();
  if (!trimmed) return DEFAULT_OPENCODE_BASE_URL;
  return trimmed;
}

function buildLegacyBootstrappedConfig() {
  const candidate: AgentMockingbirdConfig = {
    version: CONFIG_VERSION,
    workspace: {
      pinnedDirectory: env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR,
    },
    runtime: {
      opencode: {
        baseUrl: DEFAULT_OPENCODE_BASE_URL,
        providerId: DEFAULT_OPENCODE_PROVIDER_ID,
        modelId: DEFAULT_OPENCODE_MODEL_ID,
        fallbackModels: [],
        imageModel: null,
        smallModel: DEFAULT_OPENCODE_SMALL_MODEL,
        timeoutMs: DEFAULT_OPENCODE_TIMEOUT_MS,
        promptTimeoutMs: DEFAULT_OPENCODE_PROMPT_TIMEOUT_MS,
        runWaitTimeoutMs: DEFAULT_OPENCODE_RUN_WAIT_TIMEOUT_MS,
        childSessionHideAfterDays: 3,
        directory: env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR,
        bootstrap: {
          enabled: true,
          maxCharsPerFile: 20_000,
          maxCharsTotal: 150_000,
          subagentMinimal: true,
          includeAgentPrompt: true,
        },
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
        enabled: env.AGENT_MOCKINGBIRD_MEMORY_ENABLED,
        workspaceDir: env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR,
        embedProvider: env.AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER,
        embedModel: env.AGENT_MOCKINGBIRD_MEMORY_EMBED_MODEL,
        ollamaBaseUrl: env.AGENT_MOCKINGBIRD_MEMORY_OLLAMA_BASE_URL,
        chunkTokens: env.AGENT_MOCKINGBIRD_MEMORY_CHUNK_TOKENS,
        chunkOverlap: env.AGENT_MOCKINGBIRD_MEMORY_CHUNK_OVERLAP,
        maxResults: env.AGENT_MOCKINGBIRD_MEMORY_MAX_RESULTS,
        minScore: env.AGENT_MOCKINGBIRD_MEMORY_MIN_SCORE,
        syncCooldownMs: env.AGENT_MOCKINGBIRD_MEMORY_SYNC_COOLDOWN_MS,
        toolMode: env.AGENT_MOCKINGBIRD_MEMORY_TOOL_MODE,
        injectionDedupeEnabled: env.AGENT_MOCKINGBIRD_MEMORY_INJECTION_DEDUPE_ENABLED,
        injectionDedupeFallbackRecallOnly: env.AGENT_MOCKINGBIRD_MEMORY_INJECTION_DEDUPE_FALLBACK_RECALL_ONLY,
        injectionDedupeMaxTracked: env.AGENT_MOCKINGBIRD_MEMORY_INJECTION_DEDUPE_MAX_TRACKED,
        retrieval: {
          engine: "qmd_hybrid",
          strongSignalMinScore: 0.85,
          strongSignalMinGap: 0.15,
          candidateLimit: 40,
          rrfK: 60,
          expansionEnabled: true,
          conceptExpansionEnabled: true,
          conceptExpansionMaxPacks: 3,
          conceptExpansionMaxTerms: 10,
          rerankEnabled: true,
          rerankTopN: 40,
          semanticRescueEnabled: true,
          semanticRescueMinVectorScore: 0.75,
          semanticRescueMaxResults: 2,
          expansionModel: null,
          rerankModel: null,
          vectorBackend: "sqlite_vec",
          vectorUnavailableFallback: "disabled",
          vectorK: 60,
          vectorProbeLimit: 20,
        },
      },
      heartbeat: {
        enabled: true,
        interval: "30m",
        agentId: "build",
        model: `${DEFAULT_OPENCODE_PROVIDER_ID}/${DEFAULT_OPENCODE_MODEL_ID}`,
        prompt: DEFAULT_HEARTBEAT_PROMPT,
        ackMaxChars: 300,
        activeHours: null,
      },
      agentHeartbeats: {},
      cron: {
        defaultMaxAttempts: 3,
        defaultRetryBackoffMs: 30_000,
        retryBackoffCapMs: 3_600_000,
        conditionalModuleTimeoutMs: 30_000,
      },
      queue: {
        enabled: true,
        defaultMode: "collect",
        maxDepth: 10,
        coalesceDebounceMs: 500,
      },
      configPolicy: {
        mode: "builder",
        denyPaths: ["version", "runtime.configPolicy", "runtime.smokeTest"],
        strictAllowPaths: [
          "runtime.opencode.runWaitTimeoutMs",
          "runtime.opencode.childSessionHideAfterDays",
          "runtime.opencode.bootstrap",
          "runtime.runStream",
          "runtime.memory",
          "runtime.heartbeat",
          "runtime.agentHeartbeats",
          "runtime.cron",
          "runtime.queue",
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
      agentTypes: readLegacyAgentTypeConfig(DEFAULT_AGENT_TYPES),
    },
  };
  candidate.ui.agentTypes = mergeAgentTypesWithLegacyAgents(candidate.ui.agentTypes, candidate.ui.agents);
  return agentMockingbirdConfigSchema.parse(candidate);
}

function migrateConfigShape(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  if (raw.version === CONFIG_VERSION && isPlainObject(raw.workspace)) {
    return raw;
  }

  const root = { ...raw };
  const runtime = isPlainObject(root.runtime) ? root.runtime : {};
  const opencode = isPlainObject(runtime.opencode) ? runtime.opencode : {};
  const memory = isPlainObject(runtime.memory) ? runtime.memory : {};
  const pinnedDirectory =
    (typeof root.workspace === "object" &&
    root.workspace &&
    !Array.isArray(root.workspace) &&
    typeof (root.workspace as { pinnedDirectory?: unknown }).pinnedDirectory === "string"
      ? (root.workspace as { pinnedDirectory: string }).pinnedDirectory
      : undefined) ??
    (typeof opencode.directory === "string" ? opencode.directory : undefined) ??
    (typeof memory.workspaceDir === "string" ? memory.workspaceDir : undefined) ??
    env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR;

  return {
    ...root,
    version: CONFIG_VERSION,
    workspace: {
      pinnedDirectory,
    },
  };
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

function normalizeLegacyAgentHeartbeat(rawAgentType: Record<string, unknown>): Record<string, unknown> | null {
  const heartbeat = isPlainObject(rawAgentType.heartbeat) ? rawAgentType.heartbeat : null;
  if (!heartbeat) return null;

  const model =
    typeof rawAgentType.model === "string" && rawAgentType.model.trim()
      ? rawAgentType.model.trim()
      : `${DEFAULT_OPENCODE_PROVIDER_ID}/${DEFAULT_OPENCODE_MODEL_ID}`;

  return {
    enabled: typeof heartbeat.enabled === "boolean" ? heartbeat.enabled : true,
    interval: typeof heartbeat.interval === "string" && heartbeat.interval.trim() ? heartbeat.interval.trim() : "30m",
    agentId: typeof rawAgentType.id === "string" && rawAgentType.id.trim() ? rawAgentType.id.trim() : "build",
    model,
    prompt:
      typeof heartbeat.prompt === "string" && heartbeat.prompt.trim()
        ? heartbeat.prompt.trim()
        : DEFAULT_HEARTBEAT_PROMPT,
    ackMaxChars:
      typeof heartbeat.ackMaxChars === "number" && Number.isFinite(heartbeat.ackMaxChars)
        ? heartbeat.ackMaxChars
        : 300,
    activeHours: isPlainObject(heartbeat.activeHours) ? heartbeat.activeHours : null,
  };
}

function buildLegacyHeartbeatAgentKey(rawAgentType: Record<string, unknown>, index: number, usedKeys: Set<string>) {
  const rawId = typeof rawAgentType.id === "string" ? rawAgentType.id.trim() : "";
  const baseKey = rawId || "build";
  let candidate = baseKey;
  let suffix = rawId ? index + 1 : 1;
  while (usedKeys.has(candidate)) {
    candidate = `${baseKey}-${suffix}`;
    suffix += 1;
  }
  usedKeys.add(candidate);
  return candidate;
}

function migrateLegacyHeartbeatConfig(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;

  const root = { ...raw };
  const runtime = isPlainObject(root.runtime) ? { ...root.runtime } : {};
  const ui = isPlainObject(root.ui) ? { ...root.ui } : {};
  const agentTypes = Array.isArray(ui.agentTypes)
    ? ui.agentTypes.map(value => (isPlainObject(value) ? { ...value } : value))
    : [];

  const existingAgentHeartbeats = isPlainObject(runtime.agentHeartbeats) ? { ...runtime.agentHeartbeats } : null;
  const derivedAgentHeartbeats = existingAgentHeartbeats ?? {};
  const migratedAgentTypes: Record<string, unknown>[] = [];
  const usedKeys = new Set(Object.keys(derivedAgentHeartbeats));

  for (const [index, rawAgentType] of agentTypes.entries()) {
    if (!isPlainObject(rawAgentType)) continue;
    const normalizedHeartbeat = normalizeLegacyAgentHeartbeat(rawAgentType);
    if (!normalizedHeartbeat) continue;
    const agentKey = buildLegacyHeartbeatAgentKey(rawAgentType, index, usedKeys);
    derivedAgentHeartbeats[agentKey] = normalizedHeartbeat;
    migratedAgentTypes.push(rawAgentType);
  }

  if (Object.keys(derivedAgentHeartbeats).length > 0) {
    runtime.agentHeartbeats = derivedAgentHeartbeats;
  }
  for (const rawAgentType of migratedAgentTypes) {
    delete rawAgentType.heartbeat;
  }

  root.runtime = runtime;
  if (agentTypes.length > 0) {
    ui.agentTypes = agentTypes;
  }
  root.ui = ui;
  return root;
}

export function parseConfig(raw: unknown) {
  const normalized = migrateLegacyHeartbeatConfig(migrateConfigShape(stripLegacyMemoryWriteConfig(raw)));
  if (appearsToBeOpencodeConfig(normalized)) {
    throw new ConfigApplyError(
      "schema",
      "Config file appears to be OpenCode config.json, not Agent Mockingbird config. Set AGENT_MOCKINGBIRD_CONFIG_PATH to an Agent Mockingbird config file (default: ./data/agent-mockingbird.config.json).",
    );
  }
  const withExplicitEnvDefaults = deepMerge(buildExplicitEnvConfigDefaultsPatch(), normalized);
  const parsed = agentMockingbirdConfigSchema.safeParse(withExplicitEnvDefaults);
  if (!parsed.success) {
    throw new ConfigApplyError("schema", "Config schema validation failed", parsed.error.flatten());
  }
  const config = parsed.data;
  config.runtime.opencode.baseUrl = normalizeOpencodeBaseUrl(config.runtime.opencode.baseUrl);
  const workspaceAlignment = resolveWorkspaceAlignment(config);
  const normalizedMemoryWorkspaceDir = workspaceAlignment.memoryWorkspaceDir;
  config.workspace.pinnedDirectory = workspaceAlignment.opencodeWorkspaceDir;
  config.runtime.opencode.directory = workspaceAlignment.opencodeWorkspaceDir;
  config.runtime.memory.workspaceDir = normalizedMemoryWorkspaceDir;
  config.ui.agentTypes = mergeAgentTypesWithLegacyAgents(config.ui.agentTypes, config.ui.agents);
  return config;
}

function createSnapshot(configPath: string, config: AgentMockingbirdConfig): AgentMockingbirdConfigSnapshot {
  const updatedAt = existsSync(configPath) ? new Date(statSync(configPath).mtimeMs).toISOString() : new Date().toISOString();
  return {
    path: configPath,
    hash: computeConfigHash(config),
    updatedAt,
    config,
  };
}

function readSnapshotFromDisk(configPath: string): AgentMockingbirdConfigSnapshot {
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

function writeConfigAtomic(configPath: string, config: AgentMockingbirdConfig) {
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
  const legacyPath = legacyDefaultConfigPath();
  if (!env.AGENT_MOCKINGBIRD_CONFIG_PATH && existsSync(legacyPath)) {
    const snapshot = readSnapshotFromDisk(legacyPath);
    writeConfigAtomic(configPath, snapshot.config);
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

export function mergeConfigPatch(baseConfig: AgentMockingbirdConfig, patch: unknown): unknown {
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

export function persistConfigSnapshot(configPath: string, config: AgentMockingbirdConfig): AgentMockingbirdConfigSnapshot {
  try {
    writeConfigAtomic(configPath, config);
    return ensureConfigSnapshot();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to write config file";
    throw new ConfigApplyError("write", message);
  }
}
