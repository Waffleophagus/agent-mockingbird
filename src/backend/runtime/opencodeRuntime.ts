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
  RuntimeProviderAuthError,
  RuntimeProviderQuotaError,
  RuntimeProviderRateLimitError,
  RuntimeSessionBusyError,
  RuntimeSessionNotFoundError,
} from "./errors";
import type { MemoryToolCallTrace, MessageMemoryTrace, SpecialistAgent } from "../../types/dashboard";
import {
  buildDesiredRuntimeAgentConfigMap,
  normalizeConfiguredAgents,
  normalizeRuntimeAgentConfigMap,
} from "../agents/service";
import type { ConfiguredMcpServer, WafflebotConfig } from "../config/schema";
import { getConfigSnapshot } from "../config/service";
import {
  createHeartbeatUpdatedEvent,
  createSessionCompactedEvent,
  createSessionMessageCreatedEvent,
  createSessionRunErrorEvent,
  createSessionRunStatusUpdatedEvent,
  createSessionStateUpdatedEvent,
  createUsageUpdatedEvent,
  type RuntimeEvent,
} from "../contracts/events";
import type {
  BackgroundRunHandle,
  BackgroundRunStatus,
  PromptBackgroundAsyncInput,
  RuntimeEngine,
  RuntimeHealthCheckInput,
  RuntimeHealthCheckResult,
  RuntimeMessageAck,
  SendUserMessageInput,
  SpawnBackgroundSessionInput,
} from "../contracts/runtime";
import {
  appendChatExchange,
  createBackgroundRun,
  getBackgroundRunByChildExternalSessionId,
  getBackgroundRunById,
  getLocalSessionIdByRuntimeBinding,
  getRuntimeSessionBinding,
  getSessionById,
  setBackgroundRunStatus,
  setMessageMemoryTrace,
  setSessionTitle,
  setRuntimeSessionBinding,
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
import {
  createOpencodeClient,
  createOpencodeClientFromConnection,
  getOpencodeErrorStatus,
  unwrapSdkData,
} from "../opencode/client";
import {
  buildManagedSkillPaths,
  buildSkillPermissionAllowlist,
  getManagedSkillsRootPath,
  isConfigPermissionObject,
  normalizeSkillIds,
} from "../skills/service";

type Listener = (event: RuntimeEvent) => void;
type AssistantInfo = Extract<Message, { role: "assistant" }>;
type ResolvedModel = { providerId: string; modelId: string };
type RuntimeOpencodeConfig = WafflebotConfig["runtime"]["opencode"];

interface OpencodeRuntimeOptions {
  defaultProviderId: string;
  defaultModelId: string;
  fallbackModelRefs?: Array<string>;
  client?: OpencodeClient;
  getRuntimeConfig?: () => RuntimeOpencodeConfig;
  getEnabledSkills?: () => Array<string>;
  getEnabledMcps?: () => Array<string>;
  getConfiguredMcpServers?: () => Array<ConfiguredMcpServer>;
  getConfiguredAgents?: () => Array<SpecialistAgent>;
  enableEventSync?: boolean;
  enableSmallModelSync?: boolean;
}

const MODEL_MEMORY_TOOLS = new Set(["memory_search", "memory_get", "memory_remember"]);
const RUNTIME_HEALTH_PROMPT = 'Just respond "OK" to this to confirm the gateway is working.';
const RUNTIME_HEALTH_OK_PATTERN = /\bok\b/i;
const RUNTIME_HEALTH_CACHE_TTL_MS = 5_000;
const RUNTIME_HEALTH_TIMEOUT_CAP_MS = 15_000;
const OPENCODE_RUNTIME_ID = "opencode";
type RuntimeHealthSnapshot = Omit<RuntimeHealthCheckResult, "fromCache">;

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

function normalizePermissionRule(rule: unknown) {
  if (!isPlainObject(rule)) return null;
  const entries = Object.entries(rule)
    .filter((entry): entry is [string, "allow" | "deny" | "ask"] => {
      return entry[0].trim().length > 0 && (entry[1] === "allow" || entry[1] === "deny" || entry[1] === "ask");
    })
    .sort(([a], [b]) => a.localeCompare(b));
  return entries;
}

function shallowEqualPermissionRules(left: unknown, right: unknown) {
  const normalizedLeft = normalizePermissionRule(left);
  const normalizedRight = normalizePermissionRule(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft.length !== normalizedRight.length) return false;
  for (let index = 0; index < normalizedLeft.length; index += 1) {
    const leftEntry = normalizedLeft[index];
    const rightEntry = normalizedRight[index];
    if (!leftEntry || !rightEntry) return false;
    if (leftEntry[0] !== rightEntry[0] || leftEntry[1] !== rightEntry[1]) return false;
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
  }

  subscribe(onEvent: Listener): () => void {
    this.listeners.add(onEvent);
    return () => {
      this.listeners.delete(onEvent);
    };
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
    return smallModel || env.WAFFLEBOT_OPENCODE_SMALL_MODEL;
  }

  private currentTimeoutMs() {
    const runtimeConfig = this.currentRuntimeConfig();
    return runtimeConfig?.timeoutMs ?? env.WAFFLEBOT_OPENCODE_TIMEOUT_MS;
  }

  private currentPromptTimeoutMs() {
    const runtimeConfig = this.currentRuntimeConfig();
    return runtimeConfig?.promptTimeoutMs ?? env.WAFFLEBOT_OPENCODE_PROMPT_TIMEOUT_MS;
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

  private currentConfiguredAgents() {
    return normalizeConfiguredAgents(this.options.getConfiguredAgents?.() ?? []);
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

    if (this.busySessions.has(session.id)) {
      throw new RuntimeSessionBusyError(session.id);
    }
    this.busySessions.add(session.id);

    try {
      await this.ensureRuntimeConfigSynced();
      const model = this.resolveModel(session.model);
      let opencodeSessionId = await this.resolveOrCreateOpencodeSession(session.id, session.title);

      const promptInput = await this.buildPromptInputWithMemory(input.content);
      const memorySystemPrompt = this.buildWafflebotSystemPrompt();

      const promptResult = await this.sendPromptWithModelFallback({
        localSessionId: session.id,
        localSessionTitle: session.title,
        opencodeSessionId,
        primaryModel: model,
        content: promptInput.content,
        system: memorySystemPrompt,
      });
      opencodeSessionId = promptResult.opencodeSessionId;
      const assistantMessage = promptResult.message;

      await this.syncSessionTitleFromOpencode(session.id, opencodeSessionId, session.title);
      this.startSessionTitlePolling(session.id, opencodeSessionId);

      const trace = this.buildMessageMemoryTrace(assistantMessage.parts, promptInput.injectedContextResults);
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

      const assistantText = this.extractText(assistantMessage.parts);
      if (!assistantText) {
        const finish = assistantMessage.info.finish ?? "unknown";
        const toolPartCount = assistantMessage.parts.filter((part) => part.type === "tool").length;
        const detail = `finish=${finish}, tool_parts=${toolPartCount}`;
        throw new Error(`OpenCode returned no assistant text (${detail}).`);
      }

      const createdAt =
        assistantMessage.info.time?.completed ?? assistantMessage.info.time?.created ?? Date.now();
      const result = appendChatExchange({
        sessionId: session.id,
        userContent: input.content,
        assistantContent: assistantText,
        source: "runtime",
        createdAt,
        assistantMessageId: assistantMessage.info.id,
        usage: {
          requestCountDelta: 1,
          inputTokensDelta:
            assistantMessage.info.tokens?.input ?? Math.max(8, input.content.length * 2),
          outputTokensDelta:
            assistantMessage.info.tokens?.output ?? Math.max(24, Math.floor(input.content.length * 2.5)),
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
      this.busySessions.delete(session.id);
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

    return this.backgroundRecordToHandle(run);
  }

  async promptBackgroundAsync(input: PromptBackgroundAsyncInput): Promise<BackgroundRunHandle> {
    const runId = input.runId.trim();
    const content = input.content.trim();
    if (!runId) {
      throw new Error("runId is required.");
    }
    if (!content) {
      throw new Error("content is required.");
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
    const startedAt = run.startedAt ? undefined : Date.now();

    setBackgroundRunStatus({
      runId: run.id,
      status: "running",
      prompt: content,
      startedAt,
      completedAt: null,
      error: null,
    });

    try {
      await this.getClient().session.promptAsync({
        path: { id: run.childExternalSessionId },
        body: {
          model: {
            providerID: model.providerId,
            modelID: model.modelId,
          },
          system: input.system,
          agent: input.agent?.trim() || undefined,
          noReply: input.noReply,
          parts: [{ type: "text", text: content }],
        },
        responseStyle: "data",
        throwOnError: true,
        signal: this.promptRequestSignal(),
      });
    } catch (error) {
      const normalizedError = this.normalizeRuntimeError(error);
      setBackgroundRunStatus({
        runId: run.id,
        status: "failed",
        completedAt: Date.now(),
        error: normalizedError.message,
      });
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

    return this.backgroundRecordToHandle(run);
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
        setBackgroundRunStatus({
          runId: run.id,
          status: "aborted",
          completedAt: Date.now(),
          error: null,
        });
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
        return Boolean(unwrapSdkData<boolean>(retry));
      }
      throw this.normalizeRuntimeError(error);
    }
  }

  private async buildPromptInputWithMemory(userContent: string): Promise<{
    content: string;
    injectedContextResults: number;
  }> {
    if (currentMemoryConfig().toolMode === "tool_only") {
      return { content: userContent, injectedContextResults: 0 };
    }

    const query = userContent.trim();
    if (!query) return { content: userContent, injectedContextResults: 0 };

    try {
      const results = await searchMemory(query);
      if (!results.length) {
        return { content: userContent, injectedContextResults: 0 };
      }
      const contextLines = results.map(
        (result, index) =>
          `${index + 1}. (${result.score.toFixed(3)}) ${result.citation}\n${result.snippet}`,
      );
      const contextBlock = contextLines.join("\n\n");
      return {
        content: [
          "Use the memory context below only if relevant and non-contradictory to current user intent.",
          "",
          "[Memory Context]",
          contextBlock,
          "[/Memory Context]",
          "",
          "[User Message]",
          userContent,
          "[/User Message]",
        ].join("\n"),
        injectedContextResults: results.length,
      };
    } catch {
      return { content: userContent, injectedContextResults: 0 };
    }
  }

  private buildWafflebotSystemPrompt(): string | undefined {
    const memoryConfig = currentMemoryConfig();
    const lines: string[] = [];

    lines.push(
      "Config policy:",
      "- Use config_manager for runtime configuration changes.",
      "- Prefer patch_config with expectedHash from get_config to avoid conflicts.",
      "- Keep runSmokeTest enabled unless explicitly instructed otherwise.",
    );

    if (memoryConfig.enabled && memoryConfig.toolMode !== "inject_only") {
      lines.push("");
      lines.push(
        "Memory policy:",
        "- Use memory_search first for questions about prior facts/preferences/decisions/todos.",
        "- Use memory_get to inspect cited records before relying on them.",
        "- Use memory_remember only for durable information worth reusing later.",
        `- Current write policy: ${memoryConfig.writePolicy}; minimum confidence: ${memoryConfig.minConfidence.toFixed(2)}.`,
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
      case "session.updated":
        this.handleSessionUpdatedEvent(event);
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

  private handleSessionUpdatedEvent(event: Extract<OpencodeEvent, { type: "session.updated" }>) {
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
  }

  private handleSessionCompactedEvent(event: Extract<OpencodeEvent, { type: "session.compacted" }>) {
    const opencodeSessionId = event.properties.sessionID;
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

    if (event.properties.sessionID) {
      this.markBackgroundRunFailed(event.properties.sessionID, this.normalizeRuntimeError(error).message);
    }

    const localSessionId = event.properties.sessionID
      ? getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, event.properties.sessionID)
      : null;

    const normalized = this.normalizeRuntimeError(error);

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

  private isOpencodeEvent(event: unknown): event is OpencodeEvent {
    if (!event || typeof event !== "object") return false;
    const maybeEvent = event as { type?: unknown };
    return typeof maybeEvent.type === "string";
  }

  private backgroundRecordToHandle(run: BackgroundRunRecord): BackgroundRunHandle {
    return {
      runId: run.id,
      parentSessionId: run.parentSessionId,
      parentExternalSessionId: run.parentExternalSessionId,
      childExternalSessionId: run.childExternalSessionId,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      error: run.error,
    };
  }

  private applyBackgroundStatusBySessionId(opencodeSessionId: string, status: OpencodeSessionStatus) {
    const run = getBackgroundRunByChildExternalSessionId(OPENCODE_RUNTIME_ID, opencodeSessionId);
    if (!run) return;
    this.applyOpencodeBackgroundStatus(run, status);
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

    return (
      setBackgroundRunStatus({
        runId: run.id,
        status: nextStatus,
        startedAt,
        completedAt,
        error,
      }) ?? run
    );
  }

  private markBackgroundRunFailed(opencodeSessionId: string, message: string) {
    const run = getBackgroundRunByChildExternalSessionId(OPENCODE_RUNTIME_ID, opencodeSessionId);
    if (!run || run.status === "aborted" || run.status === "completed") {
      return;
    }
    setBackgroundRunStatus({
      runId: run.id,
      status: "failed",
      completedAt: Date.now(),
      error: message,
    });
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

  private buildMessageMemoryTrace(parts: Array<Part>, injectedContextResults: number): MessageMemoryTrace | null {
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

    if (injectedContextResults <= 0 && toolCalls.length === 0) {
      return null;
    }

    return {
      mode: currentMemoryConfig().toolMode,
      injectedContextResults,
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
    content: string,
    system?: string,
  ): Promise<{ info: AssistantInfo; parts: Array<Part> }> {
    const response = unwrapSdkData<{ info: Message; parts: Array<Part> }>(
      await this.getClient().session.prompt({
        path: { id: sessionId },
        body: {
          model: {
            providerID: model.providerId,
            modelID: model.modelId,
          },
          system,
          parts: [{ type: "text", text: content }],
        },
        responseStyle: "data",
        throwOnError: true,
        signal: this.promptRequestSignal(),
      }),
    );
    if (response.info.role !== "assistant") {
      throw new Error(`OpenCode returned unexpected message role: ${response.info.role}`);
    }
    return response as { info: AssistantInfo; parts: Array<Part> };
  }

  private async sendPromptWithModelFallback(input: {
    localSessionId: string;
    localSessionTitle: string;
    opencodeSessionId: string;
    primaryModel: ResolvedModel;
    content: string;
    system?: string;
  }): Promise<{ message: { info: AssistantInfo; parts: Array<Part> }; opencodeSessionId: string }> {
    const models = this.resolvePromptModels(input.primaryModel);
    let sessionId = input.opencodeSessionId;
    let previousError: unknown = null;

    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      if (!model) continue;
      if (index > 0) {
        this.emitPromptRetryStatus(input.localSessionId, index + 1, previousError, model);
      }

      let attemptError: unknown = null;
      try {
        const message = await this.sendPrompt(sessionId, model, input.content, input.system);
        return { message, opencodeSessionId: sessionId };
      } catch (error) {
        if (getOpencodeErrorStatus(error) === 404) {
          try {
            sessionId = await this.createOpencodeSession(input.localSessionId, input.localSessionTitle);
          } catch (createError) {
            throw this.normalizeRuntimeError(createError);
          }
          try {
            const message = await this.sendPrompt(sessionId, model, input.content, input.system);
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
      if (!hasMoreModels || !this.shouldFailoverPromptError(attemptError)) {
        throw this.normalizeRuntimeError(attemptError);
      }
    }

    throw this.normalizeRuntimeError(previousError);
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
    for (const fallbackRef of this.currentFallbackModels()) {
      add(this.resolveModel(fallbackRef));
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
    nextModel: ResolvedModel,
  ) {
    const detail = this.normalizeRuntimeError(error).message;
    this.emit(
      createSessionRunStatusUpdatedEvent(
        {
          sessionId,
          status: "retry",
          attempt,
          message: `${detail} Retrying with ${this.formatModelRef(nextModel)}.`,
        },
        "runtime",
      ),
    );
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
    return /^session \d+$/i.test(normalized) || normalized === "New Session";
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
    if (
      hasAny([
        "timed out",
        "timeout",
        "temporarily unavailable",
        "provider is overloaded",
        "upstream",
        "network error",
        "socket hang up",
        "connection reset",
        "econnreset",
      ])
    ) {
      return true;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      return true;
    }

    return false;
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
    const model = this.resolveModel(this.currentModelId());
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
      configuredAgents: this.currentConfiguredAgents(),
      managedSkillsRoot: getManagedSkillsRootPath(),
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

      const desiredSkillPaths = normalizeStringArray(buildManagedSkillPaths(current));
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

      if (typeof current.permission !== "string") {
        const desiredSkillPermission = buildSkillPermissionAllowlist(this.currentEnabledSkills());
        const currentPermission: Record<string, unknown> = isConfigPermissionObject(current.permission)
          ? current.permission
          : {};
        if (!shallowEqualPermissionRules(currentPermission.skill, desiredSkillPermission)) {
          nextConfig.permission = {
            ...currentPermission,
            skill: desiredSkillPermission,
          } as Config["permission"];
          changed = true;
        }
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

      const currentAgentConfig = normalizeRuntimeAgentConfigMap(currentRecord.agent);
      const desiredAgentConfig = buildDesiredRuntimeAgentConfigMap({
        currentAgentConfig: currentRecord.agent,
        configuredAgents: this.currentConfiguredAgents(),
      });
      if (stableSerialize(currentAgentConfig) !== stableSerialize(desiredAgentConfig)) {
        (nextConfig as Record<string, unknown>).agent = desiredAgentConfig;
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
    } catch {
      return;
    }
  }

  private async syncOpencodeSmallModel() {
    await this.ensureRuntimeConfigSynced(true);
  }
}
