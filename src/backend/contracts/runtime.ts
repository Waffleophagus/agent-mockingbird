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

export interface RuntimeEngine {
  sendUserMessage(input: SendUserMessageInput): Promise<RuntimeMessageAck>;
  subscribe(onEvent: (event: RuntimeEvent) => void): () => void;
  abortSession?(sessionId: string): Promise<boolean>;
  compactSession?(sessionId: string): Promise<boolean>;
}
