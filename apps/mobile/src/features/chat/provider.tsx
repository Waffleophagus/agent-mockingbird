import type {
  ChatMessage,
  ChatMessagePart,
  DashboardRealtimeFrame,
  ModelOption,
  PermissionPromptRequest,
  QuestionPromptRequest,
  SessionMessageCursor,
  SessionMessageCheckpoint,
  SessionMessagesDeltaResponse,
  SessionMessagesWindowResponse,
  SessionMessageWindowMeta,
  SessionRunErrorSnapshot,
  SessionRunStatusSnapshot,
  SessionScreenBootstrapResponse,
  SessionSummary,
} from "@agent-mockingbird/contracts/dashboard";
import { createAppApiClient } from "@agent-mockingbird/api";
import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";

import {
  appendOptimisticRequest,
  applyMessageCodeHighlight,
  applyMessageDelta,
  applyMessageRenderSnapshot,
  applyMessagePart,
  clearPendingAssistantUiMeta,
  type LocalChatMessage,
  groupPromptRequests,
  markPendingAssistantFailed,
  mergeMessages,
  normalizeRequestError,
  reconcileIncomingMessage,
  removePromptById,
  removeRequestMessages,
  sortSessionsByActivity,
  upsertSessionList,
} from "@/features/chat/chat-helpers";
import {
  readCachedLastAppliedSeq,
  readCachedSessionCheckpoint,
  readCachedSessionMessages,
  readCachedSessions,
  writeCachedLastAppliedSeq,
  writeCachedSessionCheckpoint,
  writeCachedSessionMessages,
  writeCachedSessions,
} from "@/features/chat/cache";
import { useBootstrapStore } from "@/lib/bootstrap";

type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "resyncing" | "offline";

