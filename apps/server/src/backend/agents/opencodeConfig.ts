import type { Config, ConfigProvidersResponse } from "@opencode-ai/sdk/client";
import { applyEdits, format, modify, parse as parseJsonc } from "jsonc-parser";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeAgentTypeDraft as normalizeSharedAgentTypeDraft, normalizeAgentTypeMode } from "@wafflebot/contracts/agentTypes";
import type { AgentTypeDefinition, WafflebotConfig } from "../config/schema";
import { agentTypeDefinitionSchema } from "../config/schema";
import { getConfigSnapshot } from "../config/service";
import { createOpencodeClientFromConnection, unwrapSdkData } from "../opencode/client";
import { resolveOpencodeWorkspaceDir } from "../workspace/resolve";

type OpenCodeAgentConfigRecord = Record<string, unknown>;

export interface OpencodeAgentValidationIssue {
  path: string;
  message: string;
}

export interface OpencodeAgentStorageInfo {
  directory: string;
  configFilePath: string;
  persistenceMode: "project-opencode-jsonc";
}

const NON_DELETABLE_BUILTIN_AGENT_IDS = new Set(["explore", "general"]);
const OPENCODE_SCHEMA_URL = "https://opencode.ai/config.json";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerialize(item)).join(",")}]`;
  }
  if (!isPlainObject(value)) return JSON.stringify(value);
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
}

function normalizeRuntimeAgentConfigMap(value: unknown): Record<string, OpenCodeAgentConfigRecord> {
  if (!isPlainObject(value)) return {};
  const normalized: Record<string, OpenCodeAgentConfigRecord> = {};
  for (const [rawName, rawConfig] of Object.entries(value)) {
    const name = rawName.trim();
    if (!name) continue;
    normalized[name] = isPlainObject(rawConfig) ? { ...rawConfig } : {};
  }
  return normalized;
}

function normalizeAgentTypeDraft(input: AgentTypeDefinition): AgentTypeDefinition {
  const parsed = agentTypeDefinitionSchema.parse(input);
  return normalizeSharedAgentTypeDraft(parsed) as AgentTypeDefinition;
}

function toAgentTypeDefinition(id: string, config: OpenCodeAgentConfigRecord): AgentTypeDefinition {
  const permission =
    isPlainObject(config.permission) ? (config.permission as AgentTypeDefinition["permission"]) : undefined;
  return normalizeAgentTypeDraft({
    id,
    name: typeof config.name === "string" ? config.name : undefined,
    description: typeof config.description === "string" ? config.description : undefined,
    prompt: typeof config.prompt === "string" ? config.prompt : undefined,
    model: typeof config.model === "string" ? config.model : undefined,
    variant: typeof config.variant === "string" ? config.variant : undefined,
    mode: normalizeAgentTypeMode(config.mode),
    hidden: config.hidden === true,
    disable: config.disable === true,
    temperature: typeof config.temperature === "number" ? config.temperature : undefined,
    topP: typeof config.top_p === "number" ? config.top_p : undefined,
    steps: typeof config.steps === "number" ? config.steps : undefined,
    permission,
    options: isPlainObject(config.options) ? (config.options as Record<string, unknown>) : {},
  });
}

function toOpenCodeAgentConfig(
  agentType: AgentTypeDefinition,
  previous?: OpenCodeAgentConfigRecord,
): OpenCodeAgentConfigRecord {
  return {
    ...(isPlainObject(previous) ? previous : {}),
    name: agentType.name?.trim() || undefined,
    description: agentType.description?.trim() || undefined,
    prompt: agentType.prompt?.trim() || undefined,
    model: agentType.model?.trim() || undefined,
    variant: agentType.variant?.trim() || undefined,
    mode: normalizeAgentTypeMode(agentType.mode),
    hidden: agentType.hidden === true,
    disable: agentType.disable === true,
    temperature: agentType.temperature,
    top_p: agentType.topP,
    steps: agentType.steps,
    permission: agentType.permission,
    options: isPlainObject(agentType.options) ? { ...agentType.options } : {},
  };
}

function canonicalOpencodeConfigPath(baseDir: string) {
  return path.join(baseDir, ".opencode", "opencode.jsonc");
}

function resolveOpencodeConfigFile(config: WafflebotConfig, createIfMissing = true) {
  const baseDir = resolveOpencodeWorkspaceDir(config);
  const fallback = canonicalOpencodeConfigPath(baseDir);
  if (!createIfMissing) {
    return fallback;
  }
  mkdirSync(path.dirname(fallback), { recursive: true });
  if (!existsSync(fallback)) {
    writeFileSync(fallback, `{\n  "$schema": "${OPENCODE_SCHEMA_URL}"\n}\n`, "utf8");
  }
  return fallback;
}

export function getOpencodeAgentStorageInfo(config: WafflebotConfig = getConfigSnapshot().config): OpencodeAgentStorageInfo {
  const directory = resolveOpencodeWorkspaceDir(config);
  return {
    directory,
    configFilePath: resolveOpencodeConfigFile(config, false),
    persistenceMode: "project-opencode-jsonc",
  };
}

function listAgentSearchRoots(config: WafflebotConfig): string[] {
  const roots = new Set<string>();
  const baseDir = resolveOpencodeWorkspaceDir(config);
  roots.add(baseDir);

  // OpenCode scans .opencode directories walking up project + home.
  let cursor = path.resolve(baseDir);
  while (true) {
    roots.add(path.join(cursor, ".opencode"));
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  const homeDir = os.homedir();
  roots.add(path.join(homeDir, ".opencode"));
  roots.add(path.join(process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config"), "opencode"));

  if (process.env.OPENCODE_CONFIG_DIR?.trim()) {
    roots.add(process.env.OPENCODE_CONFIG_DIR.trim());
  }

  return [...roots];
}

function deleteAgentMarkdownFiles(config: WafflebotConfig, agentId: string): string[] {
  const normalized = agentId.trim();
  if (!normalized) return [];
  const deleted: string[] = [];

  for (const root of listAgentSearchRoots(config)) {
    for (const folder of ["agent", "agents"]) {
      const candidate = path.join(root, folder, `${normalized}.md`);
      if (!existsSync(candidate)) continue;
      unlinkSync(candidate);
      deleted.push(candidate);
    }
  }

  return deleted.sort((a, b) => a.localeCompare(b));
}

function patchJsoncField(input: string, value: unknown, jsonPath: string[]) {
  const edits = modify(input, jsonPath, value, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
      eol: "\n",
    },
  });
  const patched = applyEdits(input, edits);
  const formatEdits = format(patched, undefined, {
    insertSpaces: true,
    tabSize: 2,
    eol: "\n",
  });
  return applyEdits(patched, formatEdits);
}

function readFileAgentConfigMap(configPath: string): Record<string, OpenCodeAgentConfigRecord> {
  const raw = readFileSync(configPath, "utf8");
  const parsed = parseJsonc(raw);
  if (!isPlainObject(parsed)) return {};
  const agent = parsed.agent;
  return normalizeRuntimeAgentConfigMap(agent);
}

function writeFileAgentConfigMap(configPath: string, nextMap: Record<string, OpenCodeAgentConfigRecord>) {
  const raw = readFileSync(configPath, "utf8");
  const nextAgent = Object.fromEntries(Object.entries(nextMap).sort(([left], [right]) => left.localeCompare(right)));
  const nextRaw = patchJsoncField(raw, nextAgent, ["agent"]);
  writeFileSync(configPath, nextRaw, "utf8");
}

function hashAgentTypes(agentTypes: AgentTypeDefinition[]): string {
  return createHash("sha256")
    .update(stableSerialize(agentTypes))
    .digest("hex");
}

function createOpencodeConfigClient(config: WafflebotConfig) {
  return createOpencodeClientFromConnection({
    baseUrl: config.runtime.opencode.baseUrl,
    directory: config.runtime.opencode.directory,
  });
}

async function disposeOpencodeInstance(config: WafflebotConfig) {
  try {
    await createOpencodeConfigClient(config).instance.dispose({
      responseStyle: "data",
      throwOnError: true,
      signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
    });
  } catch {
    // Best-effort; if dispose is unavailable, rely on runtime file watchers.
  }
}

async function getOpencodeConfig(config: WafflebotConfig) {
  const client = createOpencodeConfigClient(config);
  return unwrapSdkData<Config>(
    await client.config.get({
      responseStyle: "data",
      throwOnError: true,
      signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
    }),
  );
}

async function loadProviderModelMap(config: WafflebotConfig) {
  const client = createOpencodeConfigClient(config);
  const payload = unwrapSdkData<ConfigProvidersResponse>(
    await client.config.providers({
      responseStyle: "data",
      throwOnError: true,
      signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
    }),
  );
  const modelsByProvider = new Map<string, Set<string>>();
  for (const provider of payload.providers) {
    const modelSet = new Set<string>();
    for (const [modelKey, model] of Object.entries(provider.models)) {
      const id = (model.id ?? modelKey).trim();
      if (id) modelSet.add(id);
    }
    modelsByProvider.set(provider.id.trim(), modelSet);
  }
  return modelsByProvider;
}

function parseModelRef(rawRef: string, defaultProviderId: string) {
  const trimmed = rawRef.trim();
  if (!trimmed) return null;
  if (!trimmed.includes("/")) {
    return { providerId: defaultProviderId.trim(), modelId: trimmed };
  }
  const [providerPart = "", ...rest] = trimmed.split("/");
  const modelId = rest.join("/").trim();
  const providerId = providerPart.trim();
  if (!providerId || !modelId) return null;
  return { providerId, modelId };
}

export async function listOpencodeAgentTypes() {
  const config = getConfigSnapshot().config;
  const storage = getOpencodeAgentStorageInfo(config);
  const runtimeConfig = await getOpencodeConfig(config);
  const currentMap = normalizeRuntimeAgentConfigMap((runtimeConfig as Record<string, unknown>).agent);
  const agentTypes = Object.entries(currentMap)
    .map(([id, agentConfig]) => toAgentTypeDefinition(id, agentConfig))
    .filter(agentType => agentType.disable !== true)
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    agentTypes,
    hash: hashAgentTypes(agentTypes),
    storage,
  };
}

export async function validateOpencodeAgentPatch(input: {
  upserts: unknown;
  deletes: unknown;
}) {
  const issues: OpencodeAgentValidationIssue[] = [];
  const warnings: OpencodeAgentValidationIssue[] = [];

  const upsertsRaw = Array.isArray(input.upserts) ? input.upserts : [];
  const upserts: AgentTypeDefinition[] = [];
  for (let index = 0; index < upsertsRaw.length; index += 1) {
    const parsed = agentTypeDefinitionSchema.safeParse(upsertsRaw[index]);
    if (!parsed.success) {
      issues.push({
        path: `upserts.${index}`,
        message: "Invalid agent type definition",
      });
      continue;
    }
    upserts.push(normalizeAgentTypeDraft(parsed.data));
  }

  const deletes = Array.isArray(input.deletes)
    ? input.deletes
        .map(value => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];

  const seenUpserts = new Set<string>();
  for (let index = 0; index < upserts.length; index += 1) {
    const id = upserts[index]?.id;
    if (!id) continue;
    if (seenUpserts.has(id)) {
      issues.push({
        path: `upserts.${index}.id`,
        message: `Duplicate upsert id: ${id}`,
      });
      continue;
    }
    seenUpserts.add(id);
  }

  const config = getConfigSnapshot().config;
  try {
    const providers = await loadProviderModelMap(config);
    for (let index = 0; index < upserts.length; index += 1) {
      const upsert = upserts[index];
      if (!upsert?.model?.trim()) continue;
      const parsed = parseModelRef(upsert.model, config.runtime.opencode.providerId);
      if (!parsed) {
        issues.push({
          path: `upserts.${index}.model`,
          message: `Invalid model reference: ${upsert.model}`,
        });
        continue;
      }
      const models = providers.get(parsed.providerId);
      if (!models) {
        issues.push({
          path: `upserts.${index}.model`,
          message: `Unknown provider: ${parsed.providerId}`,
        });
        continue;
      }
      if (!models.has(parsed.modelId)) {
        issues.push({
          path: `upserts.${index}.model`,
          message: `Unknown model: ${parsed.providerId}/${parsed.modelId}`,
        });
      }
    }
  } catch (error) {
    warnings.push({
      path: "modelValidation",
      message: error instanceof Error ? error.message : "Unable to verify models against runtime providers",
    });
  }

  return {
    ok: issues.length === 0,
    normalized: {
      upserts,
      deletes: [...new Set(deletes)].sort((a, b) => a.localeCompare(b)),
    },
    issues,
    warnings,
  };
}

export async function patchOpencodeAgentTypes(input: {
  upserts: AgentTypeDefinition[];
  deletes: string[];
  expectedHash: string;
}) {
  const config = getConfigSnapshot().config;
  const storage = getOpencodeAgentStorageInfo(config);
  const currentConfig = await getOpencodeConfig(config);
  const currentMap = normalizeRuntimeAgentConfigMap((currentConfig as Record<string, unknown>).agent);
  const currentAgentTypes = Object.entries(currentMap)
    .map(([id, entry]) => toAgentTypeDefinition(id, entry))
    .sort((a, b) => a.id.localeCompare(b.id));
  const currentHash = hashAgentTypes(currentAgentTypes);
  if (currentHash !== input.expectedHash.trim()) {
    return {
      ok: false as const,
      status: 409,
      error: "Agent definitions changed since last load; refresh and retry.",
      currentHash,
    };
  }

  const fileConfigPath = resolveOpencodeConfigFile(config);
  const nextMap: Record<string, OpenCodeAgentConfigRecord> = { ...readFileAgentConfigMap(fileConfigPath) };
  const deletedAgentFiles: string[] = [];
  for (const id of input.deletes) {
    const normalized = id.trim();
    if (!normalized) continue;
    if (NON_DELETABLE_BUILTIN_AGENT_IDS.has(normalized)) {
      return {
        ok: false as const,
        status: 400,
        error: `Cannot delete built-in agent type: ${normalized}`,
        currentHash,
      };
    }
    delete nextMap[normalized];
    deletedAgentFiles.push(...deleteAgentMarkdownFiles(config, normalized));
  }

  for (const upsert of input.upserts) {
    const normalized = normalizeAgentTypeDraft(upsert);
    const id = normalized.id.trim();
    if (!id) continue;
    nextMap[id] = toOpenCodeAgentConfig(normalized, nextMap[id]);
  }

  const nextAgentMap = Object.fromEntries(Object.entries(nextMap).sort(([left], [right]) => left.localeCompare(right)));
  writeFileAgentConfigMap(fileConfigPath, nextAgentMap);
  await disposeOpencodeInstance(config);

  const refreshed = await listOpencodeAgentTypes();
  return {
    ok: true as const,
    agentTypes: refreshed.agentTypes,
    hash: refreshed.hash,
    storage,
    applied: {
      upserted: input.upserts.map(agent => agent.id).sort((a, b) => a.localeCompare(b)),
      deleted: input.deletes.slice().sort((a, b) => a.localeCompare(b)),
      deletedAgentFiles: deletedAgentFiles.sort((a, b) => a.localeCompare(b)),
      configFilePath: fileConfigPath,
      directory: storage.directory,
    },
  };
}
