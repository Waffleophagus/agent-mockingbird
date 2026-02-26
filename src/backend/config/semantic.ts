import type { ConfigProvidersResponse } from "@opencode-ai/sdk/client";

import type { WafflebotConfig } from "./schema";
import { ConfigApplyError, type ConfigSemanticSummary } from "./types";
import { createOpencodeClientFromConnection, unwrapSdkData } from "../opencode/client";

export function resolveModelRefForValidation(
  rawRef: string,
  defaultProviderId: string,
  modelsByProvider: Map<string, Set<string>>,
) {
  const trimmed = rawRef.trim();
  const defaultProvider = defaultProviderId.trim();
  if (!trimmed) {
    throw new ConfigApplyError("schema", "Model reference must not be empty");
  }
  if (!defaultProvider) {
    throw new ConfigApplyError("schema", "Default provider must not be empty");
  }

  // Model IDs can contain "/" (for example "zai-org/GLM-4.7-Flash"). Prefer
  // exact match on the selected provider before treating the value as a
  // qualified "provider/model" reference.
  const defaultProviderModels = modelsByProvider.get(defaultProvider);
  if (defaultProviderModels?.has(trimmed)) {
    return { providerId: defaultProvider, modelId: trimmed };
  }

  if (!trimmed.includes("/")) {
    return { providerId: defaultProvider, modelId: trimmed };
  }

  const [providerCandidate = "", ...rest] = trimmed.split("/");
  const modelId = rest.join("/").trim();
  const providerId = providerCandidate.trim();
  if (!providerId || !modelId) {
    throw new ConfigApplyError("schema", `Invalid model reference: ${rawRef}`);
  }

  if (modelsByProvider.has(providerId)) {
    return { providerId, modelId };
  }

  return { providerId: defaultProvider, modelId: trimmed };
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
  const primaryRef = resolveModelRefForValidation(
    config.runtime.opencode.modelId,
    config.runtime.opencode.providerId,
    providerMap.modelsByProvider,
  );
  assertModelAvailable(providerMap.modelsByProvider, primaryRef.providerId, primaryRef.modelId, "runtime.opencode.modelId");

  const smallModelRef = resolveModelRefForValidation(
    config.runtime.opencode.smallModel,
    config.runtime.opencode.providerId,
    providerMap.modelsByProvider,
  );
  assertModelAvailable(
    providerMap.modelsByProvider,
    smallModelRef.providerId,
    smallModelRef.modelId,
    "runtime.opencode.smallModel",
  );

  for (const fallbackRef of config.runtime.opencode.fallbackModels) {
    const parsedFallback = resolveModelRefForValidation(
      fallbackRef,
      config.runtime.opencode.providerId,
      providerMap.modelsByProvider,
    );
    assertModelAvailable(
      providerMap.modelsByProvider,
      parsedFallback.providerId,
      parsedFallback.modelId,
      "runtime.opencode.fallbackModels",
    );
  }

  if (config.runtime.opencode.imageModel?.trim()) {
    const imageModelRef = resolveModelRefForValidation(
      config.runtime.opencode.imageModel,
      config.runtime.opencode.providerId,
      providerMap.modelsByProvider,
    );
    assertModelAvailable(
      providerMap.modelsByProvider,
      imageModelRef.providerId,
      imageModelRef.modelId,
      "runtime.opencode.imageModel",
    );
  }

  return {
    providerCount: providerMap.providerCount,
    modelCount: providerMap.modelCount,
  };
}