interface MobileChatContextValue {
  sessions: SessionSummary[];
  activeSessionId: string;
  messagesBySession: Record<string, LocalChatMessage[]>;
  historyMetaBySession: Record<string, SessionMessageWindowMeta>;
  modelOptions: ModelOption[];
  loadingBootstrap: boolean;
  loadingMessagesBySession: Record<string, boolean>;
  loadingOlderBySession: Record<string, boolean>;
  loadingModels: boolean;
  savingModel: boolean;
  modelError: string;
  lastServerActivityAt: number;
  sendingBySession: Record<string, boolean>;
  runStatusBySession: Record<string, SessionRunStatusSnapshot>;
  runErrorsBySession: Record<string, string>;
  pendingPermissionsBySession: Record<string, PermissionPromptRequest[]>;
  pendingQuestionsBySession: Record<string, QuestionPromptRequest[]>;
  promptBusyRequestId: string;
  promptError: string;
  connectionState: ConnectionState;
  showThinkingDetails: boolean;
  showToolCallDetails: boolean;
  setActiveSessionId: (sessionId: string) => void;
  ensureSessionLoaded: (sessionId: string) => Promise<void>;
  loadOlderMessages: (sessionId: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  createSession: () => Promise<SessionSummary | null>;
  updateSessionModel: (sessionId: string, model: string) => Promise<void>;
  sendMessage: (sessionId: string, content: string) => Promise<void>;
  retryMessage: (sessionId: string, requestId: string, content: string) => Promise<void>;
  replyPermissionPrompt: (
    requestId: string,
    reply: "once" | "always" | "reject",
    sessionId: string,
  ) => Promise<void>;
  replyQuestionPrompt: (requestId: string, answers: Array<Array<string>>, sessionId: string) => Promise<void>;
  rejectQuestionPrompt: (requestId: string, sessionId: string) => Promise<void>;
  setShowThinkingDetails: (value: boolean) => void;
  setShowToolCallDetails: (value: boolean) => void;
}

const SHOW_THINKING_KEY = "agent-mockingbird.mobile.showThinking";
const SHOW_TOOL_CALLS_KEY = "agent-mockingbird.mobile.showToolCalls";
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const MOBILE_MESSAGE_WINDOW_LIMIT = 120;

const MobileChatContext = createContext<MobileChatContextValue | null>(null);

function randomRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function removePromptFromMap<T extends { id: string }>(current: Record<string, T[]>, sessionId: string, promptId: string) {
  if (!current[sessionId]) return current;
  return {
    ...current,
    [sessionId]: removePromptById(current[sessionId], promptId),
  };
}

function safelyParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toWebSocketUrl(apiBaseUrl: string, afterSeq: number) {
  const url = new URL("/api/mobile/events/ws", apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("afterSeq", String(afterSeq));
  return url.toString();
}

function markActivity() {
  return Date.now();
}

function checkpointFromMessages(messages: LocalChatMessage[]): SessionMessageCheckpoint | null {
  const confirmedMessages = messages.filter(message => !message.uiMeta);
  const lastMessage = confirmedMessages[confirmedMessages.length - 1];
  if (!lastMessage) return null;
  return {
    lastMessageAt: lastMessage.at,
    lastMessageId: lastMessage.id,
  };
}

function confirmedMessages(messages: LocalChatMessage[]) {
  return messages.filter(message => !message.uiMeta);
}

function cursorFromMessage(message: ChatMessage): SessionMessageCursor {
  return {
    at: message.at,
    role: message.role,
    id: message.id,
  };
}

function buildHistoryMeta(
  messages: LocalChatMessage[],
  options?: Partial<SessionMessageWindowMeta>,
): SessionMessageWindowMeta {
  const confirmed = confirmedMessages(messages);
  return {
    oldestLoaded: options?.oldestLoaded ?? (confirmed[0] ? cursorFromMessage(confirmed[0]) : null),
    newestLoaded:
      options?.newestLoaded ?? (confirmed[confirmed.length - 1] ? cursorFromMessage(confirmed[confirmed.length - 1]!) : null),
    hasOlder: options?.hasOlder ?? false,
    totalMessages: options?.totalMessages ?? confirmed.length,
    isWindowed: options?.isWindowed ?? false,
  };
}

export function MobileChatProvider({ children }: PropsWithChildren) {
  const bootstrapStore = useBootstrapStore();
  const apiBaseUrl = bootstrapStore.apiBaseUrl.trim();
  const client = useMemo(
    () => (apiBaseUrl ? createAppApiClient(apiBaseUrl) : null),
    [apiBaseUrl],
  );

  const [sessions, setSessions] = useState<SessionSummary[]>(() => readCachedSessions());
  const [activeSessionId, setActiveSessionIdState] = useState("");
  const [messagesBySession, setMessagesBySession] = useState<Record<string, LocalChatMessage[]>>({});
  const [historyMetaBySession, setHistoryMetaBySession] = useState<Record<string, SessionMessageWindowMeta>>({});
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [loadingBootstrap, setLoadingBootstrap] = useState(false);
  const [loadingMessagesBySession, setLoadingMessagesBySession] = useState<Record<string, boolean>>({});
  const [loadingOlderBySession, setLoadingOlderBySession] = useState<Record<string, boolean>>({});
  const [loadingModels, setLoadingModels] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [modelError, setModelError] = useState("");
  const [lastServerActivityAt, setLastServerActivityAt] = useState(0);
  const [sendingBySession, setSendingBySession] = useState<Record<string, boolean>>({});
  const [runStatusBySession, setRunStatusBySession] = useState<Record<string, SessionRunStatusSnapshot>>({});
  const [runErrorsBySession, setRunErrorsBySession] = useState<Record<string, string>>({});
  const [pendingPermissionsBySession, setPendingPermissionsBySession] = useState<
    Record<string, PermissionPromptRequest[]>
  >({});
  const [pendingQuestionsBySession, setPendingQuestionsBySession] = useState<Record<string, QuestionPromptRequest[]>>(
    {},
  );
  const [promptBusyRequestId, setPromptBusyRequestId] = useState("");
  const [promptError, setPromptError] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [showThinkingDetails, setShowThinkingDetailsState] = useState(false);
  const [showToolCallDetails, setShowToolCallDetailsState] = useState(false);
  const [baselineSeq, setBaselineSeq] = useState<number | null>(null);
  const [socketGeneration, setSocketGeneration] = useState(0);
  const loadedSessionIdsRef = useRef(new Set<string>());
  const activeSessionIdRef = useRef("");
  const messagesBySessionRef = useRef<Record<string, LocalChatMessage[]>>({});
  const historyMetaBySessionRef = useRef<Record<string, SessionMessageWindowMeta>>({});
  const lastAppliedSeqRef = useRef(readCachedLastAppliedSeq());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const resyncInFlightRef = useRef(false);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    messagesBySessionRef.current = messagesBySession;
  }, [messagesBySession]);

  useEffect(() => {
    historyMetaBySessionRef.current = historyMetaBySession;
  }, [historyMetaBySession]);

  useEffect(() => {
    writeCachedSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    let cancelled = false;

    const hydratePreferences = async () => {
      const [thinkingValue, toolValue] = await Promise.all([
        SecureStore.getItemAsync(SHOW_THINKING_KEY),
        SecureStore.getItemAsync(SHOW_TOOL_CALLS_KEY),
      ]);
      if (cancelled) return;
      setShowThinkingDetailsState(thinkingValue === "true");
      setShowToolCallDetailsState(toolValue === "true");
    };

    void hydratePreferences();

    return () => {
      cancelled = true;
    };
  }, []);

  function clearReconnectTimer() {
    if (!reconnectTimerRef.current) return;
    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }

  function closeSocket() {
    if (!socketRef.current) return;
    try {
      socketRef.current.close();
    } catch {
      // Ignore close errors while tearing down.
    }
    socketRef.current = null;
  }

  function commitSessionMessages(
    sessionId: string,
    nextMessages: LocalChatMessage[],
    nextMeta?: SessionMessageWindowMeta,
  ) {
    const nextMessagesBySession = {
      ...messagesBySessionRef.current,
      [sessionId]: nextMessages,
    };
    messagesBySessionRef.current = nextMessagesBySession;
    setMessagesBySession(nextMessagesBySession);
    writeCachedSessionMessages(sessionId, nextMessages);
    writeCachedSessionCheckpoint(sessionId, checkpointFromMessages(nextMessages));

    if (nextMeta) {
      const nextHistoryMetaBySession = {
        ...historyMetaBySessionRef.current,
        [sessionId]: nextMeta,
      };
      historyMetaBySessionRef.current = nextHistoryMetaBySession;
      setHistoryMetaBySession(nextHistoryMetaBySession);
    }
  }

