import type {
  Config,
  Event as OpencodeEvent,
  Message,
  OpencodeClient,
  Part,
  Session,
  SessionStatus as OpencodeSessionStatus,
} from "@opencode-ai/sdk/client";

import {
  RuntimeContinuationDetachedError,
  RuntimeProviderAuthError,
  RuntimeProviderQuotaError,
  RuntimeProviderRateLimitError,
  RuntimeSessionBusyError,
  RuntimeSessionQueuedError,
  RuntimeSessionNotFoundError,
} from "./errors";
import {
  analyzeMemoryInjectionResults,
  buildMemoryContextFingerprint,
  isMemoryRecallIntentQuery,
  isWriteIntentMemoryQuery,
  memoryInjectionResultKey,
} from "./memoryPromptDedup";
import type { ChatMessagePart, MemoryToolCallTrace, MessageMemoryTrace } from "../../types/dashboard";
import { buildWorkspaceBootstrapPromptContext } from "../agents/bootstrapContext";
import type { ConfiguredMcpServer, WafflebotConfig } from "../config/schema";
import { getConfigSnapshot } from "../config/service";
import {
  createBackgroundRunUpdatedEvent,
  createHeartbeatUpdatedEvent,
  createSessionCompactedEvent,
  createSessionMessageCreatedEvent,
  createSessionMessageDeltaEvent,
  createSessionMessagePartUpdatedEvent,
  createSessionRunErrorEvent,
  createSessionRunStatusUpdatedEvent,
  createSessionStateUpdatedEvent,
  createUsageUpdatedEvent,
  type RuntimeEvent,
} from "../contracts/events";
import type {
  BackgroundRunHandle,
  BackgroundRunStatus,
  ListBackgroundRunsInput,
  PromptBackgroundAsyncInput,
  RuntimeEngine,
  RuntimeHealthCheckInput,
  RuntimeHealthCheckResult,
  RuntimeInputPart,
  RuntimeMessageAck,
  SendUserMessageInput,
  SpawnBackgroundSessionInput,
} from "../contracts/runtime";
import {
  appendAssistantMessage,
  appendChatExchange,
  createBackgroundRun,
  ensureSessionForRuntimeBinding,
  getBackgroundRunByChildExternalSessionId,
  getBackgroundRunById,
  listBackgroundRunsForParentSession,
  listBackgroundRunsPendingAnnouncement,
  listInFlightBackgroundRuns,
  listRecentBackgroundRuns,
  listRuntimeSessionBindings,
  getUsageSnapshot,
  getLocalSessionIdByRuntimeBinding,
  recordUsageDelta,
  getRuntimeSessionBinding,
  getSessionById,
  setBackgroundRunStatus,
  setMessageMemoryTrace,
  setSessionTitle,
  setRuntimeSessionBinding,
  upsertSessionMessages,
  type BackgroundRunRecord,
} from "../db/repository";
import { env } from "../env";
import {
  buildDesiredRuntimeMcpConfigMap,
  normalizeMcpIds,
  normalizeMcpServerDefinitions,
  normalizeRuntimeMcpConfigMap,
} from "../mcp/service";
import { searchMemory } from "../memory/service";
import type { MemorySearchResult } from "../memory/types";
import {
  createOpencodeClient,
  createOpencodeClientFromConnection,
  getOpencodeErrorStatus,
  unwrapSdkData,
} from "../opencode/client";
import { getLaneQueue } from "../queue/service";
import {
  buildManagedSkillPaths,
  getManagedSkillsRootPath,
  normalizeSkillIds,
} from "../skills/service";

type Listener = (event: RuntimeEvent) => void;
type AssistantInfo = Extract<Message, { role: "assistant" }>;
type OpencodeMessagePartUpdatedEvent = Extract<OpencodeEvent, { type: "message.part.updated" }>;
type OpencodeMessageUpdatedEvent = Extract<OpencodeEvent, { type: "message.updated" }>;
type OpencodeMessagePartDeltaEvent = {
  type: "message.part.delta";
  properties: {
    sessionID: string;
    messageID: string;
    partID: string;
    field: string;
    delta: string;
  };
};
type OpencodeRuntimeEvent = OpencodeEvent | OpencodeMessagePartDeltaEvent;
type ResolvedModel = { providerId: string; modelId: string };
type RuntimeOpencodeConfig = WafflebotConfig["runtime"]["opencode"];
type RuntimeAgentCatalog = {
  ids: Set<string>;
  primaryId?: string;
};

interface OpencodeRuntimeOptions {
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
  searchMemoryFn?: (query: string, options?: { maxResults?: number; minScore?: number }) => Promise<MemorySearchResult[]>;
}

const MODEL_MEMORY_TOOLS = new Set(["memory_search", "memory_get", "memory_remember"]);
const RUNTIME_HEALTH_PROMPT = 'Just respond "OK" to this to confirm the gateway is working.';
const RUNTIME_HEALTH_OK_PATTERN = /\bok\b/i;
const RUNTIME_HEALTH_CACHE_TTL_MS = 5_000;
const RUNTIME_HEALTH_TIMEOUT_CAP_MS = 15_000;
const OPENCODE_RUNTIME_ID = "opencode";
const BACKGROUND_SYNC_INTERVAL_MS = 8_000;
const BACKGROUND_SYNC_BATCH_LIMIT = 200;
const BACKGROUND_MESSAGE_SYNC_MIN_INTERVAL_MS = 3_000;
const QUEUE_DRAIN_METADATA_KEY = "__queueDrain";
const DEFAULT_RUNTIME_TIMEOUT_MS = 120_000;
const DEFAULT_RUNTIME_PROMPT_TIMEOUT_MS = 300_000;
const STREAMED_METADATA_CACHE_LIMIT = 10_000;
const AGENT_NAME_CACHE_TTL_MS = 5_000;
const BUILTIN_SUBAGENT_IDS = new Set(["general", "explore"]);
const BUILTIN_PRIMARY_AGENT_IDS = new Set(["build", "plan", "title", "summary", "compaction"]);
type RuntimeHealthSnapshot = Omit<RuntimeHealthCheckResult, "fromCache">;
type MemoryInjectionState = {
  fingerprint: string;
  forceReinject: boolean;
  generation: number;
  turn: number;
  injectedKeysByGeneration: string[];
};

function shouldQueueWhenBusy(input: SendUserMessageInput): boolean {
  return input.metadata?.heartbeat !== true;
}

