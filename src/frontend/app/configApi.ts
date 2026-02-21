import type { OpencodeAgentStorageResponse } from "@/frontend/app/dashboardTypes";
import { normalizeAgentTypeDraft } from "@/shared/agentTypes";
import type {
  AgentTypeDefinition,
  ConfiguredMcpServer,
  RuntimeMcp,
  RuntimeSkill,
} from "@/types/dashboard";

interface ApiErrorPayload {
  error?: string;
}

export interface SkillCatalogResult {
  skills: RuntimeSkill[];
  enabled: string[];
  hash: string;
}

export interface McpCatalogResult {
  mcps: RuntimeMcp[];
  enabled: string[];
  servers: ConfiguredMcpServer[];
  hash: string;
}

export interface AgentCatalogResult {
  agentTypes: AgentTypeDefinition[];
  hash: string;
  storage: OpencodeAgentStorageResponse;
}

function asErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && typeof (payload as ApiErrorPayload).error === "string") {
    return (payload as ApiErrorPayload).error as string;
  }
  return fallback;
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function fetchSkillCatalog() {
  const response = await fetch("/api/config/skills/catalog");
  const payload = await parseJson<{
    skills?: RuntimeSkill[];
    enabled?: string[];
    hash?: string;
    error?: string;
  }>(response);
  if (!response.ok) {
    throw new Error(asErrorMessage(payload, "Failed to load runtime skills"));
  }
  return {
    skills: Array.isArray(payload.skills) ? payload.skills : [],
    enabled: Array.isArray(payload.enabled) ? payload.enabled : [],
    hash: typeof payload.hash === "string" ? payload.hash : "",
  } satisfies SkillCatalogResult;
}

export async function fetchMcpCatalog() {
  const response = await fetch("/api/config/mcps/catalog");
  const payload = await parseJson<{
    mcps?: RuntimeMcp[];
    enabled?: string[];
    servers?: ConfiguredMcpServer[];
    hash?: string;
    error?: string;
  }>(response);
  if (!response.ok) {
    throw new Error(asErrorMessage(payload, "Failed to load runtime MCP servers"));
  }
  return {
    mcps: Array.isArray(payload.mcps) ? payload.mcps : [],
    enabled: Array.isArray(payload.enabled) ? payload.enabled : [],
    servers: Array.isArray(payload.servers) ? payload.servers : [],
    hash: typeof payload.hash === "string" ? payload.hash : "",
  } satisfies McpCatalogResult;
}

export async function fetchAgentCatalog() {
  const response = await fetch("/api/opencode/agents");
  const payload = await parseJson<{
    agentTypes?: AgentTypeDefinition[];
    hash?: string;
    storage?: OpencodeAgentStorageResponse;
    error?: string;
  }>(response);
  if (!response.ok) {
    throw new Error(asErrorMessage(payload, "Failed to load OpenCode agent definitions"));
  }
  return {
    agentTypes: Array.isArray(payload.agentTypes)
      ? payload.agentTypes.map(agentType => normalizeAgentTypeDraft(agentType) as AgentTypeDefinition)
      : [],
    hash: typeof payload.hash === "string" ? payload.hash : "",
    storage: payload.storage ?? {},
  } satisfies AgentCatalogResult;
}

export async function importManagedSkill(input: {
  id: string;
  content: string;
  expectedHash?: string;
  enable?: boolean;
}) {
  const response = await fetch("/api/config/skills/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseJson<{
    skills?: string[];
    hash?: string;
    error?: string;
  }>(response);
  if (!response.ok || !Array.isArray(payload.skills)) {
    throw new Error(asErrorMessage(payload, "Failed to import skill"));
  }
  return {
    skills: payload.skills,
    hash: typeof payload.hash === "string" ? payload.hash : "",
  };
}

export async function saveSkills(input: { skills: string[]; expectedHash?: string }) {
  const response = await fetch("/api/config/skills", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseJson<{ skills?: string[]; hash?: string; error?: string }>(response);
  if (!response.ok || !Array.isArray(payload.skills)) {
    throw new Error(asErrorMessage(payload, "Failed to save skills"));
  }
  return {
    skills: payload.skills,
    hash: typeof payload.hash === "string" ? payload.hash : "",
  };
}

export async function saveMcps(input: {
  servers?: ConfiguredMcpServer[];
  mcps?: string[];
  expectedHash?: string;
}) {
  const response = await fetch("/api/config/mcps", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseJson<{
    mcps?: string[];
    servers?: ConfiguredMcpServer[];
    hash?: string;
    error?: string;
  }>(response);
  if (!response.ok || !Array.isArray(payload.mcps)) {
    throw new Error(asErrorMessage(payload, "Failed to save MCP servers"));
  }
  return {
    mcps: payload.mcps,
    servers: Array.isArray(payload.servers) ? payload.servers : [],
    hash: typeof payload.hash === "string" ? payload.hash : "",
  };
}

export async function validateAgentTypeChanges(input: {
  upserts: AgentTypeDefinition[];
  deletes: string[];
}) {
  const response = await fetch("/api/opencode/agents/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseJson<{
    ok?: boolean;
    issues?: Array<{ path?: string; message?: string }>;
    error?: string;
  }>(response);
  if (!response.ok) {
    throw new Error(asErrorMessage(payload, "Failed to validate agent changes"));
  }
  return payload;
}

export async function saveAgentTypeChanges(input: {
  upserts: AgentTypeDefinition[];
  deletes: string[];
  expectedHash: string;
}) {
  const response = await fetch("/api/opencode/agents", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseJson<{
    agentTypes?: AgentTypeDefinition[];
    hash?: string;
    storage?: OpencodeAgentStorageResponse;
    error?: string;
  }>(response);
  if (!response.ok || !Array.isArray(payload.agentTypes)) {
    throw new Error(asErrorMessage(payload, "Failed to save agent types"));
  }
  return {
    agentTypes: payload.agentTypes.map(agentType => normalizeAgentTypeDraft(agentType) as AgentTypeDefinition),
    hash: typeof payload.hash === "string" ? payload.hash : "",
    storage: payload.storage ?? {},
  };
}