  function deriveHistoryMetaForSession(
    sessionId: string,
    nextMessages: LocalChatMessage[],
    overrides?: Partial<SessionMessageWindowMeta>,
  ) {
    const currentMeta = historyMetaBySessionRef.current[sessionId];
    const sessionCount = sessions.find(session => session.id === sessionId)?.messageCount ?? currentMeta?.totalMessages;
    const confirmedCount = confirmedMessages(nextMessages).length;
    return buildHistoryMeta(nextMessages, {
      totalMessages: overrides?.totalMessages ?? sessionCount ?? confirmedCount,
      hasOlder: overrides?.hasOlder ?? currentMeta?.hasOlder ?? (sessionCount != null ? sessionCount > confirmedCount : false),
      isWindowed: overrides?.isWindowed ?? currentMeta?.isWindowed ?? false,
      oldestLoaded: overrides?.oldestLoaded,
      newestLoaded: overrides?.newestLoaded,
    });
  }

  function applyBootstrapPayload(payload: SessionScreenBootstrapResponse, options?: { resetLoadedSessions?: boolean }) {
    const nextSessions = sortSessionsByActivity(payload.sessions ?? []);
    const resolvedActiveSessionId = payload.activeSessionId || activeSessionIdRef.current || nextSessions[0]?.id || "";
    const nextMessages = (payload.messages ?? []) as LocalChatMessage[];
    const cachedMessages = resolvedActiveSessionId ? (readCachedSessionMessages(resolvedActiveSessionId) as LocalChatMessage[]) : [];
    const hydratedMessages = mergeMessages(cachedMessages, nextMessages);
    const nextHistoryMeta =
      resolvedActiveSessionId && hydratedMessages
        ? buildHistoryMeta(hydratedMessages, payload.messagesMeta ?? { totalMessages: hydratedMessages.length })
        : undefined;

    setSessions(nextSessions);
    setModelOptions(Array.isArray(payload.models) ? payload.models : []);
    setModelError("");
    setLastServerActivityAt(markActivity());
    setActiveSessionIdState(resolvedActiveSessionId);
    activeSessionIdRef.current = resolvedActiveSessionId;
    setPendingPermissionsBySession(groupPromptRequests(payload.pendingPermissions));
    setPendingQuestionsBySession(groupPromptRequests(payload.pendingQuestions));

    if (options?.resetLoadedSessions) {
      const loaded = new Set<string>();
      const nextMessagesBySession: Record<string, LocalChatMessage[]> = {};
      const nextHistoryMetaBySession: Record<string, SessionMessageWindowMeta> = {};
      if (resolvedActiveSessionId) {
        loaded.add(resolvedActiveSessionId);
        nextMessagesBySession[resolvedActiveSessionId] = hydratedMessages;
        if (nextHistoryMeta) {
          nextHistoryMetaBySession[resolvedActiveSessionId] = nextHistoryMeta;
        }
      }
      loadedSessionIdsRef.current = loaded;
      messagesBySessionRef.current = nextMessagesBySession;
      setMessagesBySession(nextMessagesBySession);
      historyMetaBySessionRef.current = nextHistoryMetaBySession;
      setHistoryMetaBySession(nextHistoryMetaBySession);
      if (resolvedActiveSessionId) {
        writeCachedSessionMessages(resolvedActiveSessionId, hydratedMessages);
        writeCachedSessionCheckpoint(resolvedActiveSessionId, checkpointFromMessages(hydratedMessages));
      }
    } else if (resolvedActiveSessionId) {
      loadedSessionIdsRef.current.add(resolvedActiveSessionId);
      const mergedMessages = mergeMessages(messagesBySessionRef.current[resolvedActiveSessionId] ?? cachedMessages, nextMessages);
      commitSessionMessages(
        resolvedActiveSessionId,
        mergedMessages,
        nextHistoryMeta ??
          historyMetaBySessionRef.current[resolvedActiveSessionId] ??
          buildHistoryMeta(mergedMessages, {
            totalMessages:
              nextSessions.find(session => session.id === resolvedActiveSessionId)?.messageCount ?? mergedMessages.length,
            hasOlder:
              (nextSessions.find(session => session.id === resolvedActiveSessionId)?.messageCount ?? mergedMessages.length) >
              confirmedMessages(mergedMessages).length,
            isWindowed: Boolean(payload.messagesMeta),
          }),
      );
    }

    const latestSeq = payload.realtime?.latestSeq ?? 0;
    lastAppliedSeqRef.current = Math.max(lastAppliedSeqRef.current, latestSeq);
    writeCachedLastAppliedSeq(lastAppliedSeqRef.current);
    setBaselineSeq(latestSeq);
  }

