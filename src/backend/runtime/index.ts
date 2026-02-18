import { OpencodeRuntime } from "./opencodeRuntime";
import type { RuntimeEngine } from "../contracts/runtime";
import { env } from "../env";
import { getOpencodeConnectionInfo } from "../opencode/client";

export interface RuntimeStartupInfo {
  opencode: {
    baseUrl: string;
    providerId: string;
    modelId: string;
    smallModel: string;
    timeoutMs: number;
    promptTimeoutMs: number;
    directoryConfigured: boolean;
    authConfigured: boolean;
  };
}

export function createRuntime(): RuntimeEngine {
  return new OpencodeRuntime({
    defaultProviderId: env.WAFFLEBOT_OPENCODE_PROVIDER_ID,
    defaultModelId: env.WAFFLEBOT_OPENCODE_MODEL_ID,
  });
}

export function getRuntimeStartupInfo(): RuntimeStartupInfo {
  const connection = getOpencodeConnectionInfo();
  return {
    opencode: {
      baseUrl: connection.baseUrl,
      providerId: env.WAFFLEBOT_OPENCODE_PROVIDER_ID,
      modelId: env.WAFFLEBOT_OPENCODE_MODEL_ID,
      smallModel: env.WAFFLEBOT_OPENCODE_SMALL_MODEL,
      timeoutMs: connection.timeoutMs,
      promptTimeoutMs: env.WAFFLEBOT_OPENCODE_PROMPT_TIMEOUT_MS,
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
