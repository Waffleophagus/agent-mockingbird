import type { WafflebotConfig } from "./schema";

export type ConfigApplyStage = "request" | "conflict" | "schema" | "semantic" | "smoke" | "write";

export class ConfigApplyError extends Error {
  readonly stage: ConfigApplyStage;
  readonly details?: unknown;

  constructor(stage: ConfigApplyStage, message: string, details?: unknown) {
    super(message);
    this.name = "ConfigApplyError";
    this.stage = stage;
    this.details = details;
  }
}

export interface WafflebotConfigSnapshot {
  path: string;
  hash: string;
  updatedAt: string;
  config: WafflebotConfig;
}

export interface ConfigSemanticSummary {
  providerCount: number;
  modelCount: number;
}

export interface ConfigSmokeTestSummary {
  sessionId: string;
  responseText: string;
}

export interface ApplyConfigPatchInput {
  patch: unknown;
  expectedHash?: string;
  runSmokeTest?: boolean;
}

export interface ApplyConfigReplaceInput {
  config: unknown;
  expectedHash?: string;
  runSmokeTest?: boolean;
}

export interface ApplyConfigResult {
  snapshot: WafflebotConfigSnapshot;
  semantic: ConfigSemanticSummary;
  smokeTest: ConfigSmokeTestSummary | null;
}
