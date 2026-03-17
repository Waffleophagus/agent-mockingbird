/* eslint-disable import/order, @typescript-eslint/no-unused-vars */
import {
  createBackgroundRunUpdatedEvent,
  createSessionCompactedEvent,
  createSessionMessageCodeHighlightEvent,
  createSessionMessageDeltaEvent,
  createSessionMessagePartUpdatedEvent,
  createSessionMessageRenderSnapshotEvent,
  createSessionPermissionRequestedEvent,
  createSessionPermissionResolvedEvent,
  createSessionQuestionRequestedEvent,
  createSessionQuestionResolvedEvent,
  createSessionRunErrorEvent,
  createSessionRunStatusUpdatedEvent,
  createSessionStateUpdatedEvent,
} from "../../contracts/events";
import { getLocalSessionIdByRuntimeBinding, getSessionById, setSessionTitle } from "../../db/repository";
import { buildStreamdownCodeLineHighlights, buildStreamdownRenderSnapshot } from "../../render/streamdownSnapshots";
import type { OpencodeRuntime } from "../opencodeRuntime";
import {
  BACKGROUND_SYNC_INTERVAL_MS,
  OPENCODE_RUNTIME_ID,
  STREAMDOWN_LIVE_HIGHLIGHT_DEBOUNCE_MS,
  STREAMDOWN_RENDER_DEBOUNCE_MS,
  STREAMED_METADATA_CACHE_LIMIT,
  logger,
  type Message,
  type OpencodeEvent,
  type OpencodeMessagePartDeltaEvent,
  type OpencodeMessagePartUpdatedEvent,
  type OpencodeMessageUpdatedEvent,
  type OpencodePermissionAskedEvent,
  type OpencodePermissionRepliedEvent,
  type OpencodeQuestionAskedEvent,
  type OpencodeQuestionRejectedEvent,
  type OpencodeQuestionRepliedEvent,
  type OpencodeRuntimeEvent,
  type Part,
} from "./shared";

export interface OpencodeRuntimeEventMethods {
  startEventSync(): void;
  startBackgroundSync(): void;
  runBackgroundSyncLoop(): Promise<void>;
  runEventSyncLoop(): Promise<void>;
  handleOpencodeEvent(event: unknown): void;
  handleMessagePartUpdatedEvent(event: OpencodeMessagePartUpdatedEvent): void;
  handleMessagePartDeltaEvent(event: OpencodeMessagePartDeltaEvent): void;
  handleMessageUpdatedEvent(event: OpencodeMessageUpdatedEvent): void;
  handleSessionCreatedEvent(event: Extract<OpencodeEvent, { type: "session.created" }>): void;
  handleSessionUpdatedEvent(event: Extract<OpencodeEvent, { type: "session.updated" }>): void;
  handleSessionStatusEvent(event: Extract<OpencodeEvent, { type: "session.status" }>): void;
  handleSessionIdleEvent(event: Extract<OpencodeEvent, { type: "session.idle" }>): void;
  handleSessionCompactedEvent(event: Extract<OpencodeEvent, { type: "session.compacted" }>): void;
  handleSessionErrorEvent(event: Extract<OpencodeEvent, { type: "session.error" }>): void;
  handlePermissionAskedEvent(event: OpencodePermissionAskedEvent): void;
  handlePermissionRepliedEvent(event: OpencodePermissionRepliedEvent): void;
  handleQuestionAskedEvent(event: OpencodeQuestionAskedEvent): void;
  handleQuestionResolvedEvent(
    event: OpencodeQuestionRepliedEvent | OpencodeQuestionRejectedEvent,
    outcome: "replied" | "rejected",
  ): void;
  isOpencodeEvent(event: unknown): event is OpencodeRuntimeEvent;
  scopedMessageId(sessionId: string, messageId: string): string;
  scopedPartId(sessionId: string, messageId: string, partId: string): string;
  isAssistantOnlyPartType(partType: Part["type"]): boolean;
  setBoundedMapEntry<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void;
  rememberMessageRole(sessionId: string, messageId: string, role: Message["role"]): void;
  rememberStreamedAssistantContent(sessionId: string, messageId: string, content: string): void;
  updateStreamedAssistantContent(
    sessionId: string,
    messageId: string,
    text: string,
    mode: "append" | "replace",
  ): void;
  rememberEmittedCodeHighlightLine(
    sessionId: string,
    messageId: string,
    lineKey: string,
    lineText: string,
  ): void;
  emitCodeHighlightLines(sessionId: string, messageId: string, content: string): Promise<void>;
  scheduleLiveCodeHighlightEmit(sessionId: string, messageId: string, content: string): void;
  scheduleRenderSnapshotEmit(sessionId: string, messageId: string, content: string): void;
  emitRenderSnapshot(sessionId: string, messageId: string, content: string): Promise<void>;
  rememberPartMetadata(part: Part): void;
}

