import { CronTime, validateCronExpression } from "cron";
import { realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import type {
  CronHandlerResult,
  CronJobCreateInput,
  CronJobDefinition,
  CronJobInstance,
  CronJobPatchInput,
  CronRunMode,
  CronScheduleKind,
} from "./types";
import { getConfigSnapshot } from "../config/service";
import { createLogger } from "../logging/logger";

const CONDITION_MODULE_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);
const logger = createLogger("cron");

export function nowMs() {
  return Date.now();
}

export function toIso(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function normalizePayload(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
}

export function normalizeConditionalModuleResult(
  value: unknown,
): CronHandlerResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("conditional module must return an object");
  }
  const result = value as Record<string, unknown>;
  if (result.status !== "ok" && result.status !== "error") {
    throw new Error("conditional module result.status must be 'ok' or 'error'");
  }
  return value as CronHandlerResult;
}

function readLegacyHandlerKey(input: { handlerKey?: unknown }): string | null {
  return typeof input.handlerKey === "string" ? input.handlerKey.trim() || null : null;
}

export function validateSchedule(input: {
  scheduleKind: CronScheduleKind;
  scheduleExpr: string | null;
  everyMs: number | null;
  atIso: string | null;
  timezone?: string | null;
}) {
  if (input.scheduleKind === "at") {
    if (!input.atIso) throw new Error("scheduleKind=at requires atIso");
    const parsedAt = Date.parse(input.atIso);
    if (!Number.isFinite(parsedAt)) {
      throw new Error("atIso must be a valid ISO timestamp");
    }
    return;
  }

  if (input.scheduleKind === "every") {
    if (
      typeof input.everyMs !== "number" ||
      !Number.isFinite(input.everyMs) ||
      input.everyMs < 1_000
    ) {
      throw new Error("scheduleKind=every requires everyMs >= 1000");
    }
    return;
  }

  const expr = input.scheduleExpr?.trim();
  if (!expr) throw new Error("scheduleKind=cron requires scheduleExpr");
  const valid = validateCronExpression(expr);
  if (!valid.valid) {
    throw new Error(`invalid cron expression: ${valid.error?.message ?? "parse failed"}`);
  }

  try {
    new CronTime(expr, input.timezone ?? undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : "parse failed";
    throw new Error(`invalid cron timezone: ${message}`);
  }
}

export function validateMode(input: {
  runMode: CronRunMode;
  conditionModulePath: string | null;
  conditionDescription: string | null;
  agentPromptTemplate: string | null;
  handlerKey?: string | null;
}) {
  if (input.handlerKey?.trim()) {
    throw new Error("handlerKey is no longer supported");
  }

  if (input.runMode === "background") {
    if (!input.conditionModulePath?.trim()) {
      throw new Error("runMode=background requires conditionModulePath");
    }
    if (input.agentPromptTemplate?.trim()) {
      throw new Error("runMode=background does not allow agentPromptTemplate");
    }
    return;
  }

  if (input.runMode === "agent") {
    if (input.conditionModulePath) {
      throw new Error("runMode=agent does not allow conditionModulePath");
    }
    if (input.conditionDescription) {
      throw new Error("runMode=agent does not allow conditionDescription");
    }
    if (!input.agentPromptTemplate?.trim()) {
      throw new Error("runMode=agent requires agentPromptTemplate");
    }
    return;
  }

  if (!input.conditionModulePath?.trim()) {
    throw new Error("runMode=conditional_agent requires conditionModulePath");
  }
}

export function computeBackoffMs(base: number, attempt: number): number {
  const cappedAttempt = Math.max(1, Math.min(10, attempt));
  return Math.min(
    base * 2 ** (cappedAttempt - 1),
    getConfigSnapshot().config.runtime.cron.retryBackoffCapMs,
  );
}

export function renderTemplate(
  template: string,
  ctx: Record<string, unknown>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_full, key: string) => {
    const raw = ctx[key];
    if (raw === undefined || raw === null) return "";
    if (typeof raw === "string") return raw;
    if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
    return JSON.stringify(raw);
  });
}

export function createUniqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function definitionPayloadContext(
  definition: CronJobDefinition,
  extra?: Record<string, unknown>,
) {
  return {
    ...definition.payload,
    jobId: definition.id,
    jobName: definition.name,
    ...(extra ?? {}),
  };
}

