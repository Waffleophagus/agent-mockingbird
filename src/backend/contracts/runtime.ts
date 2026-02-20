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

export interface RuntimeEngine {
  sendUserMessage(input: SendUserMessageInput): Promise<RuntimeMessageAck>;
  subscribe(onEvent: (event: RuntimeEvent) => void): () => void;
  checkHealth?(input?: RuntimeHealthCheckInput): Promise<RuntimeHealthCheckResult>;
  abortSession?(sessionId: string): Promise<boolean>;
  compactSession?(sessionId: string): Promise<boolean>;
}
