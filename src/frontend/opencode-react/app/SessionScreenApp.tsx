import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/ui/dialog";
import {
  type ActiveSend,
  formatCompactTimestamp,
  type LocalChatMessage,
  relativeFromIso,
} from "@/frontend/app/chatHelpers";
import {
  type ConfirmAction,
  getConfirmDialogProps,
} from "@/frontend/app/dashboardTypes";
import {
  DEFAULT_CHILD_SESSION_HIDE_AFTER_DAYS,
  DEFAULT_RUN_WAIT_TIMEOUT_MS,
  sortSessionsByActivity,
  upsertSessionList,
} from "@/frontend/app/dashboardUtils";
import { type ChatPageModel } from "@/frontend/app/pages/ChatPage";
import { useBackgroundRuns } from "@/frontend/app/useBackgroundRuns";
import { type ComposerAttachment, useChatSession } from "@/frontend/app/useChatSession";
import { useSessionHierarchy } from "@/frontend/app/useSessionHierarchy";
import { SessionScreen } from "@/frontend/opencode-react/app/SessionScreen";
import { useSessionEvents } from "@/frontend/opencode-react/state/useSessionEvents";
import { useSessionScreenBootstrap } from "@/frontend/opencode-react/state/useSessionScreenBootstrap";
import { useSessionScreenController } from "@/frontend/opencode-react/state/useSessionScreenController";
import type {
  BackgroundRunSnapshot,
  ChatMessage,
  MemoryStatusSnapshot,
  MemoryWriteEvent,
  ModelOption,
  PermissionPromptRequest,
  QuestionPromptRequest,
  SessionRunStatusSnapshot,
  SessionSummary,
  UsageSnapshot,
} from "@/types/dashboard";
import "streamdown/styles.css";
import "@/index.css";

const CHAT_SHOW_THINKING_KEY = "wafflebot.chat.showThinking";
const CHAT_SHOW_TOOL_CALLS_KEY = "wafflebot.chat.showToolCalls";

