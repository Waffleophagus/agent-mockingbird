import type {
  ChatMessagePart,
  MemoryToolCallTrace,
  MessageMemoryTrace,
} from "@agent-mockingbird/contracts/dashboard";
import type {
  Config,
  Event as OpencodeEvent,
  Message,
  OpencodeClient,
  Part,
  Session,
  SessionStatus as OpencodeSessionStatus,
} from "@opencode-ai/sdk/client";

import type {
  ConfiguredMcpServer,
  AgentMockingbirdConfig,
} from "../../config/schema";
import { getConfigSnapshot } from "../../config/service";
import type { RuntimeEvent } from "../../contracts/events";
import type {
  BackgroundRunHandle,
  BackgroundRunStatus,
  ListBackgroundRunsInput,
  PromptBackgroundAsyncInput,
  RuntimeHealthCheckInput,
  RuntimeHealthCheckResult,
  RuntimeInputPart,
  RuntimeMessageAck,
  SendUserMessageInput,
  SpawnBackgroundSessionInput,
} from "../../contracts/runtime";
import { createLogger } from "../../logging/logger";
import type { MemorySearchResult } from "../../memory/types";

export type Listener = (event: RuntimeEvent) => void;
export type AssistantInfo = Extract<Message, { role: "assistant" }>;
export type OpencodeMessagePartUpdatedEvent = Extract<
  OpencodeEvent,
  { type: "message.part.updated" }
>;
export type OpencodeMessageUpdatedEvent = Extract<
  OpencodeEvent,
  { type: "message.updated" }
>;
export type OpencodeMessagePartDeltaEvent = {
  type: "message.part.delta";
  properties: {
    sessionID: string;
    messageID: string;
    partID: string;
    field: string;
    delta: string;
  };
};
export type OpencodePermissionAskedEvent = {
  type: "permission.asked";
  properties: {
    id: string;
    sessionID: string;
    permission: string;
    patterns: string[];
    metadata: Record<string, unknown>;
    always: string[];
  };
};
export type OpencodePermissionRepliedEvent = {
  type: "permission.replied";
  properties: {
    sessionID: string;
    requestID?: string;
    reply?: "once" | "always" | "reject";
    permissionID?: string;
    response?: string;
  };
};
export type OpencodeQuestionAskedEvent = {
  type: "question.asked";
  properties: {
    id: string;
    sessionID: string;
    questions: Array<{
      question: string;
      header: string;
      options: Array<{ label: string; description: string }>;
      multiple?: boolean;
      custom?: boolean;
    }>;
  };
};
export type OpencodeQuestionRepliedEvent = {
  type: "question.replied";
  properties: {
    sessionID: string;
    requestID: string;
  };
};
export type OpencodeQuestionRejectedEvent = {
  type: "question.rejected";
  properties: {
    sessionID: string;
    requestID: string;
  };
};
export type OpencodeRuntimeEvent =
  | OpencodeEvent
  | OpencodeMessagePartDeltaEvent
  | OpencodePermissionAskedEvent
  | OpencodePermissionRepliedEvent
  | OpencodeQuestionAskedEvent
  | OpencodeQuestionRepliedEvent
  | OpencodeQuestionRejectedEvent;
export type ResolvedModel = { providerId: string; modelId: string };
export type RuntimeOpencodeConfig =
  AgentMockingbirdConfig["runtime"]["opencode"];
export type RuntimeAgentCatalog = {
  ids: Set<string>;
  primaryId?: string;
};

export interface OpencodeRuntimeOptions {
  defaultProviderId: string;
  defaultModelId: string;
  fallbackModelRefs?: Array<string>;
  client?: OpencodeClient;
  getRuntimeConfig?: () => RuntimeOpencodeConfig;
  getEnabledSkills?: () => Array<string>;
  getEnabledMcps?: () => Array<string>;
  getConfiguredMcpServers?: () => Array<ConfiguredMcpServer>;
  enableEventSync?: boolean;
  enableSmallModelSync?: boolean;
  enableBackgroundSync?: boolean;
  searchMemoryFn?: (
    query: string,
    options?: { maxResults?: number; minScore?: number },
  ) => Promise<MemorySearchResult[]>;
}

export const MODEL_MEMORY_TOOLS = new Set([
  "memory_search",
  "memory_get",
  "memory_remember",
]);
export const RUNTIME_HEALTH_PROMPT =
  'Just respond "OK" to this to confirm the gateway is working.';
export const RUNTIME_HEALTH_OK_PATTERN = /\bok\b/i;
export const RUNTIME_HEALTH_CACHE_TTL_MS = 5_000;
export const RUNTIME_HEALTH_TIMEOUT_CAP_MS = 15_000;
export const OPENCODE_RUNTIME_ID = "opencode";
export const BACKGROUND_SYNC_INTERVAL_MS = 8_000;
export const BACKGROUND_SYNC_BATCH_LIMIT = 200;
export const BACKGROUND_MESSAGE_SYNC_MIN_INTERVAL_MS = 3_000;
export const SESSION_SYNC_MESSAGE_LIMIT = 10_000;
const QUEUE_DRAIN_METADATA_KEY = "__queueDrain";
export const STREAMED_METADATA_CACHE_LIMIT = 10_000;
export const AGENT_NAME_CACHE_TTL_MS = 5_000;
export const MEMORY_INJECTION_STATE_TTL_MS = 6 * 60 * 60_000;
export const MEMORY_INJECTION_STATE_MAX_ENTRIES = 1_000;
export const BUILTIN_SUBAGENT_IDS = new Set(["general", "explore"]);
export const BUILTIN_PRIMARY_AGENT_IDS = new Set([
  "build",
  "plan",
  "title",
  "summary",
  "compaction",
]);
export type RuntimeHealthSnapshot = Omit<RuntimeHealthCheckResult, "fromCache">;
export type MemoryInjectionState = {
  fingerprint: string;
  forceReinject: boolean;
  generation: number;
  turn: number;
  injectedKeysByGeneration: string[];
};
export type MemoryInjectionStateEntry = {
  state: MemoryInjectionState;
  lastTouchedAt: number;
};

export const logger = createLogger("opencode-runtime");

export function shouldQueueWhenBusy(input: SendUserMessageInput): boolean {
  return input.metadata?.heartbeat !== true;
}

export function isQueueDrainRequest(input: SendUserMessageInput): boolean {
  return input.metadata?.[QUEUE_DRAIN_METADATA_KEY] === true;
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeStringArray(values: unknown) {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

export function shallowEqualStringArrays(
  left: Array<string>,
  right: Array<string>,
) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function currentMemoryConfig() {
  return getConfigSnapshot().config.runtime.memory;
}

export function normalizeUsageDelta(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return Math.round(value);
}

export function normalizeCostDelta(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return value;
}

export type {
  ChatMessagePart,
  Config,
  ListBackgroundRunsInput,
  MemorySearchResult,
  MemoryToolCallTrace,
  Message,
  MessageMemoryTrace,
  OpencodeClient,
  OpencodeEvent,
  OpencodeSessionStatus,
  Part,
  PromptBackgroundAsyncInput,
  RuntimeHealthCheckInput,
  RuntimeHealthCheckResult,
  RuntimeInputPart,
  RuntimeMessageAck,
  SendUserMessageInput,
  Session,
  SpawnBackgroundSessionInput,
  BackgroundRunHandle,
  BackgroundRunStatus,
};
