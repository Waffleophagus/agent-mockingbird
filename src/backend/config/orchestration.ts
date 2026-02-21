import type { WafflebotConfig } from "./schema";
import { applyConfigPatch, getConfigSnapshot, type ApplyConfigResult } from "./service";
import {
  connectRuntimeMcp,
  disconnectRuntimeMcp,
  listRuntimeMcps,
  removeRuntimeMcpAuth,
  startRuntimeMcpAuth,
} from "../mcp/service";
import { normalizeSkillId, removeManagedSkill, writeManagedSkill } from "../skills/service";

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
    const writeResult = writeManagedSkill({
      id,
      content: trimmedContent,
      overwrite: false,
    });
    created = writeResult.created;
    const current = getConfigSnapshot();
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
      removeManagedSkill(id);
    }
    throw error;
  }
}
