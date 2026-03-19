import type { AgentMockingbirdConfig } from "./schema";
import { ConfigApplyError } from "./types";

interface ConfigPolicyDecision {
  mode: "builder" | "strict";
  changedPaths: string[];
  rejectedPaths: string[];
  requireExpectedHash: boolean;
  requireSmokeTest: boolean;
  autoRollbackOnFailure: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => stableSerialize(item)).join(",")}]`;
  if (!isPlainObject(value)) return JSON.stringify(value);
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
}

function normalizePath(path: string) {
  return path.trim().replace(/\.+$/g, "");
}

function pathMatchesRule(path: string, rawRule: string) {
  const normalizedPath = normalizePath(path);
  const rule = normalizePath(rawRule);
  if (!normalizedPath || !rule) return false;
  if (rule === "*") return true;
  if (rule.endsWith(".*")) {
    const prefix = rule.slice(0, -2);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}.`);
  }
  return normalizedPath === rule || normalizedPath.startsWith(`${rule}.`);
}

function pushPath(set: Set<string>, path: string) {
  const normalized = normalizePath(path);
  if (normalized) {
    set.add(normalized);
  }
}

function collectPatchPaths(value: unknown, path: string, out: Set<string>) {
  if (Array.isArray(value)) {
    pushPath(out, path);
    return;
  }
  if (!isPlainObject(value)) {
    pushPath(out, path);
    return;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    pushPath(out, path);
    return;
  }

  for (const [key, child] of entries) {
    const nextPath = path ? `${path}.${key}` : key;
    collectPatchPaths(child, nextPath, out);
  }
}

function collectChangedPaths(current: unknown, next: unknown, path: string, out: Set<string>) {
  if (Array.isArray(current) || Array.isArray(next)) {
    if (stableSerialize(current) !== stableSerialize(next)) {
      pushPath(out, path);
    }
    return;
  }

  if (isPlainObject(current) && isPlainObject(next)) {
    const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
    if (keys.size === 0) {
      if (stableSerialize(current) !== stableSerialize(next)) {
        pushPath(out, path);
      }
      return;
    }
    for (const key of keys) {
      const left = current[key];
      const right = next[key];
      const nextPath = path ? `${path}.${key}` : key;
      if (!(key in current) || !(key in next)) {
        pushPath(out, nextPath);
        continue;
      }
      collectChangedPaths(left, right, nextPath, out);
    }
    return;
  }

  if (stableSerialize(current) !== stableSerialize(next)) {
    pushPath(out, path);
  }
}

function evaluatePolicy(config: AgentMockingbirdConfig, changedPaths: string[]): ConfigPolicyDecision {
  const policy = config.runtime.configPolicy;
  const mode = policy.mode;
  const rejected = new Set<string>();

  for (const path of changedPaths) {
    const denied = policy.denyPaths.some(rule => pathMatchesRule(path, rule));
    if (denied) {
      rejected.add(path);
      continue;
    }
    if (mode === "strict") {
      const allowed = policy.strictAllowPaths.some(rule => pathMatchesRule(path, rule));
      if (!allowed) {
        rejected.add(path);
      }
    }
  }

  return {
    mode,
    changedPaths,
    rejectedPaths: [...rejected].sort((a, b) => a.localeCompare(b)),
    requireExpectedHash: policy.requireExpectedHash,
    requireSmokeTest: policy.requireSmokeTest,
    autoRollbackOnFailure: policy.autoRollbackOnFailure,
  };
}

export function evaluateConfigPolicyForPatch(config: AgentMockingbirdConfig, patch: unknown): ConfigPolicyDecision {
  const changed = new Set<string>();
  collectPatchPaths(patch, "", changed);
  return evaluatePolicy(config, [...changed].sort((a, b) => a.localeCompare(b)));
}

export function evaluateConfigPolicyForReplace(
  current: AgentMockingbirdConfig,
  candidate: AgentMockingbirdConfig,
): ConfigPolicyDecision {
  const changed = new Set<string>();
  collectChangedPaths(current, candidate, "", changed);
  return evaluatePolicy(current, [...changed].sort((a, b) => a.localeCompare(b)));
}

export function assertConfigPolicyAllows(decision: ConfigPolicyDecision) {
  if (decision.rejectedPaths.length > 0) {
    throw new ConfigApplyError("policy", "Config policy rejected one or more changes", {
      mode: decision.mode,
      rejectedPaths: decision.rejectedPaths,
      changedPaths: decision.changedPaths,
    });
  }
}