  async function bootstrapRealtimeState(requestedSessionId?: string, options?: { resetLoadedSessions?: boolean }) {
    if (!client) return false;
    setLoadingBootstrap(true);
    setLoadingModels(true);

    try {
      const payload = (await client.sessions.bootstrap.query(
        requestedSessionId?.trim()
          ? { sessionId: requestedSessionId.trim(), messageWindowLimit: MOBILE_MESSAGE_WINDOW_LIMIT }
          : { messageWindowLimit: MOBILE_MESSAGE_WINDOW_LIMIT },
      )) as SessionScreenBootstrapResponse;
      applyBootstrapPayload(payload, options);
      return true;
    } catch (error) {
      console.error("Failed to bootstrap mobile chat", error);
      setConnectionState("offline");
      setModelError(normalizeRequestError(error));
      return false;
    } finally {
      setLoadingBootstrap(false);
      setLoadingModels(false);
    }
  }

  async function runForcedResync() {
    if (resyncInFlightRef.current) return;
    resyncInFlightRef.current = true;
    clearReconnectTimer();
    closeSocket();
    setConnectionState("resyncing");

    const ok = await bootstrapRealtimeState(activeSessionIdRef.current || undefined, {
      resetLoadedSessions: true,
    });

    resyncInFlightRef.current = false;
    if (ok) {
      reconnectAttemptRef.current = 0;
      setSocketGeneration(current => current + 1);
    }
  }

