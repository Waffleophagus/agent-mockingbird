import type { ChatMessage, HeartbeatSnapshot, SessionSummary, UsageSnapshot } from "../../types/dashboard";

export type RuntimeEventSource = "api" | "runtime" | "scheduler" | "system";

interface RuntimeEventBase<TType extends string, TPayload> {
  id: string;
  type: TType;
  source: RuntimeEventSource;
  at: string;
  payload: TPayload;
}

export type HeartbeatUpdatedEvent = RuntimeEventBase<"heartbeat.updated", HeartbeatSnapshot>;
export type UsageUpdatedEvent = RuntimeEventBase<"usage.updated", UsageSnapshot>;
export type SessionStateUpdatedEvent = RuntimeEventBase<"session.state.updated", SessionSummary>;

export interface SessionMessageCreatedPayload {
  sessionId: string;
  message: ChatMessage;
}
export type SessionMessageCreatedEvent = RuntimeEventBase<"session.message.created", SessionMessageCreatedPayload>;

export interface SessionRunStatusPayload {
  sessionId: string;
  status: "idle" | "busy" | "retry";
  attempt?: number;
  message?: string;
  nextAt?: string;
}
export type SessionRunStatusUpdatedEvent = RuntimeEventBase<"session.run.status.updated", SessionRunStatusPayload>;

export interface SessionCompactedPayload {
  sessionId: string;
}
export type SessionCompactedEvent = RuntimeEventBase<"session.compacted", SessionCompactedPayload>;

export interface SessionRunErrorPayload {
  sessionId: string | null;
  name?: string;
  message: string;
}
export type SessionRunErrorEvent = RuntimeEventBase<"session.run.error", SessionRunErrorPayload>;

export interface BackgroundRunUpdatedPayload {
  runId: string;
  parentSessionId: string;
  parentExternalSessionId: string;
  childExternalSessionId: string;
  childSessionId: string | null;
  requestedBy: string;
  prompt: string;
  status: "created" | "running" | "retrying" | "idle" | "completed" | "failed" | "aborted";
  resultSummary: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
export type BackgroundRunUpdatedEvent = RuntimeEventBase<"background.run.updated", BackgroundRunUpdatedPayload>;

export interface ConfigUpdatedPayload {
  hash: string;
  path: string;
  providerCount: number;
  modelCount: number;
  smokeTestSessionId: string | null;
  smokeTestResponse: string | null;
}
export type ConfigUpdatedEvent = RuntimeEventBase<"config.updated", ConfigUpdatedPayload>;

export interface ConfigUpdateFailedPayload {
  stage: string;
  message: string;
}
export type ConfigUpdateFailedEvent = RuntimeEventBase<"config.update.failed", ConfigUpdateFailedPayload>;

export interface ConfigRolledBackPayload {
  attemptedHash: string | null;
  restoredHash: string | null;
  message: string;
}
export type ConfigRolledBackEvent = RuntimeEventBase<"config.update.rolled_back", ConfigRolledBackPayload>;

export type RuntimeEvent =
  | HeartbeatUpdatedEvent
  | UsageUpdatedEvent
  | SessionStateUpdatedEvent
  | SessionMessageCreatedEvent
  | SessionRunStatusUpdatedEvent
  | SessionCompactedEvent
  | SessionRunErrorEvent
  | BackgroundRunUpdatedEvent
  | ConfigUpdatedEvent
  | ConfigUpdateFailedEvent
  | ConfigRolledBackEvent;

function baseRuntimeEvent<TType extends RuntimeEvent["type"], TPayload>(
  type: TType,
  payload: TPayload,
  source: RuntimeEventSource,
): RuntimeEventBase<TType, TPayload> {
  return {
    id: crypto.randomUUID(),
    type,
    source,
    at: new Date().toISOString(),
    payload,
  };
}

export function createHeartbeatUpdatedEvent(payload: HeartbeatSnapshot, source: RuntimeEventSource): HeartbeatUpdatedEvent {
  return baseRuntimeEvent("heartbeat.updated", payload, source);
}

export function createUsageUpdatedEvent(payload: UsageSnapshot, source: RuntimeEventSource): UsageUpdatedEvent {
  return baseRuntimeEvent("usage.updated", payload, source);
}

export function createSessionStateUpdatedEvent(payload: SessionSummary, source: RuntimeEventSource): SessionStateUpdatedEvent {
  return baseRuntimeEvent("session.state.updated", payload, source);
}

export function createSessionMessageCreatedEvent(
  payload: SessionMessageCreatedPayload,
  source: RuntimeEventSource,
): SessionMessageCreatedEvent {
  return baseRuntimeEvent("session.message.created", payload, source);
}

export function createSessionRunStatusUpdatedEvent(
  payload: SessionRunStatusPayload,
  source: RuntimeEventSource,
): SessionRunStatusUpdatedEvent {
  return baseRuntimeEvent("session.run.status.updated", payload, source);
}

export function createSessionCompactedEvent(
  payload: SessionCompactedPayload,
  source: RuntimeEventSource,
): SessionCompactedEvent {
  return baseRuntimeEvent("session.compacted", payload, source);
}

export function createSessionRunErrorEvent(
  payload: SessionRunErrorPayload,
  source: RuntimeEventSource,
): SessionRunErrorEvent {
  return baseRuntimeEvent("session.run.error", payload, source);
}

export function createBackgroundRunUpdatedEvent(
  payload: BackgroundRunUpdatedPayload,
  source: RuntimeEventSource,
): BackgroundRunUpdatedEvent {
  return baseRuntimeEvent("background.run.updated", payload, source);
}

export function createConfigUpdatedEvent(
  payload: ConfigUpdatedPayload,
  source: RuntimeEventSource,
): ConfigUpdatedEvent {
  return baseRuntimeEvent("config.updated", payload, source);
}

export function createConfigUpdateFailedEvent(
  payload: ConfigUpdateFailedPayload,
  source: RuntimeEventSource,
): ConfigUpdateFailedEvent {
  return baseRuntimeEvent("config.update.failed", payload, source);
}

export function createConfigRolledBackEvent(
  payload: ConfigRolledBackPayload,
  source: RuntimeEventSource,
): ConfigRolledBackEvent {
  return baseRuntimeEvent("config.update.rolled_back", payload, source);
}