export const opencodeRuntimeEventMethods: OpencodeRuntimeEventMethods = {
  startEventSync(this: OpencodeRuntime) {
    if (this["eventSyncStarted"] || this["disposed"]) return;
    this["eventSyncStarted"] = true;
    void this.runEventSyncLoop().catch((error) => logger.errorWithCause("Event sync loop crashed", error));
  },

  startBackgroundSync(this: OpencodeRuntime) {
    if (this["backgroundSyncStarted"] || this["disposed"]) return;
    this["backgroundSyncStarted"] = true;
    void this.runBackgroundSyncLoop().catch((error) => {
      logger.errorWithCause("Background sync loop crashed", error);
    });
  },

  async runBackgroundSyncLoop(this: OpencodeRuntime) {
    while (!this["disposed"]) {
      await this.syncBackgroundRuns();
      await this.waitFor(BACKGROUND_SYNC_INTERVAL_MS);
    }
  },

  async runEventSyncLoop(this: OpencodeRuntime) {
    while (!this["disposed"]) {
      try {
        const subscription = await this.getClient().event.subscribe({
          responseStyle: "data",
          throwOnError: true,
          signal: this["disposeController"].signal,
        });
        for await (const event of subscription.stream) {
          if (this["disposed"]) return;
          this.handleOpencodeEvent(event);
        }
      } catch (error) {
        if (this["disposed"]) return;
        logger.warnWithCause("Event stream sync failed", error);
      }
      await this.waitFor(1_000);
    }
  },

  handleOpencodeEvent(this: OpencodeRuntime, event) {
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
      case "permission.asked":
        this.handlePermissionAskedEvent(event);
        return;
      case "permission.replied":
        this.handlePermissionRepliedEvent(event);
        return;
      case "question.asked":
        this.handleQuestionAskedEvent(event);
        return;
      case "question.replied":
        this.handleQuestionResolvedEvent(event, "replied");
        return;
      case "question.rejected":
        this.handleQuestionResolvedEvent(event, "rejected");
        return;
      default:
        return;
    }
  },

  handleMessagePartUpdatedEvent(this: OpencodeRuntime, event) {
    const sessionId = event.properties.part.sessionID.trim();
    if (!sessionId) return;
    this.rememberPartMetadata(event.properties.part);
    const messageRole = this["messageRoleByScopedMessageId"].get(
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
        if (event.properties.part.type !== "tool") return "update" as const;
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
    if (event.properties.part.type !== "text" && event.properties.part.type !== "reasoning") {
      return;
    }
    if (deltaFromPartUpdate.length > 0) {
      this.updateStreamedAssistantContent(localSessionId, event.properties.part.messageID, deltaFromPartUpdate, "append");
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
      this.updateStreamedAssistantContent(localSessionId, event.properties.part.messageID, event.properties.part.text, "replace");
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
  },

  handleMessagePartDeltaEvent(this: OpencodeRuntime, event) {
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
    const partType = this["partTypeByScopedPartId"].get(this.scopedPartId(sessionId, messageId, partId));
    if (partType && partType !== "text" && partType !== "reasoning") return;
    const messageRole = this["messageRoleByScopedMessageId"].get(this.scopedMessageId(sessionId, messageId));
    const canTreatAsAssistant = messageRole === "assistant" || (messageRole !== "user" && partType === "reasoning");
    if (!canTreatAsAssistant) return;
    this.updateStreamedAssistantContent(localSessionId, messageId, delta, "append");
    this.emit(
      createSessionMessageDeltaEvent(
        { sessionId: localSessionId, messageId, text: delta, mode: "append", observedAt: new Date().toISOString() },
        "runtime",
      ),
    );
  },

  handleMessageUpdatedEvent(this: OpencodeRuntime, event) {
    this.rememberMessageRole(event.properties.info.sessionID, event.properties.info.id, event.properties.info.role);
    if (event.properties.info.role !== "assistant") return;
    const opencodeSessionId = event.properties.info.sessionID.trim();
    if (!opencodeSessionId) return;
    const localSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, opencodeSessionId);
    if (!localSessionId || this["busySessions"].has(localSessionId)) return;
    void this.syncMessageById({
      localSessionId,
      externalSessionId: opencodeSessionId,
      messageId: event.properties.info.id,
    });
  },

  handleSessionCreatedEvent(this: OpencodeRuntime, event) {
    this.ensureBackgroundRunForSessionInfo(event.properties.info, "created");
  },

  handleSessionUpdatedEvent(this: OpencodeRuntime, event) {
    this.ensureBackgroundRunForSessionInfo(event.properties.info, "created");
    const opencodeSessionId = event.properties.info.id.trim();
    const remoteTitle = event.properties.info.title.trim();
    if (!opencodeSessionId || !remoteTitle) return;
    const localSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, opencodeSessionId);
    if (!localSessionId || localSessionId === "main") return;
    const localSession = getSessionById(localSessionId);
    if (!localSession || localSession.title === remoteTitle) return;
    const updated = setSessionTitle(localSessionId, remoteTitle);
    if (updated) this.emit(createSessionStateUpdatedEvent(updated, "runtime"));
  },

  handleSessionStatusEvent(this: OpencodeRuntime, event) {
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
  },

  handleSessionIdleEvent(this: OpencodeRuntime, event) {
    const opencodeSessionId = event.properties.sessionID;
    this.applyBackgroundStatusBySessionId(opencodeSessionId, { type: "idle" });
    const localSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, opencodeSessionId);
    if (!localSessionId) return;
    this.emit(createSessionRunStatusUpdatedEvent({ sessionId: localSessionId, status: "idle" }, "runtime"));
    void this.syncLocalSessionFromOpencode({
      localSessionId,
      externalSessionId: opencodeSessionId,
      force: true,
    });
    void this.maybeDrainSessionQueue(localSessionId);
  },

  handleSessionCompactedEvent(this: OpencodeRuntime, event) {
    const opencodeSessionId = event.properties.sessionID;
    this.markMemoryInjectionStateForReinject(opencodeSessionId);
    const localSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, opencodeSessionId);
    if (!localSessionId) return;
    this.emit(createSessionCompactedEvent({ sessionId: localSessionId }, "runtime"));
  },

  handleSessionErrorEvent(this: OpencodeRuntime, event) {
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
      this.emit(createSessionRunStatusUpdatedEvent({ sessionId: localSessionId, status: "busy" }, "runtime"));
      return;
    }
    this.emit(
      createSessionRunErrorEvent(
        { sessionId: localSessionId, name: normalized.name, message: normalized.message },
        "runtime",
      ),
    );
  },

  handlePermissionAskedEvent(this: OpencodeRuntime, event) {
    const externalSessionId = event.properties.sessionID.trim();
    if (!externalSessionId) return;
    const localSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, externalSessionId);
    if (!localSessionId) return;
    this.emit(
      createSessionPermissionRequestedEvent(
        {
          id: event.properties.id,
          sessionId: localSessionId,
          permission: event.properties.permission,
          patterns: Array.isArray(event.properties.patterns) ? event.properties.patterns : [],
          metadata:
            event.properties.metadata && typeof event.properties.metadata === "object"
              ? event.properties.metadata
              : {},
          always: Array.isArray(event.properties.always) ? event.properties.always : [],
        },
        "runtime",
      ),
    );
  },

  handlePermissionRepliedEvent(this: OpencodeRuntime, event) {
    const externalSessionId = event.properties.sessionID.trim();
    if (!externalSessionId) return;
    const localSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, externalSessionId);
    if (!localSessionId) return;
    const requestId = event.properties.requestID ?? event.properties.permissionID ?? "";
    if (!requestId.trim()) return;
    const rawReply = (event.properties.reply ?? event.properties.response ?? "").trim();
    const reply =
      rawReply === "once" || rawReply === "always" || rawReply === "reject"
        ? rawReply
        : "once";
    this.emit(
      createSessionPermissionResolvedEvent(
        { sessionId: localSessionId, requestId, reply },
        "runtime",
      ),
    );
  },

  handleQuestionAskedEvent(this: OpencodeRuntime, event) {
    const externalSessionId = event.properties.sessionID.trim();
    if (!externalSessionId) return;
    const localSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, externalSessionId);
    if (!localSessionId) return;
    const questions = Array.isArray(event.properties.questions) ? event.properties.questions : [];
    this.emit(
      createSessionQuestionRequestedEvent(
        {
          id: event.properties.id,
          sessionId: localSessionId,
          questions: questions.map((question) => ({
            question: question.question,
            header: question.header,
            options: Array.isArray(question.options)
              ? question.options.map((option) => ({
                  label: option.label,
                  description: option.description,
                }))
              : [],
            multiple: question.multiple === true ? true : undefined,
            custom: question.custom === false ? false : true,
          })),
        },
        "runtime",
      ),
    );
  },

  handleQuestionResolvedEvent(this: OpencodeRuntime, event, outcome) {
    const externalSessionId = event.properties.sessionID.trim();
    if (!externalSessionId) return;
    const localSessionId = getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, externalSessionId);
    if (!localSessionId) return;
    this.emit(
      createSessionQuestionResolvedEvent(
        { sessionId: localSessionId, requestId: event.properties.requestID, outcome },
        "runtime",
      ),
    );
  },

  isOpencodeEvent(this: OpencodeRuntime, event: unknown): event is OpencodeRuntimeEvent {
    if (!event || typeof event !== "object") return false;
    return typeof (event as { type?: unknown }).type === "string";
  },

  scopedMessageId(this: OpencodeRuntime, sessionId: string, messageId: string) {
    return `${sessionId}:${messageId}`;
  },

  scopedPartId(this: OpencodeRuntime, sessionId: string, messageId: string, partId: string) {
    return `${sessionId}:${messageId}:${partId}`;
  },

  isAssistantOnlyPartType(this: OpencodeRuntime, partType: Part["type"]) {
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
  },

  setBoundedMapEntry<Key, Value>(
    this: OpencodeRuntime,
    map: Map<Key, Value>,
    key: Key,
    value: Value,
  ) {
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    if (map.size <= STREAMED_METADATA_CACHE_LIMIT) return;
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  },

  rememberMessageRole(this: OpencodeRuntime, sessionId, messageId, role) {
    const normalizedSessionId = sessionId.trim();
    const normalizedMessageId = messageId.trim();
    if (!normalizedSessionId || !normalizedMessageId) return;
    this.setBoundedMapEntry(
      this["messageRoleByScopedMessageId"],
      this.scopedMessageId(normalizedSessionId, normalizedMessageId),
      role,
    );
  },

  rememberStreamedAssistantContent(this: OpencodeRuntime, sessionId, messageId, content) {
    const normalizedSessionId = sessionId.trim();
    const normalizedMessageId = messageId.trim();
    if (!normalizedSessionId || !normalizedMessageId) return;
    this.setBoundedMapEntry(
      this["streamedAssistantContentByScopedMessageId"],
      this.scopedMessageId(normalizedSessionId, normalizedMessageId),
      content,
    );
  },

  updateStreamedAssistantContent(this: OpencodeRuntime, sessionId, messageId, text, mode) {
    const normalizedSessionId = sessionId.trim();
    const normalizedMessageId = messageId.trim();
    if (!normalizedSessionId || !normalizedMessageId || !text) return;
    const scopedMessageId = this.scopedMessageId(normalizedSessionId, normalizedMessageId);
    const current = this["streamedAssistantContentByScopedMessageId"].get(scopedMessageId) ?? "";
    const next = mode === "replace" ? text : `${current}${text}`;
    if (mode === "replace") {
      this["emittedCodeHighlightLinesByScopedMessageId"].delete(scopedMessageId);
    }
    this.rememberStreamedAssistantContent(normalizedSessionId, normalizedMessageId, next);
    this.scheduleLiveCodeHighlightEmit(normalizedSessionId, normalizedMessageId, next);
    this.scheduleRenderSnapshotEmit(normalizedSessionId, normalizedMessageId, next);
  },

  rememberEmittedCodeHighlightLine(this: OpencodeRuntime, sessionId, messageId, lineKey, lineText) {
    const scopedMessageId = this.scopedMessageId(sessionId, messageId);
    const current =
      this["emittedCodeHighlightLinesByScopedMessageId"].get(scopedMessageId) ??
      new Map<string, string>();
    current.set(lineKey, lineText);
    this.setBoundedMapEntry(this["emittedCodeHighlightLinesByScopedMessageId"], scopedMessageId, current);
  },

  async emitCodeHighlightLines(this: OpencodeRuntime, sessionId, messageId, content) {
    const scopedMessageId = this.scopedMessageId(sessionId, messageId);
    const latestContent = this["streamedAssistantContentByScopedMessageId"].get(scopedMessageId);
    if (latestContent !== content) return;
    const liveHighlights = await buildStreamdownCodeLineHighlights(content);
    if (liveHighlights.length === 0) return;
    const emittedLineMap =
      this["emittedCodeHighlightLinesByScopedMessageId"].get(scopedMessageId) ??
      new Map<string, string>();
    const nextHighlight = liveHighlights.find((highlight) => {
      const lineKey = `${highlight.blockIndex}:${highlight.lineIndex}`;
      return emittedLineMap.get(lineKey) !== highlight.lineText;
    });
    if (!nextHighlight) return;
    const lineKey = `${nextHighlight.blockIndex}:${nextHighlight.lineIndex}`;
    this.emit(
      createSessionMessageCodeHighlightEvent(
        { sessionId, messageId, highlight: nextHighlight, observedAt: new Date().toISOString() },
        "runtime",
      ),
    );
    this.rememberEmittedCodeHighlightLine(sessionId, messageId, lineKey, nextHighlight.lineText);
    const hasMorePendingHighlights = liveHighlights.some((highlight) => {
      const pendingLineKey = `${highlight.blockIndex}:${highlight.lineIndex}`;
      if (pendingLineKey === lineKey) return false;
      return emittedLineMap.get(pendingLineKey) !== highlight.lineText;
    });
    if (hasMorePendingHighlights) {
      this.scheduleLiveCodeHighlightEmit(sessionId, messageId, content);
    }
  },

  scheduleLiveCodeHighlightEmit(this: OpencodeRuntime, sessionId, messageId, content) {
    if (!content.trim()) return;
    const scopedMessageId = this.scopedMessageId(sessionId, messageId);
    const existingTimer = this["liveCodeHighlightTimerByScopedMessageId"].get(scopedMessageId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this["liveCodeHighlightTimerByScopedMessageId"].delete(scopedMessageId);
      void this.emitCodeHighlightLines(sessionId, messageId, content);
    }, STREAMDOWN_LIVE_HIGHLIGHT_DEBOUNCE_MS);
    this["liveCodeHighlightTimerByScopedMessageId"].set(scopedMessageId, timer);
  },

  scheduleRenderSnapshotEmit(this: OpencodeRuntime, sessionId, messageId, content) {
    if (!content.trim()) return;
    const scopedMessageId = this.scopedMessageId(sessionId, messageId);
    const existingTimer = this["renderSnapshotTimerByScopedMessageId"].get(scopedMessageId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this["renderSnapshotTimerByScopedMessageId"].delete(scopedMessageId);
      void this.emitRenderSnapshot(sessionId, messageId, content);
    }, STREAMDOWN_RENDER_DEBOUNCE_MS);
    this["renderSnapshotTimerByScopedMessageId"].set(scopedMessageId, timer);
  },

  async emitRenderSnapshot(this: OpencodeRuntime, sessionId, messageId, content) {
    const scopedMessageId = this.scopedMessageId(sessionId, messageId);
    const latestContent = this["streamedAssistantContentByScopedMessageId"].get(scopedMessageId);
    if (latestContent !== content) return;
    const renderSnapshot = await buildStreamdownRenderSnapshot(content);
    if (!renderSnapshot) return;
    this.emit(
      createSessionMessageRenderSnapshotEvent(
        { sessionId, messageId, renderSnapshot, observedAt: new Date().toISOString() },
        "runtime",
      ),
    );
  },

  rememberPartMetadata(this: OpencodeRuntime, part) {
    const maybePart = part as { sessionID?: unknown; messageID?: unknown; id?: unknown; type?: unknown };
    const sessionId = typeof maybePart.sessionID === "string" ? maybePart.sessionID.trim() : "";
    const messageId = typeof maybePart.messageID === "string" ? maybePart.messageID.trim() : "";
    const partId = typeof maybePart.id === "string" ? maybePart.id.trim() : "";
    const partType = typeof maybePart.type === "string" ? (maybePart.type as Part["type"]) : null;
    if (!sessionId || !messageId || !partId || !partType) return;
    this.setBoundedMapEntry(
      this["partTypeByScopedPartId"],
      this.scopedPartId(sessionId, messageId, partId),
      partType,
    );
    if (this.isAssistantOnlyPartType(partType)) {
      this.rememberMessageRole(sessionId, messageId, "assistant");
    }
  },
};
