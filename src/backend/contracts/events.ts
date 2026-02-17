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

export type RuntimeEvent =
  | HeartbeatUpdatedEvent
  | UsageUpdatedEvent
  | SessionStateUpdatedEvent
  | SessionMessageCreatedEvent;

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
