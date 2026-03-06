import { normalizeAgentTypeDraft as normalizeSharedAgentTypeDraft } from "@agent-mockingbird/contracts/agentTypes";
import type { AgentTypeDefinition, BackgroundRunSnapshot, SessionSummary } from "@agent-mockingbird/contracts/dashboard";

export const RUN_POLL_INTERVAL_MS = 350;
export const DEFAULT_RUN_WAIT_TIMEOUT_MS = 180_000;
export const DEFAULT_CHILD_SESSION_HIDE_AFTER_DAYS = 3;
export const DAY_MS = 24 * 60 * 60 * 1000;

const IN_FLIGHT_BACKGROUND_STATUSES = new Set<BackgroundRunSnapshot["status"]>([
  "created",
  "running",
  "retrying",
  "idle",
]);

export function extractRunErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "Run failed.";
  }
  const record = error as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }
  if (typeof record.name === "string" && record.name.trim()) {
    return record.name.trim();
  }
  return "Run failed.";
}

export function sortBackgroundRuns(input: BackgroundRunSnapshot[]) {
  return [...input].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function upsertBackgroundRunList(current: BackgroundRunSnapshot[], nextRun: BackgroundRunSnapshot) {
  const filtered = current.filter(run => run.runId !== nextRun.runId);
  return sortBackgroundRuns([nextRun, ...filtered]);
}

export function sortSessionsByActivity(input: SessionSummary[]) {
  return [...input].sort((left, right) => {
    if (left.id === "main" && right.id !== "main") return -1;
    if (right.id === "main" && left.id !== "main") return 1;
    return Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt);
  });
}

export function upsertSessionList(current: SessionSummary[], nextSession: SessionSummary) {
  const filtered = current.filter(session => session.id !== nextSession.id);
  return sortSessionsByActivity([nextSession, ...filtered]);
}

export function mergeBackgroundRunsBySession(
  current: Record<string, BackgroundRunSnapshot[]>,
  runs: BackgroundRunSnapshot[],
) {
  if (runs.length === 0) return current;
  const next = { ...current };
  for (const run of runs) {
    next[run.parentSessionId] = upsertBackgroundRunList(next[run.parentSessionId] ?? [], run);
  }
  return next;
}

export function isBackgroundRunInFlight(run: BackgroundRunSnapshot) {
  return IN_FLIGHT_BACKGROUND_STATUSES.has(run.status);
}

export function normalizeChildSessionHideAfterDays(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CHILD_SESSION_HIDE_AFTER_DAYS;
  }
  return Math.max(0, Math.min(365, Math.floor(value)));
}

export function normalizeAgentTypeDraft(agentType: AgentTypeDefinition): AgentTypeDefinition {
  return normalizeSharedAgentTypeDraft(agentType) as AgentTypeDefinition;
}

export function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}
