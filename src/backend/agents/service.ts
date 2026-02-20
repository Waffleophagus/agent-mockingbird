import type { RuntimeAgent, SpecialistAgent } from "../../types/dashboard";
import type { WafflebotConfig } from "../config/schema";
import { createOpencodeV2ClientFromConnection, unwrapSdkData } from "../opencode/client";

const WAFFLEBOT_AGENT_MANAGED_FLAG = "wafflebotManaged";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeAgentMode(value: unknown): RuntimeAgent["mode"] {
  if (value === "subagent") return value;
  if (value === "primary") return value;
  if (value === "all") return value;
  return "subagent";
}

function toModelRef(value: unknown) {
  if (!isPlainObject(value)) return undefined;
  const providerID = typeof value.providerID === "string" ? value.providerID.trim() : "";
  const modelID = typeof value.modelID === "string" ? value.modelID.trim() : "";
  if (!providerID || !modelID) return undefined;
  return `${providerID}/${modelID}`;
}

function normalizeAgentStatus(value: unknown): SpecialistAgent["status"] {
  if (value === "available") return value;
  if (value === "busy") return value;
  if (value === "offline") return value;
  return "available";
}

export function normalizeConfiguredAgents(agents: Array<SpecialistAgent>) {
  const deduped = new Map<string, SpecialistAgent>();
  for (const rawAgent of agents) {
    const id = rawAgent.id.trim();
    if (!id) continue;
    deduped.set(id, {
      id,
      name: rawAgent.name.trim() || id,
      specialty: rawAgent.specialty.trim() || "General",
      summary: rawAgent.summary.trim() || "General assistant tasks.",
      model: rawAgent.model.trim(),
      status: normalizeAgentStatus(rawAgent.status),
    });
  }
  return [...deduped.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveConfiguredAgentIds(config: WafflebotConfig) {
  return normalizeConfiguredAgents(config.ui.agents).map(agent => agent.id);
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
      mode: normalizeAgentMode(record.mode),
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

function toRuntimeAgentConfig(agent: SpecialistAgent, previous?: Record<string, unknown>) {
  const currentOptions = isPlainObject(previous?.options) ? previous.options : {};
  return {
    ...(isPlainObject(previous) ? previous : {}),
    mode: "subagent",
    model: agent.model,
    description: agent.specialty,
    prompt: agent.summary,
    disable: agent.status === "offline",
    hidden: false,
    options: {
      ...currentOptions,
      [WAFFLEBOT_AGENT_MANAGED_FLAG]: true,
      wafflebotDisplayName: agent.name,
      wafflebotStatus: agent.status,
    },
  };
}

export function buildDesiredRuntimeAgentConfigMap(input: {
  currentAgentConfig: unknown;
  configuredAgents: Array<SpecialistAgent>;
}) {
  const currentMap = normalizeRuntimeAgentConfigMap(input.currentAgentConfig);
  const desired: Record<string, Record<string, unknown>> = {};

  for (const [id, config] of Object.entries(currentMap)) {
    if (isManagedRuntimeAgentConfig(config)) continue;
    desired[id] = { ...config };
  }

  for (const configured of normalizeConfiguredAgents(input.configuredAgents)) {
    desired[configured.id] = toRuntimeAgentConfig(configured, currentMap[configured.id]);
  }

  return Object.fromEntries(Object.entries(desired).sort(([left], [right]) => left.localeCompare(right)));
}
