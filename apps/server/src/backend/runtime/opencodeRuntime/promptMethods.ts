import {
  AGENT_NAME_CACHE_TTL_MS,
  BUILTIN_PRIMARY_AGENT_IDS,
  BUILTIN_SUBAGENT_IDS,
  RUNTIME_HEALTH_CACHE_TTL_MS,
  RUNTIME_HEALTH_OK_PATTERN,
  RUNTIME_HEALTH_PROMPT,
  RUNTIME_HEALTH_TIMEOUT_CAP_MS,
  isPlainObject,
  logger,
  normalizeStringArray,
  shallowEqualStringArrays,
  type AssistantInfo,
  type ChatMessagePart,
  type Config,
  type Part,
  type ResolvedModel,
  type RuntimeAgentCatalog,
  type RuntimeHealthSnapshot,
  type RuntimeInputPart,
  type Message,
  type Session,
} from "./shared";
import {
  createSessionRunStatusUpdatedEvent,
  createSessionStateUpdatedEvent,
} from "../../contracts/events";
import {
  getSessionById,
  getRuntimeSessionBinding,
  setRuntimeSessionBinding,
  setSessionTitle,
} from "../../db/repository";
import { isActiveHeartbeatSession } from "../../heartbeat/state";
import { getOpencodeErrorStatus, unwrapSdkData } from "../../opencode/client";
import {
  buildManagedSkillPaths,
  getManagedSkillsRootPath,
} from "../../skills/service";
import {
  RuntimeProviderAuthError,
  RuntimeProviderQuotaError,
  RuntimeProviderRateLimitError,
} from "../errors";
import type { OpencodeRuntime } from "../opencodeRuntime";

export interface OpencodeRuntimePromptMethods {
  resolveModel(rawModel: string): ResolvedModel;
  extractText(parts: Array<Part>): string | null;
  extractReasoningText(parts: Array<Part>): string | null;
  extractCompletedToolOutputText(parts: Array<Part>): string | null;
  extractSubtaskPrompt(parts: Array<Part>): string | null;
  summarizeBackgroundResult(text: string | null): string;
  mapChatMessagePart(part: Part): ChatMessagePart | null;
  buildChatMessageParts(parts: Array<Part>): ChatMessagePart[];
  extractAssistantError(info: AssistantInfo, parts: Array<Part>): string | null;
  describeUnknownError(error: unknown): string | null;
  sendPrompt(
    sessionId: string,
    model: ResolvedModel,
    promptParts: Array<RuntimeInputPart>,
    system?: string,
    agent?: string,
  ): Promise<{ info: AssistantInfo; parts: Array<Part> }>;
  sendPromptWithModelFallback(input: {
    localSessionId: string;
    localSessionTitle: string;
    opencodeSessionId: string;
    primaryModel: ResolvedModel;
    parts: Array<RuntimeInputPart>;
    retryPartsOnSessionRecreate?: Array<RuntimeInputPart>;
    memoryContextFingerprint?: string | null;
    system?: string;
    agent?: string;
  }): Promise<{
    message: { info: AssistantInfo; parts: Array<Part> };
    opencodeSessionId: string;
  }>;
  sendPromptWithAgentFallback(input: {
    localSessionId?: string;
    sessionId: string;
    model: ResolvedModel;
    parts: Array<RuntimeInputPart>;
    system?: string;
    agent?: string;
  }): Promise<{ info: AssistantInfo; parts: Array<Part> }>;
  resolvePromptModels(primaryModel: ResolvedModel): Array<ResolvedModel>;
  formatModelRef(model: ResolvedModel): string;
  emitPromptRetryStatus(
    sessionId: string,
    attempt: number,
    error: unknown,
    previousModel: ResolvedModel | null,
    nextModel: ResolvedModel,
  ): void;
  extractErrorStatusCode(error: unknown): number | null;
  isModelNotFoundError(error: unknown): boolean;
  resolveOrCreateOpencodeSession(
    localSessionId: string,
    localTitle: string,
  ): Promise<string>;
  createOpencodeSession(
    localSessionId: string,
    localTitle: string,
  ): Promise<string>;
  isPlaceholderSessionTitle(title: string): boolean;
  startSessionTitlePolling(
    localSessionId: string,
    opencodeSessionId: string,
  ): void;
  syncSessionTitleFromOpencode(
    localSessionId: string,
    opencodeSessionId: string,
    localTitle: string,
    emitUpdateEvent?: boolean,
  ): Promise<boolean | undefined>;
  normalizeRuntimeError(error: unknown): Error;
  normalizeProviderMessage(message: unknown): string;
  categorizeProviderError(status: number | null, message: string): Error | null;
  shouldFailoverPromptError(error: unknown): boolean;
  isTimeoutLikeError(error: unknown): boolean;
  isInvalidAgentPromptError(error: unknown): boolean;
  resolveRequestedAgentId(
    agent: string | undefined,
    sessionId?: string,
  ): Promise<string | undefined>;
  agentModeFromConfig(
    agentId: string,
    config: Record<string, unknown>,
  ): "subagent" | "primary" | "all";
  resolvePrimaryAgentId(
    sessionId?: string,
    options?: { emitRetryStatus?: boolean },
  ): Promise<string | undefined>;
  fetchAvailableAgentNames(): Promise<Set<string> | null>;
  fetchAvailableAgentCatalog(): Promise<RuntimeAgentCatalog | null>;
  defaultRequestSignal(): AbortSignal;
  promptRequestSignal(): AbortSignal;
  healthProbeSignal(timeoutMs: number): AbortSignal;
  healthProbeTimeoutMs(): number;
  waitFor(ms: number): Promise<void>;
  clearAllTimers(timers: Map<string, ReturnType<typeof setTimeout>>): void;
  normalizeHealthProbeError(error: unknown, timeoutMs: number): Error;
  runHealthProbe(): Promise<RuntimeHealthSnapshot>;
  runtimeConfigTargetKey(): string;
  ensureRuntimeConfigSynced(force?: boolean): Promise<void>;
  applyRuntimeConfigSync(targetKey: string): Promise<void>;
}