  function scheduleReconnect() {
    if (!apiBaseUrl || baselineSeq == null || reconnectTimerRef.current || resyncInFlightRef.current) return;
    reconnectAttemptRef.current += 1;
    const exponent = reconnectAttemptRef.current - 1;
    const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** exponent);
    const jitter = Math.floor(Math.random() * 300);
    setConnectionState(current => (current === "resyncing" ? current : "reconnecting"));
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      setSocketGeneration(current => current + 1);
    }, delay + jitter);
  }

  function applyRealtimeEvent(frame: Extract<DashboardRealtimeFrame, { type: "event" }>) {
    switch (frame.event) {
      case "session-updated": {
        setLastServerActivityAt(markActivity());
        const payload = frame.payload as SessionSummary;
        setSessions(current => upsertSessionList(current, payload));
        const existingMeta = historyMetaBySessionRef.current[payload.id];
        if (existingMeta) {
          const nextHistoryMetaBySession = {
            ...historyMetaBySessionRef.current,
            [payload.id]: {
              ...existingMeta,
              totalMessages: payload.messageCount,
              hasOlder: existingMeta.isWindowed ? payload.messageCount > confirmedMessages(messagesBySessionRef.current[payload.id] ?? []).length : existingMeta.hasOlder,
            },
          };
          historyMetaBySessionRef.current = nextHistoryMetaBySession;
          setHistoryMetaBySession(nextHistoryMetaBySession);
        }
        return;
      }
      case "session-message": {
        setLastServerActivityAt(markActivity());
        const payload = frame.payload as Extract<
          import("@agent-mockingbird/contracts/dashboard").DashboardEvent,
          { event: "session-message" }
        >["payload"];
        loadedSessionIdsRef.current.add(payload.sessionId);
        const nextMessages = reconcileIncomingMessage(messagesBySessionRef.current[payload.sessionId] ?? [], payload.message);
        commitSessionMessages(payload.sessionId, nextMessages, deriveHistoryMetaForSession(payload.sessionId, nextMessages));
        if (payload.message.role === "assistant") {
          setSendingBySession(current => ({
            ...current,
            [payload.sessionId]: false,
          }));
          setRunErrorsBySession(current => {
            if (!current[payload.sessionId]) return current;
            const next = { ...current };
            delete next[payload.sessionId];
            return next;
          });
        }
        return;
      }
      case "session-message-delta": {
        setLastServerActivityAt(markActivity());
        const payload = frame.payload as Extract<
          import("@agent-mockingbird/contracts/dashboard").DashboardEvent,
          { event: "session-message-delta" }
        >["payload"];
        loadedSessionIdsRef.current.add(payload.sessionId);
        const nextMessages = applyMessageDelta(
          messagesBySessionRef.current[payload.sessionId] ?? [],
          payload.messageId,
          payload.text,
          payload.mode,
        );
        commitSessionMessages(payload.sessionId, nextMessages, deriveHistoryMetaForSession(payload.sessionId, nextMessages));
        return;
      }
      case "session-message-part": {
        setLastServerActivityAt(markActivity());
        const payload = frame.payload as Extract<
          import("@agent-mockingbird/contracts/dashboard").DashboardEvent,
          { event: "session-message-part" }
        >["payload"];
        loadedSessionIdsRef.current.add(payload.sessionId);
        const nextMessages = applyMessagePart(messagesBySessionRef.current[payload.sessionId] ?? [], payload.messageId, payload.part);
        commitSessionMessages(payload.sessionId, nextMessages, deriveHistoryMetaForSession(payload.sessionId, nextMessages));
        return;
      }
      case "session-message-code-highlight": {
        setLastServerActivityAt(markActivity());
        const payload = frame.payload as Extract<
          import("@agent-mockingbird/contracts/dashboard").DashboardEvent,
          { event: "session-message-code-highlight" }
        >["payload"];
        loadedSessionIdsRef.current.add(payload.sessionId);
        const nextMessages = applyMessageCodeHighlight(
          messagesBySessionRef.current[payload.sessionId] ?? [],
          payload.messageId,
          payload.highlight,
        );
        commitSessionMessages(payload.sessionId, nextMessages, deriveHistoryMetaForSession(payload.sessionId, nextMessages));
        return;
      }
      case "session-message-render-snapshot": {
        setLastServerActivityAt(markActivity());
        const payload = frame.payload as Extract<
          import("@agent-mockingbird/contracts/dashboard").DashboardEvent,
          { event: "session-message-render-snapshot" }
        >["payload"];
        loadedSessionIdsRef.current.add(payload.sessionId);
        const nextMessages = applyMessageRenderSnapshot(
          messagesBySessionRef.current[payload.sessionId] ?? [],
          payload.messageId,
          payload.renderSnapshot,
        );
        commitSessionMessages(payload.sessionId, nextMessages, deriveHistoryMetaForSession(payload.sessionId, nextMessages));
        return;
      }
      case "session-status": {
        setLastServerActivityAt(markActivity());
        const payload = frame.payload as Extract<
          import("@agent-mockingbird/contracts/dashboard").DashboardEvent,
          { event: "session-status" }
        >["payload"];
        if (payload.status === "idle") {
          const nextMessages = clearPendingAssistantUiMeta(messagesBySessionRef.current[payload.sessionId] ?? []);
          commitSessionMessages(payload.sessionId, nextMessages, deriveHistoryMetaForSession(payload.sessionId, nextMessages));
        }
        setRunStatusBySession(current => ({
          ...current,
          [payload.sessionId]: payload,
        }));
        return;
      }
      case "session-error": {
        setLastServerActivityAt(markActivity());
        const payload = frame.payload as Extract<
          import("@agent-mockingbird/contracts/dashboard").DashboardEvent,
          { event: "session-error" }
        >["payload"];
        const sessionId = payload.sessionId ?? "";
        if (!sessionId) return;
        setRunErrorsBySession(current => ({
          ...current,
          [sessionId]: payload.message ?? "Session failed.",
        }));
        setSendingBySession(current => ({
          ...current,
          [sessionId]: false,
        }));
        return;
      }
      case "permission-requested": {
        setLastServerActivityAt(markActivity());
        const payload = frame.payload as Extract<
          import("@agent-mockingbird/contracts/dashboard").DashboardEvent,
          { event: "permission-requested" }
        >["payload"];
        setPendingPermissionsBySession(current => {
          const existing = current[payload.sessionId] ?? [];
          if (existing.some(item => item.id === payload.id)) return current;
          return {
            ...current,
            [payload.sessionId]: [...existing, payload].sort((left, right) => left.id.localeCompare(right.id)),
          };
        });
        return;
      }
      case "permission-resolved": {
        setLastServerActivityAt(markActivity());
        const payload = frame.payload as Extract<
          import("@agent-mockingbird/contracts/dashboard").DashboardEvent,
          { event: "permission-resolved" }
        >["payload"];
        setPendingPermissionsBySession(current => removePromptFromMap(current, payload.sessionId, payload.requestId));
        return;
      }
      case "question-requested": {
        setLastServerActivityAt(markActivity());
        const payload = frame.payload as Extract<
          import("@agent-mockingbird/contracts/dashboard").DashboardEvent,
          { event: "question-requested" }
        >["payload"];
        setPendingQuestionsBySession(current => {
          const existing = current[payload.sessionId] ?? [];
          if (existing.some(item => item.id === payload.id)) return current;
          return {
            ...current,
            [payload.sessionId]: [...existing, payload].sort((left, right) => left.id.localeCompare(right.id)),
          };
        });
        return;
      }
      case "question-resolved": {
        setLastServerActivityAt(markActivity());
        const payload = frame.payload as Extract<
          import("@agent-mockingbird/contracts/dashboard").DashboardEvent,
          { event: "question-resolved" }
        >["payload"];
        setPendingQuestionsBySession(current => removePromptFromMap(current, payload.sessionId, payload.requestId));
        return;
      }
      case "heartbeat":
      case "usage":
      case "session-compacted":
      case "background-run":
      case "skills-catalog-updated":
        return;
      default:
        return;
    }
  }

  function handleRealtimeFrame(frame: DashboardRealtimeFrame) {
    if (frame.type === "hello") {
      if (frame.latestSeq < lastAppliedSeqRef.current) {
        void runForcedResync();
      }
      return;
    }

    if (frame.type === "resync_required") {
      void runForcedResync();
      return;
    }

    if (frame.seq <= lastAppliedSeqRef.current) {
      return;
    }

    if (frame.seq > lastAppliedSeqRef.current + 1) {
      void runForcedResync();
      return;
    }

    applyRealtimeEvent(frame);
    lastAppliedSeqRef.current = frame.seq;
    writeCachedLastAppliedSeq(frame.seq);
  }

  useEffect(() => {
    if (!bootstrapStore.hydrated) return;

    if (!apiBaseUrl || !client) {
      clearReconnectTimer();
      closeSocket();
      reconnectAttemptRef.current = 0;
      resyncInFlightRef.current = false;
      setSessions([]);
      setActiveSessionIdState("");
      activeSessionIdRef.current = "";
      setMessagesBySession({});
      messagesBySessionRef.current = {};
      setHistoryMetaBySession({});
      historyMetaBySessionRef.current = {};
      setPendingPermissionsBySession({});
      setPendingQuestionsBySession({});
      setLoadingOlderBySession({});
      setConnectionState("idle");
      setBaselineSeq(null);
      lastAppliedSeqRef.current = 0;
      loadedSessionIdsRef.current.clear();
      return;
    }

    void bootstrapRealtimeState(activeSessionIdRef.current || undefined, {
      resetLoadedSessions: true,
    });
  }, [apiBaseUrl, bootstrapStore.hydrated, client]);

  useEffect(() => {
    if (!apiBaseUrl || !bootstrapStore.hydrated || baselineSeq == null || resyncInFlightRef.current) return;

    let closedByCleanup = false;
    const socket = new WebSocket(toWebSocketUrl(apiBaseUrl, lastAppliedSeqRef.current));
    socketRef.current = socket;
    setConnectionState(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

    socket.onopen = () => {
      reconnectAttemptRef.current = 0;
      setLastServerActivityAt(markActivity());
      setConnectionState("connected");
    };

    socket.onmessage = event => {
      if (typeof event.data !== "string") return;
      const frame = safelyParseJson<DashboardRealtimeFrame>(event.data);
      if (!frame) return;
      setLastServerActivityAt(markActivity());
      handleRealtimeFrame(frame);
    };

    socket.onerror = () => {
      if (closedByCleanup || resyncInFlightRef.current) return;
      setConnectionState(current => (current === "resyncing" ? current : "offline"));
    };

    socket.onclose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      if (closedByCleanup || resyncInFlightRef.current) return;
      scheduleReconnect();
    };

    return () => {
      closedByCleanup = true;
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      socket.close();
    };
  }, [apiBaseUrl, baselineSeq, bootstrapStore.hydrated, socketGeneration]);

  useEffect(() => () => {
    clearReconnectTimer();
    closeSocket();
  }, []);

  async function loadLatestWindow(sessionId: string) {
    if (!client) return;
    const response = (await client.sessions.history.query({
      sessionId,
      limit: MOBILE_MESSAGE_WINDOW_LIMIT,
    })) as SessionMessagesWindowResponse;
    const incomingMessages = response.messages as LocalChatMessage[];
    loadedSessionIdsRef.current.add(sessionId);
    setLastServerActivityAt(markActivity());
    commitSessionMessages(
      sessionId,
      incomingMessages,
      buildHistoryMeta(incomingMessages, response.meta),
    );
  }

  async function ensureSessionLoaded(sessionId: string) {
    if (!client || !sessionId) return;
    const cachedMessages = readCachedSessionMessages(sessionId) as LocalChatMessage[];
    if (cachedMessages.length > 0) {
      loadedSessionIdsRef.current.add(sessionId);
      commitSessionMessages(
        sessionId,
        mergeMessages(messagesBySessionRef.current[sessionId] ?? [], cachedMessages),
        deriveHistoryMetaForSession(sessionId, cachedMessages, {
          hasOlder:
            (sessions.find(session => session.id === sessionId)?.messageCount ?? cachedMessages.length) >
            confirmedMessages(cachedMessages).length,
          isWindowed: true,
        }),
      );
    } else if (loadedSessionIdsRef.current.has(sessionId)) {
      const currentMessages = messagesBySessionRef.current[sessionId] ?? [];
      const checkpoint = checkpointFromMessages(currentMessages);
      if (!checkpoint) return;
      const response = (await client.sessions.messages.query({
        sessionId,
        checkpoint,
      })) as SessionMessagesDeltaResponse;
      if (response.requiresReset) {
        await loadLatestWindow(sessionId);
        return;
      }
      const nextMessages = mergeMessages(currentMessages, response.messages as LocalChatMessage[]);
      setLastServerActivityAt(markActivity());
      commitSessionMessages(sessionId, nextMessages, deriveHistoryMetaForSession(sessionId, nextMessages));
      return;
    }
    setLoadingMessagesBySession(current => ({
      ...current,
      [sessionId]: true,
    }));

    try {
      const checkpoint = readCachedSessionCheckpoint(sessionId) ?? checkpointFromMessages(cachedMessages);
      if (!checkpoint) {
        await loadLatestWindow(sessionId);
        return;
      }

      const response = (await client.sessions.messages.query({
        sessionId,
        checkpoint,
      })) as SessionMessagesDeltaResponse;

      if (response.requiresReset) {
        await loadLatestWindow(sessionId);
        return;
      }

      const currentMessages = messagesBySessionRef.current[sessionId] ?? cachedMessages;
      const nextMessages = mergeMessages(currentMessages, response.messages as LocalChatMessage[]);
      setLastServerActivityAt(markActivity());
      loadedSessionIdsRef.current.add(sessionId);
      commitSessionMessages(
        sessionId,
        nextMessages,
        deriveHistoryMetaForSession(sessionId, nextMessages, {
          hasOlder:
            (sessions.find(session => session.id === sessionId)?.messageCount ?? nextMessages.length) >
            confirmedMessages(nextMessages).length,
          isWindowed: true,
        }),
      );
    } finally {
      setLoadingMessagesBySession(current => ({
        ...current,
        [sessionId]: false,
      }));
    }
  }

  async function loadOlderMessages(sessionId: string) {
    if (!client || !sessionId) return;
    const meta = historyMetaBySessionRef.current[sessionId];
    if (!meta?.hasOlder || !meta.oldestLoaded || loadingOlderBySession[sessionId]) return;

    setLoadingOlderBySession(current => ({
      ...current,
      [sessionId]: true,
    }));

    try {
      const response = (await client.sessions.history.query({
        sessionId,
        limit: MOBILE_MESSAGE_WINDOW_LIMIT,
        before: meta.oldestLoaded,
      })) as SessionMessagesWindowResponse;
      const currentMessages = messagesBySessionRef.current[sessionId] ?? [];
      const nextMessages = mergeMessages(response.messages as LocalChatMessage[], currentMessages);
      setLastServerActivityAt(markActivity());
      commitSessionMessages(
        sessionId,
        nextMessages,
        buildHistoryMeta(nextMessages, {
          oldestLoaded: response.meta.oldestLoaded,
          newestLoaded: meta.newestLoaded,
          hasOlder: response.meta.hasOlder,
          totalMessages: response.meta.totalMessages,
          isWindowed: true,
        }),
      );
    } finally {
      setLoadingOlderBySession(current => ({
        ...current,
        [sessionId]: false,
      }));
    }
  }

  async function refreshSessions() {
    if (!client) return;
    const nextSessions = await client.sessions.list.query();
    setLastServerActivityAt(markActivity());
    setSessions(sortSessionsByActivity(nextSessions));
  }

  async function createSession() {
    if (!client) return null;
    const session = await client.sessions.create.mutate();
    setLastServerActivityAt(markActivity());
    setSessions(current => upsertSessionList(current, session));
    commitSessionMessages(
      session.id,
      messagesBySessionRef.current[session.id] ?? [],
      buildHistoryMeta([], {
        totalMessages: 0,
        hasOlder: false,
        isWindowed: true,
      }),
    );
    loadedSessionIdsRef.current.add(session.id);
    setActiveSessionIdState(session.id);
    activeSessionIdRef.current = session.id;
    return session;
  }

  async function updateSessionModel(sessionId: string, rawModel: string) {
    const model = rawModel.trim();
    if (!apiBaseUrl || !sessionId || !model) return;

    const currentSession = sessions.find(session => session.id === sessionId);
    if (currentSession?.model === model) {
      setModelError("");
      return;
    }

    setSavingModel(true);
    setModelError("");

    try {
      const response = await fetch(new URL(`/api/sessions/${encodeURIComponent(sessionId)}/model`, apiBaseUrl), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const payload = (await response.json()) as {
        session?: SessionSummary;
        configError?: string;
        configStage?: string;
        error?: string;
      };
      if (!response.ok || !payload.session) {
        throw new Error(payload.error ?? "Failed to update session model");
      }

      setLastServerActivityAt(markActivity());
      setSessions(current => upsertSessionList(current, payload.session!));
      if (payload.configError?.trim()) {
        const stagePrefix = payload.configStage?.trim() ? `[${payload.configStage}] ` : "";
        setModelError(`Session model updated, but runtime default did not change: ${stagePrefix}${payload.configError}`);
      }
    } catch (error) {
      setModelError(normalizeRequestError(error));
      throw error;
    } finally {
      setSavingModel(false);
    }
  }

  async function sendMessage(sessionId: string, rawContent: string) {
    const content = rawContent.trim();
    if (!client || !sessionId || !content || sendingBySession[sessionId]) return;
    const requestId = randomRequestId();
    setPromptError("");
    setSendingBySession(current => ({
      ...current,
      [sessionId]: true,
    }));
    setRunErrorsBySession(current => {
      if (!current[sessionId]) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    const optimisticMessages = appendOptimisticRequest(messagesBySessionRef.current[sessionId] ?? [], requestId, content);
    commitSessionMessages(sessionId, optimisticMessages, deriveHistoryMetaForSession(sessionId, optimisticMessages));

    try {
      const result = await client.chat.send.mutate({ sessionId, content });
      setLastServerActivityAt(markActivity());
      setSessions(current => upsertSessionList(current, result.session));
      const nextMessages = result.messages.reduce(
        (messages, message) => reconcileIncomingMessage(messages, message),
        messagesBySessionRef.current[sessionId] ?? [],
      );
      commitSessionMessages(sessionId, nextMessages, deriveHistoryMetaForSession(sessionId, nextMessages));
    } catch (error) {
      const message = normalizeRequestError(error);
      setSendingBySession(current => ({
        ...current,
        [sessionId]: false,
      }));
      setRunErrorsBySession(current => ({
        ...current,
        [sessionId]: message,
      }));
      const nextMessages = markPendingAssistantFailed(messagesBySessionRef.current[sessionId] ?? [], requestId, message);
      commitSessionMessages(sessionId, nextMessages, deriveHistoryMetaForSession(sessionId, nextMessages));
    }
  }

  async function retryMessage(sessionId: string, requestId: string, content: string) {
    const nextMessages = removeRequestMessages(messagesBySessionRef.current[sessionId] ?? [], requestId);
    commitSessionMessages(sessionId, nextMessages, deriveHistoryMetaForSession(sessionId, nextMessages));
    await sendMessage(sessionId, content);
  }

  async function replyPermissionPrompt(
    requestId: string,
    reply: "once" | "always" | "reject",
    sessionId: string,
  ) {
    if (!client) return;
    setPromptError("");
    setPromptBusyRequestId(requestId);
    try {
      await client.prompts.replyPermission.mutate({ requestId, reply });
      setLastServerActivityAt(markActivity());
      setPendingPermissionsBySession(current => removePromptFromMap(current, sessionId, requestId));
    } catch (error) {
      setPromptError(normalizeRequestError(error));
    } finally {
      setPromptBusyRequestId("");
    }
  }

  async function replyQuestionPrompt(requestId: string, answers: Array<Array<string>>, sessionId: string) {
    if (!client) return;
    setPromptError("");
    setPromptBusyRequestId(requestId);
    try {
      await client.prompts.replyQuestion.mutate({ requestId, answers });
      setLastServerActivityAt(markActivity());
      setPendingQuestionsBySession(current => removePromptFromMap(current, sessionId, requestId));
    } catch (error) {
      setPromptError(normalizeRequestError(error));
    } finally {
      setPromptBusyRequestId("");
    }
  }

  async function rejectQuestionPrompt(requestId: string, sessionId: string) {
    if (!client) return;
    setPromptError("");
    setPromptBusyRequestId(requestId);
    try {
      await client.prompts.rejectQuestion.mutate({ requestId });
      setLastServerActivityAt(markActivity());
      setPendingQuestionsBySession(current => removePromptFromMap(current, sessionId, requestId));
    } catch (error) {
      setPromptError(normalizeRequestError(error));
    } finally {
      setPromptBusyRequestId("");
    }
  }

  async function persistBooleanPreference(key: string, value: boolean) {
    try {
      await SecureStore.setItemAsync(key, value ? "true" : "false");
    } catch (error) {
      console.error("Failed to persist chat preference", error);
    }
  }

  function setActiveSessionId(sessionId: string) {
    setActiveSessionIdState(current => (current === sessionId ? current : sessionId));
    activeSessionIdRef.current = sessionId;
  }

  function setShowThinkingDetails(value: boolean) {
    setShowThinkingDetailsState(value);
    void persistBooleanPreference(SHOW_THINKING_KEY, value);
  }

  function setShowToolCallDetails(value: boolean) {
    setShowToolCallDetailsState(value);
    void persistBooleanPreference(SHOW_TOOL_CALLS_KEY, value);
  }

  const value = useMemo<MobileChatContextValue>(
    () => ({
      sessions,
      activeSessionId,
      messagesBySession,
      historyMetaBySession,
      modelOptions,
      loadingBootstrap,
      loadingMessagesBySession,
      loadingOlderBySession,
      loadingModels,
      savingModel,
      modelError,
      lastServerActivityAt,
      sendingBySession,
      runStatusBySession,
      runErrorsBySession,
      pendingPermissionsBySession,
      pendingQuestionsBySession,
      promptBusyRequestId,
      promptError,
      connectionState,
      showThinkingDetails,
      showToolCallDetails,
      setActiveSessionId,
      ensureSessionLoaded,
      loadOlderMessages,
      refreshSessions,
      createSession,
      updateSessionModel,
      sendMessage,
      retryMessage,
      replyPermissionPrompt,
      replyQuestionPrompt,
      rejectQuestionPrompt,
      setShowThinkingDetails,
      setShowToolCallDetails,
    }),
    [
      sessions,
      activeSessionId,
      messagesBySession,
      historyMetaBySession,
      modelOptions,
      loadingBootstrap,
      loadingMessagesBySession,
      loadingOlderBySession,
      loadingModels,
      savingModel,
      modelError,
      lastServerActivityAt,
      sendingBySession,
      runStatusBySession,
      runErrorsBySession,
      pendingPermissionsBySession,
      pendingQuestionsBySession,
      promptBusyRequestId,
      promptError,
      connectionState,
      showThinkingDetails,
      showToolCallDetails,
    ],
  );

  return <MobileChatContext.Provider value={value}>{children}</MobileChatContext.Provider>;
}

export function useMobileChat() {
  const value = useContext(MobileChatContext);
  if (!value) {
    throw new Error("useMobileChat must be used within MobileChatProvider");
  }
  return value;
}
