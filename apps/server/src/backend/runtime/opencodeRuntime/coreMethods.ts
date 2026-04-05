import type { RuntimeEvent } from "../../contracts/events";
import {
  createHeartbeatUpdatedEvent,
  createSessionMessageCreatedEvent,
  createSessionRunErrorEvent,
  createSessionRunStatusUpdatedEvent,
  createSessionStateUpdatedEvent,
  createUsageUpdatedEvent,
} from "../../contracts/events";
import {
  appendChatExchange,
  createBackgroundRun,
  getBackgroundRunById,
  getBackgroundRunByChildExternalSessionId,
  getRuntimeSessionBinding,
  getSessionById,
  setBackgroundRunStatus,
  setMessageMemoryTrace,
  listBackgroundRunsForParentSession,
  listInFlightBackgroundRuns,
  listRecentBackgroundRuns,
} from "../../db/repository";
import {
  normalizeMcpIds,
  normalizeMcpServerDefinitions,
} from "../../mcp/service";
import {
  createOpencodeClient,
  createOpencodeClientFromConnection,
  getOpencodeErrorStatus,
  unwrapSdkData,
} from "../../opencode/client";
import { getLaneQueue } from "../../queue/service";
import { normalizeSkillIds } from "../../skills/service";
import {
  RuntimeContinuationDetachedError,
  RuntimeSessionBusyError,
  RuntimeSessionNotFoundError,
  RuntimeSessionQueuedError,
} from "../errors";
import type { OpencodeRuntime } from "../opencodeRuntime";
import {
  isQueueDrainRequest,
  logger,
  OPENCODE_RUNTIME_ID,
  shouldQueueWhenBusy,
  type BackgroundRunHandle,
  type ListBackgroundRunsInput,
  type OpencodeSessionStatus,
  type PromptBackgroundAsyncInput,
  type ResolvedModel,
  type RuntimeHealthCheckInput,
  type RuntimeHealthCheckResult,
  type RuntimeMessageAck,
  type SendUserMessageInput,
  type SpawnBackgroundSessionInput,
  type AssistantInfo,
  type Part,
  type Session,
} from "./shared";

export interface OpencodeRuntimeCoreMethods {
  syncSessionMessages(sessionId: string): Promise<void>;
  checkHealth(input?: RuntimeHealthCheckInput): Promise<RuntimeHealthCheckResult>;
  currentRuntimeConfig(): ReturnType<NonNullable<OpencodeRuntime["options"]["getRuntimeConfig"]>> | undefined;
  currentProviderId(): string;
  currentModelId(): string;
  currentFallbackModels(): string[];
  currentSmallModel(): string;
  currentTimeoutMs(): number;
  currentPromptTimeoutMs(): number;
  currentEnabledSkills(): string[];
  currentEnabledMcps(): string[];
  currentConfiguredMcpServers(): ReturnType<typeof normalizeMcpServerDefinitions>;
  getClient(): ReturnType<typeof createOpencodeClient>;
  sendUserMessage(input: SendUserMessageInput): Promise<RuntimeMessageAck>;
  spawnBackgroundSession(input: SpawnBackgroundSessionInput): Promise<BackgroundRunHandle>;
  promptBackgroundAsync(input: PromptBackgroundAsyncInput): Promise<BackgroundRunHandle>;
  getBackgroundStatus(runId: string): Promise<BackgroundRunHandle | null>;
  listBackgroundRuns(input?: ListBackgroundRunsInput): Promise<Array<BackgroundRunHandle>>;
  abortBackground(runId: string): Promise<boolean>;
  abortSession(sessionId: string): Promise<boolean>;
  compactSession(sessionId: string): Promise<boolean>;
  cancelIdleCompaction(sessionId: string): void;
  scheduleIdleCompaction(sessionId: string, model: ResolvedModel, info: AssistantInfo): Promise<void>;
  shouldArmIdleCompaction(model: ResolvedModel, info: AssistantInfo): Promise<boolean>;
  refreshModelMetadataCache(force?: boolean): Promise<void>;
  modelSupportsImageInput(model: ResolvedModel): Promise<boolean>;
  currentImageModel(): string;
  emit(event: RuntimeEvent): void;
}

