export interface HeartbeatConfig {
  enabled: boolean;
  interval: string;
  activeHours?: {
    start: string;
    end: string;
    timezone: string;
  };
  prompt?: string;
  ackMaxChars: number;
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

export interface HeartbeatJobPayload {
  agentId: string;
  sessionId: string;
  prompt?: string;
  ackMaxChars?: number;
  activeHours?: {
    start: string;
    end: string;
    timezone: string;
  };
}
