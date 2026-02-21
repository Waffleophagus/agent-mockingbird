import { OpencodeRuntime } from "./opencodeRuntime";
import { getConfigSnapshot } from "../config/service";
import type { RuntimeEngine } from "../contracts/runtime";
import { getOpencodeConnectionInfo } from "../opencode/client";

export interface RuntimeStartupInfo {
  opencode: {
    baseUrl: string;
    providerId: string;
    modelId: string;
    fallbackModels: Array<string>;
    smallModel: string;
    timeoutMs: number;
    promptTimeoutMs: number;
    directoryConfigured: boolean;
    authConfigured: boolean;
  };
}

export function createRuntime(): RuntimeEngine {
  const config = getConfigSnapshot().config;
  return new OpencodeRuntime({
    defaultProviderId: config.runtime.opencode.providerId,
    defaultModelId: config.runtime.opencode.modelId,
    fallbackModelRefs: config.runtime.opencode.fallbackModels,
    getRuntimeConfig: () => getConfigSnapshot().config.runtime.opencode,
    getEnabledSkills: () => getConfigSnapshot().config.ui.skills,
    getEnabledMcps: () => getConfigSnapshot().config.ui.mcps,
    getConfiguredMcpServers: () => getConfigSnapshot().config.ui.mcpServers,
    getConfiguredAgents: () => getConfigSnapshot().config.ui.agents,
    getConfiguredAgentTypes: () => getConfigSnapshot().config.ui.agentTypes,
  });
}

export function getRuntimeStartupInfo(): RuntimeStartupInfo {
  const config = getConfigSnapshot().config;
  const connection = getOpencodeConnectionInfo({
    baseUrl: config.runtime.opencode.baseUrl,
    timeoutMs: config.runtime.opencode.timeoutMs,
    directory: config.runtime.opencode.directory,
  });
  return {
    opencode: {
      baseUrl: connection.baseUrl,
      providerId: config.runtime.opencode.providerId,
      modelId: config.runtime.opencode.modelId,
      fallbackModels: config.runtime.opencode.fallbackModels,
      smallModel: config.runtime.opencode.smallModel,
      timeoutMs: connection.timeoutMs,
      promptTimeoutMs: config.runtime.opencode.promptTimeoutMs,
      directoryConfigured: connection.directoryConfigured,
      authConfigured: connection.authConfigured,
    },
  };
}

export {
  RuntimeProviderAuthError,
  RuntimeProviderQuotaError,
  RuntimeProviderRateLimitError,
  RuntimeSessionBusyError,
  RuntimeSessionNotFoundError,
  RuntimeTurnTimeoutError,
} from "./errors";