export function buildNormalizedJobInput(
  input: CronJobCreateInput | (CronJobPatchInput & { id?: string }),
  defaults?: CronJobDefinition,
): {
  id: string;
  name: string;
  enabled: boolean;
  scheduleKind: CronScheduleKind;
  scheduleExpr: string | null;
  everyMs: number | null;
  atIso: string | null;
  timezone: string | null;
  runMode: CronRunMode;
  handlerKey: string | null;
  conditionModulePath: string | null;
  conditionDescription: string | null;
  agentPromptTemplate: string | null;
  agentModelOverride: string | null;
  maxAttempts: number;
  retryBackoffMs: number;
  payload: Record<string, unknown>;
} {
  return {
    id: input.id?.trim() ? input.id.trim() : defaults?.id ?? createUniqueId("cron"),
    name: input.name?.trim() ?? defaults?.name ?? "",
    enabled: input.enabled ?? defaults?.enabled ?? true,
    scheduleKind: (input.scheduleKind ?? defaults?.scheduleKind)!,
    scheduleExpr:
      input.scheduleExpr !== undefined
        ? input.scheduleExpr?.trim() ?? null
        : defaults?.scheduleExpr ?? null,
    everyMs: input.everyMs !== undefined ? input.everyMs : defaults?.everyMs ?? null,
    atIso: input.atIso !== undefined ? input.atIso?.trim() ?? null : defaults?.atIso ?? null,
    timezone:
      input.timezone !== undefined ? input.timezone?.trim() ?? null : defaults?.timezone ?? null,
    runMode: (input.runMode ?? defaults?.runMode)!,
    handlerKey: readLegacyHandlerKey(input as { handlerKey?: unknown }),
    conditionModulePath:
      input.conditionModulePath !== undefined
        ? input.conditionModulePath?.trim() ?? null
        : defaults?.conditionModulePath ?? null,
    conditionDescription:
      input.conditionDescription !== undefined
        ? input.conditionDescription?.trim() ?? null
        : defaults?.conditionDescription ?? null,
    agentPromptTemplate:
      input.agentPromptTemplate !== undefined
        ? input.agentPromptTemplate?.trim() ?? null
        : defaults?.agentPromptTemplate ?? null,
    agentModelOverride:
      input.agentModelOverride !== undefined
        ? input.agentModelOverride?.trim() ?? null
        : defaults?.agentModelOverride ?? null,
    maxAttempts: Math.max(
      1,
      input.maxAttempts ??
        defaults?.maxAttempts ??
        getConfigSnapshot().config.runtime.cron.defaultMaxAttempts,
    ),
    retryBackoffMs: Math.max(
      1_000,
      input.retryBackoffMs ??
        defaults?.retryBackoffMs ??
        getConfigSnapshot().config.runtime.cron.defaultRetryBackoffMs,
    ),
    payload:
      input.payload !== undefined
        ? normalizePayload(input.payload)
        : defaults?.payload ?? {},
  };
}

function resolveWorkspaceRootPath(): string {
  const configured = getConfigSnapshot().config.runtime.opencode.directory?.trim();
  return resolve(configured || process.cwd());
}

export function resolveConditionModuleAbsolutePath(conditionModulePath: string): string {
  const extension = extname(conditionModulePath).toLowerCase();
  if (!CONDITION_MODULE_EXTENSIONS.has(extension)) {
    throw new Error("conditionModulePath must target a .ts, .js, .mjs, or .cjs file");
  }

  const workspaceRoot = realpathSync(resolveWorkspaceRootPath());
  const target = resolve(workspaceRoot, conditionModulePath);
  let resolvedTarget: string;
  try {
    resolvedTarget = realpathSync(target);
  } catch {
    throw new Error("conditionModulePath must reference an existing file under the runtime workspace directory");
  }
  const relativePath = relative(workspaceRoot, resolvedTarget);
  if (!relativePath || relativePath === ".") {
    throw new Error("conditionModulePath must target a file under the runtime workspace directory");
  }
  if (isAbsolute(relativePath)) {
    throw new Error("conditionModulePath must target a file under the runtime workspace directory");
  }
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error("conditionModulePath escapes the runtime workspace directory");
  }
  if (!statSync(resolvedTarget).isFile()) {
    throw new Error("conditionModulePath must reference a regular file");
  }
  return resolvedTarget;
}

export function computeDueTimesForDefinition(
  row: {
    schedule_kind: CronScheduleKind;
    schedule_expr: string | null;
    every_ms: number | null;
    at_iso: string | null;
    timezone: string | null;
    last_enqueued_for: number | null;
    created_at: number;
  },
  now: number,
  maxPerTick: number,
): number[] {
  const due: number[] = [];
  const lastEnqueued = row.last_enqueued_for ?? null;

  if (row.schedule_kind === "at") {
    if (!row.at_iso) return due;
    const atMs = Date.parse(row.at_iso);
    if (!Number.isFinite(atMs)) return due;
    if (atMs <= now && (lastEnqueued === null || lastEnqueued < atMs)) {
      due.push(atMs);
    }
    return due;
  }

  if (row.schedule_kind === "every") {
    const everyMs = row.every_ms ?? 0;
    if (!Number.isFinite(everyMs) || everyMs <= 0) return due;
    let cursor = lastEnqueued ?? row.created_at;
    for (let i = 0; i < maxPerTick; i += 1) {
      const next = cursor + everyMs;
      if (next > now) break;
      due.push(next);
      cursor = next;
    }
    return due;
  }

  const expr = row.schedule_expr?.trim();
  if (!expr) return due;
  try {
    const cronTime = new CronTime(expr, row.timezone ?? undefined);
    let cursor = lastEnqueued ?? (row.created_at - 1);
    for (let i = 0; i < maxPerTick; i += 1) {
      const nextDate = cronTime.getNextDateFrom(new Date(cursor));
      const nextMs = nextDate.toMillis();
      if (!Number.isFinite(nextMs)) break;
      if (nextMs > now) break;
      if (nextMs <= cursor) break;
      due.push(nextMs);
      cursor = nextMs + 1;
    }
  } catch {
    logger.warn("Ignoring invalid cron expression during scheduling", {
      scheduleExpr: expr,
      timezone: row.timezone,
    });
  }
  return due;
}

export function buildAgentPromptContext(
  definition: CronJobDefinition,
  instance: CronJobInstance,
  context?: Record<string, unknown>,
) {
  return {
    ...definitionPayloadContext(definition),
    ...(context ?? {}),
    threadSessionId: definition.threadSessionId,
    instanceId: instance.id,
    scheduledFor: instance.scheduledFor,
  };
}
