export interface HeartbeatConfig {
  enabled: boolean;
  interval: string;
  activeHours?: {
    start: string;
    end: string;
    timezone: string;
  } | null;
  prompt: string;
  ackMaxChars: number;
}

export interface HeartbeatRuntimeConfig extends HeartbeatConfig {
  agentId: string;
  model: string;
}

export interface HeartbeatContext {
  agentId: string;
  sessionId: string;
  scheduledFor: string;
  now: string;
  lastHeartbeat?: string;
}

export interface HeartbeatResult {
  acknowledged: boolean;
  skipped?: boolean;
  suppressed: boolean;
  response?: string;
  error?: string;
}

export type HeartbeatLastResult = "idle" | "acknowledged" | "attention" | "skipped" | "error";

export interface HeartbeatRuntimeState {
  sessionId: string | null;
  backgroundRunId: string | null;
  parentSessionId: string | null;
  externalSessionId: string | null;
  running: boolean;
  lastRunAt: string | null;
  lastResult: HeartbeatLastResult;
  lastResponse: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface HeartbeatStatus {
  config: HeartbeatRuntimeConfig;
  state: HeartbeatRuntimeState;
  sessionTitle: string | null;
  nextDueAt: string | null;
}
