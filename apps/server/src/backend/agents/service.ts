import {
  agentTypeToLegacySpecialist,
  legacySpecialistToAgentType,
  normalizeAgentTypeDraft,
  normalizeAgentTypeList,
  normalizeAgentTypeMode,
  normalizeLegacySpecialistAgents,
} from "@wafflebot/contracts/agentTypes";
import type { RuntimeAgent, SpecialistAgent } from "@wafflebot/contracts/dashboard";
import type { AgentTypeDefinition, WafflebotConfig } from "../config/schema";
import { createOpencodeV2ClientFromConnection, unwrapSdkData } from "../opencode/client";

const WAFFLEBOT_AGENT_MANAGED_FLAG = "wafflebotManaged";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toModelRef(value: unknown) {
  if (!isPlainObject(value)) return undefined;
  const providerID = typeof value.providerID === "string" ? value.providerID.trim() : "";
  const modelID = typeof value.modelID === "string" ? value.modelID.trim() : "";
  if (!providerID || !modelID) return undefined;
  return `${providerID}/${modelID}`;
}

export function normalizeConfiguredAgents(agents: Array<SpecialistAgent>) {
  return normalizeLegacySpecialistAgents(agents) as SpecialistAgent[];
}

export function resolveConfiguredAgentIds(config: WafflebotConfig) {
  return normalizeConfiguredAgentTypes(config.ui.agentTypes).map(agent => agent.id);
}

export function normalizeConfiguredAgentTypes(agentTypes: Array<AgentTypeDefinition>) {
  return normalizeAgentTypeList(agentTypes) as AgentTypeDefinition[];
}

export function toLegacySpecialistAgent(agentType: AgentTypeDefinition): SpecialistAgent {
  return agentTypeToLegacySpecialist(agentType) as SpecialistAgent;
}

export function resolveConfiguredAgentTypesFromLegacyAgents(agents: Array<SpecialistAgent>) {
  const normalizedAgents = normalizeConfiguredAgents(agents);
  return normalizeConfiguredAgentTypes(normalizedAgents.map(agent => legacySpecialistToAgentType(agent) as AgentTypeDefinition));
}

function createAgentClient(config: WafflebotConfig) {
  return createOpencodeV2ClientFromConnection({
    baseUrl: config.runtime.opencode.baseUrl,
    directory: config.runtime.opencode.directory,
  });
}

export async function listRuntimeAgents(config: WafflebotConfig): Promise<RuntimeAgent[]> {
  const client = createAgentClient(config);
  const payload = unwrapSdkData<Array<Record<string, unknown>>>(
    await client.app.agents(undefined, {
      responseStyle: "data",
      throwOnError: true,
      signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
    }),
  );

  const agents: RuntimeAgent[] = [];
  for (const record of Array.isArray(payload) ? payload : []) {
    if (!isPlainObject(record)) continue;
    const id = typeof record.name === "string" ? record.name.trim() : "";
    if (!id) continue;
    const model = toModelRef(record.model);
    agents.push({
      id,
      mode: normalizeAgentTypeMode(record.mode),
      description: typeof record.description === "string" ? record.description : undefined,
      model,
      native: Boolean(record.native),
      hidden: Boolean(record.hidden),
      enabled: record.disable === true ? false : true,
    });
  }
  return agents.sort((a, b) => a.id.localeCompare(b.id));
}

export function normalizeRuntimeAgentConfigMap(value: unknown): Record<string, Record<string, unknown>> {
  if (!isPlainObject(value)) return {};
  const normalized: Record<string, Record<string, unknown>> = {};
  for (const [rawName, rawConfig] of Object.entries(value)) {
    const name = rawName.trim();
    if (!name) continue;
    normalized[name] = isPlainObject(rawConfig) ? { ...rawConfig } : {};
  }
  return normalized;
}

function isManagedRuntimeAgentConfig(value: unknown) {
  if (!isPlainObject(value)) return false;
  const options = value.options;
  if (!isPlainObject(options)) return false;
  return options[WAFFLEBOT_AGENT_MANAGED_FLAG] === true;
}

function toRuntimeAgentConfig(agent: AgentTypeDefinition, previous?: Record<string, unknown>) {
  const normalizedAgent = normalizeAgentTypeDraft(agent) as AgentTypeDefinition;
  const currentOptions = isPlainObject(previous?.options) ? previous.options : {};
  return {
    ...(isPlainObject(previous) ? previous : {}),
    mode: normalizedAgent.mode,
    model: normalizedAgent.model,
    description: normalizedAgent.description,
    prompt: normalizedAgent.prompt,
    variant: normalizedAgent.variant,
    temperature: normalizedAgent.temperature,
    top_p: normalizedAgent.topP,
    steps: normalizedAgent.steps,
    permission: normalizedAgent.permission,
    disable: normalizedAgent.disable === true,
    hidden: normalizedAgent.hidden === true,
    options: {
      ...currentOptions,
      [WAFFLEBOT_AGENT_MANAGED_FLAG]: true,
      ...(isPlainObject(normalizedAgent.options) ? normalizedAgent.options : {}),
      wafflebotDisplayName: normalizedAgent.name ?? normalizedAgent.id,
    },
  };
}

export function buildDesiredRuntimeAgentConfigMap(input: {
  currentAgentConfig: unknown;
  configuredAgentTypes?: Array<AgentTypeDefinition>;
  configuredAgents?: Array<SpecialistAgent>;
}) {
  const currentMap = normalizeRuntimeAgentConfigMap(input.currentAgentConfig);
  const desired: Record<string, Record<string, unknown>> = {};

  for (const [id, config] of Object.entries(currentMap)) {
    if (isManagedRuntimeAgentConfig(config)) continue;
    desired[id] = { ...config };
  }

  const configuredAgentTypes = input.configuredAgentTypes ?? resolveConfiguredAgentTypesFromLegacyAgents(input.configuredAgents ?? []);
  for (const configured of normalizeConfiguredAgentTypes(configuredAgentTypes)) {
    desired[configured.id] = toRuntimeAgentConfig(configured, currentMap[configured.id]);
  }

  return Object.fromEntries(Object.entries(desired).sort(([left], [right]) => left.localeCompare(right)));
}
