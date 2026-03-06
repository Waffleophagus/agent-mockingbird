import {
  assertConfigPolicyAllows,
  evaluateConfigPolicyForPatch,
  evaluateConfigPolicyForReplace,
} from "./policy";
import type { AgentMockingbirdConfig } from "./schema";
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
import {
  ConfigApplyError,
  type ConfigPolicySummary,
  type ConfigSemanticSummary,
  type ConfigSmokeTestSummary,
} from "./types";

export {
  ConfigApplyError,
  type ApplyConfigPatchInput,
  type ApplyConfigReplaceInput,
  type ApplyConfigResult,
  type ConfigPolicySummary,
  type ConfigSemanticSummary,
  type ConfigSmokeTestSummary,
  type AgentMockingbirdConfigSnapshot,
} from "./types";

async function applyCandidateConfig(
  input: {
    currentPath: string;
    currentConfig: AgentMockingbirdConfig;
    candidate: AgentMockingbirdConfig;
    runSemanticValidation: boolean;
    runSmokeValidation: boolean;
    autoRollbackOnFailure: boolean;
  },
): Promise<{
  snapshot: ReturnType<typeof persistConfigSnapshot>;
  semantic: ConfigSemanticSummary;
  smokeTest: ConfigSmokeTestSummary | null;
}> {
  const semantic = input.runSemanticValidation
    ? await runSemanticValidation(input.candidate)
    : { providerCount: 0, modelCount: 0 };
  if (!input.runSmokeValidation) {
    const snapshot = persistConfigSnapshot(input.currentPath, input.candidate);
    return { snapshot, semantic, smokeTest: null };
  }

  if (!input.autoRollbackOnFailure) {
    const smokeTest = await runSmokeTest(input.candidate);
    const snapshot = persistConfigSnapshot(input.currentPath, input.candidate);
    return { snapshot, semantic, smokeTest };
  }

  const attemptedSnapshot = persistConfigSnapshot(input.currentPath, input.candidate);
  try {
    const smokeTest = await runSmokeTest(input.candidate);
    return { snapshot: attemptedSnapshot, semantic, smokeTest };
  } catch (error) {
    let rollbackSnapshot: ReturnType<typeof persistConfigSnapshot> | null = null;
    try {
      rollbackSnapshot = persistConfigSnapshot(input.currentPath, input.currentConfig);
    } catch (rollbackError) {
      const rollbackMessage =
        rollbackError instanceof Error ? rollbackError.message : "Failed to rollback config";
      throw new ConfigApplyError("rollback", rollbackMessage, {
        attemptedHash: attemptedSnapshot.hash,
        originalError: error instanceof Error ? error.message : "Smoke test failed",
      });
    }

    if (error instanceof ConfigApplyError) {
      throw new ConfigApplyError(error.stage, error.message, {
        ...(error.details ?? {}),
        rolledBack: true,
        attemptedHash: attemptedSnapshot.hash,
        restoredHash: rollbackSnapshot.hash,
      });
    }

    const message = error instanceof Error ? error.message : "Smoke test failed";
    throw new ConfigApplyError("smoke", message, {
      rolledBack: true,
      attemptedHash: attemptedSnapshot.hash,
      restoredHash: rollbackSnapshot.hash,
    });
  }
}

export { ensureConfigSnapshot as ensureConfigFile, getConfigSnapshot, getConfig, getConfigPath };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function shouldRunSemanticValidation(current: AgentMockingbirdConfig, candidate: AgentMockingbirdConfig) {
  return JSON.stringify(current.runtime.opencode) !== JSON.stringify(candidate.runtime.opencode);
}

export async function applyConfigPatch(input: {
  patch: unknown;
  expectedHash?: string;
  runSmokeTest?: boolean;
  safeMode?: boolean;
}) {
  const current = ensureConfigSnapshot();
  if (!isPlainObject(input.patch)) {
    throw new ConfigApplyError("request", "patch must be an object");
  }

  let policy: ConfigPolicySummary | null = null;
  if (input.safeMode) {
    policy = evaluateConfigPolicyForPatch(current.config, input.patch);
    assertConfigPolicyAllows(policy);
    if (policy.requireExpectedHash && !input.expectedHash) {
      throw new ConfigApplyError("request", "expectedHash is required in safe mode");
    }
  }
  assertExpectedHashMatches(current.hash, input.expectedHash);

  const merged = mergeConfigPatch(current.config, input.patch);
  const candidate = parseConfig(merged);
  if (input.safeMode) {
    policy = evaluateConfigPolicyForReplace(current.config, candidate);
    assertConfigPolicyAllows(policy);
  }

  const runSmokeValidation = policy?.requireSmokeTest ? true : input.runSmokeTest !== false;
  const runSemanticValidation = shouldRunSemanticValidation(current.config, candidate);
  const validated = await applyCandidateConfig({
    currentPath: current.path,
    currentConfig: current.config,
    candidate,
    runSemanticValidation,
    runSmokeValidation,
    autoRollbackOnFailure: policy?.autoRollbackOnFailure ?? false,
  });

  return {
    snapshot: validated.snapshot,
    semantic: validated.semantic,
    smokeTest: validated.smokeTest,
    policy,
  };
}

export async function replaceConfig(input: {
  config: unknown;
  expectedHash?: string;
  runSmokeTest?: boolean;
  safeMode?: boolean;
}) {
  const current = ensureConfigSnapshot();
  const candidate = parseConfig(input.config);
  let policy: ConfigPolicySummary | null = null;
  if (input.safeMode) {
    policy = evaluateConfigPolicyForReplace(current.config, candidate);
    assertConfigPolicyAllows(policy);
    if (policy.requireExpectedHash && !input.expectedHash) {
      throw new ConfigApplyError("request", "expectedHash is required in safe mode");
    }
  }
  assertExpectedHashMatches(current.hash, input.expectedHash);

  const runSmokeValidation = policy?.requireSmokeTest ? true : input.runSmokeTest !== false;
  const runSemanticValidation = shouldRunSemanticValidation(current.config, candidate);
  const validated = await applyCandidateConfig({
    currentPath: current.path,
    currentConfig: current.config,
    candidate,
    runSemanticValidation,
    runSmokeValidation,
    autoRollbackOnFailure: policy?.autoRollbackOnFailure ?? false,
  });

  return {
    snapshot: validated.snapshot,
    semantic: validated.semantic,
    smokeTest: validated.smokeTest,
    policy,
  };
}

export async function applyConfigPatchSafe(input: {
  patch: unknown;
  expectedHash?: string;
  runSmokeTest?: boolean;
}) {
  return applyConfigPatch({
    ...input,
    safeMode: true,
  });
}

export async function replaceConfigSafe(input: {
  config: unknown;
  expectedHash?: string;
  runSmokeTest?: boolean;
}) {
  return replaceConfig({
    ...input,
    safeMode: true,
  });
}
