import type {
  ChatMessage,
  ChatMessagePart,
  HeartbeatSnapshot,
  SessionMessagePartPhase,
  SessionSummary,
  UsageSnapshot,
} from "@agent-mockingbird/contracts/dashboard";

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

export interface SessionMessagePartUpdatedPayload {
  sessionId: string;
  messageId: string;
  part: ChatMessagePart;
  phase: SessionMessagePartPhase;
  observedAt: string;
}
export type SessionMessagePartUpdatedEvent = RuntimeEventBase<"session.message.part.updated", SessionMessagePartUpdatedPayload>;

export interface SessionMessageDeltaPayload {
  sessionId: string;
  messageId: string;
  text: string;
  mode: "append" | "replace";
  observedAt: string;
}
export type SessionMessageDeltaEvent = RuntimeEventBase<"session.message.delta", SessionMessageDeltaPayload>;

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

export interface SessionPermissionRequestPayload {
  id: string;
  sessionId: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
}
export type SessionPermissionRequestedEvent = RuntimeEventBase<
  "session.permission.requested",
  SessionPermissionRequestPayload
>;

export interface SessionPermissionResolvedPayload {
  sessionId: string;
  requestId: string;
  reply: "once" | "always" | "reject";
}
export type SessionPermissionResolvedEvent = RuntimeEventBase<
  "session.permission.resolved",
  SessionPermissionResolvedPayload
>;

export interface SessionQuestionOption {
  label: string;
  description: string;
}

export interface SessionQuestionInfo {
  question: string;
  header: string;
  options: SessionQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface SessionQuestionRequestPayload {
  id: string;
  sessionId: string;
  questions: SessionQuestionInfo[];
}
export type SessionQuestionRequestedEvent = RuntimeEventBase<
  "session.question.requested",
  SessionQuestionRequestPayload
>;

export interface SessionQuestionResolvedPayload {
  sessionId: string;
  requestId: string;
  outcome: "replied" | "rejected";
}
export type SessionQuestionResolvedEvent = RuntimeEventBase<
  "session.question.resolved",
  SessionQuestionResolvedPayload
>;

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

export interface SkillsCatalogUpdatedPayload {
  revision: string;
}
export type SkillsCatalogUpdatedEvent = RuntimeEventBase<"skills.catalog.updated", SkillsCatalogUpdatedPayload>;

export interface SignalChannelStatusPayload {
  connected: boolean;
  baseUrl: string;
  account: string | null;
  lastEventAt: string | null;
  lastError: string | null;
}
export type SignalChannelStatusUpdatedEvent = RuntimeEventBase<
  "channel.signal.status.updated",
  SignalChannelStatusPayload
>;

export interface SignalPairingRequestedPayload {
  senderId: string;
  code: string;
  expiresAt: string;
}
export type SignalPairingRequestedEvent = RuntimeEventBase<
  "channel.signal.pairing.requested",
  SignalPairingRequestedPayload
>;

export interface SignalMessageReceivedPayload {
  senderId: string;
  groupId: string | null;
  sessionId: string;
}
export type SignalMessageReceivedEvent = RuntimeEventBase<
  "channel.signal.message.received",
  SignalMessageReceivedPayload
>;

export interface SignalMessageSentPayload {
  target: string;
  sessionId: string;
}
export type SignalMessageSentEvent = RuntimeEventBase<"channel.signal.message.sent", SignalMessageSentPayload>;

export interface SignalErrorPayload {
  message: string;
  detail?: string;
}
export type SignalErrorEvent = RuntimeEventBase<"channel.signal.error", SignalErrorPayload>;

export type RuntimeEvent =
  | HeartbeatUpdatedEvent
  | UsageUpdatedEvent
  | SessionStateUpdatedEvent
  | SessionMessageCreatedEvent
  | SessionMessagePartUpdatedEvent
  | SessionMessageDeltaEvent
  | SessionRunStatusUpdatedEvent
  | SessionCompactedEvent
  | SessionRunErrorEvent
  | SessionPermissionRequestedEvent
  | SessionPermissionResolvedEvent
  | SessionQuestionRequestedEvent
  | SessionQuestionResolvedEvent
  | BackgroundRunUpdatedEvent
  | ConfigUpdatedEvent
  | ConfigUpdateFailedEvent
  | ConfigRolledBackEvent
  | SkillsCatalogUpdatedEvent
  | SignalChannelStatusUpdatedEvent
  | SignalPairingRequestedEvent
  | SignalMessageReceivedEvent
  | SignalMessageSentEvent
  | SignalErrorEvent;

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

export function createSessionMessagePartUpdatedEvent(
  payload: SessionMessagePartUpdatedPayload,
  source: RuntimeEventSource,
): SessionMessagePartUpdatedEvent {
  return baseRuntimeEvent("session.message.part.updated", payload, source);
}

export function createSessionMessageDeltaEvent(
  payload: SessionMessageDeltaPayload,
  source: RuntimeEventSource,
): SessionMessageDeltaEvent {
  return baseRuntimeEvent("session.message.delta", payload, source);
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

export function createSessionPermissionRequestedEvent(
  payload: SessionPermissionRequestPayload,
  source: RuntimeEventSource,
): SessionPermissionRequestedEvent {
  return baseRuntimeEvent("session.permission.requested", payload, source);
}

export function createSessionPermissionResolvedEvent(
  payload: SessionPermissionResolvedPayload,
  source: RuntimeEventSource,
): SessionPermissionResolvedEvent {
  return baseRuntimeEvent("session.permission.resolved", payload, source);
}

export function createSessionQuestionRequestedEvent(
  payload: SessionQuestionRequestPayload,
  source: RuntimeEventSource,
): SessionQuestionRequestedEvent {
  return baseRuntimeEvent("session.question.requested", payload, source);
}

export function createSessionQuestionResolvedEvent(
  payload: SessionQuestionResolvedPayload,
  source: RuntimeEventSource,
): SessionQuestionResolvedEvent {
  return baseRuntimeEvent("session.question.resolved", payload, source);
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

export function createSkillsCatalogUpdatedEvent(
  payload: SkillsCatalogUpdatedPayload,
  source: RuntimeEventSource,
): SkillsCatalogUpdatedEvent {
  return baseRuntimeEvent("skills.catalog.updated", payload, source);
}

export function createSignalChannelStatusUpdatedEvent(
  payload: SignalChannelStatusPayload,
  source: RuntimeEventSource,
): SignalChannelStatusUpdatedEvent {
  return baseRuntimeEvent("channel.signal.status.updated", payload, source);
}

export function createSignalPairingRequestedEvent(
  payload: SignalPairingRequestedPayload,
  source: RuntimeEventSource,
): SignalPairingRequestedEvent {
  return baseRuntimeEvent("channel.signal.pairing.requested", payload, source);
}

export function createSignalMessageReceivedEvent(
  payload: SignalMessageReceivedPayload,
  source: RuntimeEventSource,
): SignalMessageReceivedEvent {
  return baseRuntimeEvent("channel.signal.message.received", payload, source);
}

export function createSignalMessageSentEvent(
  payload: SignalMessageSentPayload,
  source: RuntimeEventSource,
): SignalMessageSentEvent {
  return baseRuntimeEvent("channel.signal.message.sent", payload, source);
}

export function createSignalErrorEvent(
  payload: SignalErrorPayload,
  source: RuntimeEventSource,
): SignalErrorEvent {
  return baseRuntimeEvent("channel.signal.error", payload, source);
}
