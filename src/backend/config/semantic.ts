import type { ConfigProvidersResponse } from "@opencode-ai/sdk/client";

import type { WafflebotConfig } from "./schema";
import { ConfigApplyError, type ConfigSemanticSummary } from "./types";
import { createOpencodeClientFromConnection, unwrapSdkData } from "../opencode/client";

function parseModelRef(rawRef: string, defaultProviderId: string) {
  const trimmed = rawRef.trim();
  if (!trimmed) {
    throw new ConfigApplyError("schema", "Model reference must not be empty");
  }
  if (!trimmed.includes("/")) {
    return { providerId: defaultProviderId, modelId: trimmed };
  }
  const [providerId, ...rest] = trimmed.split("/");
  const modelId = rest.join("/").trim();
  if (!providerId || !modelId) {
    throw new ConfigApplyError("schema", `Invalid model reference: ${rawRef}`);
  }
  return { providerId: providerId.trim(), modelId };
}

async function loadProviderModelMap(config: WafflebotConfig) {
  try {
    const client = createOpencodeClientFromConnection({
      baseUrl: config.runtime.opencode.baseUrl,
      directory: config.runtime.opencode.directory,
    });
    const payload = unwrapSdkData<ConfigProvidersResponse>(
      await client.config.providers({
        responseStyle: "data",
        throwOnError: true,
        signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
      }),
    );
    const modelsByProvider = new Map<string, Set<string>>();
    let modelCount = 0;
    for (const provider of payload.providers) {
      const modelSet = new Set<string>();
      for (const [modelKey, model] of Object.entries(provider.models)) {
        modelSet.add((model.id ?? modelKey).trim());
        modelCount += 1;
      }
      modelsByProvider.set(provider.id, modelSet);
    }
    return {
      modelsByProvider,
      providerCount: payload.providers.length,
      modelCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load OpenCode providers";
    throw new ConfigApplyError("semantic", message);
  }
}

function assertModelAvailable(
  modelsByProvider: Map<string, Set<string>>,
  providerId: string,
  modelId: string,
  field: string,
) {
  const providerModels = modelsByProvider.get(providerId);
  if (!providerModels) {
    throw new ConfigApplyError("semantic", `${field} references unknown provider: ${providerId}`);
  }
  if (!providerModels.has(modelId)) {
    throw new ConfigApplyError("semantic", `${field} references unknown model: ${providerId}/${modelId}`);
  }
}

export async function runSemanticValidation(config: WafflebotConfig): Promise<ConfigSemanticSummary> {
  const providerMap = await loadProviderModelMap(config);
  const primaryRef = parseModelRef(config.runtime.opencode.modelId, config.runtime.opencode.providerId);
  assertModelAvailable(providerMap.modelsByProvider, primaryRef.providerId, primaryRef.modelId, "runtime.opencode.modelId");

  const smallModelRef = parseModelRef(config.runtime.opencode.smallModel, config.runtime.opencode.providerId);
  assertModelAvailable(
    providerMap.modelsByProvider,
    smallModelRef.providerId,
    smallModelRef.modelId,
    "runtime.opencode.smallModel",
  );

  for (const fallbackRef of config.runtime.opencode.fallbackModels) {
    const parsedFallback = parseModelRef(fallbackRef, config.runtime.opencode.providerId);
    assertModelAvailable(
      providerMap.modelsByProvider,
      parsedFallback.providerId,
      parsedFallback.modelId,
      "runtime.opencode.fallbackModels",
    );
  }

  return {
    providerCount: providerMap.providerCount,
    modelCount: providerMap.modelCount,
  };
}
