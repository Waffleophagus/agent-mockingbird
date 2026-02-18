export type ChatRole = "user" | "assistant";

export interface MemoryToolCallTrace {
  tool: string;
  status: "pending" | "running" | "completed" | "error";
  summary?: string;
  error?: string;
}

export interface MessageMemoryTrace {
  mode: "hybrid" | "inject_only" | "tool_only";
  injectedContextResults: number;
  toolCalls: MemoryToolCallTrace[];
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  at: string;
  memoryTrace?: MessageMemoryTrace;
}

export interface SessionSummary {
  id: string;
  title: string;
  model: string;
  status: "active" | "idle";
  lastActiveAt: string;
  messageCount: number;
}

export interface ModelOption {
  id: string;
  label: string;
  providerId: string;
  modelId: string;
}

export interface SpecialistAgent {
  id: string;
  name: string;
  specialty: string;
  summary: string;
  model: string;
  status: "available" | "busy" | "offline";
}

export interface UsageSnapshot {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface SessionRunStatusSnapshot {
  sessionId: string;
  status: "idle" | "busy" | "retry";
  attempt?: number;
  message?: string;
  nextAt?: string;
}

export interface SessionCompactedSnapshot {
  sessionId: string;
}

export interface SessionMessagePartSnapshot {
  sessionId: string;
  messageId: string;
  part: Record<string, unknown>;
  delta?: string;
}

export interface SessionRunErrorSnapshot {
  sessionId: string | null;
  name?: string;
  message: string;
}

export interface HeartbeatSnapshot {
  online: boolean;
  at: string;
}

export interface MemoryStatusSnapshot {
  enabled: boolean;
  workspaceDir: string;
  provider: string;
  model: string;
  toolMode: "hybrid" | "inject_only" | "tool_only";
  writePolicy: "conservative" | "moderate" | "aggressive";
  minConfidence: number;
  files: number;
  chunks: number;
  records: number;
  cacheEntries: number;
  indexedAt: string | null;
}

export interface MemoryPolicySnapshot {
  mode: "hybrid" | "inject_only" | "tool_only";
  writePolicy: "conservative" | "moderate" | "aggressive";
  minConfidence: number;
  allowedTypes: Array<"decision" | "preference" | "fact" | "todo" | "observation">;
  disallowedTypes: Array<"decision" | "preference" | "fact" | "todo" | "observation">;
  guidance: string[];
}

export interface MemoryWriteEvent {
  id: string;
  status: "accepted" | "rejected";
  reason: string;
  type: "decision" | "preference" | "fact" | "todo" | "observation";
  source: "user" | "assistant" | "system";
  content: string;
  confidence: number;
  sessionId: string | null;
  topic: string | null;
  recordId: string | null;
  path: string | null;
  createdAt: string;
}

export interface DashboardBootstrap {
  sessions: SessionSummary[];
  skills: string[];
  mcps: string[];
  agents: SpecialistAgent[];
  usage: UsageSnapshot;
  heartbeat: HeartbeatSnapshot;
}

export type DashboardEvent =
  | { event: "heartbeat"; payload: HeartbeatSnapshot }
  | { event: "usage"; payload: UsageSnapshot }
  | { event: "session-updated"; payload: SessionSummary }
  | { event: "session-message"; payload: { sessionId: string; message: ChatMessage } }
  | { event: "session-status"; payload: SessionRunStatusSnapshot }
  | { event: "session-compacted"; payload: SessionCompactedSnapshot }
  | { event: "session-part"; payload: SessionMessagePartSnapshot }
  | { event: "session-error"; payload: SessionRunErrorSnapshot };
