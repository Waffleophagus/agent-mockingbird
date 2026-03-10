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
  retrievedContextResults?: number;
  suppressedAsAlreadyInContext?: number;
  suppressedAsIrrelevant?: number;
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

export interface StreamdownCodeTokenSnapshot {
  bgColor?: string;
  content: string;
  color?: string;
}

export interface StreamdownCodeBlockSnapshot {
  blockIndex: number;
  codeHash: string;
  language: string;
  tokens: StreamdownCodeTokenSnapshot[][];
}

export interface StreamdownCodeLineHighlight {
  blockIndex: number;
  codeHash: string;
  isClosed: boolean;
  lineIndex: number;
  language: string;
  lineText: string;
  tokens: StreamdownCodeTokenSnapshot[];
}

export interface StreamdownRenderSnapshot {
  codeBlocks: StreamdownCodeBlockSnapshot[];
  contentHash: string;
  themeId: string;
  version: 1;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  at: string;
  memoryTrace?: MessageMemoryTrace;
  parts?: ChatMessagePart[];
  renderSnapshot?: StreamdownRenderSnapshot;
}

export interface SessionMessageCheckpoint {
  lastMessageAt: string;
  lastMessageId: string;
}

export interface SessionMessageCursor {
  at: string;
  role: ChatRole;
  id: string;
}

export interface SessionMessageWindowMeta {
  oldestLoaded: SessionMessageCursor | null;
  newestLoaded: SessionMessageCursor | null;
  hasOlder: boolean;
  totalMessages: number;
  isWindowed: boolean;
}

export interface SessionMessagesDeltaResponse {
  messages: ChatMessage[];
  checkpoint: SessionMessageCheckpoint | null;
  requiresReset?: boolean;
}

export interface SessionMessagesWindowResponse {
  messages: ChatMessage[];
  meta: SessionMessageWindowMeta;
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

export interface RuntimeSkillIssue {
  id?: string;
  location: string;
  reason: string;
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

export interface PermissionPromptRequest {
  id: string;
  sessionId: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
}

export interface PermissionPromptResolved {
  sessionId: string;
  requestId: string;
  reply: "once" | "always" | "reject";
}

export interface QuestionPromptOption {
  label: string;
  description: string;
}

export interface QuestionPromptInfo {
  question: string;
  header: string;
  options: QuestionPromptOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface QuestionPromptRequest {
  id: string;
  sessionId: string;
  questions: QuestionPromptInfo[];
}

export interface QuestionPromptResolved {
  sessionId: string;
  requestId: string;
  outcome: "replied" | "rejected";
}

export interface SessionMessageDeltaSnapshot {
  sessionId: string;
  messageId: string;
  text: string;
  mode: "append" | "replace";
  observedAt: string;
}

export interface SessionMessageRenderSnapshotEvent {
  sessionId: string;
  messageId: string;
  renderSnapshot: StreamdownRenderSnapshot;
  observedAt: string;
}

export interface SessionMessageCodeHighlightEvent {
  sessionId: string;
  messageId: string;
  highlight: StreamdownCodeLineHighlight;
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

export interface RealtimeCursorSnapshot {
  latestSeq: number;
}

export interface SessionScreenBootstrapResponse {
  sessions: SessionSummary[];
  activeSessionId: string;
  activeSession: SessionSummary | null;
  messages: ChatMessage[];
  messagesMeta?: SessionMessageWindowMeta;
  usage: UsageSnapshot;
  heartbeat: HeartbeatSnapshot;
  models: ModelOption[];
  backgroundRuns: BackgroundRunSnapshot[];
  pendingPermissions?: PermissionPromptRequest[];
  pendingQuestions?: QuestionPromptRequest[];
  workspaceBootstrap?: {
    mode?: string;
    identity?: {
      name?: string;
      emoji?: string;
      theme?: string;
      creature?: string;
      vibe?: string;
      avatar?: string;
    };
    files?: Array<{
      name: string;
      missing: boolean;
      truncated: boolean;
    }>;
  };
  featureFlags?: {
    reviewEnabled?: boolean;
  };
  realtime: RealtimeCursorSnapshot;
}

export interface NotificationDeviceRecord {
  installationId: string;
  expoPushToken: string;
  platform: "ios" | "android";
  enabled: boolean;
  label: string | null;
  lastSeenAt: string;
  updatedAt: string;
  createdAt: string;
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
  | {
      event: "session-message-code-highlight";
      payload: SessionMessageCodeHighlightEvent;
    }
  | {
      event: "session-message-render-snapshot";
      payload: SessionMessageRenderSnapshotEvent;
    }
  | { event: "session-status"; payload: SessionRunStatusSnapshot }
  | { event: "session-compacted"; payload: SessionCompactedSnapshot }
  | { event: "session-error"; payload: SessionRunErrorSnapshot }
  | { event: "permission-requested"; payload: PermissionPromptRequest }
  | { event: "permission-resolved"; payload: PermissionPromptResolved }
  | { event: "question-requested"; payload: QuestionPromptRequest }
  | { event: "question-resolved"; payload: QuestionPromptResolved }
  | { event: "background-run"; payload: BackgroundRunSnapshot }
  | { event: "skills-catalog-updated"; payload: { revision: string } };

export interface DashboardRealtimeHelloFrame {
  type: "hello";
  latestSeq: number;
  replayWindowSize: number;
}

export interface DashboardRealtimeEventFrame {
  type: "event";
  seq: number;
  event: DashboardEvent["event"];
  payload: DashboardEvent["payload"];
}

export interface DashboardRealtimeResyncRequiredFrame {
  type: "resync_required";
  latestSeq: number;
  reason: "gap" | "invalid_cursor" | "server_restart";
}

export type DashboardRealtimeFrame =
  | DashboardRealtimeHelloFrame
  | DashboardRealtimeEventFrame
  | DashboardRealtimeResyncRequiredFrame;
