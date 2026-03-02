import type { WafflebotConfig } from "./schema";
import { applyConfigPatch, getConfigSnapshot, type ApplyConfigResult } from "./service";
import {
  connectRuntimeMcp,
  disconnectRuntimeMcp,
  listRuntimeMcps,
  normalizeMcpIds,
  removeRuntimeMcpAuth,
  resolveConfiguredMcpIds,
  resolveConfiguredMcpServers,
  startRuntimeMcpAuth,
} from "../mcp/service";
import {
  getManagedSkillsRootPath,
  listRuntimeSkills,
  normalizeSkillId,
  removeManagedSkill,
  writeManagedSkill,
} from "../skills/service";

interface RuntimeMcpSnapshot {
  id: string;
  enabled: boolean;
  status: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration" | "unknown";
  error?: string;
}

export type RuntimeMcpAction = "connect" | "disconnect" | "authStart" | "authRemove";

export interface RuntimeMcpActionResult {
  id: string;
  hash: string;
  mcps: RuntimeMcpSnapshot[];
  connected?: boolean;
  disconnected?: boolean;
  authorizationUrl?: string;
  authRemoved?: { success: true };
}

export interface RuntimeSkillCatalogResult {
  status: 200 | 502;
  payload: {
    skills: Array<{
      id: string;
      name: string;
      description: string;
      location: string;
      enabled: boolean;
      managed: boolean;
    }>;
    enabled: string[];
    hash: string;
    managedPath: string;
    error?: string;
  };
}

export interface RuntimeMcpCatalogResult {
  status: 200 | 502;
  payload: {
    mcps: RuntimeMcpSnapshot[];
    enabled: string[];
    servers: ReturnType<typeof resolveConfiguredMcpServers>;
    hash: string;
    error?: string;
  };
}

export async function runRuntimeMcpAction(
  config: WafflebotConfig,
  id: string,
  action: RuntimeMcpAction,
  hash: string,
): Promise<RuntimeMcpActionResult> {
  if (action === "connect") {
    const connected = await connectRuntimeMcp(config, id);
    const mcps = await listRuntimeMcps(config);
    return { id, connected, mcps, hash };
  }
  if (action === "disconnect") {
    const disconnected = await disconnectRuntimeMcp(config, id);
    const mcps = await listRuntimeMcps(config);
    return { id, disconnected, mcps, hash };
  }
  if (action === "authStart") {
    const authorizationUrl = await startRuntimeMcpAuth(config, id);
    const mcps = await listRuntimeMcps(config);
    return { id, authorizationUrl, mcps, hash };
  }
  const authRemoved = await removeRuntimeMcpAuth(config, id);
  const mcps = await listRuntimeMcps(config);
  return { id, authRemoved, mcps, hash };
}

export async function runRuntimeMcpActionForCurrentConfig(
  id: string,
  action: RuntimeMcpAction,
): Promise<RuntimeMcpActionResult> {
  const snapshot = getConfigSnapshot();
  return runRuntimeMcpAction(snapshot.config, id, action, snapshot.hash);
}

export async function loadRuntimeSkillCatalog(): Promise<RuntimeSkillCatalogResult> {
  const snapshot = getConfigSnapshot();
  try {
    const skills = await listRuntimeSkills(snapshot.config, snapshot.config.ui.skills);
    return {
      status: 200,
      payload: {
        skills,
        enabled: snapshot.config.ui.skills,
        hash: snapshot.hash,
        managedPath: getManagedSkillsRootPath(snapshot.config.runtime.opencode.directory),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load runtime skills";
    return {
      status: 502,
      payload: {
        skills: [],
        enabled: snapshot.config.ui.skills,
        hash: snapshot.hash,
        managedPath: getManagedSkillsRootPath(snapshot.config.runtime.opencode.directory),
        error: message,
      },
    };
  }
}

export async function loadRuntimeMcpCatalog(): Promise<RuntimeMcpCatalogResult> {
  const snapshot = getConfigSnapshot();
  try {
    const mcps = await listRuntimeMcps(snapshot.config);
    return {
      status: 200,
      payload: {
        mcps,
        enabled: resolveConfiguredMcpIds(snapshot.config),
        servers: resolveConfiguredMcpServers(snapshot.config),
        hash: snapshot.hash,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load runtime MCP servers";
    const enabled = resolveConfiguredMcpIds(snapshot.config);
    return {
      status: 502,
      payload: {
        mcps: normalizeMcpIds(enabled).map(id => ({
          id,
          enabled: true,
          status: "unknown",
        })),
        enabled,
        servers: resolveConfiguredMcpServers(snapshot.config),
        hash: snapshot.hash,
        error: message,
      },
    };
  }
}

export async function importManagedSkillWithConfigUpdate(input: {
  rawId: string;
  content: string;
  enable: boolean;
  expectedHash?: string;
  runSmokeTest: boolean;
}): Promise<{
  imported: { id: string; filePath: string };
  result: ApplyConfigResult;
}> {
  const id = normalizeSkillId(input.rawId);
  const trimmedContent = input.content.trim();
  if (!trimmedContent) {
    throw new Error("skill content is required");
  }

  let created = false;
  try {
    const current = getConfigSnapshot();
    const writeResult = writeManagedSkill({
      id,
      content: trimmedContent,
      overwrite: false,
      workspaceDir: current.config.runtime.opencode.directory,
    });
    created = writeResult.created;
    const enabledSkills = new Set(current.config.ui.skills);
    if (input.enable) {
      enabledSkills.add(id);
    }

    const result = await applyConfigPatch({
      patch: {
        ui: {
          skills: [...enabledSkills],
        },
      },
      expectedHash: input.expectedHash,
      runSmokeTest: input.runSmokeTest,
    });

    return {
      imported: {
        id,
        filePath: writeResult.filePath,
      },
      result,
    };
  } catch (error) {
    if (created) {
      const current = getConfigSnapshot();
      removeManagedSkill(id, current.config.runtime.opencode.directory);
    }
    throw error;
  }
}
