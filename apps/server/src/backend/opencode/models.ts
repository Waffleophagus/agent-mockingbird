import type { ConfigProvidersResponse } from "@opencode-ai/sdk/client";

import { createOpencodeClientFromConnection, unwrapSdkData } from "./client";
import { getConfig } from "../config/service";

export interface OpencodeModelOption {
  id: string;
  providerId: string;
  modelId: string;
  label: string;
  supportsImageInput?: boolean;
}

export async function listOpencodeModelOptions(): Promise<OpencodeModelOption[]> {
  const config = getConfig();
  const client = createOpencodeClientFromConnection({
    baseUrl: config.runtime.opencode.baseUrl,
    directory: config.runtime.opencode.directory,
  });
  const payload = unwrapSdkData<ConfigProvidersResponse>(await client.config.providers({
    responseStyle: "data",
    throwOnError: true,
  }));

  const options: OpencodeModelOption[] = [];
  for (const provider of payload.providers) {
    for (const [modelKey, model] of Object.entries(provider.models)) {
      const modelId = model.id ?? modelKey;
      const id = `${provider.id}/${modelId}`;
      options.push({
        id,
        providerId: provider.id,
        modelId,
        label: `${provider.name} / ${model.name}`,
        supportsImageInput: model.capabilities?.input?.image === true,
      });
    }
  }

  return options.sort((a, b) => a.label.localeCompare(b.label));
}
