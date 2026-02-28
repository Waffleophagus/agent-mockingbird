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

export type ChatToolCallStatus = "pending" | "running" | "completed" | "error";

export interface ChatThinkingPart {
  id: string;
  type: "thinking";
  text: string;
  startedAt?: string;
  endedAt?: string;
  observedAt?: string;
}

export interface ChatToolCallPart {
  id: string;
  type: "tool_call";
  toolCallId: string;
  tool: string;
  status: ChatToolCallStatus;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  startedAt?: string;
  endedAt?: string;
  observedAt?: string;
}

export type ChatMessagePart = ChatThinkingPart | ChatToolCallPart;

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  at: string;
  memoryTrace?: MessageMemoryTrace;
  parts?: ChatMessagePart[];
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
  supportsImageInput?: boolean;
}

export interface SpecialistAgent {
  id: string;
  name: string;
  specialty: string;
  summary: string;
  model: string;
  status: "available" | "busy" | "offline";
}

export interface AgentTypeDefinition {
  id: string;
  name?: string;
  description?: string;
  prompt?: string;
  model?: string;
  variant?: string;
  mode: "subagent" | "primary" | "all";
  hidden: boolean;
  disable: boolean;
  temperature?: number;
  topP?: number;
  steps?: number;
  permission?: Record<string, unknown>;
  options: Record<string, unknown>;
}

export interface RuntimeSkill {
  id: string;
  name: string;
  description: string;
  location: string;
  enabled: boolean;
  managed: boolean;
}

export type RuntimeMcpStatus =
  | "connected"
  | "disabled"
  | "failed"
  | "needs_auth"
  | "needs_client_registration"
  | "unknown";

export interface RuntimeMcp {
  id: string;
  enabled: boolean;
  status: RuntimeMcpStatus;
  error?: string;
}

export interface RuntimeAgent {
  id: string;
  mode: "subagent" | "primary" | "all";
  description?: string;
  model?: string;
  native: boolean;
  hidden: boolean;
  enabled: boolean;
}

export type ConfiguredMcpServer =
  | {
      id: string;
      type: "remote";
      enabled: boolean;
      url: string;
      headers: Record<string, string>;
      oauth: "auto" | "off";
      timeoutMs?: number;
    }
  | {
      id: string;
      type: "local";
      enabled: boolean;
      command: string[];
      environment: Record<string, string>;
      timeoutMs?: number;
    };

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

export interface SessionRunErrorSnapshot {
  sessionId: string | null;
  name?: string;
  message: string;
}

export interface SessionMessageDeltaSnapshot {
  sessionId: string;
  messageId: string;
  text: string;
  mode: "append" | "replace";
  observedAt: string;
}

export interface BackgroundRunSnapshot {
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

export type SessionMessagePartPhase = "start" | "update" | "final";

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
  files: number;
  chunks: number;
  records: number;
  cacheEntries: number;
  indexedAt: string | null;
}

export interface MemoryWriteEvent {
  id: string;
  status: "accepted" | "rejected";
  reason: string;
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
  | {
      event: "session-message-part";
      payload: {
        sessionId: string;
        messageId: string;
        part: ChatMessagePart;
        phase: SessionMessagePartPhase;
        observedAt: string;
      };
    }
  | { event: "session-message-delta"; payload: SessionMessageDeltaSnapshot }
  | { event: "session-status"; payload: SessionRunStatusSnapshot }
  | { event: "session-compacted"; payload: SessionCompactedSnapshot }
  | { event: "session-error"; payload: SessionRunErrorSnapshot }
  | { event: "background-run"; payload: BackgroundRunSnapshot };
