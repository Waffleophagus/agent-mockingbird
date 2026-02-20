import type { WafflebotConfig } from "./schema";
import { runSemanticValidation } from "./semantic";
import { runSmokeTest } from "./smoke";
import {
  assertExpectedHashMatches,
  ensureConfigSnapshot,
  getConfig,
  getConfigPath,
  getConfigSnapshot,
  mergeConfigPatch,
  parseConfig,
  persistConfigSnapshot,
} from "./store";
import { ConfigApplyError, type ConfigSemanticSummary, type ConfigSmokeTestSummary } from "./types";

export {
  ConfigApplyError,
  type ApplyConfigPatchInput,
  type ApplyConfigReplaceInput,
  type ApplyConfigResult,
  type ConfigSemanticSummary,
  type ConfigSmokeTestSummary,
  type WafflebotConfigSnapshot,
} from "./types";

async function applyCandidateConfig(
  candidate: WafflebotConfig,
  runSmokeValidation: boolean,
): Promise<{ semantic: ConfigSemanticSummary; smokeTest: ConfigSmokeTestSummary | null }> {
  const semantic = await runSemanticValidation(candidate);
  const smokeTest = runSmokeValidation ? await runSmokeTest(candidate) : null;
  return { semantic, smokeTest };
}

export { ensureConfigSnapshot as ensureConfigFile, getConfigSnapshot, getConfig, getConfigPath };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function applyConfigPatch(input: {
  patch: unknown;
  expectedHash?: string;
  runSmokeTest?: boolean;
}) {
  const current = ensureConfigSnapshot();
  assertExpectedHashMatches(current.hash, input.expectedHash);
  if (!isPlainObject(input.patch)) {
    throw new ConfigApplyError("request", "patch must be an object");
  }

  const merged = mergeConfigPatch(current.config, input.patch);
  const candidate = parseConfig(merged);
  const validated = await applyCandidateConfig(candidate, input.runSmokeTest !== false);
  const snapshot = persistConfigSnapshot(current.path, candidate);

  return {
    snapshot,
    semantic: validated.semantic,
    smokeTest: validated.smokeTest,
  };
}

export async function replaceConfig(input: {
  config: unknown;
  expectedHash?: string;
  runSmokeTest?: boolean;
}) {
  const current = ensureConfigSnapshot();
  assertExpectedHashMatches(current.hash, input.expectedHash);

  const candidate = parseConfig(input.config);
  const validated = await applyCandidateConfig(candidate, input.runSmokeTest !== false);
  const snapshot = persistConfigSnapshot(current.path, candidate);

  return {
    snapshot,
    semantic: validated.semantic,
    smokeTest: validated.smokeTest,
  };
}
