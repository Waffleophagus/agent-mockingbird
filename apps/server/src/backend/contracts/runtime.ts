import type { ChatMessage } from "@agent-mockingbird/contracts/dashboard";

import type { RuntimeEvent } from "./events";


export interface RuntimeTextInputPart {
  type: "text";
  text: string;
}

export interface RuntimeFileInputPart {
  type: "file";
  mime: string;
  filename?: string;
  url: string;
}

export type RuntimeInputPart = RuntimeTextInputPart | RuntimeFileInputPart;

export interface SendUserMessageInput {
  sessionId: string;
  content: string;
  parts?: RuntimeInputPart[];
  agent?: string;
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
  childSessionId: string | null;
  requestedBy: string;
  prompt: string;
  status: BackgroundRunStatus;
  resultSummary: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface PromptBackgroundAsyncInput {
  runId: string;
  content: string;
  parts?: RuntimeInputPart[];
  model?: string;
  system?: string;
  agent?: string;
  noReply?: boolean;
}

export interface ListBackgroundRunsInput {
  parentSessionId?: string;
  limit?: number;
  inFlightOnly?: boolean;
}

export interface RuntimeEngine {
  sendUserMessage(input: SendUserMessageInput): Promise<RuntimeMessageAck>;
  subscribe(onEvent: (event: RuntimeEvent) => void): () => void;
  dispose?(): Promise<void> | void;
  syncSessionMessages?(sessionId: string): Promise<void>;
  checkHealth?(input?: RuntimeHealthCheckInput): Promise<RuntimeHealthCheckResult>;
  abortSession?(sessionId: string): Promise<boolean>;
  compactSession?(sessionId: string): Promise<boolean>;
  spawnBackgroundSession?(input: SpawnBackgroundSessionInput): Promise<BackgroundRunHandle>;
  promptBackgroundAsync?(input: PromptBackgroundAsyncInput): Promise<BackgroundRunHandle>;
  getBackgroundStatus?(runId: string): Promise<BackgroundRunHandle | null>;
  listBackgroundRuns?(input?: ListBackgroundRunsInput): Promise<Array<BackgroundRunHandle>>;
  abortBackground?(runId: string): Promise<boolean>;
}