export const opencodeRuntimePromptMethods: OpencodeRuntimePromptMethods = {
  resolveModel(this: OpencodeRuntime, rawModel) {
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
  },

  extractText(this: OpencodeRuntime, parts: Array<Part>) {
    const text = parts
      .filter(
        (part): part is Extract<Part, { type: "text" }> => part.type === "text",
      )
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n");
    return text || null;
  },

  extractReasoningText(this: OpencodeRuntime, parts: Array<Part>) {
    const text = parts
      .filter(
        (part): part is Extract<Part, { type: "reasoning" }> =>
          part.type === "reasoning",
      )
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n");
    return text || null;
  },

  extractCompletedToolOutputText(this: OpencodeRuntime, parts: Array<Part>) {
    const outputs: string[] = [];
    for (const part of parts) {
      if (part.type !== "tool") continue;
      if (part.state.status !== "completed") continue;
      const output = part.state.output.trim();
      if (output) outputs.push(output);
    }
    return outputs.length > 0 ? outputs.join("\n\n") : null;
  },

  extractSubtaskPrompt(this: OpencodeRuntime, parts: Array<Part>) {
    const subtask = parts.find(
      (part): part is Extract<Part, { type: "subtask" }> =>
        part.type === "subtask",
    );
    const prompt = subtask?.prompt.trim();
    return prompt || null;
  },

  summarizeBackgroundResult(this: OpencodeRuntime, text: string | null) {
    const normalized = (text ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) return "Background run completed.";
    if (normalized.length <= 800) return normalized;
    return `${normalized.slice(0, 800)}...`;
  },

  mapChatMessagePart(this: OpencodeRuntime, part) {
    const toIsoIfFiniteMillis = (value: unknown): string | undefined => {
      if (typeof value !== "number" || !Number.isFinite(value))
        return undefined;
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
    const stateTime =
      "time" in part.state &&
      part.state.time &&
      typeof part.state.time === "object"
        ? part.state.time
        : null;
    const startedAt =
      stateTime && "start" in stateTime
        ? toIsoIfFiniteMillis(stateTime.start)
        : undefined;
    const endedAt =
      stateTime && "end" in stateTime
        ? toIsoIfFiniteMillis(stateTime.end)
        : undefined;
    const output =
      part.state.status === "completed"
        ? part.state.output.trim() || undefined
        : undefined;
    const error =
      part.state.status === "error"
        ? part.state.error.trim() || undefined
        : undefined;
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
  },

  buildChatMessageParts(this: OpencodeRuntime, parts) {
    const mapped = parts
      .map((part) => this.mapChatMessagePart(part))
      .filter((part): part is ChatMessagePart => Boolean(part));
    if (mapped.length === 0) return [];
    const deduped = new Map<string, ChatMessagePart>();
    for (const part of mapped) {
      deduped.set(part.id, part);
    }
    return [...deduped.values()];
  },

  extractAssistantError(this: OpencodeRuntime, info, parts) {
    const infoError = this.describeUnknownError(info.error);
    if (infoError) return infoError;
    for (const part of parts) {
      if (part.type !== "tool" || part.state.status !== "error") continue;
      const reason = part.state.error?.trim();
      if (reason) return `Tool ${part.tool} failed: ${reason}`;
      return `Tool ${part.tool} failed.`;
    }
    return null;
  },

  describeUnknownError(this: OpencodeRuntime, error: unknown) {
    if (!error) return null;
    if (typeof error === "string") {
      const trimmed = error.trim();
      return trimmed || null;
    }
    if (error instanceof Error) {
      const message = error.message.trim();
      return message || error.name || "Unknown error";
    }
    if (typeof error !== "object") return String(error);
    const record = error as Record<string, unknown>;
    const directMessage =
      typeof record.message === "string" ? record.message.trim() : "";
    if (directMessage) return directMessage;
    const dataMessage =
      record.data &&
      typeof record.data === "object" &&
      typeof (record.data as Record<string, unknown>).message === "string"
        ? ((record.data as Record<string, unknown>).message as string).trim()
        : "";
    if (dataMessage) return dataMessage;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (name) return name;
    return null;
  },

  async sendPrompt(
    this: OpencodeRuntime,
    sessionId,
    model,
    promptParts,
    system,
    agent,
  ) {
    const response = unwrapSdkData<{ info?: Message; parts?: Array<Part> }>(
      await this.getClient().session.prompt({
        path: { id: sessionId },
        body: {
          model: { providerID: model.providerId, modelID: model.modelId },
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
        this.describeUnknownError(
          (response as Record<string, unknown>).error,
        ) ?? this.describeUnknownError(response);
      if (topLevelError) {
        const wrapped = new Error(topLevelError);
        const status = this.extractErrorStatusCode(
          (response as Record<string, unknown>).error ?? response,
        );
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
      throw new Error(
        `OpenCode returned unexpected message role: ${info.role}`,
      );
    }
    return {
      info: info as AssistantInfo,
      parts: Array.isArray(response.parts) ? response.parts : [],
    };
  },

  async sendPromptWithModelFallback(this: OpencodeRuntime, input) {
    const models = this.resolvePromptModels(input.primaryModel);
    let sessionId = input.opencodeSessionId;
    let previousError: unknown = null;

    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      if (!model) continue;
      if (index > 0) {
        this.emitPromptRetryStatus(
          input.localSessionId,
          index + 1,
          previousError,
          models[index - 1] ?? null,
          model,
        );
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
          const previousSessionState = this.getMemoryInjectionState(sessionId);
          try {
            sessionId = await this.createOpencodeSession(
              input.localSessionId,
              input.localSessionTitle,
            );
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
                injectedKeysByGeneration: [
                  ...(previousSessionState?.injectedKeysByGeneration ?? []),
                ],
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
      if (
        !(
          this.isModelNotFoundError(attemptError) ||
          this.shouldFailoverPromptError(attemptError)
        )
      ) {
        throw this.normalizeRuntimeError(attemptError);
      }
    }

    throw this.normalizeRuntimeError(previousError);
  },

  async sendPromptWithAgentFallback(this: OpencodeRuntime, input) {
    try {
      return await this.sendPrompt(
        input.sessionId,
        input.model,
        input.parts,
        input.system,
        input.agent,
      );
    } catch (error) {
      if (!this.isInvalidAgentPromptError(error)) throw error;
      if (input.agent) {
        try {
          return await this.sendPrompt(
            input.sessionId,
            input.model,
            input.parts,
            input.system,
            undefined,
          );
        } catch (fallbackError) {
          if (!this.isInvalidAgentPromptError(fallbackError))
            throw fallbackError;
          const primaryAgent = await this.resolvePrimaryAgentId(
            input.localSessionId,
          );
          if (!primaryAgent) throw fallbackError;
          return this.sendPrompt(
            input.sessionId,
            input.model,
            input.parts,
            input.system,
            primaryAgent,
          );
        }
      }
      const fallbackAgent = await this.resolvePrimaryAgentId(
        input.localSessionId,
      );
      if (!fallbackAgent) throw error;
      return this.sendPrompt(
        input.sessionId,
        input.model,
        input.parts,
        input.system,
        fallbackAgent,
      );
    }
  },

  resolvePromptModels(this: OpencodeRuntime, primaryModel) {
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
  },

  formatModelRef(this: OpencodeRuntime, model: ResolvedModel) {
    return `${model.providerId}/${model.modelId}`;
  },

  emitPromptRetryStatus(
    this: OpencodeRuntime,
    sessionId,
    attempt,
    error,
    previousModel,
    nextModel,
  ) {
    const detail = this.normalizeRuntimeError(error).message;
    const nextRef = this.formatModelRef(nextModel);
    const message = this.isModelNotFoundError(error)
      ? `Model ${previousModel ? this.formatModelRef(previousModel) : "requested"} is not available at the selected provider. Retrying with ${nextRef}.`
      : `${detail} Retrying with ${nextRef}.`;
    this.emit(
      createSessionRunStatusUpdatedEvent(
        { sessionId, status: "retry", attempt, message },
        "runtime",
      ),
    );
  },

  extractErrorStatusCode(this: OpencodeRuntime, error: unknown) {
    if (!error || typeof error !== "object") return null;
    const record = error as Record<string, unknown>;
    if (typeof record.status === "number" && Number.isFinite(record.status))
      return record.status;
    if (
      typeof record.statusCode === "number" &&
      Number.isFinite(record.statusCode)
    ) {
      return record.statusCode;
    }
    const data = record.data;
    if (data && typeof data === "object") {
      const dataRecord = data as Record<string, unknown>;
      if (
        typeof dataRecord.statusCode === "number" &&
        Number.isFinite(dataRecord.statusCode)
      ) {
        return dataRecord.statusCode;
      }
    }
    return null;
  },

  isModelNotFoundError(this: OpencodeRuntime, error) {
    const message = (this.describeUnknownError(error) ?? "").toLowerCase();
    return message.includes("model not found");
  },

  async resolveOrCreateOpencodeSession(
    this: OpencodeRuntime,
    localSessionId,
    localTitle,
  ) {
    const bound = getRuntimeSessionBinding("opencode", localSessionId);
    if (bound) return bound;
    return this.createOpencodeSession(localSessionId, localTitle);
  },

  async createOpencodeSession(
    this: OpencodeRuntime,
    localSessionId,
    localTitle,
  ) {
    const body = localSessionId === "main" ? { title: localTitle } : {};
    const created = unwrapSdkData<Session>(
      await this.getClient().session.create({
        body,
        responseStyle: "data",
        throwOnError: true,
        signal: this.defaultRequestSignal(),
      }),
    );
    setRuntimeSessionBinding("opencode", localSessionId, created.id);
    return created.id;
  },

  isPlaceholderSessionTitle(this: OpencodeRuntime, title: string) {
    const normalized = title.trim();
    if (!normalized) return true;
    return (
      /^session \d+$/i.test(normalized) ||
      /^new session(?:\s*-\s*.+)?$/i.test(normalized)
    );
  },

  startSessionTitlePolling(
    this: OpencodeRuntime,
    localSessionId,
    opencodeSessionId,
  ) {
    if (localSessionId === "main") return;
    const localSession = getSessionById(localSessionId);
    if (!localSession || !this.isPlaceholderSessionTitle(localSession.title))
      return;
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
  },

  async syncSessionTitleFromOpencode(
    this: OpencodeRuntime,
    localSessionId,
    opencodeSessionId,
    localTitle,
    emitUpdateEvent = false,
  ) {
    if (localSessionId === "main") return;
    if (isActiveHeartbeatSession(localSessionId)) return false;
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
      if (this.isPlaceholderSessionTitle(remoteTitle)) return false;
      if (!remoteTitle || remoteTitle === localTitle) return false;
      const updated = setSessionTitle(localSessionId, remoteTitle);
      if (emitUpdateEvent && updated) {
        this.emit(createSessionStateUpdatedEvent(updated, "runtime"));
      }
      return true;
    } catch (error) {
      logger.warnWithCause("Session title sync failed", error, {
        localSessionId,
        localTitle,
      });
      return false;
    }
  },

  normalizeRuntimeError(this: OpencodeRuntime, error) {
    const status = getOpencodeErrorStatus(error);
    const fallback =
      this.describeUnknownError(error) ?? "OpenCode request failed.";
    const categorized = this.categorizeProviderError(status, fallback);
    if (categorized) return categorized;
    if (status !== null)
      return new Error(`OpenCode API error (${status}): ${fallback}`);
    if (error instanceof Error) return error;
    return new Error(fallback);
  },

  normalizeProviderMessage(this: OpencodeRuntime, message) {
    if (typeof message !== "string" || !message.trim()) return "";
    const normalized = this.categorizeProviderError(null, message);
    return normalized ? normalized.message : message;
  },

  categorizeProviderError(
    this: OpencodeRuntime,
    status: number | null,
    message: string,
  ) {
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
  },

  shouldFailoverPromptError(this: OpencodeRuntime, error) {
    const status = getOpencodeErrorStatus(error);
    if (status !== null) {
      if ([401, 402, 403, 408, 429, 500, 502, 503, 504].includes(status))
        return true;
      if ([400, 404].includes(status)) return false;
    }
    const message = this.describeUnknownError(error) ?? "";
    if (this.categorizeProviderError(status, message)) return true;
    const normalized = message.toLowerCase();
    const hasAny = (values: Array<string>) =>
      values.some((value) => normalized.includes(value));
    if (this.isTimeoutLikeError(error)) return true;
    if (
      hasAny([
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
    return false;
  },

  isTimeoutLikeError(this: OpencodeRuntime, error) {
    if (error instanceof DOMException && error.name === "AbortError")
      return true;
    const message = this.describeUnknownError(error)?.toLowerCase() ?? "";
    return Boolean(
      message &&
      (message.includes("timed out") ||
        message.includes("timeout") ||
        message.includes("operation timed out")),
    );
  },

  isInvalidAgentPromptError(this: OpencodeRuntime, error) {
    const normalized = (this.describeUnknownError(error) ?? "").toLowerCase();
    if (!normalized) return false;
    return (
      normalized.includes("agent.variant") ||
      (normalized.includes("default agent") &&
        normalized.includes("not found")) ||
      (normalized.includes("default agent") &&
        normalized.includes("subagent")) ||
      normalized.includes("is not an object")
    );
  },

  async resolveRequestedAgentId(this: OpencodeRuntime, agent, sessionId) {
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
  },

  agentModeFromConfig(
    this: OpencodeRuntime,
    agentId: string,
    config: Record<string, unknown>,
  ) {
    const explicit = typeof config.mode === "string" ? config.mode.trim() : "";
    if (
      explicit === "subagent" ||
      explicit === "primary" ||
      explicit === "all"
    ) {
      return explicit;
    }
    if (BUILTIN_SUBAGENT_IDS.has(agentId)) return "subagent";
    if (BUILTIN_PRIMARY_AGENT_IDS.has(agentId)) return "primary";
    return "all";
  },

  async resolvePrimaryAgentId(this: OpencodeRuntime, sessionId, options) {
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
  },

  async fetchAvailableAgentNames(this: OpencodeRuntime) {
    const catalog = await this.fetchAvailableAgentCatalog();
    return catalog?.ids ?? null;
  },

  async fetchAvailableAgentCatalog(this: OpencodeRuntime) {
    const now = Date.now();
    if (
      this["availableAgentNamesCache"] &&
      now - this["availableAgentNamesCache"].fetchedAtMs <=
        AGENT_NAME_CACHE_TTL_MS
    ) {
      return this["availableAgentNamesCache"].catalog;
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
      const configuredAgentMap = isPlainObject(record.agent)
        ? (record.agent as Record<string, unknown>)
        : {};
      const defaultAgentId =
        typeof record.default_agent === "string"
          ? record.default_agent.trim()
          : "";
      const ids = new Set<string>([
        "build",
        "plan",
        "general",
        "explore",
        "title",
        "summary",
        "compaction",
      ]);
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
        const defaultConfig = isPlainObject(configuredAgentMap[defaultAgentId])
          ? (configuredAgentMap[defaultAgentId] as Record<string, unknown>)
          : null;
        const disabled = defaultConfig?.disable === true;
        const hidden = defaultConfig?.hidden === true;
        const mode = defaultConfig
          ? this.agentModeFromConfig(defaultAgentId, defaultConfig)
          : "primary";
        if (!disabled && !hidden && mode !== "subagent") {
          primaryId = defaultAgentId;
        }
      }
      if (!primaryId) {
        const buildConfig = isPlainObject(configuredAgentMap.build)
          ? (configuredAgentMap.build as Record<string, unknown>)
          : null;
        if (buildConfig?.disable !== true) {
          primaryId = "build";
        }
      }
      const catalog: RuntimeAgentCatalog = { ids, primaryId };
      this["availableAgentNamesCache"] = { fetchedAtMs: now, catalog };
      return catalog;
    } catch {
      return null;
    }
  },

  defaultRequestSignal(this: OpencodeRuntime) {
    return AbortSignal.timeout(this.currentTimeoutMs());
  },

  promptRequestSignal(this: OpencodeRuntime) {
    return AbortSignal.timeout(this.currentPromptTimeoutMs());
  },

  healthProbeSignal(this: OpencodeRuntime, timeoutMs: number) {
    return AbortSignal.timeout(timeoutMs);
  },

  healthProbeTimeoutMs(this: OpencodeRuntime) {
    return Math.max(
      1_000,
      Math.min(
        this.currentPromptTimeoutMs(),
        this.currentTimeoutMs(),
        RUNTIME_HEALTH_TIMEOUT_CAP_MS,
      ),
    );
  },

  async waitFor(this: OpencodeRuntime, ms) {
    if (this["disposed"]) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this["disposeController"].signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        this["disposeController"].signal.removeEventListener("abort", onAbort);
        resolve();
      };
      this["disposeController"].signal.addEventListener("abort", onAbort, {
        once: true,
      });
    });
  },

  clearAllTimers(
    this: OpencodeRuntime,
    timers: Map<string, ReturnType<typeof setTimeout>>,
  ) {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  },

  normalizeHealthProbeError(this: OpencodeRuntime, error, timeoutMs) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return new Error(`Runtime health probe timed out after ${timeoutMs}ms.`);
    }
    return this.normalizeRuntimeError(error);
  },

  async runHealthProbe(this: OpencodeRuntime) {
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
          body: { title: "agent-mockingbird-runtime-health" },
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
            model: { providerID: model.providerId, modelID: model.modelId },
            parts: [{ type: "text", text: RUNTIME_HEALTH_PROMPT }],
          },
          responseStyle: "data",
          throwOnError: true,
          signal: this.healthProbeSignal(timeoutMs),
        }),
      );
      if (response.info.role !== "assistant") {
        throw new Error(
          `OpenCode returned unexpected message role: ${response.info.role}`,
        );
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
        ? { name: normalizedError.name, message: normalizedError.message }
        : null,
    };
  },

  runtimeConfigTargetKey(this: OpencodeRuntime) {
    return JSON.stringify({
      enabledSkills: this.currentEnabledSkills(),
      managedSkillsRoot: getManagedSkillsRootPath(
        this.currentRuntimeConfig()?.directory ?? null,
      ),
    });
  },

  async ensureRuntimeConfigSynced(this: OpencodeRuntime, force = false) {
    if (this["options"].enableSmallModelSync === false) return;
    const targetKey = this.runtimeConfigTargetKey();
    if (!force && this["runtimeConfigSyncKey"] === targetKey) return;
    if (this["runtimeConfigSyncInFlight"]) {
      await this["runtimeConfigSyncInFlight"];
      if (!force && this["runtimeConfigSyncKey"] === targetKey) return;
    }
    const syncPromise = this.applyRuntimeConfigSync(targetKey);
    this["runtimeConfigSyncInFlight"] = syncPromise;
    try {
      await syncPromise;
    } finally {
      if (this["runtimeConfigSyncInFlight"] === syncPromise) {
        this["runtimeConfigSyncInFlight"] = null;
      }
    }
  },

  async applyRuntimeConfigSync(this: OpencodeRuntime, targetKey) {
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
      const desiredSkillPaths = normalizeStringArray(
        buildManagedSkillPaths(
          current,
          this.currentRuntimeConfig()?.directory ?? null,
        ),
      );
      const currentSkillsValue = currentRecord.skills;
      const currentSkillPaths = normalizeStringArray(
        isPlainObject(currentSkillsValue)
          ? (currentSkillsValue as { paths?: unknown }).paths
          : undefined,
      );
      if (!shallowEqualStringArrays(currentSkillPaths, desiredSkillPaths)) {
        const currentSkills = isPlainObject(currentSkillsValue)
          ? currentSkillsValue
          : {};
        (nextConfig as Record<string, unknown>).skills = {
          ...currentSkills,
          paths: desiredSkillPaths,
        };
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
      this["runtimeConfigSyncKey"] = targetKey;
      this["availableAgentNamesCache"] = null;
    } catch (error) {
      console.error(
        "[opencode] Config sync failed:",
        error instanceof Error ? error.message : error,
      );
    }
  },
};
