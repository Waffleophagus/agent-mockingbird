import type { AgentMockingbirdConfig } from "./schema";

export type ConfigApplyStage =
  | "request"
  | "conflict"
  | "schema"
  | "semantic"
  | "smoke"
  | "policy"
  | "rollback"
  | "write";

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

export interface AgentMockingbirdConfigSnapshot {
  path: string;
  hash: string;
  updatedAt: string;
  config: AgentMockingbirdConfig;
}

export interface ConfigSemanticSummary {
  providerCount: number;
  modelCount: number;
}

export interface ConfigSmokeTestSummary {
  sessionId: string;
  responseText: string;
}

export interface ConfigPolicySummary {
  mode: "builder" | "strict";
  changedPaths: string[];
  rejectedPaths: string[];
  requireExpectedHash: boolean;
  requireSmokeTest: boolean;
  autoRollbackOnFailure: boolean;
}

export interface ApplyConfigPatchInput {
  patch: unknown;
  expectedHash?: string;
  runSmokeTest?: boolean;
  safeMode?: boolean;
}

export interface ApplyConfigReplaceInput {
  config: unknown;
  expectedHash?: string;
  runSmokeTest?: boolean;
  safeMode?: boolean;
}

export interface ApplyConfigResult {
  snapshot: AgentMockingbirdConfigSnapshot;
  semantic: ConfigSemanticSummary;
  smokeTest: ConfigSmokeTestSummary | null;
  policy: ConfigPolicySummary | null;
}
