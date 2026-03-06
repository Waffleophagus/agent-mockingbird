import type { RuntimeInputPart } from "../contracts/runtime";

export type QueueMode = "collect" | "followup" | "replace";

export interface QueuedMessage {
  id: string;
  sessionId: string;
  content: string;
  parts?: RuntimeInputPart[];
  agent?: string;
  metadata?: Record<string, unknown>;
  arrivedAt: number;
}

export interface LaneStats {
  sessionId: string;
  depth: number;
  mode: QueueMode;
  oldestMessageAge: number | null;
}

export interface QueueConfig {
  enabled: boolean;
  defaultMode: QueueMode;
  maxDepth: number;
  coalesceDebounceMs: number;
}

export interface QueueDrainResult {
  messagesProcessed: number;
  mode: QueueMode;
  coalesced: boolean;
}

export type DrainHandler = (
  sessionId: string,
  messages: QueuedMessage[],
  mode: QueueMode,
) => Promise<void>;
