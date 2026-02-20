import type { RuntimeEvent } from "./events";
import type { ChatMessage } from "../../types/dashboard";

export interface SendUserMessageInput {
  sessionId: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeMessageAck {
  sessionId: string;
  messages: ChatMessage[];
}

export interface RuntimeHealthCheckInput {
  force?: boolean;
}

export interface RuntimeHealthCheckResult {
  ok: boolean;
  checkedAt: string;
  latencyMs: number | null;
  fromCache: boolean;
  cacheTtlMs: number;
  cacheExpiresAt: string;
  probeSessionId: string | null;
  responseText: string | null;
  error: { name: string; message: string } | null;
}

export type BackgroundRunStatus =
  | "created"
  | "running"
  | "retrying"
  | "idle"
  | "completed"
  | "failed"
  | "aborted";

export interface SpawnBackgroundSessionInput {
  parentSessionId: string;
  title?: string;
  requestedBy?: string;
  prompt?: string;
}

export interface BackgroundRunHandle {
  runId: string;
  parentSessionId: string;
  parentExternalSessionId: string;
  childExternalSessionId: string;
  status: BackgroundRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface PromptBackgroundAsyncInput {
  runId: string;
  content: string;
  model?: string;
  system?: string;
  agent?: string;
  noReply?: boolean;
}

export interface RuntimeEngine {
  sendUserMessage(input: SendUserMessageInput): Promise<RuntimeMessageAck>;
  subscribe(onEvent: (event: RuntimeEvent) => void): () => void;
  checkHealth?(input?: RuntimeHealthCheckInput): Promise<RuntimeHealthCheckResult>;
  abortSession?(sessionId: string): Promise<boolean>;
  compactSession?(sessionId: string): Promise<boolean>;
  spawnBackgroundSession?(input: SpawnBackgroundSessionInput): Promise<BackgroundRunHandle>;
  promptBackgroundAsync?(input: PromptBackgroundAsyncInput): Promise<BackgroundRunHandle>;
  getBackgroundStatus?(runId: string): Promise<BackgroundRunHandle | null>;
  abortBackground?(runId: string): Promise<boolean>;
}
