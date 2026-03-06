export type AgentTypeMode = "subagent" | "primary" | "all";
export type LegacySpecialistStatus = "available" | "busy" | "offline";

export interface LegacySpecialistAgentLike {
  id: string;
  name: string;
  specialty: string;
  summary: string;
  model: string;
  status: LegacySpecialistStatus;
}

export interface AgentTypeDefinitionLike {
  id: string;
  name?: string;
  description?: string;
  prompt?: string;
  model?: string;
  variant?: string;
  mode: AgentTypeMode;
  hidden: boolean;
  disable: boolean;
  temperature?: number;
  topP?: number;
  steps?: number;
  permission?: Record<string, unknown>;
  options: Record<string, unknown>;
}

const LEGACY_DEFAULT_SPECIALTY = "General";
const LEGACY_DEFAULT_SUMMARY = "General assistant tasks.";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeAgentTypeMode(value: unknown): AgentTypeMode {
  if (value === "subagent" || value === "primary" || value === "all") {
    return value;
  }
  return "subagent";
}

export function normalizeLegacySpecialistStatus(value: unknown): LegacySpecialistStatus {
  if (value === "available" || value === "busy" || value === "offline") {
    return value;
  }
  return "available";
}

export function normalizeAgentTypeDraft(agentType: AgentTypeDefinitionLike): AgentTypeDefinitionLike {
  return {
    ...agentType,
    id: agentType.id.trim(),
    name: agentType.name?.trim() || undefined,
    description: agentType.description?.trim() || undefined,
    prompt: agentType.prompt?.trim() || undefined,
    model: agentType.model?.trim() || undefined,
    variant: agentType.variant?.trim() || undefined,
    mode: normalizeAgentTypeMode(agentType.mode),
    hidden: agentType.hidden === true,
    disable: agentType.disable === true,
    options: isPlainObject(agentType.options) ? { ...agentType.options } : {},
  };
}

export function normalizeAgentTypeList(agentTypes: AgentTypeDefinitionLike[]) {
  const deduped = new Map<string, AgentTypeDefinitionLike>();
  for (const rawType of agentTypes) {
    const normalized = normalizeAgentTypeDraft(rawType);
    if (!normalized.id) continue;
    deduped.set(normalized.id, normalized);
  }
  return [...deduped.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function normalizeLegacySpecialistAgents(agents: LegacySpecialistAgentLike[]) {
  const deduped = new Map<string, LegacySpecialistAgentLike>();
  for (const rawAgent of agents) {
    const id = rawAgent.id.trim();
    if (!id) continue;
    deduped.set(id, {
      id,
      name: rawAgent.name.trim() || id,
      specialty: rawAgent.specialty.trim() || LEGACY_DEFAULT_SPECIALTY,
      summary: rawAgent.summary.trim() || LEGACY_DEFAULT_SUMMARY,
      model: rawAgent.model.trim(),
      status: normalizeLegacySpecialistStatus(rawAgent.status),
    });
  }
  return [...deduped.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function legacySpecialistToAgentType(agent: LegacySpecialistAgentLike): AgentTypeDefinitionLike {
  return {
    id: agent.id.trim(),
    name: agent.name.trim() || undefined,
    description: agent.specialty.trim() || undefined,
    prompt: agent.summary.trim() || undefined,
    model: agent.model.trim() || undefined,
    mode: "subagent",
    hidden: false,
    disable: agent.status === "offline",
    options: {
      agentMockingbirdManagedLegacy: true,
      agentMockingbirdDisplayName: agent.name.trim(),
      agentMockingbirdStatus: agent.status,
    },
  };
}

export function agentTypeToLegacySpecialist(agentType: AgentTypeDefinitionLike): LegacySpecialistAgentLike {
  const normalized = normalizeAgentTypeDraft(agentType);
  return {
    id: normalized.id,
    name: normalized.name || normalized.id,
    specialty: normalized.description || LEGACY_DEFAULT_SPECIALTY,
    summary: normalized.prompt || LEGACY_DEFAULT_SUMMARY,
    model: normalized.model || "",
    status: normalized.disable ? "offline" : "available",
  };
}