function isQueueDrainRequest(input: SendUserMessageInput): boolean {
  return input.metadata?.[QUEUE_DRAIN_METADATA_KEY] === true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringArray(values: unknown) {
  if (!Array.isArray(values)) return [];
  const normalized = values.map(value => (typeof value === "string" ? value.trim() : "")).filter(Boolean);
  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

function shallowEqualStringArrays(left: Array<string>, right: Array<string>) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerialize(item)).join(",")}]`;
  }
  if (!isPlainObject(value)) {
    return JSON.stringify(value);
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
}

function currentMemoryConfig() {
  return getConfigSnapshot().config.runtime.memory;
}

function normalizeUsageDelta(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return Math.round(value);
}

function normalizeCostDelta(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return value;
}

export class OpencodeRuntime implements RuntimeEngine {
  private listeners = new Set<Listener>();
  private client: OpencodeClient | null = null;
  private clientConnectionKey: string | null = null;
  private eventSyncStarted = false;
  private busySessions = new Set<string>();
  private healthSnapshot: RuntimeHealthSnapshot | null = null;
  private healthCacheExpiresAtMs = 0;
  private healthProbeInFlight: Promise<RuntimeHealthSnapshot> | null = null;
  private runtimeConfigSyncKey: string | null = null;
  private runtimeConfigSyncInFlight: Promise<void> | null = null;
  private backgroundSyncStarted = false;
  private backgroundSyncInFlight: Promise<void> | null = null;
  private backgroundHydrationInFlight = new Set<string>();
  private backgroundAnnouncementInFlight = new Set<string>();
  private backgroundLastEmitByRunId = new Map<string, string>();
  private backgroundMessageSyncAtByChildSessionId = new Map<string, number>();
  private drainingSessions = new Set<string>();
  private imageCapabilityByModelRef = new Map<string, boolean>();
  private imageCapabilityFetchedAtMs = 0;
  private messageRoleByScopedMessageId = new Map<string, Message["role"]>();
  private partTypeByScopedPartId = new Map<string, Part["type"]>();
  private memoryInjectionStateBySessionId = new Map<string, MemoryInjectionState>();
  private availableAgentNamesCache:
    | {
        fetchedAtMs: number;
        catalog: RuntimeAgentCatalog;
      }
    | null = null;

  constructor(private options: OpencodeRuntimeOptions) {
    if (options.client) {
      this.client = options.client;
    } else if (!options.getRuntimeConfig) {
      this.client = createOpencodeClient();
    }
    if (options.enableSmallModelSync !== false) {
      void this.syncOpencodeSmallModel();
    }
    if (options.enableEventSync !== false) {
      this.startEventSync();
    }
    if (options.enableBackgroundSync !== false) {
      this.startBackgroundSync();
    }
  }

  subscribe(onEvent: Listener): () => void {
    this.listeners.add(onEvent);
    return () => {
      this.listeners.delete(onEvent);
    };
  }

  async syncSessionMessages(sessionId: string): Promise<void> {
    const localSessionId = sessionId.trim();
    if (!localSessionId) return;
    const localSession = getSessionById(localSessionId);
    if (!localSession) return;
    const externalSessionId = getRuntimeSessionBinding(OPENCODE_RUNTIME_ID, localSessionId);
    if (!externalSessionId) return;
    const run = getBackgroundRunByChildExternalSessionId(OPENCODE_RUNTIME_ID, externalSessionId);
    if (run) {
      this.ensureLocalSessionForBackgroundRun(run);
    }
    await this.syncLocalSessionFromOpencode({
      localSessionId,
      externalSessionId,
      force: true,
      titleHint: localSession.title,
    });
  }

  async checkHealth(input?: RuntimeHealthCheckInput): Promise<RuntimeHealthCheckResult> {
    const force = input?.force === true;
    if (!force && this.healthSnapshot && this.healthCacheExpiresAtMs > Date.now()) {
      return {
        ...this.healthSnapshot,
        fromCache: true,
      };
    }

    await this.ensureRuntimeConfigSynced();

    if (!this.healthProbeInFlight) {
      this.healthProbeInFlight = this.runHealthProbe();
    }

    try {
      const snapshot = await this.healthProbeInFlight;
      this.healthSnapshot = snapshot;
      this.healthCacheExpiresAtMs = Date.parse(snapshot.cacheExpiresAt);
      return {
        ...snapshot,
        fromCache: false,
      };
    } finally {
      this.healthProbeInFlight = null;
    }
  }

  private currentRuntimeConfig() {
    return this.options.getRuntimeConfig?.();
  }

  private currentProviderId() {
    const runtimeConfig = this.currentRuntimeConfig();
    const providerId = runtimeConfig?.providerId?.trim();
    return providerId || this.options.defaultProviderId;
  }

  private currentModelId() {
    const runtimeConfig = this.currentRuntimeConfig();
    const modelId = runtimeConfig?.modelId?.trim();
    return modelId || this.options.defaultModelId;
  }

  private currentFallbackModels() {
    const runtimeConfig = this.currentRuntimeConfig();
    return runtimeConfig?.fallbackModels ?? this.options.fallbackModelRefs ?? [];
  }

  private currentSmallModel() {
    const runtimeConfig = this.currentRuntimeConfig();
    const smallModel = runtimeConfig?.smallModel?.trim();
    return smallModel || `${this.currentProviderId()}/${this.currentModelId()}`;
  }

  private currentTimeoutMs() {
    const runtimeConfig = this.currentRuntimeConfig();
    return runtimeConfig?.timeoutMs ?? DEFAULT_RUNTIME_TIMEOUT_MS;
  }

  private currentPromptTimeoutMs() {
    const runtimeConfig = this.currentRuntimeConfig();
    return runtimeConfig?.promptTimeoutMs ?? DEFAULT_RUNTIME_PROMPT_TIMEOUT_MS;
  }

  private currentEnabledSkills() {
    return normalizeSkillIds(this.options.getEnabledSkills?.() ?? []);
  }

  private currentEnabledMcps() {
    return normalizeMcpIds(this.options.getEnabledMcps?.() ?? []);
  }

  private currentConfiguredMcpServers() {
    return normalizeMcpServerDefinitions(this.options.getConfiguredMcpServers?.() ?? []);
  }

  private getClient() {
    if (this.options.client) {
      return this.options.client;
    }

    const runtimeConfig = this.currentRuntimeConfig();
    if (!runtimeConfig) {
      if (!this.client) {
        this.client = createOpencodeClient();
      }
      return this.client;
    }

    const nextKey = `${runtimeConfig.baseUrl}|${runtimeConfig.directory ?? ""}`;
    if (!this.client || this.clientConnectionKey !== nextKey) {
      this.clientConnectionKey = nextKey;
      this.runtimeConfigSyncKey = null;
      this.client = createOpencodeClientFromConnection({
        baseUrl: runtimeConfig.baseUrl,
        directory: runtimeConfig.directory,
      });
    }
    return this.client;
  }

  async sendUserMessage(input: SendUserMessageInput): Promise<RuntimeMessageAck> {
    const session = getSessionById(input.sessionId);
    if (!session) {
      throw new RuntimeSessionNotFoundError(input.sessionId);
    }

    const childRunsInFlight = this.inFlightBackgroundChildRunCount(session.id);
    const sessionBusy =
      this.busySessions.has(session.id) ||
      childRunsInFlight > 0 ||
      (this.drainingSessions.has(session.id) && !isQueueDrainRequest(input));

    if (sessionBusy) {
      if (shouldQueueWhenBusy(input)) {
        let enqueuedDepth = 0;
        let queued = false;
        try {
          const queue = getLaneQueue();
          const enqueued = queue.enqueue(session.id, input.content, input.parts, input.agent, input.metadata);
          enqueuedDepth = enqueued.depth;
          queued = enqueued.queued;
        } catch {
          // Queue not initialized, fall through
        }
        if (queued) {
          throw new RuntimeSessionQueuedError(session.id, enqueuedDepth);
        }
      }
      throw new RuntimeSessionBusyError(session.id);
    }
    this.busySessions.add(session.id);

    try {
      await this.ensureRuntimeConfigSynced();
      const model = this.resolveModel(session.model);
      let selectedModel = model;
      let opencodeSessionId = await this.resolveOrCreateOpencodeSession(session.id, session.title);
      const inputParts = this.normalizePromptInputParts(input.content, input.parts);
      const imageInputPresent = inputParts.some(part => part.type === "file" && part.mime.toLowerCase().startsWith("image/"));

      if (imageInputPresent) {
        const supportsImage = await this.modelSupportsImageInput(model);
        if (!supportsImage) {
          const imageModelRef = this.currentImageModel();
          if (imageModelRef) {
            selectedModel = this.resolveModel(imageModelRef);
            this.emit(
              createSessionRunStatusUpdatedEvent(
                {
                  sessionId: session.id,
                  status: "retry",
                  attempt: 1,
                  message: `Routing image input to ${this.formatModelRef(selectedModel)} in this session.`,
                },
                "runtime",
              ),
            );
          }
        }
      }

      const primaryText = this.extractPrimaryTextInput(inputParts);
      const promptInput = await this.buildPromptInputWithMemory(opencodeSessionId, primaryText);
      const requestedAgent = await this.resolveRequestedAgentId(input.agent?.trim(), session.id);
      const effectiveAgent = requestedAgent ?? (await this.resolvePrimaryAgentId(undefined, { emitRetryStatus: false }));
      const memorySystemPrompt = this.buildWafflebotSystemPrompt({
        agentId: effectiveAgent,
      });
      const promptParts = this.applyMemoryPromptToParts(inputParts, promptInput.content);
      const recreatedSessionPromptParts = this.applyMemoryPromptToParts(inputParts, promptInput.freshSessionContent);

      let promptResult: { message: { info: AssistantInfo; parts: Array<Part> }; opencodeSessionId: string };
      try {
        promptResult = await this.sendPromptWithModelFallback({
          localSessionId: session.id,
          localSessionTitle: session.title,
          opencodeSessionId,
          primaryModel: selectedModel,
          parts: promptParts,
          retryPartsOnSessionRecreate: recreatedSessionPromptParts,
          memoryContextFingerprint: promptInput.memoryContextFingerprint,
          system: memorySystemPrompt,
          agent: effectiveAgent,
        });
      } catch (error) {
        const childRunCount = this.inFlightBackgroundChildRunCount(session.id);
        if (this.isTimeoutLikeError(error) && childRunCount > 0) {
          throw new RuntimeContinuationDetachedError(session.id, childRunCount);
        }
        throw error;
      }
      opencodeSessionId = promptResult.opencodeSessionId;
      const assistantMessage = promptResult.message;
      this.rememberMessageRole(opencodeSessionId, assistantMessage.info.id, "assistant");
      for (const part of assistantMessage.parts) {
        this.rememberPartMetadata(part);
      }

      await this.syncSessionTitleFromOpencode(session.id, opencodeSessionId, session.title);
      this.startSessionTitlePolling(session.id, opencodeSessionId);

      const trace = this.buildMessageMemoryTrace(assistantMessage.parts, {
        injectedContextResults: promptInput.injectedContextResults,
        retrievedContextResults: promptInput.retrievedContextResults,
        suppressedAsAlreadyInContext: promptInput.suppressedAsAlreadyInContext,
        suppressedAsIrrelevant: promptInput.suppressedAsIrrelevant,
      });
      const assistantParts = this.buildChatMessageParts(assistantMessage.parts);
      const assistantError = this.extractAssistantError(assistantMessage.info, assistantMessage.parts);
      if (assistantError) {
        const normalizedAssistantError = this.normalizeProviderMessage(assistantError) || assistantError;
        this.emit(
          createSessionRunErrorEvent(
            {
              sessionId: session.id,
              message: normalizedAssistantError,
            },
            "runtime",
          ),
        );
        throw new Error(`OpenCode run failed: ${normalizedAssistantError}`);
      }

      const assistantText =
        this.extractText(assistantMessage.parts) ||
        this.mapOpencodeMessageContent(assistantMessage.info, assistantMessage.parts) ||
        "[assistant response pending; check streamed parts or wait for session sync]";

      const createdAt =
        assistantMessage.info.time?.completed ?? assistantMessage.info.time?.created ?? Date.now();
      const result = appendChatExchange({
        sessionId: session.id,
        userContent: this.summarizeUserInputForStorage(input.content, inputParts),
        assistantContent: assistantText,
        assistantParts,
        source: "runtime",
        createdAt,
        userMessageId: assistantMessage.info.parentID,
        assistantMessageId: assistantMessage.info.id,
        usage: {
          requestCountDelta: 1,
          inputTokensDelta:
            assistantMessage.info.tokens?.input ?? Math.max(8, promptInput.content.length * 2),
          outputTokensDelta:
            assistantMessage.info.tokens?.output ?? Math.max(24, Math.floor(promptInput.content.length * 2.5)),
          estimatedCostUsdDelta: assistantMessage.info.cost ?? 0,
        },
      });

      if (!result) {
        throw new RuntimeSessionNotFoundError(input.sessionId);
      }

      if (trace) {
        setMessageMemoryTrace({
          sessionId: session.id,
          messageId: assistantMessage.info.id,
          trace,
          createdAt,
        });
        for (const message of result.messages) {
          if (message.id === assistantMessage.info.id && message.role === "assistant") {
            message.memoryTrace = trace;
          }
        }
      }

      if (assistantParts.length > 0) {
        for (const message of result.messages) {
          if (message.id === assistantMessage.info.id && message.role === "assistant") {
            message.parts = assistantParts;
          }
        }
      }

      for (const message of result.messages) {
        this.emit(
          createSessionMessageCreatedEvent(
            {
              sessionId: result.session.id,
              message,
            },
            "runtime",
          ),
        );
      }
      this.emit(createSessionStateUpdatedEvent(result.session, "runtime"));
      this.emit(createUsageUpdatedEvent(result.usage, "runtime"));
      this.emit(createHeartbeatUpdatedEvent(result.heartbeat, "runtime"));

      return {
        sessionId: result.session.id,
        messages: result.messages,
      };
    } finally {
      try {
        const queue = getLaneQueue();
        if (queue.depth(session.id) > 0 && this.inFlightBackgroundChildRunCount(session.id) === 0) {
          this.drainingSessions.add(session.id);
          this.busySessions.delete(session.id);

          while (queue.depth(session.id) > 0) {
            try {
              await queue.drainAndExecute(session.id);
            } catch (err) {
              console.error("Queue drain error:", err);
              break;
            }
          }
        }
      } catch {
        // Queue not initialized, ignore
      } finally {
        this.drainingSessions.delete(session.id);
        this.busySessions.delete(session.id);
      }
    }
  }

  async spawnBackgroundSession(input: SpawnBackgroundSessionInput): Promise<BackgroundRunHandle> {
    const parentSessionId = input.parentSessionId.trim();
    const parentSession = getSessionById(parentSessionId);
    if (!parentSession) {
      throw new RuntimeSessionNotFoundError(parentSessionId);
    }

    await this.ensureRuntimeConfigSynced();
    const parentOpencodeSessionId = await this.resolveOrCreateOpencodeSession(parentSession.id, parentSession.title);
    const created = unwrapSdkData<Session>(
      await this.getClient().session.create({
        body: {
          parentID: parentOpencodeSessionId,
          title: input.title?.trim() || `${parentSession.title} background`,
        },
        responseStyle: "data",
        throwOnError: true,
        signal: this.defaultRequestSignal(),
      }),
    );

    const run = createBackgroundRun({
      runtime: OPENCODE_RUNTIME_ID,
      parentSessionId: parentSession.id,
      parentExternalSessionId: parentOpencodeSessionId,
      childExternalSessionId: created.id,
      requestedBy: input.requestedBy,
      prompt: input.prompt,
      status: "created",
    });
    if (!run) {
      throw new Error("Failed to create background run record.");
    }

    this.ensureLocalSessionForBackgroundRun(run, created);
    this.emitBackgroundRunUpdated(run);
    return this.backgroundRecordToHandle(run);
  }

  async promptBackgroundAsync(input: PromptBackgroundAsyncInput): Promise<BackgroundRunHandle> {
    const runId = input.runId.trim();
    const content = input.content.trim();
    const inputParts = this.normalizePromptInputParts(content, input.parts);
    if (!runId) {
      throw new Error("runId is required.");
    }
    if (!content && inputParts.length === 0) {
      throw new Error("content or parts is required.");
    }

    const run = getBackgroundRunById(runId);
    if (!run) {
      throw new Error(`Unknown background run: ${runId}`);
    }

    const parentSession = getSessionById(run.parentSessionId);
    if (!parentSession) {
      throw new RuntimeSessionNotFoundError(run.parentSessionId);
    }

    await this.ensureRuntimeConfigSynced();
    const model = this.resolveModel(input.model?.trim() || parentSession.model);
    const requestedAgent = await this.resolveRequestedAgentId(input.agent?.trim());
    const effectiveAgent = requestedAgent ?? (await this.resolvePrimaryAgentId(undefined, { emitRetryStatus: false }));
    const startedAt = run.startedAt ? undefined : Date.now();

    const running =
      setBackgroundRunStatus({
      runId: run.id,
      status: "running",
      prompt: content,
      startedAt,
      completedAt: null,
      resultSummary: null,
      error: null,
      }) ?? run;
    this.emitBackgroundRunUpdated(running);

    try {
      await this.getClient().session.promptAsync({
        path: { id: run.childExternalSessionId },
        body: {
          model: {
            providerID: model.providerId,
            modelID: model.modelId,
          },
          system: input.system,
          agent: effectiveAgent,
          noReply: input.noReply,
          parts: inputParts,
        },
        responseStyle: "data",
        throwOnError: true,
        signal: this.promptRequestSignal(),
      });
    } catch (error) {
      const normalizedError = this.normalizeRuntimeError(error);
      const failed =
        setBackgroundRunStatus({
        runId: run.id,
        status: "failed",
        completedAt: Date.now(),
        error: normalizedError.message,
        }) ?? run;
      this.emitBackgroundRunUpdated(failed);
      throw normalizedError;
    }

    const refreshed = await this.getBackgroundStatus(run.id);
    if (!refreshed) {
      throw new Error(`Background run disappeared after dispatch: ${run.id}`);
    }
    return refreshed;
  }

  async getBackgroundStatus(runId: string): Promise<BackgroundRunHandle | null> {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) return null;

    let run = getBackgroundRunById(normalizedRunId);
    if (!run) return null;

    try {
      const statuses = unwrapSdkData<Record<string, OpencodeSessionStatus>>(
        await this.getClient().session.status({
          responseStyle: "data",
          throwOnError: true,
          signal: this.defaultRequestSignal(),
        }),
      );
      const opencodeStatus = statuses[run.childExternalSessionId];
      if (opencodeStatus) {
        run = this.applyOpencodeBackgroundStatus(run, opencodeStatus);
      }
    } catch {
      // Keep local status if status refresh fails.
    }

    if (run.status === "completed") {
      await this.announceBackgroundRunIfNeeded(run.id);
      const refreshed = getBackgroundRunById(run.id);
      if (refreshed) {
        run = refreshed;
      }
    }

    await this.syncBackgroundSessionMessages(
      run,
      run.status === "completed" || run.status === "failed" || run.status === "aborted",
    );

    return this.backgroundRecordToHandle(run);
  }

  async listBackgroundRuns(input?: ListBackgroundRunsInput): Promise<Array<BackgroundRunHandle>> {
    const limit = Math.max(1, Math.min(500, Math.floor(input?.limit ?? 100)));
    const parentSessionId = input?.parentSessionId?.trim();
    const runs = parentSessionId
      ? listBackgroundRunsForParentSession(parentSessionId, limit)
      : input?.inFlightOnly
        ? listInFlightBackgroundRuns(OPENCODE_RUNTIME_ID, limit)
        : listRecentBackgroundRuns(OPENCODE_RUNTIME_ID, limit);

    const handles: Array<BackgroundRunHandle> = [];
    for (const run of runs) {
      const status = await this.getBackgroundStatus(run.id);
      if (!status) continue;
      handles.push(status);
    }
    return handles;
  }

  async abortBackground(runId: string): Promise<boolean> {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) return false;
    const run = getBackgroundRunById(normalizedRunId);
    if (!run) return false;

    try {
      const result = await this.getClient().session.abort({
        path: { id: run.childExternalSessionId },
        responseStyle: "data",
        throwOnError: true,
        signal: this.defaultRequestSignal(),
      });
      const aborted = Boolean(unwrapSdkData<boolean>(result));
      if (aborted) {
        const updated =
          setBackgroundRunStatus({
          runId: run.id,
          status: "aborted",
          completedAt: Date.now(),
          error: null,
          }) ?? run;
        this.emitBackgroundRunUpdated(updated);
      }
      return aborted;
    } catch (error) {
      if (getOpencodeErrorStatus(error) === 404) {
        return false;
      }
      throw this.normalizeRuntimeError(error);
    }
  }

  async abortSession(sessionId: string): Promise<boolean> {
    const opencodeSessionId = getRuntimeSessionBinding(OPENCODE_RUNTIME_ID, sessionId);
    if (!opencodeSessionId) return false;
    try {
      const result = await this.getClient().session.abort({
        path: { id: opencodeSessionId },
        responseStyle: "data",
        throwOnError: true,
        signal: this.defaultRequestSignal(),
      });
      return Boolean(unwrapSdkData<boolean>(result));
    } catch (error) {
      if (getOpencodeErrorStatus(error) === 404) {
        return false;
      }
      throw this.normalizeRuntimeError(error);
    }
  }

  async compactSession(sessionId: string): Promise<boolean> {
    const session = getSessionById(sessionId);
    if (!session) throw new RuntimeSessionNotFoundError(sessionId);

    let opencodeSessionId = await this.resolveOrCreateOpencodeSession(session.id, session.title);
    const model = this.resolveModel(session.model);
    try {
      const result = await this.getClient().session.summarize({
        path: { id: opencodeSessionId },
        body: {
          providerID: model.providerId,
          modelID: model.modelId,
        },
        responseStyle: "data",
        throwOnError: true,
        signal: this.defaultRequestSignal(),
      });
      this.markMemoryInjectionStateForReinject(opencodeSessionId);
      return Boolean(unwrapSdkData<boolean>(result));
    } catch (error) {
      if (getOpencodeErrorStatus(error) === 404) {
        opencodeSessionId = await this.createOpencodeSession(session.id, session.title);
        const retry = await this.getClient().session.summarize({
          path: { id: opencodeSessionId },
          body: {
            providerID: model.providerId,
            modelID: model.modelId,
          },
          responseStyle: "data",
          throwOnError: true,
          signal: this.defaultRequestSignal(),
        });
        this.markMemoryInjectionStateForReinject(opencodeSessionId);
        return Boolean(unwrapSdkData<boolean>(retry));
      }
      throw this.normalizeRuntimeError(error);
    }
  }

  private async buildPromptInputWithMemory(opencodeSessionId: string, userContent: string): Promise<{
    content: string;
    freshSessionContent: string;
    injectedContextResults: number;
    retrievedContextResults: number;
    suppressedAsAlreadyInContext: number;
    suppressedAsIrrelevant: number;
    memoryContextFingerprint: string | null;
  }> {
    if (currentMemoryConfig().toolMode === "tool_only") {
      return {
        content: userContent,
        freshSessionContent: userContent,
        injectedContextResults: 0,
        retrievedContextResults: 0,
        suppressedAsAlreadyInContext: 0,
        suppressedAsIrrelevant: 0,
        memoryContextFingerprint: null,
      };
    }

    const query = userContent.trim();
    if (!query) {
      this.clearMemoryInjectionState(opencodeSessionId);
      return {
        content: userContent,
        freshSessionContent: userContent,
        injectedContextResults: 0,
        retrievedContextResults: 0,
        suppressedAsAlreadyInContext: 0,
        suppressedAsIrrelevant: 0,
        memoryContextFingerprint: null,
      };
    }
    if (currentMemoryConfig().toolMode === "hybrid" && isWriteIntentMemoryQuery(query)) {
      return {
        content: userContent,
        freshSessionContent: userContent,
        injectedContextResults: 0,
        retrievedContextResults: 0,
        suppressedAsAlreadyInContext: 0,
        suppressedAsIrrelevant: 0,
        memoryContextFingerprint: null,
      };
    }

    try {
      const searchResults = await this.searchMemory(query);
      const analyzed = analyzeMemoryInjectionResults(query, searchResults as MemorySearchResult[]);
      const relevantResults = analyzed.results;
      if (!relevantResults.length) {
        return {
          content: userContent,
          freshSessionContent: userContent,
          injectedContextResults: 0,
          retrievedContextResults: searchResults.length,
          suppressedAsAlreadyInContext: 0,
          suppressedAsIrrelevant: analyzed.filteredIrrelevantCount,
          memoryContextFingerprint: null,
        };
      }

      const memoryConfig = currentMemoryConfig();
      const dedupeEnabled = memoryConfig.injectionDedupeEnabled;
      const dedupeRecallFallbackOnly = memoryConfig.injectionDedupeFallbackRecallOnly;
      const isRecallIntent = isMemoryRecallIntentQuery(query);
      const state = this.memoryInjectionStateBySessionId.get(opencodeSessionId) ?? {
        fingerprint: "",
        forceReinject: false,
        generation: 0,
        turn: 0,
        injectedKeysByGeneration: [],
      };
      const alreadyInjected = new Set(state.injectedKeysByGeneration);
      let suppressedAsAlreadyInContext = 0;
      let candidateResults = [...relevantResults];
      let recallFallbackApplied = false;
      if (dedupeEnabled) {
        candidateResults = relevantResults.filter(result => !alreadyInjected.has(memoryInjectionResultKey(result)));
        suppressedAsAlreadyInContext = relevantResults.length - candidateResults.length;
      }
      if (!candidateResults.length && dedupeEnabled) {
        const allowFallback = dedupeRecallFallbackOnly ? isRecallIntent : true;
        if (allowFallback && relevantResults.length > 0) {
          candidateResults = [relevantResults[0] as MemorySearchResult];
          suppressedAsAlreadyInContext = Math.max(0, relevantResults.length - 1);
          recallFallbackApplied = true;
        }
      }

      const makeWrappedText = (results: MemorySearchResult[]) => {
        const contextLines = results.map(
          (result, index) =>
            `${index + 1}. (${result.score.toFixed(3)}) ${result.citation}\n${result.snippet}`,
        );
        const contextBlock = contextLines.join("\n\n");
        return [
          "Use the memory context below only if relevant and non-contradictory to current user intent.",
          "",
          "[Memory Context]",
          contextBlock,
          "[/Memory Context]",
          "",
          "[User Message]",
          userContent,
          "[/User Message]",
        ].join("\n");
      };
      const freshSessionWrappedText = makeWrappedText(relevantResults);
      if (!candidateResults.length) {
        this.setMemoryInjectionState(opencodeSessionId, {
          ...state,
          forceReinject: false,
          turn: state.turn + 1,
        });
        return {
          content: userContent,
          freshSessionContent: freshSessionWrappedText,
          injectedContextResults: 0,
          retrievedContextResults: searchResults.length,
          suppressedAsAlreadyInContext,
          suppressedAsIrrelevant: analyzed.filteredIrrelevantCount,
          memoryContextFingerprint: null,
        };
      }

      const wrappedText = makeWrappedText(candidateResults);
      const fingerprint = buildMemoryContextFingerprint(candidateResults);
      const existing = state;
      const shouldInject = recallFallbackApplied || !existing || existing.forceReinject || existing.fingerprint !== fingerprint;
      if (shouldInject) {
        const maxTracked = Math.max(32, memoryConfig.injectionDedupeMaxTracked);
        const injectedKeys = [...existing.injectedKeysByGeneration, ...candidateResults.map(memoryInjectionResultKey)];
        const dedupedKeys = [...new Set(injectedKeys)];
        this.setMemoryInjectionState(opencodeSessionId, {
          fingerprint,
          forceReinject: false,
          generation: existing.generation,
          turn: existing.turn + 1,
          injectedKeysByGeneration: dedupedKeys.slice(-maxTracked),
        });
      } else {
        this.setMemoryInjectionState(opencodeSessionId, {
          ...existing,
          forceReinject: false,
          turn: existing.turn + 1,
        });
      }
      return {
        content: shouldInject ? wrappedText : userContent,
        freshSessionContent: freshSessionWrappedText,
        injectedContextResults: shouldInject ? candidateResults.length : 0,
        retrievedContextResults: searchResults.length,
        suppressedAsAlreadyInContext,
        suppressedAsIrrelevant: analyzed.filteredIrrelevantCount,
        memoryContextFingerprint: fingerprint,
      };
    } catch {
      return {
        content: userContent,
        freshSessionContent: userContent,
        injectedContextResults: 0,
        retrievedContextResults: 0,
        suppressedAsAlreadyInContext: 0,
        suppressedAsIrrelevant: 0,
        memoryContextFingerprint: null,
      };
    }
  }

  private setMemoryInjectionState(sessionId: string, state: MemoryInjectionState) {
    const normalized = sessionId.trim();
    if (!normalized) return;
    this.memoryInjectionStateBySessionId.set(normalized, state);
  }

  private clearMemoryInjectionState(sessionId: string) {
    const normalized = sessionId.trim();
    if (!normalized) return;
    this.memoryInjectionStateBySessionId.delete(normalized);
  }

  private markMemoryInjectionStateForReinject(sessionId: string) {
    const normalized = sessionId.trim();
    if (!normalized) return;
    const existing = this.memoryInjectionStateBySessionId.get(normalized);
    if (existing) {
      this.memoryInjectionStateBySessionId.set(normalized, {
        ...existing,
        forceReinject: true,
        generation: existing.generation + 1,
        injectedKeysByGeneration: [],
      });
      return;
    }
    this.memoryInjectionStateBySessionId.set(normalized, {
      fingerprint: "",
      forceReinject: true,
      generation: 1,
      turn: 0,
      injectedKeysByGeneration: [],
    });
  }

  private async searchMemory(query: string, options?: { maxResults?: number; minScore?: number }) {
    if (this.options.searchMemoryFn) {
      return this.options.searchMemoryFn(query, options);
    }
    return searchMemory(query, options);
  }

  private normalizePromptInputParts(content: string, parts?: RuntimeInputPart[]): RuntimeInputPart[] {
    const normalized: RuntimeInputPart[] = [];
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part.type === "text") {
          if (!part.text?.trim()) continue;
          normalized.push({
            type: "text",
            text: part.text,
          });
          continue;
        }
        if (part.type === "file") {
          const mime = part.mime?.trim();
          const url = part.url?.trim();
          if (!mime || !url) continue;
          normalized.push({
            type: "file",
            mime,
            filename: part.filename?.trim() || undefined,
            url,
          });
        }
      }
    }
    if (normalized.length > 0) return normalized;
    if (!content.trim()) return [];
    return [{ type: "text", text: content }];
  }

  private extractPrimaryTextInput(parts: RuntimeInputPart[]) {
    const firstText = parts.find(part => part.type === "text");
    return firstText?.text ?? "";
  }

  private applyMemoryPromptToParts(parts: RuntimeInputPart[], memoryWrappedText: string): RuntimeInputPart[] {
    if (!memoryWrappedText.trim()) return parts;
    const next = [...parts];
    const index = next.findIndex(part => part.type === "text");
    if (index === -1) {
      next.unshift({
        type: "text",
        text: memoryWrappedText,
      });
      return next;
    }
    const existing = next[index];
    if (!existing || existing.type !== "text") return next;
    next[index] = {
      ...existing,
      text: memoryWrappedText,
    };
    return next;
  }

  private summarizeUserInputForStorage(content: string, parts: RuntimeInputPart[]) {
    const text = content.trim();
    const attachments = parts.filter(part => part.type === "file");
    if (attachments.length === 0) return text;
    const imageCount = attachments.filter(part => part.mime.toLowerCase().startsWith("image/")).length;
    const fileCount = attachments.length - imageCount;
    const summaryBits: string[] = [];
    if (imageCount > 0) summaryBits.push(`${imageCount} image${imageCount === 1 ? "" : "s"}`);
    if (fileCount > 0) summaryBits.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
    const attachmentSummary = `[Attachments: ${summaryBits.join(", ")}]`;
    return text ? `${text}\n\n${attachmentSummary}` : attachmentSummary;
  }

  private async modelSupportsImageInput(model: ResolvedModel) {
    const now = Date.now();
    if (now - this.imageCapabilityFetchedAtMs > 60_000) {
      this.imageCapabilityByModelRef.clear();
    }
    if (this.imageCapabilityByModelRef.size > 0 && this.imageCapabilityByModelRef.has(this.formatModelRef(model))) {
      return this.imageCapabilityByModelRef.get(this.formatModelRef(model)) === true;
    }

    try {
      const payload = unwrapSdkData<Record<string, unknown>>(
        await this.getClient().config.providers({
          responseStyle: "data",
          throwOnError: true,
          signal: this.defaultRequestSignal(),
        }),
      );
      const map = new Map<string, boolean>();
      const providers = Array.isArray(payload.providers) ? payload.providers : [];
      for (const provider of providers) {
        if (!provider || typeof provider !== "object" || Array.isArray(provider)) continue;
        const providerRecord = provider as Record<string, unknown>;
        const providerId = typeof providerRecord.id === "string" ? providerRecord.id.trim() : "";
        if (!providerId) continue;
        const models =
          providerRecord.models && typeof providerRecord.models === "object" && !Array.isArray(providerRecord.models)
            ? (providerRecord.models as Record<string, Record<string, unknown>>)
            : {};
        for (const [modelKey, modelInfo] of Object.entries(models)) {
          const modelIdRaw = typeof modelInfo.id === "string" ? modelInfo.id : modelKey;
          const modelId = modelIdRaw.trim();
          if (!modelId) continue;
          const capabilities =
            modelInfo.capabilities && typeof modelInfo.capabilities === "object" && !Array.isArray(modelInfo.capabilities)
              ? (modelInfo.capabilities as Record<string, unknown>)
              : {};
          const input =
            capabilities.input && typeof capabilities.input === "object" && !Array.isArray(capabilities.input)
              ? (capabilities.input as Record<string, unknown>)
              : {};
          const supportsImage = input.image === true;
          map.set(`${providerId}/${modelId}`, supportsImage);
        }
      }
      this.imageCapabilityByModelRef = map;
      this.imageCapabilityFetchedAtMs = now;
    } catch {
      return false;
    }

    return this.imageCapabilityByModelRef.get(this.formatModelRef(model)) === true;
  }

  private currentImageModel() {
    const runtimeConfig = this.currentRuntimeConfig();
    const explicit = runtimeConfig?.imageModel?.trim();
    if (explicit) return explicit;
    return runtimeConfig?.fallbackModels.find(model => model.trim())?.trim() || this.currentSmallModel();
  }

  private buildWafflebotSystemPrompt(input?: { agentId?: string }): string | undefined {
    const memoryConfig = currentMemoryConfig();
    const config = getConfigSnapshot().config;
    const workspaceContext = buildWorkspaceBootstrapPromptContext({
      config,
      agentId: input?.agentId,
    });
    const lines: string[] = [];

    lines.push(
      "Config policy:",
      "- Use config_manager for runtime configuration changes.",
      "- Use agent_type_manager for dedicated agent type CRUD operations.",
      "- Prefer patch_config with expectedHash from get_config to avoid conflicts.",
      "- Safe config writes enforce policy checks and may reject protected paths.",
      "- Keep runSmokeTest enabled unless explicitly instructed otherwise.",
    );

    if (memoryConfig.enabled && memoryConfig.toolMode !== "inject_only") {
      lines.push("");
      lines.push(
        "Memory policy:",
        "- Use memory_search when a request likely depends on prior durable context.",
        "- Prefer one search call first; then use memory_get only for the top 1-2 cited records before relying on details.",
        "- For people/relationships, use concrete terms (for example: daughter, spouse, partner, child, parent, names) instead of only generic words.",
        "- For broad domains (for example: portfolio), run one adjacent-term refinement (for example: metals, silver, bonds, allocation) if the first search misses.",
        "- Skip memory tool calls for clearly self-contained tasks.",
        "- If the first memory_search misses, do one refined query with entity/relationship terms before concluding no memory exists.",
        "- Use memory_remember when new context could be useful later.",
        "- Prefer supersedes when replacing older memory records.",
      );
    }

    if (env.WAFFLEBOT_CRON_ENABLED) {
      lines.push("");
      lines.push(
        "Cron policy:",
        "- Use cron_manager for recurring automation and background checks.",
        "- Prefer deterministic jobs when possible; only invoke the model when useful.",
        "- Review existing jobs before creating new ones to avoid duplicates.",
      );
    }

    if (workspaceContext.section) {
      lines.push("", workspaceContext.section);
    }

    if (workspaceContext.agentPrompt) {
      lines.push(
        "",
        `## Active Agent Prompt (${workspaceContext.agentPromptSource ?? input?.agentId ?? "selected"})`,
        workspaceContext.agentPrompt,
      );
    }

    return lines.length ? lines.join("\n") : undefined;
  }

  private emit(event: RuntimeEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private startEventSync() {
    if (this.eventSyncStarted) return;
    this.eventSyncStarted = true;
    void this.runEventSyncLoop();
  }

  private startBackgroundSync() {
    if (this.backgroundSyncStarted) return;
    this.backgroundSyncStarted = true;
    void this.runBackgroundSyncLoop();
  }

  private async runBackgroundSyncLoop() {
    while (true) {
      await this.syncBackgroundRuns();
      await new Promise((resolve) => setTimeout(resolve, BACKGROUND_SYNC_INTERVAL_MS));
    }
  }

  private async syncBackgroundRuns() {
    if (this.backgroundSyncInFlight) {
      await this.backgroundSyncInFlight;
      return;
    }

    const task = (async () => {
      try {
        await this.reconcileBackgroundChildrenFromParents();
        await this.refreshInFlightBackgroundRuns();
        await this.processPendingBackgroundAnnouncements();
      } catch {
        // Non-blocking: background sync should not impact foreground interactions.
      }
    })();

    this.backgroundSyncInFlight = task;
    try {
      await task;
    } finally {
      this.backgroundSyncInFlight = null;
    }
  }

  private async reconcileBackgroundChildrenFromParents() {
    const bindings = listRuntimeSessionBindings(OPENCODE_RUNTIME_ID, BACKGROUND_SYNC_BATCH_LIMIT);
    for (const binding of bindings) {
      try {
        const children = unwrapSdkData<Array<Session>>(
          await this.getClient().session.children({
            path: { id: binding.externalSessionId },
            responseStyle: "data",
            throwOnError: true,
            signal: this.defaultRequestSignal(),
          }),
        );
        for (const child of children) {
          this.ensureBackgroundRunForSessionInfo(child, "created", binding.sessionId);
        }
      } catch {
        // best effort
      }
    }
  }

  private async refreshInFlightBackgroundRuns() {
    const runs = listInFlightBackgroundRuns(OPENCODE_RUNTIME_ID, BACKGROUND_SYNC_BATCH_LIMIT);
    for (const run of runs) {
      await this.getBackgroundStatus(run.id);
    }
  }

  private async processPendingBackgroundAnnouncements() {
    const pending = listBackgroundRunsPendingAnnouncement(OPENCODE_RUNTIME_ID, BACKGROUND_SYNC_BATCH_LIMIT);
    for (const run of pending) {
      await this.announceBackgroundRunIfNeeded(run.id);
    }
  }

  private async runEventSyncLoop() {
    while (true) {
      try {
        const subscription = await this.getClient().event.subscribe({
          responseStyle: "data",
          throwOnError: true,
        });
        for await (const event of subscription.stream) {
          this.handleOpencodeEvent(event);
        }
      } catch {
        // Non-blocking: event stream issues should not disrupt prompt handling.
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  private handleOpencodeEvent(event: unknown) {
    if (!this.isOpencodeEvent(event)) return;

    switch (event.type) {
      case "session.created":
        this.handleSessionCreatedEvent(event);
        return;
      case "session.updated":
        this.handleSessionUpdatedEvent(event);
        return;
      case "message.part.updated":
        this.handleMessagePartUpdatedEvent(event);
        return;
      case "message.part.delta":
        this.handleMessagePartDeltaEvent(event);
        return;
      case "message.updated":
        this.handleMessageUpdatedEvent(event);
        return;
      case "session.status":
        this.handleSessionStatusEvent(event);
        return;
      case "session.idle":
        this.handleSessionIdleEvent(event);
        return;
      case "session.compacted":
        this.handleSessionCompactedEvent(event);
        return;
      case "session.error":
        this.handleSessionErrorEvent(event);
        return;
      default:
        return;
    }
  }

  private handleMessagePartUpdatedEvent(event: OpencodeMessagePartUpdatedEvent) {
    const sessionId = event.properties.part.sessionID.trim();
    if (!sessionId) return;
    this.rememberPartMetadata(event.properties.part);

    const messageRole = this.messageRoleByScopedMessageId.get(
      this.scopedMessageId(sessionId, event.properties.part.messageID),
    );
    const canTreatAsAssistant =
      messageRole === "assistant" ||
      (messageRole !== "user" && event.properties.part.type === "reasoning");

    const localSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, sessionId);
    if (!localSessionId) return;

    const mappedPart = this.mapChatMessagePart(event.properties.part);
    if (mappedPart) {
      const phase = (() => {
        if (event.properties.part.type !== "tool") {
          return "update" as const;
        }
        const status = event.properties.part.state.status;
        if (status === "pending") return "start" as const;
        if (status === "running") return "update" as const;
        return "final" as const;
      })();

      this.emit(
        createSessionMessagePartUpdatedEvent(
          {
            sessionId: localSessionId,
            messageId: event.properties.part.messageID,
            part: mappedPart,
            phase,
            observedAt: new Date().toISOString(),
          },
          "runtime",
        ),
      );
    }

    const maybeDelta = (event.properties as { delta?: unknown }).delta;
    const deltaFromPartUpdate = typeof maybeDelta === "string" ? maybeDelta : "";
    if (!canTreatAsAssistant) return;
    if (event.properties.part.type !== "text" && event.properties.part.type !== "reasoning") return;

    if (deltaFromPartUpdate.length > 0) {
      this.emit(
        createSessionMessageDeltaEvent(
          {
            sessionId: localSessionId,
            messageId: event.properties.part.messageID,
            text: deltaFromPartUpdate,
            mode: "append",
            observedAt: new Date().toISOString(),
          },
          "runtime",
        ),
      );
      return;
    }

    if (event.properties.part.text.length > 0) {
      this.emit(
        createSessionMessageDeltaEvent(
          {
            sessionId: localSessionId,
            messageId: event.properties.part.messageID,
            text: event.properties.part.text,
            mode: "replace",
            observedAt: new Date().toISOString(),
          },
          "runtime",
        ),
      );
    }
  }

  private handleMessagePartDeltaEvent(event: OpencodeMessagePartDeltaEvent) {
    const sessionId = event.properties.sessionID.trim();
    if (!sessionId) return;

    const field = event.properties.field.trim();
    if (field !== "text") return;
    const delta = event.properties.delta;
    if (typeof delta !== "string" || delta.length === 0) return;

    const messageId = event.properties.messageID.trim();
    const partId = event.properties.partID.trim();
    if (!messageId || !partId) return;

    const localSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, sessionId);
    if (!localSessionId) return;

    const partType = this.partTypeByScopedPartId.get(this.scopedPartId(sessionId, messageId, partId));
    if (partType && partType !== "text" && partType !== "reasoning") return;

    const messageRole = this.messageRoleByScopedMessageId.get(this.scopedMessageId(sessionId, messageId));
    const canTreatAsAssistant =
      messageRole === "assistant" || (messageRole !== "user" && partType === "reasoning");
    if (!canTreatAsAssistant) return;

    this.emit(
      createSessionMessageDeltaEvent(
        {
          sessionId: localSessionId,
          messageId,
          text: delta,
          mode: "append",
          observedAt: new Date().toISOString(),
        },
        "runtime",
      ),
    );
  }

  private handleMessageUpdatedEvent(event: OpencodeMessageUpdatedEvent) {
    this.rememberMessageRole(
      event.properties.info.sessionID,
      event.properties.info.id,
      event.properties.info.role,
    );
    if (event.properties.info.role !== "assistant") return;
    const opencodeSessionId = event.properties.info.sessionID.trim();
    if (!opencodeSessionId) return;
    const localSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, opencodeSessionId);
    if (!localSessionId) return;
    if (this.busySessions.has(localSessionId)) return;

    void this.syncMessageById({
      localSessionId,
      externalSessionId: opencodeSessionId,
      messageId: event.properties.info.id,
    });
  }

  private handleSessionCreatedEvent(event: Extract<OpencodeEvent, { type: "session.created" }>) {
    this.ensureBackgroundRunForSessionInfo(event.properties.info, "created");
  }

  private handleSessionUpdatedEvent(event: Extract<OpencodeEvent, { type: "session.updated" }>) {
    this.ensureBackgroundRunForSessionInfo(event.properties.info, "created");

    const opencodeSessionId = event.properties.info.id.trim();
    const remoteTitle = event.properties.info.title.trim();
    if (!opencodeSessionId || !remoteTitle) return;

    const localSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, opencodeSessionId);
    if (!localSessionId || localSessionId === "main") return;

    const localSession = getSessionById(localSessionId);
    if (!localSession || localSession.title === remoteTitle) return;

    const updated = setSessionTitle(localSessionId, remoteTitle);
    if (!updated) return;
    this.emit(createSessionStateUpdatedEvent(updated, "runtime"));
  }

  private handleSessionStatusEvent(event: Extract<OpencodeEvent, { type: "session.status" }>) {
    const opencodeSessionId = event.properties.sessionID;
    const status = event.properties.status;

    this.applyBackgroundStatusBySessionId(opencodeSessionId, status);

    const localSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, opencodeSessionId);
    if (!localSessionId) return;

    this.emit(
      createSessionRunStatusUpdatedEvent(
        {
          sessionId: localSessionId,
          status: status.type,
          attempt: status.type === "retry" ? status.attempt : undefined,
          message: status.type === "retry" ? this.normalizeProviderMessage(status.message) : undefined,
          nextAt:
            status.type === "retry" && Number.isFinite(status.next)
              ? new Date(status.next).toISOString()
              : undefined,
        },
        "runtime",
      ),
    );
  }

  private handleSessionIdleEvent(event: Extract<OpencodeEvent, { type: "session.idle" }>) {
    const opencodeSessionId = event.properties.sessionID;

    this.applyBackgroundStatusBySessionId(opencodeSessionId, { type: "idle" });

    const localSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, opencodeSessionId);
    if (!localSessionId) return;

    this.emit(
      createSessionRunStatusUpdatedEvent(
        {
          sessionId: localSessionId,
          status: "idle",
        },
        "runtime",
      ),
    );

    void this.syncLocalSessionFromOpencode({
      localSessionId,
      externalSessionId: opencodeSessionId,
      force: true,
    });
    void this.maybeDrainSessionQueue(localSessionId);
  }

  private handleSessionCompactedEvent(event: Extract<OpencodeEvent, { type: "session.compacted" }>) {
    const opencodeSessionId = event.properties.sessionID;
    this.markMemoryInjectionStateForReinject(opencodeSessionId);
    const localSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, opencodeSessionId);
    if (!localSessionId) return;

    this.emit(
      createSessionCompactedEvent(
        {
          sessionId: localSessionId,
        },
        "runtime",
      ),
    );
  }

  private handleSessionErrorEvent(event: Extract<OpencodeEvent, { type: "session.error" }>) {
    const error = event.properties.error;
    if (!error) return;

    const normalized = this.normalizeRuntimeError(error);
    if (event.properties.sessionID) {
      this.markBackgroundRunFailed(event.properties.sessionID, normalized.message);
    }
    const localSessionId = event.properties.sessionID
      ? getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, event.properties.sessionID)
      : null;

    if (localSessionId && this.isTimeoutLikeError(error) && this.inFlightBackgroundChildRunCount(localSessionId) > 0) {
      this.emit(
        createSessionRunStatusUpdatedEvent(
          {
            sessionId: localSessionId,
            status: "busy",
          },
          "runtime",
        ),
      );
      return;
    }

    this.emit(
      createSessionRunErrorEvent(
        {
          sessionId: localSessionId,
          name: normalized.name,
          message: normalized.message,
        },
        "runtime",
      ),
    );
  }

  private isOpencodeEvent(event: unknown): event is OpencodeRuntimeEvent {
    if (!event || typeof event !== "object") return false;
    const maybeEvent = event as { type?: unknown };
    return typeof maybeEvent.type === "string";
  }

  private scopedMessageId(sessionId: string, messageId: string): string {
    return `${sessionId}:${messageId}`;
  }

  private scopedPartId(sessionId: string, messageId: string, partId: string): string {
    return `${sessionId}:${messageId}:${partId}`;
  }

  private isAssistantOnlyPartType(partType: Part["type"]): boolean {
    return (
      partType === "reasoning" ||
      partType === "tool" ||
      partType === "step-start" ||
      partType === "step-finish" ||
      partType === "snapshot" ||
      partType === "patch" ||
      partType === "agent" ||
      partType === "retry" ||
      partType === "compaction"
    );
  }

  private setBoundedMapEntry<Key, Value>(map: Map<Key, Value>, key: Key, value: Value) {
    if (map.has(key)) {
      map.delete(key);
    }
    map.set(key, value);
    if (map.size <= STREAMED_METADATA_CACHE_LIMIT) return;
    const oldest = map.keys().next().value as Key | undefined;
    if (oldest !== undefined) {
      map.delete(oldest);
    }
  }

  private rememberMessageRole(sessionId: string, messageId: string, role: Message["role"]) {
    const normalizedSessionId = sessionId.trim();
    const normalizedMessageId = messageId.trim();
    if (!normalizedSessionId || !normalizedMessageId) return;
    this.setBoundedMapEntry(
      this.messageRoleByScopedMessageId,
      this.scopedMessageId(normalizedSessionId, normalizedMessageId),
      role,
    );
  }

  private rememberPartMetadata(part: Part) {
    const maybePart = part as {
      sessionID?: unknown;
      messageID?: unknown;
      id?: unknown;
      type?: unknown;
    };
    const sessionId = typeof maybePart.sessionID === "string" ? maybePart.sessionID.trim() : "";
    const messageId = typeof maybePart.messageID === "string" ? maybePart.messageID.trim() : "";
    const partId = typeof maybePart.id === "string" ? maybePart.id.trim() : "";
    const partType = typeof maybePart.type === "string" ? (maybePart.type as Part["type"]) : null;
    if (!sessionId || !messageId || !partId || !partType) return;

    this.setBoundedMapEntry(this.partTypeByScopedPartId, this.scopedPartId(sessionId, messageId, partId), partType);
    if (this.isAssistantOnlyPartType(partType)) {
      this.rememberMessageRole(sessionId, messageId, "assistant");
    }
  }

  private backgroundRecordToHandle(run: BackgroundRunRecord): BackgroundRunHandle {
    const childSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, run.childExternalSessionId);
    return {
      runId: run.id,
      parentSessionId: run.parentSessionId,
      parentExternalSessionId: run.parentExternalSessionId,
      childExternalSessionId: run.childExternalSessionId,
      childSessionId,
      requestedBy: run.requestedBy,
      prompt: run.prompt,
      status: run.status,
      resultSummary: run.resultSummary,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      error: run.error,
    };
  }

  private backgroundRecordFingerprint(run: BackgroundRunRecord) {
    const childSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, run.childExternalSessionId) ?? "";
    return [
      run.status,
      run.error ?? "",
      run.resultSummary ?? "",
      run.prompt,
      childSessionId,
      run.startedAt ?? "",
      run.completedAt ?? "",
      run.updatedAt,
    ].join("|");
  }

  private emitBackgroundRunUpdated(run: BackgroundRunRecord, force = false) {
    const nextFingerprint = this.backgroundRecordFingerprint(run);
    const previous = this.backgroundLastEmitByRunId.get(run.id);
    if (!force && previous === nextFingerprint) return;
    this.backgroundLastEmitByRunId.set(run.id, nextFingerprint);

    this.emit(
      createBackgroundRunUpdatedEvent(
        {
          runId: run.id,
          parentSessionId: run.parentSessionId,
          parentExternalSessionId: run.parentExternalSessionId,
          childExternalSessionId: run.childExternalSessionId,
          childSessionId: getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, run.childExternalSessionId),
          requestedBy: run.requestedBy,
          prompt: run.prompt,
          status: run.status,
          resultSummary: run.resultSummary,
          error: run.error,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
        },
        "runtime",
      ),
    );
  }

  private ensureLocalSessionForBackgroundRun(run: BackgroundRunRecord, sessionInfo?: Session): string | null {
    const existingSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, run.childExternalSessionId);
    const existingSession = existingSessionId ? getSessionById(existingSessionId) : null;
    const parentSession = getSessionById(run.parentSessionId);
    const remoteTitle = sessionInfo?.title?.trim();

    const ensured = ensureSessionForRuntimeBinding({
      runtime: OPENCODE_RUNTIME_ID,
      externalSessionId: run.childExternalSessionId,
      title:
        remoteTitle ||
        existingSession?.title ||
        `${parentSession?.title?.trim() || "Session"} background`,
      model: parentSession?.model,
    });
    if (!ensured) return null;

    if (!existingSession || existingSession.title !== ensured.title || existingSession.model !== ensured.model) {
      this.emit(createSessionStateUpdatedEvent(ensured, "runtime"));
    }

    return ensured.id;
  }

  private mapOpencodeMessageContent(info: Message, parts: Array<Part>): string {
    const text = this.extractText(parts);
    if (text && text.trim()) {
      return text;
    }
    if (info.role === "assistant") {
      const reasoningText = this.extractReasoningText(parts);
      if (reasoningText) {
        return reasoningText;
      }
      const toolOutputText = this.extractCompletedToolOutputText(parts);
      if (toolOutputText) {
        return toolOutputText;
      }
    }
    if (info.role === "user") {
      const subtaskPrompt = this.extractSubtaskPrompt(parts);
      if (subtaskPrompt) {
        return subtaskPrompt;
      }
    }
    if (info.role === "assistant") {
      const failure = this.extractAssistantError(info, parts);
      if (failure) {
        return `[assistant error] ${failure}`;
      }
    }
    return "";
  }

  private async syncLocalSessionFromOpencode(input: {
    localSessionId: string;
    externalSessionId: string;
    force?: boolean;
    titleHint?: string;
    messages?: Array<{ info: Message; parts: Array<Part> }>;
  }): Promise<void> {
    const localSessionId = input.localSessionId.trim();
    const externalSessionId = input.externalSessionId.trim();
    if (!localSessionId || !externalSessionId) return;

    const existingSession = getSessionById(localSessionId);
    if (!existingSession) return;
    if (getRuntimeSessionBinding(OPENCODE_RUNTIME_ID, localSessionId) !== externalSessionId) {
      setRuntimeSessionBinding(OPENCODE_RUNTIME_ID, localSessionId, externalSessionId);
    }

    const now = Date.now();
    if (!input.force) {
      const lastSyncedAt = this.backgroundMessageSyncAtByChildSessionId.get(externalSessionId) ?? 0;
      if (now - lastSyncedAt < BACKGROUND_MESSAGE_SYNC_MIN_INTERVAL_MS) {
        return;
      }
    }
    this.backgroundMessageSyncAtByChildSessionId.set(externalSessionId, now);

    const normalizedTitle = input.titleHint?.trim();
    if (normalizedTitle && normalizedTitle !== existingSession.title) {
      const updatedTitle = setSessionTitle(localSessionId, normalizedTitle);
      if (updatedTitle) {
        this.emit(createSessionStateUpdatedEvent(updatedTitle, "runtime"));
      }
    }

    let messages = input.messages;
    if (!messages) {
      messages = unwrapSdkData<Array<{ info: Message; parts: Array<Part> }>>(
        await this.getClient().session.messages({
          path: { id: externalSessionId },
          query: { limit: 200 },
          responseStyle: "data",
          throwOnError: true,
          signal: this.defaultRequestSignal(),
        }),
      );
    }

    for (const entry of messages) {
      this.rememberMessageRole(externalSessionId, entry.info.id, entry.info.role);
      for (const part of entry.parts) {
        this.rememberPartMetadata(part);
      }
    }

    const imported = messages.flatMap(entry => {
      const content = this.mapOpencodeMessageContent(entry.info, entry.parts).trim();
      if (!content) return [];
      const parts = entry.info.role === "assistant" ? this.buildChatMessageParts(entry.parts) : [];
      return [
        {
          id: entry.info.id,
          role: entry.info.role,
          content,
          createdAt: entry.info.time.created,
          parts: parts.length > 0 ? parts : undefined,
        },
      ];
    });

    const synced = upsertSessionMessages({
      sessionId: localSessionId,
      messages: imported,
      touchedAt: now,
    });
    if (!synced) return;

    const entriesById = new Map(messages.map(entry => [entry.info.id, entry] as const));
    for (const message of synced.inserted) {
      if (message.role !== "assistant") continue;
      const entry = entriesById.get(message.id);
      if (!entry || entry.info.role !== "assistant") continue;

      recordUsageDelta({
        id: `assistant-message:${entry.info.id}`,
        sessionId: localSessionId,
        requestCountDelta: 1,
        inputTokensDelta: normalizeUsageDelta(entry.info.tokens?.input),
        outputTokensDelta: normalizeUsageDelta(entry.info.tokens?.output),
        estimatedCostUsdDelta: normalizeCostDelta(entry.info.cost),
        source: "runtime",
        createdAt: entry.info.time?.completed ?? entry.info.time?.created ?? now,
      });
    }

    if (synced.inserted.length === 0) return;

    for (const message of synced.inserted) {
      this.emit(
        createSessionMessageCreatedEvent(
          {
            sessionId: localSessionId,
            message,
          },
          "runtime",
        ),
      );
    }
    this.emit(createSessionStateUpdatedEvent(synced.session, "runtime"));
    this.emit(createUsageUpdatedEvent(getUsageSnapshot(), "runtime"));
  }

  private async syncMessageById(input: {
    localSessionId: string;
    externalSessionId: string;
    messageId: string;
    titleHint?: string;
  }) {
    try {
      const entry = unwrapSdkData<{ info: Message; parts: Array<Part> }>(
        await this.getClient().session.message({
          path: { id: input.externalSessionId, messageID: input.messageId },
          responseStyle: "data",
          throwOnError: true,
          signal: this.defaultRequestSignal(),
        }),
      );
      await this.syncLocalSessionFromOpencode({
        localSessionId: input.localSessionId,
        externalSessionId: input.externalSessionId,
        force: true,
        titleHint: input.titleHint,
        messages: [entry],
      });
    } catch {
      // best-effort message reconciliation
    }
  }

  private async syncBackgroundSessionMessages(
    run: BackgroundRunRecord,
    force = false,
    messages?: Array<{ info: Message; parts: Array<Part> }>,
  ): Promise<void> {
    const childSessionId = this.ensureLocalSessionForBackgroundRun(run);
    if (!childSessionId) return;

    try {
      await this.syncLocalSessionFromOpencode({
        localSessionId: childSessionId,
        externalSessionId: run.childExternalSessionId,
        force,
        messages,
      });
    } catch {
      // Non-blocking: transcript sync should never block run status updates.
    }
  }

  private ensureBackgroundRunForSessionInfo(
    sessionInfo: Session,
    status: BackgroundRunStatus = "created",
    knownParentSessionId?: string,
  ): BackgroundRunRecord | null {
    const childExternalSessionId = sessionInfo.id.trim();
    const parentExternalSessionId = sessionInfo.parentID?.trim();
    if (!childExternalSessionId || !parentExternalSessionId) return null;

    const parentSessionId =
      knownParentSessionId?.trim() || getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, parentExternalSessionId);
    if (!parentSessionId) return null;

    const run = createBackgroundRun({
      runtime: OPENCODE_RUNTIME_ID,
      parentSessionId,
      parentExternalSessionId,
      childExternalSessionId,
      requestedBy: "runtime-sync",
      status,
    });
    if (run) {
      this.ensureLocalSessionForBackgroundRun(run, sessionInfo);
      this.emitBackgroundRunUpdated(run);
    }
    return run;
  }

  private async hydrateBackgroundRunFromSessionId(
    childExternalSessionId: string,
    status?: OpencodeSessionStatus,
  ): Promise<BackgroundRunRecord | null> {
    const normalizedChildExternalSessionId = childExternalSessionId.trim();
    if (!normalizedChildExternalSessionId) return null;
    if (this.backgroundHydrationInFlight.has(normalizedChildExternalSessionId)) return null;

    this.backgroundHydrationInFlight.add(normalizedChildExternalSessionId);
    try {
      const sessionInfo = unwrapSdkData<Session>(
        await this.getClient().session.get({
          path: { id: normalizedChildExternalSessionId },
          responseStyle: "data",
          throwOnError: true,
          signal: this.defaultRequestSignal(),
        }),
      );
      const run = this.ensureBackgroundRunForSessionInfo(sessionInfo, "created");
      if (run && status) {
        return this.applyOpencodeBackgroundStatus(run, status);
      }
      return run;
    } catch {
      return null;
    } finally {
      this.backgroundHydrationInFlight.delete(normalizedChildExternalSessionId);
    }
  }

  private async announceBackgroundRunIfNeeded(runId: string): Promise<boolean> {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) return false;
    if (this.backgroundAnnouncementInFlight.has(normalizedRunId)) return false;

    const current = getBackgroundRunById(normalizedRunId);
    if (!current || current.status !== "completed") return false;
    if (current.resultSummary && current.resultSummary.trim()) return false;

    this.backgroundAnnouncementInFlight.add(normalizedRunId);
    try {
      const latest = getBackgroundRunById(normalizedRunId);
      if (!latest || latest.status !== "completed") return false;
      if (latest.resultSummary && latest.resultSummary.trim()) return false;

      const messages = unwrapSdkData<Array<{ info: Message; parts: Array<Part> }>>(
        await this.getClient().session.messages({
          path: { id: latest.childExternalSessionId },
          query: { limit: 50 },
          responseStyle: "data",
          throwOnError: true,
          signal: this.defaultRequestSignal(),
        }),
      );
      await this.syncBackgroundSessionMessages(latest, true, messages);
      const latestAssistant = [...messages]
        .reverse()
        .find((entry) => entry.info.role === "assistant");
      const assistantText = latestAssistant
        ? this.mapOpencodeMessageContent(latestAssistant.info, latestAssistant.parts).trim()
        : "";
      const resultSummary = this.summarizeBackgroundResult(assistantText);
      const childSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, latest.childExternalSessionId);
      const summaryLine =
        resultSummary && resultSummary !== "Background run completed."
          ? resultSummary
          : "run completed.";
      const announcementText =
        `[Background ${latest.id}] ${summaryLine}\n` +
        `Child session: ${childSessionId ?? latest.childExternalSessionId}`;

      const appended = appendAssistantMessage({
        sessionId: latest.parentSessionId,
        content: announcementText,
        source: "runtime",
      });
      if (!appended) {
        const failed =
          setBackgroundRunStatus({
          runId: latest.id,
          status: "failed",
          completedAt: Date.now(),
          error: `Unable to append announcement to parent session ${latest.parentSessionId}.`,
          }) ?? latest;
        this.emitBackgroundRunUpdated(failed);
        return false;
      }

      const updated = setBackgroundRunStatus({
        runId: latest.id,
        status: "completed",
        resultSummary,
        error: null,
      });
      if (updated) {
        this.emitBackgroundRunUpdated(updated);
      }

      this.emit(
        createSessionMessageCreatedEvent(
          {
            sessionId: appended.session.id,
            message: appended.message,
          },
          "runtime",
        ),
      );
      this.emit(createSessionStateUpdatedEvent(appended.session, "runtime"));
      this.emit(createUsageUpdatedEvent(appended.usage, "runtime"));
      this.emit(createHeartbeatUpdatedEvent(appended.heartbeat, "runtime"));

      return Boolean(updated);
    } catch (error) {
      const failed = setBackgroundRunStatus({
        runId: normalizedRunId,
        status: "failed",
        completedAt: Date.now(),
        error: this.normalizeRuntimeError(error).message,
      });
      if (failed) {
        this.emitBackgroundRunUpdated(failed);
      }
      return false;
    } finally {
      this.backgroundAnnouncementInFlight.delete(normalizedRunId);
    }
  }

  private applyBackgroundStatusBySessionId(opencodeSessionId: string, status: OpencodeSessionStatus) {
    const run = getBackgroundRunByChildExternalSessionId(OPENCODE_RUNTIME_ID, opencodeSessionId);
    if (run) {
      this.applyOpencodeBackgroundStatus(run, status);
      return;
    }
    void this.hydrateBackgroundRunFromSessionId(opencodeSessionId, status);
  }

  private applyOpencodeBackgroundStatus(
    run: BackgroundRunRecord,
    status: OpencodeSessionStatus,
  ): BackgroundRunRecord {
    if (run.status === "aborted" || run.status === "failed") {
      return run;
    }

    const now = Date.now();
    const hasStarted = Boolean(run.startedAt);
    let nextStatus: BackgroundRunStatus | null = null;
    let startedAt: number | undefined;
    let completedAt: number | null | undefined;
    let error: string | null | undefined;

    if (status.type === "busy") {
      nextStatus = "running";
      startedAt = hasStarted ? undefined : now;
      completedAt = null;
      error = null;
    } else if (status.type === "retry") {
      nextStatus = "retrying";
      startedAt = hasStarted ? undefined : now;
      completedAt = null;
      error = this.normalizeProviderMessage(status.message) || status.message;
    } else if (status.type === "idle") {
      if (!hasStarted && run.status === "created") {
        nextStatus = "idle";
      } else if (run.status !== "completed") {
        nextStatus = "completed";
        completedAt = now;
        error = null;
      }
    }

    if (!nextStatus || (nextStatus === run.status && typeof completedAt === "undefined" && typeof error === "undefined")) {
      return run;
    }

    const updated =
      setBackgroundRunStatus({
        runId: run.id,
        status: nextStatus,
        startedAt,
        completedAt,
        error,
      }) ?? run;

    this.emitBackgroundRunUpdated(updated);

    if (updated.status === "completed") {
      void this.announceBackgroundRunIfNeeded(updated.id);
    }
    void this.maybeDrainSessionQueue(updated.parentSessionId);

    return updated;
  }

  private inFlightBackgroundChildRunCount(parentSessionId: string): number {
    const runs = listBackgroundRunsForParentSession(parentSessionId, 200);
    return runs.filter(run => run.status === "created" || run.status === "running" || run.status === "retrying" || run.status === "idle").length;
  }

  private async maybeDrainSessionQueue(sessionId: string) {
    if (this.busySessions.has(sessionId)) return;
    if (this.drainingSessions.has(sessionId)) return;
    if (this.inFlightBackgroundChildRunCount(sessionId) > 0) return;

    try {
      const queue = getLaneQueue();
      if (queue.depth(sessionId) === 0) return;
      this.drainingSessions.add(sessionId);
      while (queue.depth(sessionId) > 0) {
        await queue.drainAndExecute(sessionId);
      }
    } catch {
      // Queue drain is best-effort.
    } finally {
      this.drainingSessions.delete(sessionId);
    }
  }

  private markBackgroundRunFailed(opencodeSessionId: string, message: string) {
    const run = getBackgroundRunByChildExternalSessionId(OPENCODE_RUNTIME_ID, opencodeSessionId);
    if (!run) {
      void this.hydrateBackgroundRunFromSessionId(opencodeSessionId);
      return;
    }
    if (run.status === "aborted" || run.status === "completed") {
      return;
    }
    const updated = setBackgroundRunStatus({
      runId: run.id,
      status: "failed",
      completedAt: Date.now(),
      error: message,
    });
    if (updated) {
      this.emitBackgroundRunUpdated(updated);
    }
  }

  private resolveModel(rawModel: string): ResolvedModel {
    const trimmed = rawModel.trim();
    if (trimmed.includes("/")) {
      const [providerId, ...rest] = trimmed.split("/");
      const modelId = rest.join("/").trim();
      if (providerId && modelId) {
        return { providerId, modelId };
      }
    }

    return {
      providerId: this.currentProviderId(),
      modelId: trimmed || this.currentModelId(),
    };
  }

  private extractText(parts: Array<Part>): string | null {
    const text = parts
      .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n");
    return text || null;
  }

  private extractReasoningText(parts: Array<Part>): string | null {
    const text = parts
      .filter((part): part is Extract<Part, { type: "reasoning" }> => part.type === "reasoning")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n");
    return text || null;
  }

  private extractCompletedToolOutputText(parts: Array<Part>): string | null {
    const outputs: string[] = [];
    for (const part of parts) {
      if (part.type !== "tool") continue;
      if (part.state.status !== "completed") continue;
      const output = part.state.output.trim();
      if (output) outputs.push(output);
    }
    return outputs.length > 0 ? outputs.join("\n\n") : null;
  }

  private extractSubtaskPrompt(parts: Array<Part>): string | null {
    const subtask = parts.find((part): part is Extract<Part, { type: "subtask" }> => part.type === "subtask");
    const prompt = subtask?.prompt.trim();
    return prompt || null;
  }

  private summarizeBackgroundResult(text: string | null): string {
    const normalized = (text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) return "Background run completed.";
    if (normalized.length <= 800) return normalized;
    return `${normalized.slice(0, 800)}...`;
  }

  private mapChatMessagePart(part: Part): ChatMessagePart | null {
    const toIsoIfFiniteMillis = (value: unknown): string | undefined => {
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
      return new Date(value).toISOString();
    };

    if (part.type === "reasoning") {
      const text = part.text.trim();
      if (!text) return null;
      return {
        id: part.id,
        type: "thinking",
        text,
        startedAt: toIsoIfFiniteMillis(part.time.start),
        endedAt: toIsoIfFiniteMillis(part.time.end),
      };
    }

    if (part.type !== "tool") return null;

    const stateTime = "time" in part.state && part.state.time && typeof part.state.time === "object" ? part.state.time : null;
    const startedAt =
      stateTime && "start" in stateTime
        ? toIsoIfFiniteMillis(stateTime.start)
        : undefined;
    const endedAt =
      stateTime && "end" in stateTime
        ? toIsoIfFiniteMillis(stateTime.end)
        : undefined;

    const output = (() => {
      if (part.state.status !== "completed") return undefined;
      const trimmed = part.state.output.trim();
      return trimmed || undefined;
    })();
    const error = (() => {
      if (part.state.status !== "error") return undefined;
      const trimmed = part.state.error.trim();
      return trimmed || undefined;
    })();

    return {
      id: part.id,
      type: "tool_call",
      toolCallId: part.callID,
      tool: part.tool,
      status: part.state.status,
      input: isPlainObject(part.state.input) ? part.state.input : undefined,
      output,
      error,
      startedAt,
      endedAt,
    };
  }

  private buildChatMessageParts(parts: Array<Part>): ChatMessagePart[] {
    const mapped = parts
      .map(part => this.mapChatMessagePart(part))
      .filter((part): part is ChatMessagePart => Boolean(part));
    if (mapped.length === 0) return [];
    const deduped = new Map<string, ChatMessagePart>();
    for (const part of mapped) {
      deduped.set(part.id, part);
    }
    return [...deduped.values()];
  }

  private extractAssistantError(info: AssistantInfo, parts: Array<Part>): string | null {
    const infoError = this.describeUnknownError(info.error);
    if (infoError) {
      return infoError;
    }

    for (const part of parts) {
      if (part.type !== "tool" || part.state.status !== "error") continue;
      const reason = part.state.error?.trim();
      if (reason) {
        return `Tool ${part.tool} failed: ${reason}`;
      }
      return `Tool ${part.tool} failed.`;
    }

    return null;
  }

  private describeUnknownError(error: unknown): string | null {
    if (!error) return null;
    if (typeof error === "string") {
      const trimmed = error.trim();
      return trimmed || null;
    }

    if (error instanceof Error) {
      const message = error.message.trim();
      return message || error.name || "Unknown error";
    }

    if (typeof error !== "object") {
      return String(error);
    }

    const record = error as Record<string, unknown>;
    const directMessage = typeof record.message === "string" ? record.message.trim() : "";
    if (directMessage) return directMessage;

    const dataMessage =
      record.data && typeof record.data === "object" && typeof (record.data as Record<string, unknown>).message === "string"
        ? ((record.data as Record<string, unknown>).message as string).trim()
        : "";
    if (dataMessage) return dataMessage;

    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (name) return name;

    return null;
  }

  private buildMessageMemoryTrace(
    parts: Array<Part>,
    memoryStats: {
      injectedContextResults: number;
      retrievedContextResults: number;
      suppressedAsAlreadyInContext: number;
      suppressedAsIrrelevant: number;
    },
  ): MessageMemoryTrace | null {
    const toolCalls: MemoryToolCallTrace[] = [];
    for (const part of parts) {
      if (part.type !== "tool" || !MODEL_MEMORY_TOOLS.has(part.tool)) continue;
      const call: MemoryToolCallTrace = {
        tool: part.tool,
        status: part.state.status,
      };

      if (part.state.status === "error") {
        call.error = part.state.error;
        call.summary = "tool call failed";
      } else if (part.state.status === "completed") {
        call.summary = this.summarizeMemoryToolOutput(part.tool, part.state.output);
      }
      toolCalls.push(call);
    }

    if (memoryStats.injectedContextResults <= 0 && toolCalls.length === 0) {
      return null;
    }

    return {
      mode: currentMemoryConfig().toolMode,
      injectedContextResults: memoryStats.injectedContextResults,
      retrievedContextResults: memoryStats.retrievedContextResults,
      suppressedAsAlreadyInContext: memoryStats.suppressedAsAlreadyInContext,
      suppressedAsIrrelevant: memoryStats.suppressedAsIrrelevant,
      toolCalls,
      createdAt: new Date().toISOString(),
    };
  }

  private summarizeMemoryToolOutput(tool: string, output: string): string {
    if (tool !== "memory_remember") {
      return "completed";
    }
    try {
      const parsed = JSON.parse(output) as unknown;
      if (!parsed || typeof parsed !== "object") return "completed";
      const container = parsed as Record<string, unknown>;
      const result = (container.result as Record<string, unknown> | undefined) ?? container;
      const accepted = result.accepted;
      const reason = result.reason;
      if (typeof accepted === "boolean" && typeof reason === "string") {
        return accepted ? `accepted: ${reason}` : `rejected: ${reason}`;
      }
      if (typeof accepted === "boolean") {
        return accepted ? "accepted" : "rejected";
      }
    } catch {
      // ignore parse errors and fall back to generic summary
    }
    return "completed";
  }

  private async sendPrompt(
    sessionId: string,
    model: ResolvedModel,
    promptParts: Array<RuntimeInputPart>,
    system?: string,
    agent?: string,
  ): Promise<{ info: AssistantInfo; parts: Array<Part> }> {
    const response = unwrapSdkData<{ info?: Message; parts?: Array<Part> }>(
      await this.getClient().session.prompt({
        path: { id: sessionId },
        body: {
          model: {
            providerID: model.providerId,
            modelID: model.modelId,
          },
          system,
          agent,
          parts: promptParts,
        },
        responseStyle: "data",
        throwOnError: true,
        signal: this.promptRequestSignal(),
      }),
    );
    if (!response || typeof response !== "object") {
      throw new Error("OpenCode returned an empty prompt response.");
    }
    const info = response.info;
    if (!info || typeof info !== "object") {
      const topLevelError =
        this.describeUnknownError((response as Record<string, unknown>).error) ?? this.describeUnknownError(response);
      if (topLevelError) {
        const wrapped = new Error(topLevelError);
        const status = this.extractErrorStatusCode((response as Record<string, unknown>).error ?? response);
        if (typeof status === "number") {
          (wrapped as Error & { status?: number }).status = status;
        }
        throw wrapped;
      }
      throw new Error("OpenCode prompt response is missing message metadata.");
    }

    const infoRecord = info as Record<string, unknown>;
    const infoError = this.describeUnknownError(infoRecord.error);
    if (infoError) {
      const wrapped = new Error(infoError);
      const status = this.extractErrorStatusCode(infoRecord.error);
      if (typeof status === "number") {
        (wrapped as Error & { status?: number }).status = status;
      }
      throw wrapped;
    }
    if (info.role !== "assistant") {
      throw new Error(`OpenCode returned unexpected message role: ${info.role}`);
    }

    const responseParts = Array.isArray(response.parts) ? response.parts : [];
    return { info: info as AssistantInfo, parts: responseParts };
  }

  private async sendPromptWithModelFallback(input: {
    localSessionId: string;
    localSessionTitle: string;
    opencodeSessionId: string;
    primaryModel: ResolvedModel;
    parts: Array<RuntimeInputPart>;
    retryPartsOnSessionRecreate?: Array<RuntimeInputPart>;
    memoryContextFingerprint?: string | null;
    system?: string;
    agent?: string;
  }): Promise<{ message: { info: AssistantInfo; parts: Array<Part> }; opencodeSessionId: string }> {
    const models = this.resolvePromptModels(input.primaryModel);
    let sessionId = input.opencodeSessionId;
    let previousError: unknown = null;

    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      if (!model) continue;
      if (index > 0) {
        this.emitPromptRetryStatus(input.localSessionId, index + 1, previousError, models[index - 1] ?? null, model);
      }

      let attemptError: unknown = null;
      try {
        const message = await this.sendPromptWithAgentFallback({
          localSessionId: input.localSessionId,
          sessionId,
          model,
          parts: input.parts,
          system: input.system,
          agent: input.agent,
        });
        return { message, opencodeSessionId: sessionId };
      } catch (error) {
        if (getOpencodeErrorStatus(error) === 404) {
          const previousSessionState = this.memoryInjectionStateBySessionId.get(sessionId);
          try {
            sessionId = await this.createOpencodeSession(input.localSessionId, input.localSessionTitle);
          } catch (createError) {
            throw this.normalizeRuntimeError(createError);
          }
          try {
            if (input.memoryContextFingerprint) {
              this.setMemoryInjectionState(sessionId, {
                fingerprint: input.memoryContextFingerprint,
                forceReinject: false,
                generation: previousSessionState?.generation ?? 0,
                turn: previousSessionState?.turn ?? 0,
                injectedKeysByGeneration: [...(previousSessionState?.injectedKeysByGeneration ?? [])],
              });
            } else if (previousSessionState) {
              this.setMemoryInjectionState(sessionId, {
                ...previousSessionState,
              });
            }
            const retryParts = input.retryPartsOnSessionRecreate ?? input.parts;
            const message = await this.sendPromptWithAgentFallback({
              localSessionId: input.localSessionId,
              sessionId,
              model,
              parts: retryParts,
              system: input.system,
              agent: input.agent,
            });
            return { message, opencodeSessionId: sessionId };
          } catch (retryError) {
            attemptError = retryError;
          }
        } else {
          attemptError = error;
        }
      }

      previousError = attemptError;
      const hasMoreModels = index < models.length - 1;
      if (!hasMoreModels) {
        throw this.normalizeRuntimeError(attemptError);
      }
      if (!(this.isModelNotFoundError(attemptError) || this.shouldFailoverPromptError(attemptError))) {
        throw this.normalizeRuntimeError(attemptError);
      }
    }

    throw this.normalizeRuntimeError(previousError);
  }

  private async sendPromptWithAgentFallback(input: {
    localSessionId?: string;
    sessionId: string;
    model: ResolvedModel;
    parts: Array<RuntimeInputPart>;
    system?: string;
    agent?: string;
  }): Promise<{ info: AssistantInfo; parts: Array<Part> }> {
    try {
      return await this.sendPrompt(input.sessionId, input.model, input.parts, input.system, input.agent);
    } catch (error) {
      if (!this.isInvalidAgentPromptError(error)) {
        throw error;
      }

      if (input.agent) {
        try {
          return await this.sendPrompt(input.sessionId, input.model, input.parts, input.system, undefined);
        } catch (fallbackError) {
          if (!this.isInvalidAgentPromptError(fallbackError)) {
            throw fallbackError;
          }
          const primaryAgent = await this.resolvePrimaryAgentId(input.localSessionId);
          if (!primaryAgent) {
            throw fallbackError;
          }
          return this.sendPrompt(input.sessionId, input.model, input.parts, input.system, primaryAgent);
        }
      }

      const fallbackAgent = await this.resolvePrimaryAgentId(input.localSessionId);
      if (!fallbackAgent) {
        throw error;
      }
      return this.sendPrompt(input.sessionId, input.model, input.parts, input.system, fallbackAgent);
    }
  }

  private resolvePromptModels(primaryModel: ResolvedModel): Array<ResolvedModel> {
    const models: Array<ResolvedModel> = [];
    const seen = new Set<string>();
    const add = (model: ResolvedModel) => {
      const key = this.formatModelRef(model);
      if (seen.has(key)) return;
      seen.add(key);
      models.push(model);
    };

    add(primaryModel);
    const fallbackRefs = this.currentFallbackModels();
    for (const fallbackRef of fallbackRefs) {
      add(this.resolveModel(fallbackRef));
    }
    if (fallbackRefs.length === 0) {
      add({
        providerId: this.currentProviderId(),
        modelId: this.currentModelId(),
      });
    }

    return models;
  }

  private formatModelRef(model: ResolvedModel): string {
    return `${model.providerId}/${model.modelId}`;
  }

  private emitPromptRetryStatus(
    sessionId: string,
    attempt: number,
    error: unknown,
    previousModel: ResolvedModel | null,
    nextModel: ResolvedModel,
  ) {
    const detail = this.normalizeRuntimeError(error).message;
    const nextRef = this.formatModelRef(nextModel);
    const message = this.isModelNotFoundError(error)
      ? `Model ${previousModel ? this.formatModelRef(previousModel) : "requested"} is not available at the selected provider. Retrying with ${nextRef}.`
      : `${detail} Retrying with ${nextRef}.`;
    this.emit(
      createSessionRunStatusUpdatedEvent(
        {
          sessionId,
          status: "retry",
          attempt,
          message,
        },
        "runtime",
      ),
    );
  }

  private extractErrorStatusCode(error: unknown): number | null {
    if (!error || typeof error !== "object") return null;
    const record = error as Record<string, unknown>;
    if (typeof record.status === "number" && Number.isFinite(record.status)) {
      return record.status;
    }
    if (typeof record.statusCode === "number" && Number.isFinite(record.statusCode)) {
      return record.statusCode;
    }
    const data = record.data;
    if (data && typeof data === "object") {
      const dataRecord = data as Record<string, unknown>;
      if (typeof dataRecord.statusCode === "number" && Number.isFinite(dataRecord.statusCode)) {
        return dataRecord.statusCode;
      }
    }
    return null;
  }

  private isModelNotFoundError(error: unknown) {
    const message = (this.describeUnknownError(error) ?? "").toLowerCase();
    return message.includes("model not found");
  }

  private async resolveOrCreateOpencodeSession(localSessionId: string, localTitle: string) {
    const bound = getRuntimeSessionBinding(OPENCODE_RUNTIME_ID, localSessionId);
    if (bound) return bound;
    return this.createOpencodeSession(localSessionId, localTitle);
  }

  private async createOpencodeSession(localSessionId: string, localTitle: string) {
    const body = localSessionId === "main" ? { title: localTitle } : {};
    const created = unwrapSdkData<Session>(
      await this.getClient().session.create({
        body,
        responseStyle: "data",
        throwOnError: true,
        signal: this.defaultRequestSignal(),
      }),
    );
    setRuntimeSessionBinding(OPENCODE_RUNTIME_ID, localSessionId, created.id);
    return created.id;
  }

  private isPlaceholderSessionTitle(title: string) {
    const normalized = title.trim();
    if (!normalized) return true;
    return (
      /^session \d+$/i.test(normalized) ||
      /^new session(?:\s*-\s*.+)?$/i.test(normalized)
    );
  }

  private startSessionTitlePolling(localSessionId: string, opencodeSessionId: string) {
    if (localSessionId === "main") return;
    const localSession = getSessionById(localSessionId);
    if (!localSession || !this.isPlaceholderSessionTitle(localSession.title)) return;

    void (async () => {
      const retryDelaysMs = [600, 1200, 2200, 3500, 5000, 7000];
      for (const delayMs of retryDelaysMs) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        const currentLocal = getSessionById(localSessionId);
        if (!currentLocal) return;
        if (!this.isPlaceholderSessionTitle(currentLocal.title)) return;

        const synced = await this.syncSessionTitleFromOpencode(
          localSessionId,
          opencodeSessionId,
          currentLocal.title,
          true,
        );
        if (synced) return;
      }
    })();
  }

  private async syncSessionTitleFromOpencode(
    localSessionId: string,
    opencodeSessionId: string,
    localTitle: string,
    emitUpdateEvent = false,
  ) {
    if (localSessionId === "main") return;

    try {
      const opencodeSession = unwrapSdkData<Session>(
        await this.getClient().session.get({
          path: { id: opencodeSessionId },
          responseStyle: "data",
          throwOnError: true,
          signal: this.defaultRequestSignal(),
        }),
      );
      const remoteTitle = opencodeSession.title.trim();
      // Ignore OpenCode placeholder titles (for example "New session - <timestamp>").
      // Keep local placeholder until a prompt-derived title is available.
      if (this.isPlaceholderSessionTitle(remoteTitle)) return false;
      if (!remoteTitle || remoteTitle === localTitle) return false;
      const updated = setSessionTitle(localSessionId, remoteTitle);
      if (emitUpdateEvent && updated) {
        this.emit(createSessionStateUpdatedEvent(updated, "runtime"));
      }
      return true;
    } catch {
      // Non-blocking: title sync should never break prompt handling.
      return false;
    }
  }

  private normalizeRuntimeError(error: unknown): Error {
    const status = getOpencodeErrorStatus(error);
    const fallback = this.describeUnknownError(error) ?? "OpenCode request failed.";
    const categorized = this.categorizeProviderError(status, fallback);
    if (categorized) return categorized;
    if (status !== null) {
      return new Error(`OpenCode API error (${status}): ${fallback}`);
    }
    if (error instanceof Error) return error;
    return new Error(fallback);
  }

  private normalizeProviderMessage(message: unknown): string {
    if (typeof message !== "string" || !message.trim()) return "";
    const normalized = this.categorizeProviderError(null, message);
    return normalized ? normalized.message : message;
  }

  private categorizeProviderError(status: number | null, message: string): Error | null {
    const normalized = message.toLowerCase();
    const includes = (needle: string) => normalized.includes(needle);
    const hasAny = (values: Array<string>) => values.some(includes);

    if (
      hasAny([
        "exceeded_current_quota_error",
        "exceeded your current token quota",
        "freeusagelimiterror",
        "insufficient_quota",
        "quota exceeded",
        "not enough credits",
        "credit balance",
      ])
    ) {
      return new RuntimeProviderQuotaError();
    }

    if (
      status === 401 ||
      status === 403 ||
      hasAny([
        "invalid api key",
        "authentication failed",
        "unauthorized",
        "forbidden",
        "auth error",
        "bad credentials",
      ])
    ) {
      return new RuntimeProviderAuthError();
    }

    if (
      status === 429 ||
      hasAny([
        "too many requests",
        "rate limited",
        "rate limit",
        "rate_limit",
        "provider is overloaded",
      ])
    ) {
      return new RuntimeProviderRateLimitError();
    }

    return null;
  }

  private shouldFailoverPromptError(error: unknown): boolean {
    const status = getOpencodeErrorStatus(error);
    if (status !== null) {
      if ([401, 402, 403, 408, 429, 500, 502, 503, 504].includes(status)) {
        return true;
      }
      if ([400, 404].includes(status)) {
        return false;
      }
    }

    const message = this.describeUnknownError(error) ?? "";
    if (this.categorizeProviderError(status, message)) {
      return true;
    }

    const normalized = message.toLowerCase();
    const hasAny = (values: Array<string>) => values.some((value) => normalized.includes(value));
    if (this.isTimeoutLikeError(error)) {
      return true;
    }
    if (hasAny(["temporarily unavailable", "provider is overloaded", "upstream", "network error", "socket hang up", "connection reset", "econnreset"])) {
      return true;
    }

    return false;
  }

  private isTimeoutLikeError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "AbortError") {
      return true;
    }
    const message = this.describeUnknownError(error)?.toLowerCase() ?? "";
    if (!message) return false;
    return message.includes("timed out") || message.includes("timeout") || message.includes("operation timed out");
  }

  private isInvalidAgentPromptError(error: unknown): boolean {
    const normalized = (this.describeUnknownError(error) ?? "").toLowerCase();
    if (!normalized) return false;
    return (
      normalized.includes("agent.variant") ||
      (normalized.includes("default agent") && normalized.includes("not found")) ||
      (normalized.includes("default agent") && normalized.includes("subagent")) ||
      normalized.includes("is not an object")
    );
  }

  private async resolveRequestedAgentId(agent: string | undefined, sessionId?: string): Promise<string | undefined> {
    const normalized = agent?.trim();
    if (!normalized) return undefined;
    const names = await this.fetchAvailableAgentNames();
    if (!names) return normalized;
    if (names.has(normalized)) return normalized;
    if (sessionId) {
      this.emit(
        createSessionRunStatusUpdatedEvent(
          {
            sessionId,
            status: "retry",
            attempt: 1,
            message: `Requested agent "${normalized}" is unavailable in OpenCode. Falling back to default agent.`,
          },
          "runtime",
        ),
      );
    }
    return undefined;
  }

  private agentModeFromConfig(agentId: string, config: Record<string, unknown>): "subagent" | "primary" | "all" {
    const explicit = typeof config.mode === "string" ? config.mode.trim() : "";
    if (explicit === "subagent" || explicit === "primary" || explicit === "all") {
      return explicit;
    }
    if (BUILTIN_SUBAGENT_IDS.has(agentId)) return "subagent";
    if (BUILTIN_PRIMARY_AGENT_IDS.has(agentId)) return "primary";
    return "all";
  }

  private async resolvePrimaryAgentId(
    sessionId?: string,
    options?: {
      emitRetryStatus?: boolean;
    },
  ): Promise<string | undefined> {
    const catalog = await this.fetchAvailableAgentCatalog();
    const selected = catalog?.primaryId;
    if (!selected) return undefined;

    if ((options?.emitRetryStatus ?? true) && sessionId) {
      this.emit(
        createSessionRunStatusUpdatedEvent(
          {
            sessionId,
            status: "retry",
            attempt: 1,
            message: `OpenCode default agent is unavailable. Retrying with primary agent "${selected}" (by id).`,
          },
          "runtime",
        ),
      );
    }

    return selected;
  }

  private async fetchAvailableAgentNames(): Promise<Set<string> | null> {
    const catalog = await this.fetchAvailableAgentCatalog();
    return catalog?.ids ?? null;
  }

  private async fetchAvailableAgentCatalog(): Promise<RuntimeAgentCatalog | null> {
    const now = Date.now();
    if (this.availableAgentNamesCache && now - this.availableAgentNamesCache.fetchedAtMs <= AGENT_NAME_CACHE_TTL_MS) {
      return this.availableAgentNamesCache.catalog;
    }

    try {
      const config = unwrapSdkData<Config>(
        await this.getClient().config.get({
          responseStyle: "data",
          throwOnError: true,
          signal: this.defaultRequestSignal(),
        }),
      );

      const record = config as Record<string, unknown>;
      const configuredAgentMap = isPlainObject(record.agent) ? (record.agent as Record<string, unknown>) : {};
      const defaultAgentId = typeof record.default_agent === "string" ? record.default_agent.trim() : "";
      const ids = new Set<string>(["build", "plan", "general", "explore", "title", "summary", "compaction"]);
      let primaryId: string | undefined;

      for (const [rawId, rawConfig] of Object.entries(configuredAgentMap)) {
        const id = rawId.trim();
        if (!id) continue;
        ids.add(id);
        if (!isPlainObject(rawConfig)) continue;
        const disabled = rawConfig.disable === true;
        if (disabled) continue;
        const hidden = rawConfig.hidden === true;
        const mode = this.agentModeFromConfig(id, rawConfig);
        if (!primaryId && mode !== "subagent" && !hidden) {
          primaryId = id;
        }
      }

      if (defaultAgentId) {
        const defaultConfig =
          isPlainObject(configuredAgentMap[defaultAgentId]) ? (configuredAgentMap[defaultAgentId] as Record<string, unknown>) : null;
        const disabled = defaultConfig?.disable === true;
        const hidden = defaultConfig?.hidden === true;
        const mode = defaultConfig ? this.agentModeFromConfig(defaultAgentId, defaultConfig) : "primary";
        if (!disabled && !hidden && mode !== "subagent") {
          primaryId = defaultAgentId;
        }
      }

      if (!primaryId) {
        const buildConfig = isPlainObject(configuredAgentMap.build) ? (configuredAgentMap.build as Record<string, unknown>) : null;
        if (buildConfig?.disable !== true) {
          primaryId = "build";
        }
      }

      const catalog: RuntimeAgentCatalog = { ids, primaryId };
      this.availableAgentNamesCache = {
        fetchedAtMs: now,
        catalog,
      };
      return catalog;
    } catch {
      return null;
    }
  }

  private defaultRequestSignal() {
    return AbortSignal.timeout(this.currentTimeoutMs());
  }

  private promptRequestSignal() {
    return AbortSignal.timeout(this.currentPromptTimeoutMs());
  }

  private healthProbeSignal(timeoutMs: number) {
    return AbortSignal.timeout(timeoutMs);
  }

  private healthProbeTimeoutMs() {
    return Math.max(1_000, Math.min(this.currentPromptTimeoutMs(), this.currentTimeoutMs(), RUNTIME_HEALTH_TIMEOUT_CAP_MS));
  }

  private normalizeHealthProbeError(error: unknown, timeoutMs: number): Error {
    if (error instanceof DOMException && error.name === "AbortError") {
      return new Error(`Runtime health probe timed out after ${timeoutMs}ms.`);
    }
    return this.normalizeRuntimeError(error);
  }

  private async runHealthProbe(): Promise<RuntimeHealthSnapshot> {
    const startedAt = Date.now();
    const timeoutMs = this.healthProbeTimeoutMs();
    const model: ResolvedModel = {
      providerId: this.currentProviderId(),
      modelId: this.currentModelId(),
    };
    let probeSessionId: string | null = null;
    let responseText: string | null = null;
    let normalizedError: Error | null = null;

    try {
      const created = unwrapSdkData<Session>(
        await this.getClient().session.create({
          body: { title: "wafflebot-runtime-health" },
          responseStyle: "data",
          throwOnError: true,
          signal: this.healthProbeSignal(timeoutMs),
        }),
      );
      probeSessionId = created.id;

      const response = unwrapSdkData<{ info: Message; parts: Array<Part> }>(
        await this.getClient().session.prompt({
          path: { id: probeSessionId },
          body: {
            model: {
              providerID: model.providerId,
              modelID: model.modelId,
            },
            parts: [{ type: "text", text: RUNTIME_HEALTH_PROMPT }],
          },
          responseStyle: "data",
          throwOnError: true,
          signal: this.healthProbeSignal(timeoutMs),
        }),
      );

      if (response.info.role !== "assistant") {
        throw new Error(`OpenCode returned unexpected message role: ${response.info.role}`);
      }

      responseText = this.extractText(response.parts);
      if (!responseText) {
        throw new Error("Runtime health probe returned no assistant text.");
      }
      if (!RUNTIME_HEALTH_OK_PATTERN.test(responseText)) {
        throw new Error(
          `Runtime health probe response did not match expected pattern: ${RUNTIME_HEALTH_OK_PATTERN.source}`,
        );
      }
    } catch (error) {
      normalizedError = this.normalizeHealthProbeError(error, timeoutMs);
    }

    const checkedAtMs = Date.now();
    const cacheExpiresAtMs = checkedAtMs + RUNTIME_HEALTH_CACHE_TTL_MS;
    return {
      ok: normalizedError === null,
      checkedAt: new Date(checkedAtMs).toISOString(),
      latencyMs: checkedAtMs - startedAt,
      cacheTtlMs: RUNTIME_HEALTH_CACHE_TTL_MS,
      cacheExpiresAt: new Date(cacheExpiresAtMs).toISOString(),
      probeSessionId,
      responseText,
      error: normalizedError
        ? {
            name: normalizedError.name,
            message: normalizedError.message,
          }
        : null,
    };
  }

  private runtimeConfigTargetKey() {
    return JSON.stringify({
      smallModel: this.currentSmallModel().trim(),
      enabledSkills: this.currentEnabledSkills(),
      enabledMcps: this.currentEnabledMcps(),
      configuredMcpServers: this.currentConfiguredMcpServers(),
      managedSkillsRoot: getManagedSkillsRootPath(this.currentRuntimeConfig()?.directory ?? null),
    });
  }

  private async ensureRuntimeConfigSynced(force = false) {
    if (this.options.enableSmallModelSync === false) return;

    const targetKey = this.runtimeConfigTargetKey();
    if (!force && this.runtimeConfigSyncKey === targetKey) return;

    if (this.runtimeConfigSyncInFlight) {
      await this.runtimeConfigSyncInFlight;
      if (!force && this.runtimeConfigSyncKey === targetKey) return;
    }

    const syncPromise = this.applyRuntimeConfigSync(targetKey);
    this.runtimeConfigSyncInFlight = syncPromise;
    try {
      await syncPromise;
    } finally {
      if (this.runtimeConfigSyncInFlight === syncPromise) {
        this.runtimeConfigSyncInFlight = null;
      }
    }
  }

  private async applyRuntimeConfigSync(targetKey: string) {
    try {
      const current = unwrapSdkData<Config>(
        await this.getClient().config.get({
          responseStyle: "data",
          throwOnError: true,
          signal: this.defaultRequestSignal(),
        }),
      );

      const nextConfig: Config = { ...current };
      const currentRecord = current as Record<string, unknown>;
      let changed = false;

      const desiredSmallModel = this.currentSmallModel().trim();
      if (desiredSmallModel && current.small_model !== desiredSmallModel) {
        nextConfig.small_model = desiredSmallModel;
        changed = true;
      }

      const desiredSkillPaths = normalizeStringArray(
        buildManagedSkillPaths(current, this.currentRuntimeConfig()?.directory ?? null),
      );
      const currentSkillsValue = currentRecord.skills;
      const currentSkillPaths = normalizeStringArray(
        isPlainObject(currentSkillsValue) ? (currentSkillsValue as { paths?: unknown }).paths : undefined,
      );
      if (!shallowEqualStringArrays(currentSkillPaths, desiredSkillPaths)) {
        const currentSkills = isPlainObject(currentSkillsValue) ? currentSkillsValue : {};
        (nextConfig as Record<string, unknown>).skills = {
          ...currentSkills,
          paths: desiredSkillPaths,
        };
        changed = true;
      }

      const currentMcpConfig = normalizeRuntimeMcpConfigMap(currentRecord.mcp);
      const desiredMcpConfig = buildDesiredRuntimeMcpConfigMap({
        currentMcpConfig: currentRecord.mcp,
        configuredServers: this.currentConfiguredMcpServers(),
        legacyEnabledIds: this.currentEnabledMcps(),
      });
      if (stableSerialize(currentMcpConfig) !== stableSerialize(desiredMcpConfig)) {
        (nextConfig as Record<string, unknown>).mcp = desiredMcpConfig;
        changed = true;
      }

      if (changed) {
        await this.getClient().config.update({
          body: nextConfig,
          responseStyle: "data",
          throwOnError: true,
          signal: this.defaultRequestSignal(),
        });
      }

      this.runtimeConfigSyncKey = targetKey;
      this.availableAgentNamesCache = null;
    } catch (error) {
      console.error("[opencode] Config sync failed:", error instanceof Error ? error.message : error);
      return;
    }
  }

  private async syncOpencodeSmallModel() {
    await this.ensureRuntimeConfigSynced(true);
  }
}
