import { OpencodeRuntime } from "./opencodeRuntime";
import { getConfigSnapshot } from "../config/service";
import type { RuntimeEngine } from "../contracts/runtime";
import { readConfiguredMcpServersFromWorkspaceConfig } from "../mcp/service";
import { getOpencodeConnectionInfo } from "../opencode/client";
import { listManagedSkillCatalog } from "../skills/service";

let runtimeInstance: RuntimeEngine | null = null;

interface RuntimeStartupInfo {
  executor: {
    enabled: boolean;
    baseUrl: string;
    workspaceDir: string;
    dataDir: string;
    uiMountPath: string;
  };
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
  const runtime = new OpencodeRuntime({
    defaultProviderId: config.runtime.opencode.providerId,
    defaultModelId: config.runtime.opencode.modelId,
    fallbackModelRefs: config.runtime.opencode.fallbackModels,
    getRuntimeConfig: () => getConfigSnapshot().config.runtime.opencode,
    getEnabledSkills: () => listManagedSkillCatalog(getConfigSnapshot().config.runtime.opencode.directory).enabled,
    getEnabledMcps: () =>
      readConfiguredMcpServersFromWorkspaceConfig(getConfigSnapshot().config)
        .filter(server => server.enabled)
        .map(server => server.id),
    getConfiguredMcpServers: () => readConfiguredMcpServersFromWorkspaceConfig(getConfigSnapshot().config),
  });
  runtimeInstance = runtime;
  return runtime;
}

export function getRuntime(): RuntimeEngine | null {
  return runtimeInstance;
}

export function getRuntimeStartupInfo(): RuntimeStartupInfo {
  const config = getConfigSnapshot().config;
  const connection = getOpencodeConnectionInfo({
    baseUrl: config.runtime.opencode.baseUrl,
    timeoutMs: config.runtime.opencode.timeoutMs,
    directory: config.runtime.opencode.directory,
  });
  return {
    executor: {
      enabled: config.runtime.executor.enabled,
      baseUrl: config.runtime.executor.baseUrl,
      workspaceDir: config.runtime.executor.workspaceDir,
      dataDir: config.runtime.executor.dataDir,
      uiMountPath: config.runtime.executor.uiMountPath,
    },
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
  RuntimeSessionBusyError,
  RuntimeSessionNotFoundError,
  RuntimeTurnTimeoutError,
} from "./errors";