export const opencodeRuntimeCoreMethods: OpencodeRuntimeCoreMethods = {
  async syncSessionMessages(this: OpencodeRuntime, sessionId) {
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
  },

  async checkHealth(this: OpencodeRuntime, input) {
    const force = input?.force === true;
    if (!force && this["healthSnapshot"] && this["healthCacheExpiresAtMs"] > Date.now()) {
      return { ...this["healthSnapshot"], fromCache: true };
    }
    await this.ensureRuntimeConfigSynced();
    if (!this["healthProbeInFlight"]) {
      this["healthProbeInFlight"] = this.runHealthProbe();
    }
    try {
      const snapshot = await this["healthProbeInFlight"];
      this["healthSnapshot"] = snapshot;
      this["healthCacheExpiresAtMs"] = Date.parse(snapshot.cacheExpiresAt);
      return { ...snapshot, fromCache: false };
    } finally {
      this["healthProbeInFlight"] = null;
    }
  },

  currentRuntimeConfig(this: OpencodeRuntime) {
    return this["options"].getRuntimeConfig?.();
  },

  currentProviderId(this: OpencodeRuntime) {
    return this.currentRuntimeConfig()?.providerId?.trim() || this["options"].defaultProviderId;
  },

  currentModelId(this: OpencodeRuntime) {
    return this.currentRuntimeConfig()?.modelId?.trim() || this["options"].defaultModelId;
  },

  currentFallbackModels(this: OpencodeRuntime) {
    return this.currentRuntimeConfig()?.fallbackModels ?? this["options"].fallbackModelRefs ?? [];
  },

  currentSmallModel(this: OpencodeRuntime) {
    const smallModel = this.currentRuntimeConfig()?.smallModel?.trim();
    return smallModel || `${this.currentProviderId()}/${this.currentModelId()}`;
  },

  currentTimeoutMs(this: OpencodeRuntime) {
    return this.currentRuntimeConfig()?.timeoutMs ?? 120_000;
  },

  currentPromptTimeoutMs(this: OpencodeRuntime) {
    return this.currentRuntimeConfig()?.promptTimeoutMs ?? 300_000;
  },

  currentEnabledSkills(this: OpencodeRuntime) {
    return normalizeSkillIds(this["options"].getEnabledSkills?.() ?? []);
  },

  currentEnabledMcps(this: OpencodeRuntime) {
    return normalizeMcpIds(this["options"].getEnabledMcps?.() ?? []);
  },

  currentConfiguredMcpServers(this: OpencodeRuntime) {
    return normalizeMcpServerDefinitions(this["options"].getConfiguredMcpServers?.() ?? []);
  },

  getClient(this: OpencodeRuntime) {
    if (this["options"].client) return this["options"].client;
    const runtimeConfig = this.currentRuntimeConfig();
    if (!runtimeConfig) {
      if (!this["client"]) this["client"] = createOpencodeClient();
      return this["client"];
    }
    const nextKey = `${runtimeConfig.baseUrl}|${runtimeConfig.directory ?? ""}`;
    if (!this["client"] || this["clientConnectionKey"] !== nextKey) {
      this["clientConnectionKey"] = nextKey;
      this["runtimeConfigSyncKey"] = null;
      this["client"] = createOpencodeClientFromConnection({
        baseUrl: runtimeConfig.baseUrl,
        directory: runtimeConfig.directory,
      });
    }
    return this["client"];
  },

  async sendUserMessage(this: OpencodeRuntime, input) {
    const session = getSessionById(input.sessionId);
    if (!session) throw new RuntimeSessionNotFoundError(input.sessionId);
    this.cancelIdleCompaction(session.id);
    const childRunsInFlight = this.inFlightBackgroundChildRunCount(session.id);
    const sessionBusy =
      this["busySessions"].has(session.id) ||
      childRunsInFlight > 0 ||
      (this["drainingSessions"].has(session.id) && !isQueueDrainRequest(input));
    if (sessionBusy) {
      if (shouldQueueWhenBusy(input)) {
        let enqueuedDepth = 0;
        let queued = false;
        try {
          const queue = getLaneQueue();
          const enqueued = queue.enqueue(
            session.id,
            input.content,
            input.parts,
            input.agent,
            input.metadata,
          );
          enqueuedDepth = enqueued.depth;
          queued = enqueued.queued;
        } catch {
          // Queue not initialized, fall through
        }
        if (queued) throw new RuntimeSessionQueuedError(session.id, enqueuedDepth);
      }
      throw new RuntimeSessionBusyError(session.id);
    }
    this["busySessions"].add(session.id);

    try {
      await this.ensureRuntimeConfigSynced();
      const model = this.resolveModel(session.model);
      let selectedModel = model;
      let opencodeSessionId = await this.resolveOrCreateOpencodeSession(session.id, session.title);
      const inputParts = this.normalizePromptInputParts(input.content, input.parts);
      const imageInputPresent = inputParts.some(
        (part) => part.type === "file" && part.mime.toLowerCase().startsWith("image/"),
      );
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
      const effectiveAgent =
        requestedAgent ??
        (await this.resolvePrimaryAgentId(undefined, { emitRetryStatus: false }));
      const promptParts = this.applyMemoryPromptToParts(inputParts, promptInput.content);
      const recreatedSessionPromptParts = this.applyMemoryPromptToParts(
        inputParts,
        promptInput.freshSessionContent,
      );

      let promptResult: {
        message: { info: AssistantInfo; parts: Array<Part> };
        opencodeSessionId: string;
      };
      try {
        promptResult = await this.sendPromptWithModelFallback({
          localSessionId: session.id,
          localSessionTitle: session.title,
          opencodeSessionId,
          primaryModel: selectedModel,
          parts: promptParts,
          retryPartsOnSessionRecreate: recreatedSessionPromptParts,
          memoryContextFingerprint: promptInput.memoryContextFingerprint,
          system: undefined,
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
      const assistantError = this.extractAssistantError(
        assistantMessage.info,
        assistantMessage.parts,
      );
      if (assistantError) {
        const normalizedAssistantError =
          this.normalizeProviderMessage(assistantError) || assistantError;
        this.emit(
          createSessionRunErrorEvent(
            { sessionId: session.id, message: normalizedAssistantError },
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
        assistantMessage.info.time?.completed ??
        assistantMessage.info.time?.created ??
        Date.now();
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
          providerId: assistantMessage.info.providerID ?? null,
          modelId: assistantMessage.info.modelID ?? null,
          requestCountDelta: 1,
          inputTokensDelta:
            assistantMessage.info.tokens?.input ??
            Math.max(8, promptInput.content.length * 2),
          outputTokensDelta:
            assistantMessage.info.tokens?.output ??
            Math.max(24, Math.floor(promptInput.content.length * 2.5)),
          estimatedCostUsdDelta: assistantMessage.info.cost ?? 0,
        },
      });
      if (!result) throw new RuntimeSessionNotFoundError(input.sessionId);

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
            { sessionId: result.session.id, message },
            "runtime",
          ),
        );
      }
      this.emit(createSessionStateUpdatedEvent(result.session, "runtime"));
      this.emit(createUsageUpdatedEvent(result.usage, "runtime"));
      this.emit(createHeartbeatUpdatedEvent(result.heartbeat, "runtime"));
      await this.scheduleIdleCompaction(session.id, selectedModel, assistantMessage.info);
      return { sessionId: result.session.id, messages: result.messages };
    } finally {
      try {
        const queue = getLaneQueue();
        if (queue.depth(session.id) > 0 && this.inFlightBackgroundChildRunCount(session.id) === 0) {
          this["drainingSessions"].add(session.id);
          this["busySessions"].delete(session.id);
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
        this["drainingSessions"].delete(session.id);
        this["busySessions"].delete(session.id);
      }
    }
  },

  async spawnBackgroundSession(this: OpencodeRuntime, input) {
    const parentSessionId = input.parentSessionId.trim();
    const parentSession = getSessionById(parentSessionId);
    if (!parentSession) throw new RuntimeSessionNotFoundError(parentSessionId);
    await this.ensureRuntimeConfigSynced();
    const parentOpencodeSessionId = await this.resolveOrCreateOpencodeSession(
      parentSession.id,
      parentSession.title,
    );
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
    if (!run) throw new Error("Failed to create background run record.");
    this.ensureLocalSessionForBackgroundRun(run, created);
    this.emitBackgroundRunUpdated(run);
    return this.backgroundRecordToHandle(run);
  },

  async promptBackgroundAsync(this: OpencodeRuntime, input) {
    const runId = input.runId.trim();
    const content = input.content.trim();
    const inputParts = this.normalizePromptInputParts(content, input.parts);
    if (!runId) throw new Error("runId is required.");
    if (!content && inputParts.length === 0) throw new Error("content or parts is required.");
    const run = getBackgroundRunById(runId);
    if (!run) throw new Error(`Unknown background run: ${runId}`);
    const parentSession = getSessionById(run.parentSessionId);
    if (!parentSession) throw new RuntimeSessionNotFoundError(run.parentSessionId);
    await this.ensureRuntimeConfigSynced();
    const model = this.resolveModel(input.model?.trim() || parentSession.model);
    const requestedAgent = await this.resolveRequestedAgentId(input.agent?.trim());
    const effectiveAgent =
      requestedAgent ??
      (await this.resolvePrimaryAgentId(undefined, { emitRetryStatus: false }));
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
          model: { providerID: model.providerId, modelID: model.modelId },
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
    if (!refreshed) throw new Error(`Background run disappeared after dispatch: ${run.id}`);
    return refreshed;
  },

  async getBackgroundStatus(this: OpencodeRuntime, runId) {
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
      if (refreshed) run = refreshed;
    }
    await this.syncBackgroundSessionMessages(
      run,
      run.status === "completed" || run.status === "failed" || run.status === "aborted",
    );
    return this.backgroundRecordToHandle(run);
  },

  async listBackgroundRuns(this: OpencodeRuntime, input) {
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
  },

  async abortBackground(this: OpencodeRuntime, runId) {
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
      if (getOpencodeErrorStatus(error) === 404) return false;
      throw this.normalizeRuntimeError(error);
    }
  },

  async abortSession(this: OpencodeRuntime, sessionId) {
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
      if (getOpencodeErrorStatus(error) === 404) return false;
      throw this.normalizeRuntimeError(error);
    }
  },

  async compactSession(this: OpencodeRuntime, sessionId) {
    this.cancelIdleCompaction(sessionId);
    const session = getSessionById(sessionId);
    if (!session) throw new RuntimeSessionNotFoundError(sessionId);
    let opencodeSessionId = await this.resolveOrCreateOpencodeSession(session.id, session.title);
    const model = this.resolveModel(session.model);
    try {
      const result = await this.getClient().session.summarize({
        path: { id: opencodeSessionId },
        body: { providerID: model.providerId, modelID: model.modelId },
        responseStyle: "data",
        throwOnError: true,
        signal: this.defaultRequestSignal(),
      });
      this.markMemoryInjectionStateForReinject(opencodeSessionId);
      const compacted = Boolean(unwrapSdkData<boolean>(result));
      if (compacted) {
        await this.syncLocalSessionFromOpencode({
          localSessionId: session.id,
          externalSessionId: opencodeSessionId,
          force: true,
          titleHint: session.title,
        });
      }
      return compacted;
    } catch (error) {
      if (getOpencodeErrorStatus(error) === 404) {
        opencodeSessionId = await this.createOpencodeSession(session.id, session.title);
        const retry = await this.getClient().session.summarize({
          path: { id: opencodeSessionId },
          body: { providerID: model.providerId, modelID: model.modelId },
          responseStyle: "data",
          throwOnError: true,
          signal: this.defaultRequestSignal(),
        });
        this.markMemoryInjectionStateForReinject(opencodeSessionId);
        const compacted = Boolean(unwrapSdkData<boolean>(retry));
        if (compacted) {
          await this.syncLocalSessionFromOpencode({
            localSessionId: session.id,
            externalSessionId: opencodeSessionId,
            force: true,
            titleHint: session.title,
          });
        }
        return compacted;
      }
      throw this.normalizeRuntimeError(error);
    }
  },

  cancelIdleCompaction(this: OpencodeRuntime, sessionId) {
    const currentGeneration = this["idleCompactionGenerationBySessionId"].get(sessionId) ?? 0;
    this["idleCompactionGenerationBySessionId"].set(sessionId, currentGeneration + 1);
    const timer = this["idleCompactionTimerBySessionId"].get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this["idleCompactionTimerBySessionId"].delete(sessionId);
    }
  },

  async scheduleIdleCompaction(this: OpencodeRuntime, sessionId, model, info) {
    this.cancelIdleCompaction(sessionId);
    let shouldArm = false;
    try {
      shouldArm = await this.shouldArmIdleCompaction(model, info);
    } catch (error) {
      logger.warnWithCause("Failed to evaluate idle compaction threshold", error, {
        sessionId,
      });
      return;
    }
    if (!shouldArm) return;
    const runtimeConfig = this.currentRuntimeConfig();
    const delayMs = Math.max(
      0,
      Math.round((runtimeConfig?.compaction.preemptiveIdleMinutes ?? 0) * 60_000),
    );
    const generation = this["idleCompactionGenerationBySessionId"].get(sessionId) ?? 0;
    const timer = setTimeout(() => {
      void (async () => {
        if (this["disposed"]) return;
        if ((this["idleCompactionGenerationBySessionId"].get(sessionId) ?? 0) !== generation) return;
        this["idleCompactionTimerBySessionId"].delete(sessionId);
        if (
          this["busySessions"].has(sessionId) ||
          this["drainingSessions"].has(sessionId) ||
          this.inFlightBackgroundChildRunCount(sessionId) > 0
        ) {
          return;
        }
        try {
          await this.compactSession(sessionId);
        } catch (error) {
          logger.warnWithCause("Idle compaction timer failed", error, {
            sessionId,
          });
        }
      })();
    }, delayMs);
    this["idleCompactionTimerBySessionId"].set(sessionId, timer);
  },

  async shouldArmIdleCompaction(this: OpencodeRuntime, model, info) {
    const runtimeConfig = this.currentRuntimeConfig();
    const thresholdRatio = runtimeConfig?.compaction.preemptiveThresholdRatio ?? 0;
    if (!Number.isFinite(thresholdRatio) || thresholdRatio <= 0) return false;
    const delayMinutes = runtimeConfig?.compaction.preemptiveIdleMinutes ?? 0;
    if (!Number.isFinite(delayMinutes) || delayMinutes < 0) return false;
    const tokens = info.tokens;
    if (!tokens) return false;

    await this.refreshModelMetadataCache();
    const modelLimits = this["modelContextLimitByModelRef"].get(this.formatModelRef(model));
    if (!modelLimits || modelLimits.context <= 0 || modelLimits.output < 0) return false;

    const reserved = Math.min(20_000, modelLimits.output);
    const usableBudget = modelLimits.context - reserved;
    if (usableBudget <= 0) return false;

    const cacheRead = tokens.cache?.read ?? 0;
    const cacheWrite = tokens.cache?.write ?? 0;
    const effectiveTokens = tokens.input + tokens.output + cacheRead + cacheWrite;
    return effectiveTokens >= usableBudget * thresholdRatio;
  },

  async refreshModelMetadataCache(this: OpencodeRuntime, force = false) {
    const now = Date.now();
    if (!force && now - this["imageCapabilityFetchedAtMs"] <= 60_000 && this["imageCapabilityByModelRef"].size > 0) {
      return;
    }
    const payload = unwrapSdkData<Record<string, unknown>>(
      await this.getClient().config.providers({
        responseStyle: "data",
        throwOnError: true,
        signal: this.defaultRequestSignal(),
      }),
    );
    const imageMap = new Map<string, boolean>();
    const contextLimitMap = new Map<string, { context: number; output: number }>();
    const providers = Array.isArray(payload.providers) ? payload.providers : [];
    for (const provider of providers) {
      if (!provider || typeof provider !== "object" || Array.isArray(provider)) continue;
      const providerRecord = provider as Record<string, unknown>;
      const providerId =
        typeof providerRecord.id === "string" ? providerRecord.id.trim() : "";
      if (!providerId) continue;
      const models =
        providerRecord.models &&
        typeof providerRecord.models === "object" &&
        !Array.isArray(providerRecord.models)
          ? (providerRecord.models as Record<string, Record<string, unknown>>)
          : {};
      for (const [modelKey, modelInfo] of Object.entries(models)) {
        const modelIdRaw = typeof modelInfo.id === "string" ? modelInfo.id : modelKey;
        const modelId = modelIdRaw.trim();
        if (!modelId) continue;
        const modelRef = `${providerId}/${modelId}`;
        const capabilities =
          modelInfo.capabilities &&
          typeof modelInfo.capabilities === "object" &&
          !Array.isArray(modelInfo.capabilities)
            ? (modelInfo.capabilities as Record<string, unknown>)
            : {};
        const input =
          capabilities.input &&
          typeof capabilities.input === "object" &&
          !Array.isArray(capabilities.input)
            ? (capabilities.input as Record<string, unknown>)
            : {};
        imageMap.set(modelRef, input.image === true);

        const limit =
          modelInfo.limit &&
          typeof modelInfo.limit === "object" &&
          !Array.isArray(modelInfo.limit)
            ? (modelInfo.limit as Record<string, unknown>)
            : {};
        const context = typeof limit.context === "number" && Number.isFinite(limit.context) ? limit.context : 0;
        const output = typeof limit.output === "number" && Number.isFinite(limit.output) ? limit.output : 0;
        contextLimitMap.set(modelRef, { context, output });
      }
    }
    this["imageCapabilityByModelRef"] = imageMap;
    this["modelContextLimitByModelRef"] = contextLimitMap;
    this["imageCapabilityFetchedAtMs"] = now;
  },

  async modelSupportsImageInput(this: OpencodeRuntime, model) {
    const modelRef = this.formatModelRef(model);
    try {
      await this.refreshModelMetadataCache();
    } catch {
      return false;
    }
    return this["imageCapabilityByModelRef"].get(modelRef) === true;
  },

  currentImageModel(this: OpencodeRuntime) {
    const runtimeConfig = this.currentRuntimeConfig();
    const explicit = runtimeConfig?.imageModel?.trim();
    if (explicit) return explicit;
    return runtimeConfig?.fallbackModels.find((model: string) => model.trim())?.trim() || this.currentSmallModel();
  },

  emit(this: OpencodeRuntime, event) {
    if (this["disposed"]) return;
    for (const listener of this["listeners"]) {
      listener(event);
    }
  },
};