function loadBooleanSetting(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function formatTimestampSummary(iso: string): string {
  const compact = formatCompactTimestamp(iso);
  if (!compact) return relativeFromIso(iso);
  return `${compact} · ${relativeFromIso(iso)}`;
}

function sortPromptRequests<T extends { id: string }>(items: T[]) {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function collectPromptScopeSessionIds(input: {
  rootSessionId: string;
  childSessionsByParentSessionId: Record<string, SessionSummary[]>;
}) {
  const root = input.rootSessionId.trim();
  if (!root) return [];
  const ids: string[] = [root];
  const seen = new Set(ids);
  for (const id of ids) {
    const children = input.childSessionsByParentSessionId[id] ?? [];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      ids.push(child.id);
    }
  }
  return ids;
}

function parseErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const message = (payload as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}

export function SessionScreenApp() {
  type StreamStatus = "connecting" | "connected" | "reconnecting";
  type ConfigPanelTab = "usage" | "memory" | "background";

  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, LocalChatMessage[]>>({});
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const [modelError, setModelError] = useState("");
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [showThinkingDetails, setShowThinkingDetails] = useState(() =>
    loadBooleanSetting(CHAT_SHOW_THINKING_KEY, false),
  );
  const [showToolCallDetails, setShowToolCallDetails] = useState(() =>
    loadBooleanSetting(CHAT_SHOW_TOOL_CALLS_KEY, false),
  );
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [usage, setUsage] = useState<UsageSnapshot>({
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  });
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatusSnapshot | null>(null);
  const [memoryActivity, setMemoryActivity] = useState<MemoryWriteEvent[]>([]);
  const [memoryError, setMemoryError] = useState("");
  const [heartbeatAt, setHeartbeatAt] = useState<string>("");
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [draftMessage, setDraftMessage] = useState("");
  const [draftAttachments, setDraftAttachments] = useState<ComposerAttachment[]>([]);
  const [activeSend, setActiveSend] = useState<ActiveSend | null>(null);
  const [runWaitTimeoutMs, setRunWaitTimeoutMs] = useState(DEFAULT_RUN_WAIT_TIMEOUT_MS);
  const [runtimeDefaultModel, setRuntimeDefaultModel] = useState("");
  const [isSyncingRuntimeDefaultModel, setIsSyncingRuntimeDefaultModel] = useState(false);
  const [runStatusBySession, setRunStatusBySession] = useState<Record<string, SessionRunStatusSnapshot>>({});
  const [runErrorsBySession, setRunErrorsBySession] = useState<Record<string, string>>({});
  const [pendingPermissionsBySession, setPendingPermissionsBySession] = useState<
    Record<string, PermissionPromptRequest[]>
  >({});
  const [pendingQuestionsBySession, setPendingQuestionsBySession] = useState<
    Record<string, QuestionPromptRequest[]>
  >({});
  const [promptBusyRequestId, setPromptBusyRequestId] = useState("");
  const [promptError, setPromptError] = useState("");
  const [compactedAtBySession, setCompactedAtBySession] = useState<Record<string, string>>({});
  const [backgroundRunsBySession, setBackgroundRunsBySession] = useState<Record<string, BackgroundRunSnapshot[]>>({});
  const [activeConfigPanelTab, setActiveConfigPanelTab] = useState<ConfigPanelTab>("usage");
  const [expandedSessionGroupsById, setExpandedSessionGroupsById] = useState<Record<string, boolean>>({});
  const [showAllChildren, setShowAllChildren] = useState(false);
  const [childSessionSearchQuery, setChildSessionSearchQuery] = useState("");
  const [childSessionHideAfterDays, setChildSessionHideAfterDays] = useState(DEFAULT_CHILD_SESSION_HIDE_AFTER_DAYS);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [focusedModelIndex, setFocusedModelIndex] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const loadedSessionsRef = useRef(new Set<string>());
  const loadedBackgroundSessionsRef = useRef(new Set<string>());
  const backgroundRunsBySessionRef = useRef<Record<string, BackgroundRunSnapshot[]>>({});
  const activeSendRef = useRef<ActiveSend | null>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const abortedRequestIdsRef = useRef(new Set<string>());
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const modelSearchInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const previousActiveSessionIdRef = useRef("");
  const {
    abortBackgroundRun,
    backgroundActionBusyByRun,
    backgroundCheckInBusyByRun,
    backgroundPrompt,
    backgroundRunsError,
    backgroundSpawnBusy,
    backgroundSteerDraftByRun,
    checkInBackgroundRun,
    focusedBackgroundRunId,
    loadingBackgroundRuns,
    refreshBackgroundRunsForSession,
    refreshInFlightBackgroundRuns,
    refreshSessionsList,
    setBackgroundActionBusyByRun,
    setBackgroundPrompt,
    setBackgroundSteerDraftByRun,
    setFocusedBackgroundRunId,
    spawnBackgroundRun,
    steerBackgroundRun,
  } = useBackgroundRuns({
    activeSessionId,
    sessions,
    loadedBackgroundSessionsRef,
    setBackgroundRunsBySession,
    setSessions,
    setActiveSessionId,
    setActiveConfigPanelTab,
  });
  backgroundRunsBySessionRef.current = backgroundRunsBySession;

  useSessionScreenBootstrap({
    loadedSessionsRef,
    loadedBackgroundSessionsRef,
    setLoading,
    setLoadingModels,
    setSessions,
    setUsage,
    setHeartbeatAt,
    setActiveSessionId,
    setModelOptions,
    setModelError,
    setMemoryStatus,
    setMemoryActivity,
    setRunWaitTimeoutMs,
    setChildSessionHideAfterDays,
    setRuntimeDefaultModel,
    setBackgroundRunsBySession,
    setPendingPermissionsBySession,
    setPendingQuestionsBySession,
    setMemoryError,
    setStreamStatus,
    setMessagesBySession,
  });

  useSessionEvents({
    backgroundRunsBySessionRef,
    loadedSessionsRef,
    loadedBackgroundSessionsRef,
    activeSendRef,
    setHeartbeatAt,
    setUsage,
    setSessions,
    setMessagesBySession,
    setRunStatusBySession,
    setRunErrorsBySession,
    setCompactedAtBySession,
    setBackgroundRunsBySession,
    setBackgroundSteerDraftByRun,
    setBackgroundActionBusyByRun,
    setFocusedBackgroundRunId,
    setPendingPermissionsBySession,
    setPendingQuestionsBySession,
    setRunWaitTimeoutMs,
    setChildSessionHideAfterDays,
    setRuntimeDefaultModel,
    setStreamStatus,
    setMemoryStatus,
    setMemoryActivity,
    setMemoryError,
  });

  useEffect(() => {
    if (!activeSessionId || loadedSessionsRef.current.has(activeSessionId)) return;

    let cancelled = false;
    const loadMessages = async () => {
      setLoadingMessages(true);
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(activeSessionId)}/messages`);
        const payload = (await response.json()) as { messages: ChatMessage[]; error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load messages");
        }
        if (cancelled) return;

        setMessagesBySession(current => ({
          ...current,
          [activeSessionId]: payload.messages,
        }));
        loadedSessionsRef.current.add(activeSessionId);
      } catch (error) {
        console.error(error);
      } finally {
        if (!cancelled) {
          setLoadingMessages(false);
        }
      }
    };

    loadMessages().catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId || loadedBackgroundSessionsRef.current.has(activeSessionId)) return;

    const loadBackgroundRuns = async () => {
      await refreshBackgroundRunsForSession(activeSessionId);
    };

    void loadBackgroundRuns();
  }, [activeSessionId, refreshBackgroundRunsForSession]);

  useEffect(() => {
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshMemory = async () => {
      try {
        const [statusResponse, activityResponse] = await Promise.all([
          fetch("/api/memory/status"),
          fetch("/api/memory/activity?limit=12"),
        ]);
        const statusPayload = (await statusResponse.json()) as { status?: MemoryStatusSnapshot; error?: string };
        const activityPayload = (await activityResponse.json()) as { events?: MemoryWriteEvent[]; error?: string };
        if (cancelled) return;
        if (statusResponse.ok && statusPayload.status) {
          setMemoryStatus(statusPayload.status);
        }
        if (activityResponse.ok && Array.isArray(activityPayload.events)) {
          setMemoryActivity(activityPayload.events);
        }
      } catch {
        // non-blocking; live memory telemetry should not disrupt chat
      }
    };

    const interval = setInterval(() => {
      void refreshMemory();
    }, 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_SHOW_THINKING_KEY, String(showThinkingDetails));
    } catch {
      // ignore localStorage write failures
    }
  }, [showThinkingDetails]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_SHOW_TOOL_CALLS_KEY, String(showToolCallDetails));
    } catch {
      // ignore localStorage write failures
    }
  }, [showToolCallDetails]);

  const activeMessages = useMemo(() => messagesBySession[activeSessionId] ?? [], [messagesBySession, activeSessionId]);
  const activeSession = useMemo(
    () => sessions.find(session => session.id === activeSessionId) ?? sessions[0],
    [sessions, activeSessionId],
  );
  const activeSessionRunStatus = activeSession ? runStatusBySession[activeSession.id] : undefined;
  const activeSessionRunError = activeSession ? (runErrorsBySession[activeSession.id] ?? "") : "";
  const activeSessionCompactedAt = activeSession ? (compactedAtBySession[activeSession.id] ?? "") : "";
  const {
    abortActiveRun,
    chatControlError,
    compactSession,
    handleComposerPaste,
    handleComposerKeyDown,
    isAborting,
    isCompacting,
    removeComposerAttachment,
    retryFailedRequest,
    sendMessage,
  } = useChatSession({
    activeSession,
    draftMessage,
    draftAttachments,
    runWaitTimeoutMs,
    composerFormRef,
    messagesBySession,
    loadedSessionsRef,
    activeSendRef,
    activeAbortControllerRef,
    abortedRequestIdsRef,
    setDraftMessage,
    setDraftAttachments,
    setMessagesBySession,
    setRunErrorsBySession,
    setRunStatusBySession,
    setSessions,
    setCompactedAtBySession,
    setActiveSend,
  });
  const {
    activeBackgroundRuns,
    inFlightBackgroundRunsBySession,
    latestBackgroundRunByChildSessionId,
    rootSessions,
    childSessionsByParentSessionId,
    sessionSearchNeedle,
    childSessionVisibilityByParentSessionId,
    childSessionSearchMatchBySessionId,
    parentSessionSearchMatchBySessionId,
    totalSessionSearchMatches,
    totalHiddenChildSessionsByAge,
    totalInFlightBackgroundRuns,
    activeBackgroundInFlightCount,
  } = useSessionHierarchy({
    activeSessionId,
    sessions,
    backgroundRunsBySession,
    childSessionSearchQuery,
    showAllChildren,
    childSessionHideAfterDays,
    referenceNowMs: nowMs,
  });
  const isActiveSessionRunning =
    Boolean(activeSend) && Boolean(activeSession) && activeSend?.sessionId === activeSession?.id;
  const canAbortActiveSession = isActiveSessionRunning && !isAborting;
  const activeRunStatusLabel = activeSessionRunStatus?.status ?? (isActiveSessionRunning ? "busy" : "idle");
  const activeRunStatusHint =
    activeSessionRunStatus?.status === "retry"
      ? `${activeSessionRunStatus.message ?? "retrying"}${
          activeSessionRunStatus.nextAt ? ` · next ${formatTimestampSummary(activeSessionRunStatus.nextAt)}` : ""
        }`
      : "";
  const promptScopeSessionIds = useMemo(
    () =>
      collectPromptScopeSessionIds({
        rootSessionId: activeSessionId,
        childSessionsByParentSessionId,
      }),
    [activeSessionId, childSessionsByParentSessionId],
  );
  const scopedPendingPermissions = useMemo(() => {
    const list: PermissionPromptRequest[] = [];
    for (const sessionId of promptScopeSessionIds) {
      const items = pendingPermissionsBySession[sessionId] ?? [];
      list.push(...items);
    }
    return sortPromptRequests(list);
  }, [pendingPermissionsBySession, promptScopeSessionIds]);
  const scopedPendingQuestions = useMemo(() => {
    const list: QuestionPromptRequest[] = [];
    for (const sessionId of promptScopeSessionIds) {
      const items = pendingQuestionsBySession[sessionId] ?? [];
      list.push(...items);
    }
    return sortPromptRequests(list);
  }, [pendingQuestionsBySession, promptScopeSessionIds]);
  const activePermissionRequest = scopedPendingPermissions[0];
  const activeQuestionRequest = activePermissionRequest ? undefined : scopedPendingQuestions[0];
  const promptBlocked = Boolean(activePermissionRequest || activeQuestionRequest);
  const availableModels = useMemo(() => {
    const byId = new Map(modelOptions.map(option => [option.id, option]));
    if (activeSession?.model && !byId.has(activeSession.model)) {
      const [providerId, ...rest] = activeSession.model.split("/");
      const modelId = rest.join("/") || activeSession.model;
      byId.set(activeSession.model, {
        id: activeSession.model,
        label: `${activeSession.model} (current)`,
        providerId: providerId || "custom",
        modelId,
      });
    }
    return [...byId.values()];
  }, [modelOptions, activeSession?.model]);
  const selectedModelLabel = useMemo(() => {
    if (!activeSession) return "Select model";
    return availableModels.find(option => option.id === activeSession.model)?.label ?? activeSession.model;
  }, [availableModels, activeSession]);
  const sessionMatchesRuntimeDefault = useMemo(() => {
    if (!activeSession) return true;
    if (!runtimeDefaultModel.trim()) return true;
    return activeSession.model === runtimeDefaultModel;
  }, [activeSession, runtimeDefaultModel]);
  const filteredModelOptions = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    if (!query) return availableModels;
    return availableModels.filter(option => {
      const haystack = `${option.label} ${option.id} ${option.providerId} ${option.modelId}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [availableModels, modelQuery]);

  useEffect(() => {
    setFocusedModelIndex(0);
  }, [filteredModelOptions]);

  useEffect(() => {
    setIsModelPickerOpen(false);
    setModelQuery("");
  }, [activeSessionId]);

  useEffect(() => {
    if (!promptBusyRequestId) return;
    const requestStillPending =
      scopedPendingPermissions.some(item => item.id === promptBusyRequestId) ||
      scopedPendingQuestions.some(item => item.id === promptBusyRequestId);
    if (!requestStillPending) {
      setPromptBusyRequestId("");
    }
  }, [promptBusyRequestId, scopedPendingPermissions, scopedPendingQuestions]);

  useEffect(() => {
    setPromptError("");
  }, [activeSessionId]);

  useEffect(() => {
    if (!isModelPickerOpen) return;

    modelSearchInputRef.current?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      if (!modelPickerRef.current?.contains(event.target as Node)) {
        setIsModelPickerOpen(false);
      }
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsModelPickerOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isModelPickerOpen]);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      const threshold = 100;
      const isScrolledUp = container.scrollHeight - container.scrollTop - container.clientHeight > threshold;
      setIsUserScrolledUp(isScrolledUp);
      if (!isScrolledUp) {
        setHasNewMessages(false);
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;

    if (previousActiveSessionIdRef.current !== activeSessionId) {
      container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
      setIsUserScrolledUp(false);
      setHasNewMessages(false);
    } else if (!isUserScrolledUp) {
      container.scrollTo({ top: container.scrollHeight, behavior: isActiveSessionRunning ? "auto" : "smooth" });
    } else if (activeMessages.length > 0) {
      setHasNewMessages(true);
    }
    previousActiveSessionIdRef.current = activeSessionId;
  }, [activeSessionId, activeMessages, loadingMessages, isActiveSessionRunning, isUserScrolledUp]);

  function scrollToBottom() {
    const container = chatScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    setIsUserScrolledUp(false);
    setHasNewMessages(false);
  }
  function requestAbortRun() {
    if (!activeSession) return;
    setConfirmAction({ type: "abort-run", sessionId: activeSession.id });
  }

  function requestAbortBackgroundRun(runId: string) {
    setConfirmAction({ type: "abort-background", runId });
  }

  function handleConfirmAction() {
    const action = confirmAction;
    setConfirmAction(null);
    if (!action) return;
    if (action.type === "abort-run") {
      void abortActiveRun();
      return;
    }
    if (action.type === "abort-background") {
      void abortBackgroundRun(action.runId);
    }
  }

  function toggleSessionGroup(sessionId: string) {
    setExpandedSessionGroupsById(current => ({
      ...current,
      [sessionId]: !current[sessionId],
    }));
  }

  async function saveSessionModel(model: string) {
    if (!activeSession || model === activeSession.model) return;

    setIsSavingModel(true);
    setModelError("");
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(activeSession.id)}/model`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const payload = (await response.json()) as {
        session?: SessionSummary;
        configHash?: string;
        configError?: string;
        configStage?: string;
        runtimeDefaultModel?: string;
        sessionMatchesRuntimeDefault?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.session) {
        throw new Error(payload.error ?? "Failed to update session model");
      }
      const updated = payload.session;

      setSessions(current => upsertSessionList(current, updated));
      if (typeof payload.runtimeDefaultModel === "string") {
        setRuntimeDefaultModel(payload.runtimeDefaultModel);
      }
      if (typeof payload.configError === "string" && payload.configError.trim()) {
        const stagePrefix =
          typeof payload.configStage === "string" && payload.configStage.trim()
            ? `[${payload.configStage}] `
            : "";
        setModelError(
          `Session model updated, but runtime default did not change (${payload.runtimeDefaultModel || "unknown"}): ${stagePrefix}${payload.configError}`,
        );
      }
    } catch (error) {
      setModelError(error instanceof Error ? error.message : "Failed to update session model");
    } finally {
      setIsSavingModel(false);
    }
  }

  async function syncRuntimeDefaultToActiveModel() {
    if (!activeSession) return;
    setIsSyncingRuntimeDefaultModel(true);
    setModelError("");
    try {
      const response = await fetch("/api/runtime/default-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: activeSession.model }),
      });
      const payload = (await response.json()) as {
        runtimeDefaultModel?: string;
        configHash?: string;
        stage?: string;
        error?: string;
      };
      if (!response.ok) {
        const stagePrefix =
          typeof payload.stage === "string" && payload.stage.trim() ? `[${payload.stage}] ` : "";
        throw new Error(`${stagePrefix}${payload.error ?? "Failed to sync runtime default model"}`);
      }
      if (typeof payload.runtimeDefaultModel === "string") {
        setRuntimeDefaultModel(payload.runtimeDefaultModel);
      }
    } catch (error) {
      setModelError(error instanceof Error ? error.message : "Failed to sync runtime default model");
    } finally {
      setIsSyncingRuntimeDefaultModel(false);
    }
  }

  async function selectModelFromPicker(model: string) {
    setModelQuery("");
    setIsModelPickerOpen(false);
    await saveSessionModel(model);
  }

  function handleModelSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusedModelIndex(current => Math.min(current + 1, filteredModelOptions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusedModelIndex(current => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const focusedModel = filteredModelOptions[focusedModelIndex];
      if (focusedModel) {
        void selectModelFromPicker(focusedModel.id);
      }
    }
  }

  async function createNewSession() {
    setIsCreatingSession(true);
    setSessionError("");
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as { session?: SessionSummary; error?: string };
      if (!response.ok || !payload.session) {
        throw new Error(payload.error ?? "Failed to create session");
      }
      const created = payload.session;

      loadedSessionsRef.current.add(created.id);
      loadedBackgroundSessionsRef.current.add(created.id);
      setMessagesBySession(current => ({
        ...current,
        [created.id]: current[created.id] ?? [],
      }));
      setBackgroundRunsBySession(current => ({
        ...current,
        [created.id]: current[created.id] ?? [],
      }));
      setSessions(current => sortSessionsByActivity([created, ...current.filter(session => session.id !== created.id)]));
      setActiveSessionId(created.id);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Failed to create session");
    } finally {
      setIsCreatingSession(false);
    }
  }

  async function replyPermissionPrompt(input: {
    requestId: string;
    sessionId: string;
    reply: "once" | "always" | "reject";
  }) {
    if (!input.requestId.trim()) return;
    setPromptBusyRequestId(input.requestId);
    setPromptError("");
    try {
      const response = await fetch(`/api/ui/prompts/permission/${encodeURIComponent(input.requestId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: input.reply }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(parseErrorMessage(payload, "Failed to reply to permission request"));
      }
      setPendingPermissionsBySession(current => {
        const existing = current[input.sessionId] ?? [];
        const nextList = existing.filter(item => item.id !== input.requestId);
        if (nextList.length === existing.length) return current;
        return {
          ...current,
          [input.sessionId]: nextList,
        };
      });
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : "Failed to reply to permission request");
    } finally {
      setPromptBusyRequestId(current => (current === input.requestId ? "" : current));
    }
  }

  async function replyQuestionPrompt(input: {
    requestId: string;
    sessionId: string;
    answers: Array<Array<string>>;
  }) {
    if (!input.requestId.trim()) return;
    setPromptBusyRequestId(input.requestId);
    setPromptError("");
    try {
      const response = await fetch(`/api/ui/prompts/question/${encodeURIComponent(input.requestId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: input.answers }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(parseErrorMessage(payload, "Failed to reply to question request"));
      }
      setPendingQuestionsBySession(current => {
        const existing = current[input.sessionId] ?? [];
        const nextList = existing.filter(item => item.id !== input.requestId);
        if (nextList.length === existing.length) return current;
        return {
          ...current,
          [input.sessionId]: nextList,
        };
      });
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : "Failed to reply to question request");
    } finally {
      setPromptBusyRequestId(current => (current === input.requestId ? "" : current));
    }
  }

  async function rejectQuestionPrompt(input: { requestId: string; sessionId: string }) {
    if (!input.requestId.trim()) return;
    setPromptBusyRequestId(input.requestId);
    setPromptError("");
    try {
      const response = await fetch(`/api/ui/prompts/question/${encodeURIComponent(input.requestId)}/reject`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(parseErrorMessage(payload, "Failed to reject question request"));
      }
      setPendingQuestionsBySession(current => {
        const existing = current[input.sessionId] ?? [];
        const nextList = existing.filter(item => item.id !== input.requestId);
        if (nextList.length === existing.length) return current;
        return {
          ...current,
          [input.sessionId]: nextList,
        };
      });
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : "Failed to reject question request");
    } finally {
      setPromptBusyRequestId(current => (current === input.requestId ? "" : current));
    }
  }

  const chatPageModel: ChatPageModel = {
    activeBackgroundInFlightCount,
    activeBackgroundRuns,
    activeConfigPanelTab,
    activeMessages,
    activeRunStatusHint,
    activeRunStatusLabel,
    activeSession,
    activeSessionCompactedAt,
    activeSessionId,
    activeSessionRunError,
    availableModels,
    backgroundActionBusyByRun,
    backgroundCheckInBusyByRun,
    backgroundPrompt,
    backgroundRunsError,
    backgroundSpawnBusy,
    backgroundSteerDraftByRun,
    canAbortActiveSession,
    chatControlError,
    chatScrollRef,
    checkInBackgroundRun,
    childSessionHideAfterDays,
    childSessionSearchMatchBySessionId,
    childSessionSearchQuery,
    childSessionVisibilityByParentSessionId,
    childSessionsByParentSessionId,
    compactSession,
    composerFormRef,
    createNewSession,
    draftMessage,
    draftAttachments,
    expandedSessionGroupsById,
    filteredModelOptions,
    focusedBackgroundRunId,
    focusedModelIndex,
    handleComposerKeyDown,
    handleComposerPaste,
    handleModelSearchKeyDown,
    hasNewMessages,
    inFlightBackgroundRunsBySession,
    isAborting,
    isActiveSessionRunning,
    isCompacting,
    isCreatingSession,
    isModelPickerOpen,
    isSavingModel,
    isSending: isActiveSessionRunning,
    isUserScrolledUp,
    latestBackgroundRunByChildSessionId,
    loading,
    loadingBackgroundRuns,
    loadingMessages,
    loadingModels,
    memoryActivity,
    memoryError,
    memoryStatus,
    modelError,
    modelPickerRef,
    modelQuery,
    modelSearchInputRef,
    parentSessionSearchMatchBySessionId,
    refreshBackgroundRunsForSession,
    refreshInFlightBackgroundRuns,
    refreshSessionsList,
    requestAbortBackgroundRun,
    requestAbortRun,
    retryFailedRequest,
    removeComposerAttachment,
    rootSessions,
    scrollToBottom,
    selectModelFromPicker,
    selectedModelLabel,
    runtimeDefaultModel,
    promptBlocked,
    activePermissionRequest,
    activeQuestionRequest,
    promptBusyRequestId,
    promptError,
    onPermissionPromptReply: (requestId, sessionId, reply) =>
      replyPermissionPrompt({ requestId, sessionId, reply }),
    onQuestionPromptReply: (requestId, sessionId, answers) =>
      replyQuestionPrompt({ requestId, sessionId, answers }),
    onQuestionPromptReject: (requestId, sessionId) =>
      rejectQuestionPrompt({ requestId, sessionId }),
    sessionMatchesRuntimeDefault,
    sendMessage,
    sessionError,
    sessionSearchNeedle,
    setActiveConfigPanelTab,
    setActiveSessionId,
    setBackgroundPrompt,
    setBackgroundSteerDraftByRun,
    setChildSessionSearchQuery,
    setDraftMessage,
    setIsModelPickerOpen,
    setModelQuery,
    setShowThinkingDetails,
    setShowToolCallDetails,
    setShowAllChildren,
    showThinkingDetails,
    showToolCallDetails,
    showAllChildren,
    syncRuntimeDefaultToActiveModel,
    isSyncingRuntimeDefaultModel,
    spawnBackgroundRun,
    steerBackgroundRun,
    toggleSessionGroup,
    totalHiddenChildSessionsByAge,
    totalInFlightBackgroundRuns,
    totalSessionSearchMatches,
    usage,
  };
  const sessionScreenModel = useSessionScreenController({
    chat: chatPageModel,
    streamStatus,
    heartbeatAt,
  });

  return (
    <main className="oc-app">
      {renderConfirmDialog()}
      <SessionScreen model={sessionScreenModel} />
    </main>
  );

  function renderConfirmDialog() {
    const props = getConfirmDialogProps(confirmAction);
    return (
      <ConfirmDialog
        open={props.open}
        title={props.title}
        description={props.description}
        confirmLabel={props.confirmLabel}
        variant={props.variant}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmAction(null)}
      />
    );
  }
}
