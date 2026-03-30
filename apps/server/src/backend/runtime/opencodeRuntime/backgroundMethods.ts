import { persistCompactionMemoryCandidates } from "./compactionMemory";
import {
  BACKGROUND_MESSAGE_SYNC_MIN_INTERVAL_MS,
  BACKGROUND_SYNC_BATCH_LIMIT,
  OPENCODE_RUNTIME_ID,
  SESSION_SYNC_MESSAGE_LIMIT,
  logger,
  normalizeCostDelta,
  normalizeUsageDelta,
  type AssistantInfo,
  type BackgroundRunHandle,
  type BackgroundRunStatus,
  type Message,
  type OpencodeSessionStatus,
  type Part,
  type Session,
} from "./shared";
import {
  createBackgroundRunUpdatedEvent,
  createHeartbeatUpdatedEvent,
  createSessionMessageCreatedEvent,
  createSessionStateUpdatedEvent,
  createUsageUpdatedEvent,
} from "../../contracts/events";
import {
  appendAssistantMessage,
  createBackgroundRun,
  ensureSessionForRuntimeBinding,
  getBackgroundRunByChildExternalSessionId,
  getBackgroundRunById,
  getLocalSessionIdByRuntimeBinding,
  getRuntimeSessionBinding,
  getSessionById,
  getUsageSnapshot,
  listBackgroundRunsForParentSession,
  listBackgroundRunsPendingAnnouncement,
  listInFlightBackgroundRuns,
  listRuntimeSessionBindings,
  recordUsageDelta,
  setBackgroundRunStatus,
  setRuntimeSessionBinding,
  setSessionTitle,
  upsertSessionMessages,
  type BackgroundRunRecord,
} from "../../db/repository";
import { unwrapSdkData } from "../../opencode/client";
import { getLaneQueue } from "../../queue/service";
import type { OpencodeRuntime } from "../opencodeRuntime";

export interface OpencodeRuntimeBackgroundMethods {
  syncBackgroundRuns(): Promise<void>;
  reconcileBackgroundChildrenFromParents(): Promise<void>;
  refreshInFlightBackgroundRuns(): Promise<void>;
  processPendingBackgroundAnnouncements(): Promise<void>;
  backgroundRecordToHandle(run: BackgroundRunRecord): BackgroundRunHandle;
  backgroundRecordFingerprint(run: BackgroundRunRecord): string;
  emitBackgroundRunUpdated(run: BackgroundRunRecord, force?: boolean): void;
  ensureLocalSessionForBackgroundRun(
    run: BackgroundRunRecord,
    sessionInfo?: Session,
  ): string | null;
  mapOpencodeMessageContent(info: Message, parts: Array<Part>): string;
  syncLocalSessionFromOpencode(input: {
    localSessionId: string;
    externalSessionId: string;
    force?: boolean;
    titleHint?: string;
    messages?: Array<{ info: Message; parts: Array<Part> }>;
  }): Promise<void>;
  syncMessageById(input: {
    localSessionId: string;
    externalSessionId: string;
    messageId: string;
    titleHint?: string;
  }): Promise<void>;
  syncBackgroundSessionMessages(
    run: BackgroundRunRecord,
    force?: boolean,
    messages?: Array<{ info: Message; parts: Array<Part> }>,
  ): Promise<void>;
  ensureBackgroundRunForSessionInfo(
    sessionInfo: Session,
    status?: BackgroundRunStatus,
    knownParentSessionId?: string,
  ): BackgroundRunRecord | null;
  hydrateBackgroundRunFromSessionId(
    childExternalSessionId: string,
    status?: OpencodeSessionStatus,
  ): Promise<BackgroundRunRecord | null>;
  announceBackgroundRunIfNeeded(runId: string): Promise<boolean>;
  applyBackgroundStatusBySessionId(
    opencodeSessionId: string,
    status: OpencodeSessionStatus,
  ): void;
  applyOpencodeBackgroundStatus(
    run: BackgroundRunRecord,
    status: OpencodeSessionStatus,
  ): BackgroundRunRecord;
  inFlightBackgroundChildRunCount(parentSessionId: string): number;
  maybeDrainSessionQueue(sessionId: string): Promise<void>;
  markBackgroundRunFailed(opencodeSessionId: string, message: string): void;
}

