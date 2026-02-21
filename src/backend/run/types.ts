export type AgentRunState = "queued" | "running" | "completed" | "failed";

export type AgentRunEventType =
  | "run.accepted"
  | "run.recovered"
  | "run.started"
  | "run.completed"
  | "run.failed";

export interface AgentRun {
  id: string;
  sessionId: string;
  state: AgentRunState;
  content: string;
  metadata: Record<string, unknown>;
  idempotencyKey: string | null;
  result: unknown;
  error: unknown;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AgentRunEvent {
  id: string;
  runId: string;
  seq: number;
  type: AgentRunEventType;
  payload: unknown;
  at: string;
}

export interface CreateAgentRunInput {
  sessionId: string;
  content: string;
  agent?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}
