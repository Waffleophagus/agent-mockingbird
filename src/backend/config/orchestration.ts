import type { WafflebotConfig } from "./schema";
import { getConfigSnapshot } from "./service";
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
  disposeOpencodeSkillInstance,
  getDisabledSkillsRootPath,
  getManagedSkillsRootPath,
  listManagedSkillCatalog,
  normalizeSkillId,
  removeManagedSkill,
  reconcileManagedSkillEnabledSet,
  setManagedSkillEnabled,
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
  status: 200;
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
    disabled: string[];
    invalid: Array<{
      id?: string;
      location: string;
      reason: string;
    }>;
    hash: string;
    revision: string;
    managedPath: string;
    disabledPath: string;
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
  const catalog = listManagedSkillCatalog(snapshot.config.runtime.opencode.directory);
  return {
    status: 200,
    payload: {
      skills: catalog.skills,
      enabled: catalog.enabled,
      disabled: catalog.disabled,
      invalid: catalog.invalid,
      hash: catalog.revision,
      revision: catalog.revision,
      managedPath: catalog.enabledPath,
      disabledPath: catalog.disabledPath,
    },
  };
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
}): Promise<{
  imported: { id: string; filePath: string };
  skills: string[];
  hash: string;
}> {
  const id = normalizeSkillId(input.rawId);
  const trimmedContent = input.content.trim();
  if (!trimmedContent) {
    throw new Error("skill content is required");
  }

  let created = false;
  try {
    const current = getConfigSnapshot();
    const before = listManagedSkillCatalog(current.config.runtime.opencode.directory);
    if (input.expectedHash && input.expectedHash !== before.revision && input.expectedHash !== current.hash) {
      throw new Error("Skill catalog has changed; refresh and retry");
    }
    const writeResult = writeManagedSkill({
      id,
      content: trimmedContent,
      overwrite: false,
      workspaceDir: current.config.runtime.opencode.directory,
      enabled: true,
    });
    created = writeResult.created;
    if (!input.enable) {
      setManagedSkillEnabled(id, false, current.config.runtime.opencode.directory);
    }
    await disposeOpencodeSkillInstance(current.config);
    const next = listManagedSkillCatalog(current.config.runtime.opencode.directory);

    return {
      imported: {
        id,
        filePath: writeResult.filePath,
      },
      skills: next.enabled,
      hash: next.revision,
    };
  } catch (error) {
    if (created) {
      const current = getConfigSnapshot();
      removeManagedSkill(id, current.config.runtime.opencode.directory);
    }
    throw error;
  }
}

export async function setEnabledSkillsFromCatalog(input: {
  skills: string[];
  expectedHash?: string;
}): Promise<{ skills: string[]; hash: string }> {
  const current = getConfigSnapshot();
  const before = listManagedSkillCatalog(current.config.runtime.opencode.directory);
  if (input.expectedHash && input.expectedHash !== before.revision && input.expectedHash !== current.hash) {
    throw new Error("Skill catalog has changed; refresh and retry");
  }
  reconcileManagedSkillEnabledSet(input.skills, current.config.runtime.opencode.directory);
  await disposeOpencodeSkillInstance(current.config);
  const next = listManagedSkillCatalog(current.config.runtime.opencode.directory);
  return { skills: next.enabled, hash: next.revision };
}

export function getEnabledSkillsFromCatalog() {
  const current = getConfigSnapshot();
  const catalog = listManagedSkillCatalog(current.config.runtime.opencode.directory);
  return {
    skills: catalog.enabled,
    hash: catalog.revision,
    managedPath: getManagedSkillsRootPath(current.config.runtime.opencode.directory),
    disabledPath: getDisabledSkillsRootPath(current.config.runtime.opencode.directory),
  };
}