export const opencodeRuntimeBackgroundMethods: OpencodeRuntimeBackgroundMethods =
  {
    async syncBackgroundRuns(this: OpencodeRuntime) {
      if (this["backgroundSyncInFlight"]) {
        await this["backgroundSyncInFlight"];
        return;
      }
      const task = (async () => {
        try {
          await this.reconcileBackgroundChildrenFromParents();
          await this.refreshInFlightBackgroundRuns();
          await this.processPendingBackgroundAnnouncements();
        } catch (error) {
          logger.warnWithCause("Background sync failed", error);
        }
      })();
      this["backgroundSyncInFlight"] = task;
      try {
        await task;
      } finally {
        this["backgroundSyncInFlight"] = null;
      }
    },

    async reconcileBackgroundChildrenFromParents(this: OpencodeRuntime) {
      const bindings = listRuntimeSessionBindings(
        OPENCODE_RUNTIME_ID,
        BACKGROUND_SYNC_BATCH_LIMIT,
      );
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
            this.ensureBackgroundRunForSessionInfo(
              child,
              "created",
              binding.sessionId,
            );
          }
        } catch (error) {
          logger.warnWithCause(
            "Background child reconciliation failed",
            error,
            {
              externalSessionId: binding.externalSessionId,
              sessionId: binding.sessionId,
            },
          );
        }
      }
    },

    async refreshInFlightBackgroundRuns(this: OpencodeRuntime) {
      const runs = listInFlightBackgroundRuns(
        OPENCODE_RUNTIME_ID,
        BACKGROUND_SYNC_BATCH_LIMIT,
      );
      for (const run of runs) {
        await this.getBackgroundStatus(run.id);
      }
    },

    async processPendingBackgroundAnnouncements(this: OpencodeRuntime) {
      const pending = listBackgroundRunsPendingAnnouncement(
        OPENCODE_RUNTIME_ID,
        BACKGROUND_SYNC_BATCH_LIMIT,
      );
      for (const run of pending) {
        await this.announceBackgroundRunIfNeeded(run.id);
      }
    },

    backgroundRecordToHandle(this: OpencodeRuntime, run: BackgroundRunRecord) {
      const childSessionId = getLocalSessionIdByRuntimeBinding(
        OPENCODE_RUNTIME_ID,
        run.childExternalSessionId,
      );
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
    },

    backgroundRecordFingerprint(
      this: OpencodeRuntime,
      run: BackgroundRunRecord,
    ) {
      const childSessionId =
        getLocalSessionIdByRuntimeBinding(
          OPENCODE_RUNTIME_ID,
          run.childExternalSessionId,
        ) ?? "";
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
    },

    emitBackgroundRunUpdated(this: OpencodeRuntime, run, force = false) {
      const nextFingerprint = this.backgroundRecordFingerprint(run);
      const previous = this["backgroundLastEmitByRunId"].get(run.id);
      if (!force && previous === nextFingerprint) return;
      this["backgroundLastEmitByRunId"].set(run.id, nextFingerprint);
      this.emit(
        createBackgroundRunUpdatedEvent(
          {
            runId: run.id,
            parentSessionId: run.parentSessionId,
            parentExternalSessionId: run.parentExternalSessionId,
            childExternalSessionId: run.childExternalSessionId,
            childSessionId: getLocalSessionIdByRuntimeBinding(
              OPENCODE_RUNTIME_ID,
              run.childExternalSessionId,
            ),
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
      if (
        run.status === "completed" ||
        run.status === "failed" ||
        run.status === "aborted"
      ) {
        this["backgroundLastEmitByRunId"].delete(run.id);
        this["backgroundMessageSyncAtByChildSessionId"].delete(
          run.childExternalSessionId,
        );
      }
    },

    ensureLocalSessionForBackgroundRun(
      this: OpencodeRuntime,
      run,
      sessionInfo,
    ) {
      const existingSessionId = getLocalSessionIdByRuntimeBinding(
        OPENCODE_RUNTIME_ID,
        run.childExternalSessionId,
      );
      const existingSession = existingSessionId
        ? getSessionById(existingSessionId)
        : null;
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
      if (
        !existingSession ||
        existingSession.title !== ensured.title ||
        existingSession.model !== ensured.model
      ) {
        this.emit(createSessionStateUpdatedEvent(ensured, "runtime"));
      }
      return ensured.id;
    },

    mapOpencodeMessageContent(this: OpencodeRuntime, info, parts) {
      const text = this.extractText(parts);
      if (text && text.trim()) return text;
      if (info.role === "assistant") {
        const reasoningText = this.extractReasoningText(parts);
        if (reasoningText) return reasoningText;
        const toolOutputText = this.extractCompletedToolOutputText(parts);
        if (toolOutputText) return toolOutputText;
      }
      if (info.role === "user") {
        const subtaskPrompt = this.extractSubtaskPrompt(parts);
        if (subtaskPrompt) return subtaskPrompt;
      }
      if (info.role === "assistant") {
        const failure = this.extractAssistantError(
          info as AssistantInfo,
          parts,
        );
        if (failure) return `[assistant error] ${failure}`;
      }
      return "";
    },

    async syncLocalSessionFromOpencode(this: OpencodeRuntime, input) {
      const localSessionId = input.localSessionId.trim();
      const externalSessionId = input.externalSessionId.trim();
      if (!localSessionId || !externalSessionId) return;
      const existingSession = getSessionById(localSessionId);
      if (!existingSession) return;
      if (
        getRuntimeSessionBinding(OPENCODE_RUNTIME_ID, localSessionId) !==
        externalSessionId
      ) {
        setRuntimeSessionBinding(
          OPENCODE_RUNTIME_ID,
          localSessionId,
          externalSessionId,
        );
      }
      const now = Date.now();
      if (!input.force) {
        const lastSyncedAt =
          this["backgroundMessageSyncAtByChildSessionId"].get(
            externalSessionId,
          ) ?? 0;
        if (now - lastSyncedAt < BACKGROUND_MESSAGE_SYNC_MIN_INTERVAL_MS)
          return;
      }
      this["backgroundMessageSyncAtByChildSessionId"].set(
        externalSessionId,
        now,
      );
      const normalizedTitle = input.titleHint?.trim();
      if (normalizedTitle && normalizedTitle !== existingSession.title) {
        const updatedTitle = setSessionTitle(localSessionId, normalizedTitle);
        if (updatedTitle)
          this.emit(createSessionStateUpdatedEvent(updatedTitle, "runtime"));
      }
      let messages = input.messages;
      if (!messages) {
        messages = unwrapSdkData<Array<{ info: Message; parts: Array<Part> }>>(
          await this.getClient().session.messages({
            path: { id: externalSessionId },
            query: { limit: SESSION_SYNC_MESSAGE_LIMIT },
            responseStyle: "data",
            throwOnError: true,
            signal: this.defaultRequestSignal(),
          }),
        );
      }
      for (const entry of messages) {
        this.rememberMessageRole(
          externalSessionId,
          entry.info.id,
          entry.info.role,
        );
        for (const part of entry.parts) {
          this.rememberPartMetadata(part);
        }
      }
      const imported = messages.flatMap((entry) => {
        const content = this.mapOpencodeMessageContent(
          entry.info,
          entry.parts,
        ).trim();
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
      const entriesById = new Map(
        messages.map((entry) => [entry.info.id, entry] as const),
      );
      for (const message of synced.inserted) {
        if (message.role !== "assistant") continue;
        const entry = entriesById.get(message.id);
        if (!entry || entry.info.role !== "assistant") continue;
        recordUsageDelta({
          id: `assistant-message:${entry.info.id}`,
          sessionId: localSessionId,
          providerId: entry.info.providerID ?? null,
          modelId: entry.info.modelID ?? null,
          requestCountDelta: 1,
          inputTokensDelta: normalizeUsageDelta(entry.info.tokens?.input),
          outputTokensDelta: normalizeUsageDelta(entry.info.tokens?.output),
          estimatedCostUsdDelta: normalizeCostDelta(entry.info.cost),
          source: "runtime",
          createdAt:
            entry.info.time?.completed ?? entry.info.time?.created ?? now,
        });
      }
      if (synced.inserted.length === 0) return;
      for (const message of synced.inserted) {
        const entry = entriesById.get(message.id);
        if (
          message.role === "assistant" &&
          entry?.info.role === "assistant" &&
          entry.info.summary === true
        ) {
          const scopedMessageId = this.scopedMessageId(externalSessionId, message.id);
          if (!this["processedCompactionMessageIds"].has(scopedMessageId)) {
            this.setBoundedMapEntry(
              this["processedCompactionMessageIds"],
              scopedMessageId,
              true,
            );
            try {
              await persistCompactionMemoryCandidates({
                summary: message.content,
                sessionId: localSessionId,
              });
            } catch (error) {
              logger.warnWithCause("Failed to process compaction memory candidates", error, {
                sessionId: localSessionId,
                messageId: message.id,
              });
            }
          }
        }
        this.emit(
          createSessionMessageCreatedEvent(
            { sessionId: localSessionId, message },
            "runtime",
          ),
        );
      }
      this.emit(createSessionStateUpdatedEvent(synced.session, "runtime"));
      this.emit(createUsageUpdatedEvent(getUsageSnapshot(), "runtime"));
    },

    async syncMessageById(this: OpencodeRuntime, input) {
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
      } catch (error) {
        logger.warnWithCause("Message reconciliation failed", error, input);
      }
    },

    async syncBackgroundSessionMessages(
      this: OpencodeRuntime,
      run,
      force = false,
      messages,
    ) {
      const childSessionId = this.ensureLocalSessionForBackgroundRun(run);
      if (!childSessionId) return;
      try {
        await this.syncLocalSessionFromOpencode({
          localSessionId: childSessionId,
          externalSessionId: run.childExternalSessionId,
          force,
          messages,
        });
      } catch (error) {
        logger.warnWithCause("Background transcript sync failed", error, {
          runId: run.id,
          childExternalSessionId: run.childExternalSessionId,
        });
      }
    },

    ensureBackgroundRunForSessionInfo(
      this: OpencodeRuntime,
      sessionInfo,
      status = "created",
      knownParentSessionId,
    ) {
      const childExternalSessionId = sessionInfo.id.trim();
      const parentExternalSessionId = sessionInfo.parentID?.trim();
      if (!childExternalSessionId || !parentExternalSessionId) return null;
      const parentSessionId =
        knownParentSessionId?.trim() ||
        getLocalSessionIdByRuntimeBinding(
          OPENCODE_RUNTIME_ID,
          parentExternalSessionId,
        );
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
    },

    async hydrateBackgroundRunFromSessionId(
      this: OpencodeRuntime,
      childExternalSessionId,
      status,
    ) {
      const normalizedChildExternalSessionId = childExternalSessionId.trim();
      if (!normalizedChildExternalSessionId) return null;
      if (
        this["backgroundHydrationInFlight"].has(
          normalizedChildExternalSessionId,
        )
      )
        return null;
      this["backgroundHydrationInFlight"].add(normalizedChildExternalSessionId);
      try {
        const sessionInfo = unwrapSdkData<Session>(
          await this.getClient().session.get({
            path: { id: normalizedChildExternalSessionId },
            responseStyle: "data",
            throwOnError: true,
            signal: this.defaultRequestSignal(),
          }),
        );
        const run = this.ensureBackgroundRunForSessionInfo(
          sessionInfo,
          "created",
        );
        if (run && status) {
          return this.applyOpencodeBackgroundStatus(run, status);
        }
        return run;
      } catch (error) {
        logger.warnWithCause("Background run hydration failed", error, {
          childExternalSessionId: normalizedChildExternalSessionId,
        });
        return null;
      } finally {
        this["backgroundHydrationInFlight"].delete(
          normalizedChildExternalSessionId,
        );
      }
    },

    async announceBackgroundRunIfNeeded(this: OpencodeRuntime, runId) {
      const normalizedRunId = runId.trim();
      if (!normalizedRunId) return false;
      if (this["backgroundAnnouncementInFlight"].has(normalizedRunId))
        return false;
      const current = getBackgroundRunById(normalizedRunId);
      if (!current || current.status !== "completed") return false;
      if (current.resultSummary && current.resultSummary.trim()) return false;
      this["backgroundAnnouncementInFlight"].add(normalizedRunId);
      try {
        const latest = getBackgroundRunById(normalizedRunId);
        if (!latest || latest.status !== "completed") return false;
        if (latest.resultSummary && latest.resultSummary.trim()) return false;
        const messages = unwrapSdkData<
          Array<{ info: Message; parts: Array<Part> }>
        >(
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
          ? this.mapOpencodeMessageContent(
              latestAssistant.info,
              latestAssistant.parts,
            ).trim()
          : "";
        const resultSummary = this.summarizeBackgroundResult(assistantText);
        const childSessionId = getLocalSessionIdByRuntimeBinding(
          OPENCODE_RUNTIME_ID,
          latest.childExternalSessionId,
        );
        const summaryLine =
          resultSummary && resultSummary !== "Background run completed."
            ? resultSummary
            : "run completed.";
        const announcementText = `[Background ${latest.id}] ${summaryLine}\nChild session: ${childSessionId ?? latest.childExternalSessionId}`;
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
        if (updated) this.emitBackgroundRunUpdated(updated);
        this.emit(
          createSessionMessageCreatedEvent(
            { sessionId: appended.session.id, message: appended.message },
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
        if (failed) this.emitBackgroundRunUpdated(failed);
        return false;
      } finally {
        this["backgroundAnnouncementInFlight"].delete(normalizedRunId);
      }
    },

    applyBackgroundStatusBySessionId(
      this: OpencodeRuntime,
      opencodeSessionId,
      status,
    ) {
      const run = getBackgroundRunByChildExternalSessionId(
        OPENCODE_RUNTIME_ID,
        opencodeSessionId,
      );
      if (run) {
        this.applyOpencodeBackgroundStatus(run, status);
        return;
      }
      void this.hydrateBackgroundRunFromSessionId(opencodeSessionId, status);
    },

    applyOpencodeBackgroundStatus(this: OpencodeRuntime, run, status) {
      if (run.status === "aborted" || run.status === "failed") return run;
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
      if (
        !nextStatus ||
        (nextStatus === run.status &&
          typeof completedAt === "undefined" &&
          typeof error === "undefined")
      ) {
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
    },

    inFlightBackgroundChildRunCount(
      this: OpencodeRuntime,
      parentSessionId: string,
    ) {
      const runs = listBackgroundRunsForParentSession(parentSessionId, 200);
      return runs.filter(
        (run) =>
          run.status === "created" ||
          run.status === "running" ||
          run.status === "retrying" ||
          run.status === "idle",
      ).length;
    },

    async maybeDrainSessionQueue(this: OpencodeRuntime, sessionId) {
      if (this["busySessions"].has(sessionId)) return;
      if (this["drainingSessions"].has(sessionId)) return;
      if (this.inFlightBackgroundChildRunCount(sessionId) > 0) return;
      try {
        const queue = getLaneQueue();
        if (queue.depth(sessionId) === 0) return;
        this["drainingSessions"].add(sessionId);
        while (queue.depth(sessionId) > 0) {
          await queue.drainAndExecute(sessionId);
        }
      } catch (error) {
        logger.warnWithCause("Queue drain failed", error, { sessionId });
      } finally {
        this["drainingSessions"].delete(sessionId);
      }
    },

    markBackgroundRunFailed(this: OpencodeRuntime, opencodeSessionId, message) {
      const run = getBackgroundRunByChildExternalSessionId(
        OPENCODE_RUNTIME_ID,
        opencodeSessionId,
      );
      if (!run) {
        void this.hydrateBackgroundRunFromSessionId(opencodeSessionId);
        return;
      }
      if (run.status === "aborted" || run.status === "completed") return;
      const updated = setBackgroundRunStatus({
        runId: run.id,
        status: "failed",
        completedAt: Date.now(),
        error: message,
      });
      if (updated) this.emitBackgroundRunUpdated(updated);
    },
  };
