export type CronScheduleKind = "at" | "every" | "cron";
export type CronRunMode = "system" | "agent" | "script";
export type CronInvokePolicy = "never" | "always" | "on_condition";

export type CronJobState = "queued" | "leased" | "running" | "completed" | "failed" | "dead";
export type CronStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type CronStepKind = "system" | "script" | "agent";

export interface CronJobDefinition {
  id: string;
  name: string;
  enabled: boolean;
  scheduleKind: CronScheduleKind;
  scheduleExpr: string | null;
  everyMs: number | null;
  atIso: string | null;
  timezone: string | null;
  runMode: CronRunMode;
  invokePolicy: CronInvokePolicy;
  handlerKey: string | null;
  agentPromptTemplate: string | null;
  agentModelOverride: string | null;
  maxAttempts: number;
  retryBackoffMs: number;
  payload: Record<string, unknown>;
  lastEnqueuedFor: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CronJobInstance {
  id: string;
  jobDefinitionId: string;
  scheduledFor: string;
  state: CronJobState;
  attempt: number;
  nextAttemptAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  resultSummary: string | null;
  error: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface CronJobStep {
  id: string;
  jobInstanceId: string;
  stepKind: CronStepKind;
  status: CronStepStatus;
  input: unknown;
  output: unknown;
  error: unknown;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface CronHealthSnapshot {
  enabled: boolean;
  schedulerPollMs: number;
  workerPollMs: number;
  leaseMs: number;
  jobs: {
    total: number;
    enabled: number;
  };
  instances: {
    queued: number;
    leased: number;
    running: number;
    completed: number;
    failed: number;
    dead: number;
  };
}

export interface CronJobCreateInput {
  name: string;
  enabled?: boolean;
  scheduleKind: CronScheduleKind;
  scheduleExpr?: string | null;
  everyMs?: number | null;
  atIso?: string | null;
  timezone?: string | null;
  runMode: CronRunMode;
  invokePolicy: CronInvokePolicy;
  handlerKey?: string | null;
  agentPromptTemplate?: string | null;
  agentModelOverride?: string | null;
  maxAttempts?: number;
  retryBackoffMs?: number;
  payload?: Record<string, unknown>;
}

export interface CronJobPatchInput {
  name?: string;
  enabled?: boolean;
  scheduleKind?: CronScheduleKind;
  scheduleExpr?: string | null;
  everyMs?: number | null;
  atIso?: string | null;
  timezone?: string | null;
  runMode?: CronRunMode;
  invokePolicy?: CronInvokePolicy;
  handlerKey?: string | null;
  agentPromptTemplate?: string | null;
  agentModelOverride?: string | null;
  maxAttempts?: number;
  retryBackoffMs?: number;
  payload?: Record<string, unknown>;
}

export interface CronHandlerContext {
  nowMs: number;
  payload: Record<string, unknown>;
  job: CronJobDefinition;
  instance: CronJobInstance;
}

export interface CronHandlerResult {
  status: "ok" | "error";
  summary?: string;
  data?: unknown;
  invokeAgent?: {
    shouldInvoke: boolean;
    prompt?: string;
    context?: Record<string, unknown>;
    severity?: "info" | "warn" | "critical";
  };
}

export type CronHandler = (ctx: CronHandlerContext) => Promise<CronHandlerResult> | CronHandlerResult;
