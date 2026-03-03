import type { OpencodeAgentStorageResponse } from "@/frontend/app/dashboardTypes";
import { normalizeAgentTypeDraft } from "@/shared/agentTypes";
import type {
  AgentTypeDefinition,
  ConfiguredMcpServer,
  RuntimeMcp,
  RuntimeSkillIssue,
  RuntimeSkill,
} from "@/types/dashboard";

interface ApiErrorPayload {
  error?: string;
}

export interface SkillCatalogResult {
  skills: RuntimeSkill[];
  enabled: string[];
  disabled: string[];
  invalid: RuntimeSkillIssue[];
  hash: string;
  revision: string;
  managedPath: string;
  disabledPath: string;
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

export interface OtherConfigResult {
  fallbackModels: string[];
  imageModel: string;
  hash: string;
}

export interface OpenclawImportPreviewFile {
  relativePath: string;
  sourcePath: string;
  targetPath: string;
  sourceHash: string;
  targetHash: string | null;
  status: "new" | "identical" | "conflict";
  sizeBytes: number;
}

export interface OpenclawImportPreviewResult {
  previewId: string;
  source: {
    mode: "local" | "git";
    resolvedDirectory: string;
    url?: string;
    requestedRef?: string;
    resolvedRef?: string;
    commit?: string;
  };
  targetDirectory: string;
  discoveredCount: number;
  filesNew: OpenclawImportPreviewFile[];
  filesIdentical: OpenclawImportPreviewFile[];
  filesConflicting: OpenclawImportPreviewFile[];
  warnings: string[];
  expiresAt: string;
}

export interface OpenclawImportApplyResult {
  previewId: string;
  sourceDirectory: string;
  targetDirectory: string;
  copied: Array<{ relativePath: string; sourcePath: string; targetPath: string }>;
  skippedExisting: Array<{ relativePath: string; targetPath: string }>;
  skippedIdentical: Array<{ relativePath: string; targetPath: string }>;
  skippedRequested: Array<{ relativePath: string; targetPath: string }>;
  failed: Array<{ relativePath: string; reason: string }>;
  memorySync:
    | { status: "disabled" }
    | { status: "completed" }
    | { status: "failed"; error: string };
  summary: {
    copied: number;
    skippedExisting: number;
    skippedIdentical: number;
    skippedRequested: number;
    failed: number;
  };
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
    disabled?: string[];
    invalid?: RuntimeSkillIssue[];
    hash?: string;
    revision?: string;
    managedPath?: string;
    disabledPath?: string;
    error?: string;
  }>(response);
  if (!response.ok) {
    throw new Error(asErrorMessage(payload, "Failed to load runtime skills"));
  }
  return {
    skills: Array.isArray(payload.skills) ? payload.skills : [],
    enabled: Array.isArray(payload.enabled) ? payload.enabled : [],
    disabled: Array.isArray(payload.disabled) ? payload.disabled : [],
    invalid: Array.isArray(payload.invalid) ? payload.invalid : [],
    hash: typeof payload.hash === "string" ? payload.hash : "",
    revision: typeof payload.revision === "string" ? payload.revision : "",
    managedPath: typeof payload.managedPath === "string" ? payload.managedPath : "",
    disabledPath: typeof payload.disabledPath === "string" ? payload.disabledPath : "",
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

export async function fetchOtherConfig() {
  const response = await fetch("/api/config");
  const payload = await parseJson<{
    hash?: string;
    config?: {
      runtime?: {
        opencode?: {
          fallbackModels?: string[];
          imageModel?: string | null;
        };
      };
    };
    error?: string;
  }>(response);
  if (!response.ok) {
    throw new Error(asErrorMessage(payload, "Failed to load runtime config"));
  }
  return {
    fallbackModels: Array.isArray(payload.config?.runtime?.opencode?.fallbackModels)
      ? payload.config.runtime.opencode.fallbackModels
      : [],
    imageModel:
      typeof payload.config?.runtime?.opencode?.imageModel === "string"
        ? payload.config.runtime.opencode.imageModel
        : "",
    hash: typeof payload.hash === "string" ? payload.hash : "",
  } satisfies OtherConfigResult;
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

export async function previewOpenclawImport(input: {
  source: { mode: "local"; path: string } | { mode: "git"; url: string; ref?: string };
  targetDirectory?: string;
}) {
  const response = await fetch("/api/config/opencode/bootstrap/import-openclaw/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseJson<{ preview?: OpenclawImportPreviewResult; error?: string }>(response);
  if (!response.ok || !payload.preview) {
    throw new Error(asErrorMessage(payload, "Failed to preview OpenClaw import"));
  }
  return payload.preview;
}

export async function applyOpenclawImport(input: {
  previewId: string;
  overwritePaths?: string[];
  skipPaths?: string[];
  runMemorySync?: boolean;
}) {
  const response = await fetch("/api/config/opencode/bootstrap/import-openclaw/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseJson<{ applied?: OpenclawImportApplyResult; error?: string }>(response);
  if (!response.ok || !payload.applied) {
    throw new Error(asErrorMessage(payload, "Failed to apply OpenClaw import"));
  }
  return payload.applied;
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

export async function saveOtherConfig(input: { fallbackModels: string[]; imageModel: string; expectedHash?: string }) {
  const response = await fetch("/api/config/patch-safe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patch: {
        runtime: {
          opencode: {
            fallbackModels: input.fallbackModels,
            imageModel: input.imageModel.trim() || null,
          },
        },
      },
      expectedHash: input.expectedHash,
      runSmokeTest: true,
    }),
  });
  const payload = await parseJson<{
    snapshot?: {
      hash?: string;
      config?: {
        runtime?: {
          opencode?: {
            fallbackModels?: string[];
            imageModel?: string | null;
          };
        };
      };
    };
    error?: string;
  }>(response);
  const nextFallbacks = payload.snapshot?.config?.runtime?.opencode?.fallbackModels;
  if (!response.ok || !Array.isArray(nextFallbacks)) {
    throw new Error(asErrorMessage(payload, "Failed to save runtime config"));
  }
  return {
    fallbackModels: nextFallbacks,
    imageModel:
      typeof payload.snapshot?.config?.runtime?.opencode?.imageModel === "string"
        ? payload.snapshot.config.runtime.opencode.imageModel
        : "",
    hash: typeof payload.snapshot?.hash === "string" ? payload.snapshot.hash : "",
  } satisfies OtherConfigResult;
}
