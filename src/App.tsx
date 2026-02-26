import {
  Activity,
  Cpu,
  Settings2,
  Users,
  Wrench,
} from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import {
  type ActiveSend,
  formatCompactTimestamp,
  type LocalChatMessage,
  normalizeListInput,
  relativeFromIso,
} from "@/frontend/app/chatHelpers";
import {
  fetchAgentCatalog,
  fetchMcpCatalog,
  fetchOtherConfig,
  fetchSkillCatalog,
  importManagedSkill,
  saveAgentTypeChanges,
  saveMcps,
  saveOtherConfig as saveOtherConfigPatch,
  saveSkills,
  validateAgentTypeChanges,
} from "@/frontend/app/configApi";
import {
  type ConfirmAction,
  getConfirmDialogProps,
} from "@/frontend/app/dashboardTypes";
import {
  DEFAULT_CHILD_SESSION_HIDE_AFTER_DAYS,
  DEFAULT_RUN_WAIT_TIMEOUT_MS,
  normalizeAgentTypeDraft,
  sortSessionsByActivity,
  upsertSessionList,
} from "@/frontend/app/dashboardUtils";
import { AgentsPage } from "@/frontend/app/pages/AgentsPage";
import { type ChatPageModel, ChatPage } from "@/frontend/app/pages/ChatPage";
import { McpPage } from "@/frontend/app/pages/McpPage";
import { OtherConfigPage } from "@/frontend/app/pages/OtherConfigPage";
import { SkillsPage } from "@/frontend/app/pages/SkillsPage";
import { useBackgroundRuns } from "@/frontend/app/useBackgroundRuns";
import { type ComposerAttachment, useChatSession } from "@/frontend/app/useChatSession";
import { useDashboardBootstrap } from "@/frontend/app/useDashboardBootstrap";
import { useSessionHierarchy } from "@/frontend/app/useSessionHierarchy";
import type {
  AgentTypeDefinition,
  BackgroundRunSnapshot,
  ChatMessage,
  MemoryStatusSnapshot,
  MemoryWriteEvent,
  ModelOption,
  ConfiguredMcpServer,
  SessionRunStatusSnapshot,
  SessionSummary,
  RuntimeMcp,
  RuntimeSkill,
  UsageSnapshot,
} from "@/types/dashboard";
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

export function App() {
  type StreamStatus = "connecting" | "connected" | "reconnecting";
  type DashboardPage = "chat" | "skills" | "mcp" | "agents" | "other";
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
  const [openAgentModelPickerId, setOpenAgentModelPickerId] = useState<string | null>(null);
  const [agentModelQuery, setAgentModelQuery] = useState("");
  const [agentFocusedModelIndex, setAgentFocusedModelIndex] = useState(0);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [agentTypes, setAgentTypes] = useState<AgentTypeDefinition[]>([]);
  const [dashboardPage, setDashboardPage] = useState<DashboardPage>("chat");
  const [configHash, setConfigHash] = useState("");
  const [agentConfigHash, setAgentConfigHash] = useState("");
  const [opencodeDirectory, setOpencodeDirectory] = useState("");
  const [opencodeConfigFilePath, setOpencodeConfigFilePath] = useState("");
  const [opencodePersistenceMode, setOpencodePersistenceMode] = useState("");
  const [skillsDraft, setSkillsDraft] = useState("");
  const [availableSkills, setAvailableSkills] = useState<RuntimeSkill[]>([]);
  const [availableMcps, setAvailableMcps] = useState<RuntimeMcp[]>([]);
  const [mcpServers, setMcpServers] = useState<ConfiguredMcpServer[]>([]);
  const [mcpsDraft, setMcpsDraft] = useState("");
  const [skillInput, setSkillInput] = useState("");
  const [mcpInput, setMcpInput] = useState("");
  const [importSkillId, setImportSkillId] = useState("");
  const [importSkillContent, setImportSkillContent] = useState("");
  const [isSavingSkills, setIsSavingSkills] = useState(false);
  const [isSavingMcps, setIsSavingMcps] = useState(false);
  const [isSavingAgents, setIsSavingAgents] = useState(false);
  const [isImportingSkill, setIsImportingSkill] = useState(false);
  const [loadingSkillCatalog, setLoadingSkillCatalog] = useState(false);
  const [loadingMcpCatalog, setLoadingMcpCatalog] = useState(false);
  const [loadingAgentCatalog, setLoadingAgentCatalog] = useState(false);
  const [skillsError, setSkillsError] = useState("");
  const [skillCatalogError, setSkillCatalogError] = useState("");
  const [mcpCatalogError, setMcpCatalogError] = useState("");
  const [mcpsError, setMcpsError] = useState("");
  const [mcpActionError, setMcpActionError] = useState("");
  const [mcpActionBusyId, setMcpActionBusyId] = useState("");
  const [agentsError, setAgentsError] = useState("");
  const [agentCatalogError, setAgentCatalogError] = useState("");
  const [agentTypesBaseline, setAgentTypesBaseline] = useState<AgentTypeDefinition[]>([]);
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
  const [runtimeFallbackModels, setRuntimeFallbackModels] = useState<string[]>([]);
  const [runtimeImageModel, setRuntimeImageModel] = useState("");
  const [isSyncingRuntimeDefaultModel, setIsSyncingRuntimeDefaultModel] = useState(false);
  const [isSavingOtherConfig, setIsSavingOtherConfig] = useState(false);
  const [loadingOtherConfig, setLoadingOtherConfig] = useState(false);
  const [otherConfigError, setOtherConfigError] = useState("");
  const [openFallbackModelPickerIndex, setOpenFallbackModelPickerIndex] = useState<number | null>(null);
  const [fallbackModelQuery, setFallbackModelQuery] = useState("");
  const [fallbackFocusedModelIndex, setFallbackFocusedModelIndex] = useState(0);
  const [runStatusBySession, setRunStatusBySession] = useState<Record<string, SessionRunStatusSnapshot>>({});
  const [runErrorsBySession, setRunErrorsBySession] = useState<Record<string, string>>({});
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
  const activeSendRef = useRef<ActiveSend | null>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const abortedRequestIdsRef = useRef(new Set<string>());
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const modelSearchInputRef = useRef<HTMLInputElement>(null);
  const agentModelPickerRef = useRef<HTMLDivElement>(null);
  const agentModelSearchInputRef = useRef<HTMLInputElement>(null);
  const fallbackModelPickerRef = useRef<HTMLDivElement>(null);
  const fallbackModelSearchInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const previousActiveSessionIdRef = useRef("");
  const isSending = activeSend !== null;
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

  useDashboardBootstrap({
    loadedSessionsRef,
    loadedBackgroundSessionsRef,
    activeSendRef,
    setLoading,
    setLoadingModels,
    setSessions,
    setSkillsDraft,
    setMcpsDraft,
    setAgentTypes,
    setAgentTypesBaseline,
    setUsage,
    setHeartbeatAt,
    setActiveSessionId,
    setModelOptions,
    setModelError,
    setMemoryStatus,
    setMemoryActivity,
    setAvailableSkills,
    setAvailableMcps,
    setAgentConfigHash,
    setOpencodeDirectory,
    setOpencodeConfigFilePath,
    setOpencodePersistenceMode,
    setMcpServers,
    setRunWaitTimeoutMs,
    setChildSessionHideAfterDays,
    setRuntimeDefaultModel,
    setRuntimeFallbackModels,
    setRuntimeImageModel,
    setConfigHash,
    setSkillCatalogError,
    setMcpCatalogError,
    setAgentCatalogError,
    setBackgroundRunsBySession,
    setMemoryError,
    setStreamStatus,
    setMessagesBySession,
    setRunStatusBySession,
    setRunErrorsBySession,
    setCompactedAtBySession,
    setBackgroundSteerDraftByRun,
    setBackgroundActionBusyByRun,
    setFocusedBackgroundRunId,
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
  const availableFallbackModels = useMemo(() => {
    const byId = new Map(modelOptions.map(option => [option.id, option]));
    for (const fallbackModel of runtimeFallbackModels) {
      const id = fallbackModel.trim();
      if (!id || byId.has(id)) continue;
      const [providerId, ...rest] = id.split("/");
      const modelId = rest.join("/") || id;
      byId.set(id, {
        id,
        label: `${id} (configured)`,
        providerId: providerId || "custom",
        modelId,
      });
    }
    return [...byId.values()];
  }, [modelOptions, runtimeFallbackModels]);
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
  const filteredFallbackModelOptions = useMemo(() => {
    const query = fallbackModelQuery.trim().toLowerCase();
    if (!query) return availableFallbackModels;
    return availableFallbackModels.filter(option => {
      const haystack = `${option.label} ${option.id} ${option.providerId} ${option.modelId}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [availableFallbackModels, fallbackModelQuery]);

  useEffect(() => {
    setFocusedModelIndex(0);
  }, [filteredModelOptions]);
  const configuredSkills = useMemo(() => normalizeListInput(skillsDraft), [skillsDraft]);
  const configuredSkillSet = useMemo(() => new Set(configuredSkills), [configuredSkills]);
  const configuredUnavailableSkills = useMemo(
    () => configuredSkills.filter(id => !availableSkills.some(skill => skill.id === id)),
    [availableSkills, configuredSkills],
  );
  const normalizedMcpServers = useMemo(() => {
    const deduped = new Map<string, ConfiguredMcpServer>();
    for (const server of mcpServers) {
      const id = server.id.trim();
      if (!id) continue;
      deduped.set(id, { ...server, id });
    }
    return [...deduped.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [mcpServers]);
  const configuredMcps = useMemo(() => normalizeListInput(mcpsDraft), [mcpsDraft]);
  const mcpServerIdSet = useMemo(() => new Set(normalizedMcpServers.map(server => server.id)), [normalizedMcpServers]);
  const configuredMcpSet = useMemo(() => new Set(configuredMcps), [configuredMcps]);
  const runtimeMcpById = useMemo(() => new Map(availableMcps.map(mcp => [mcp.id, mcp])), [availableMcps]);
  const discoverableMcps = useMemo(
    () => availableMcps.filter(mcp => !configuredMcpSet.has(mcp.id)),
    [availableMcps, configuredMcpSet],
  );

  useEffect(() => {
    setIsModelPickerOpen(false);
    setModelQuery("");
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
    if (!openAgentModelPickerId) return;
    agentModelSearchInputRef.current?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      if (!agentModelPickerRef.current?.contains(event.target as Node)) {
        setOpenAgentModelPickerId(null);
      }
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenAgentModelPickerId(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openAgentModelPickerId]);

  useEffect(() => {
    setAgentFocusedModelIndex(0);
  }, [agentModelQuery, openAgentModelPickerId]);

  useEffect(() => {
    if (openFallbackModelPickerIndex === null) return;
    fallbackModelSearchInputRef.current?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      if (!fallbackModelPickerRef.current?.contains(event.target as Node)) {
        setOpenFallbackModelPickerIndex(null);
      }
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenFallbackModelPickerIndex(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openFallbackModelPickerIndex]);

  useEffect(() => {
    setFallbackFocusedModelIndex(0);
  }, [fallbackModelQuery, openFallbackModelPickerIndex]);

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
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    } else if (activeMessages.length > 0) {
      setHasNewMessages(true);
    }
    previousActiveSessionIdRef.current = activeSessionId;
  }, [activeSessionId, activeMessages.length, loadingMessages, isSending, isUserScrolledUp]);

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

  function requestRemoveSkill(skillId: string) {
    setConfirmAction({ type: "remove-skill", skillId });
  }

  function requestRemoveMcp(mcpId: string) {
    setConfirmAction({ type: "remove-mcp", mcpId });
  }

  function requestDisconnectMcp(mcpId: string) {
    setConfirmAction({ type: "disconnect-mcp", mcpId });
  }

  function requestRemoveAgent(agentId: string) {
    setConfirmAction({ type: "remove-agent", agentId });
  }

  function handleConfirmAction() {
    const action = confirmAction;
    setConfirmAction(null);

    if (!action) return;

    switch (action.type) {
      case "abort-run":
        void abortActiveRun();
        break;
      case "abort-background":
        void abortBackgroundRun(action.runId);
        break;
      case "remove-skill":
        removeSkill(action.skillId);
        break;
      case "remove-mcp":
        removeMcp(action.mcpId);
        break;
      case "disconnect-mcp":
        void runMcpRuntimeAction(action.mcpId, "disconnect");
        break;
      case "remove-agent":
        removeAgentType(action.agentId);
        break;
    }
  }

  function toggleSessionGroup(sessionId: string) {
    setExpandedSessionGroupsById(current => ({
      ...current,
      [sessionId]: !current[sessionId],
    }));
  }

  async function refreshSkillCatalog() {
    setLoadingSkillCatalog(true);
    setSkillCatalogError("");
    setSkillsError("");
    try {
      const payload = await fetchSkillCatalog();
      setAvailableSkills(payload.skills);
      setSkillsDraft(payload.enabled.join("\n"));
      if (payload.hash) setConfigHash(payload.hash);
    } catch (error) {
      setSkillCatalogError(error instanceof Error ? error.message : "Failed to load runtime skills");
    } finally {
      setLoadingSkillCatalog(false);
    }
  }

  async function refreshMcpCatalog() {
    setLoadingMcpCatalog(true);
    setMcpCatalogError("");
    setMcpsError("");
    setMcpActionError("");
    try {
      const payload = await fetchMcpCatalog();
      setAvailableMcps(payload.mcps);
      setMcpServers(payload.servers);
      setMcpsDraft(payload.enabled.join("\n"));
      if (payload.hash) setConfigHash(payload.hash);
    } catch (error) {
      setMcpCatalogError(error instanceof Error ? error.message : "Failed to load runtime MCP servers");
    } finally {
      setLoadingMcpCatalog(false);
    }
  }

  async function refreshAgentCatalog() {
    setLoadingAgentCatalog(true);
    setAgentCatalogError("");
    try {
      const payload = await fetchAgentCatalog();
      setAgentTypes(payload.agentTypes);
      setAgentTypesBaseline(payload.agentTypes);
      if (payload.hash) setAgentConfigHash(payload.hash);
      setOpencodeDirectory(typeof payload.storage.directory === "string" ? payload.storage.directory : "");
      setOpencodeConfigFilePath(typeof payload.storage.configFilePath === "string" ? payload.storage.configFilePath : "");
      setOpencodePersistenceMode(typeof payload.storage.persistenceMode === "string" ? payload.storage.persistenceMode : "");
    } catch (error) {
      setAgentCatalogError(error instanceof Error ? error.message : "Failed to load OpenCode agent definitions");
    } finally {
      setLoadingAgentCatalog(false);
    }
  }

  function toggleSkillEnabled(skillId: string) {
    if (configuredSkillSet.has(skillId)) {
      setSkillsDraft(configuredSkills.filter(value => value !== skillId).join("\n"));
      return;
    }
    setSkillsDraft([...configuredSkills, skillId].join("\n"));
  }

  function addSkill() {
    const next = skillInput.trim();
    if (!next) return;
    const merged = [...configuredSkills, next];
    setSkillsDraft(normalizeListInput(merged.join("\n")).join("\n"));
    setSkillInput("");
  }

  function removeSkill(skill: string) {
    setSkillsDraft(configuredSkills.filter(value => value !== skill).join("\n"));
  }

  function mcpStatusVariant(status: RuntimeMcp["status"]) {
    if (status === "connected") return "success" as const;
    if (status === "failed" || status === "needs_client_registration") return "warning" as const;
    if (status === "needs_auth") return "warning" as const;
    return "outline" as const;
  }

  function mcpStatusLabel(status: RuntimeMcp["status"]) {
    if (status === "needs_auth") return "Needs Auth";
    if (status === "needs_client_registration") return "Needs Registration";
    return status.replaceAll("_", " ");
  }

  async function importSkill() {
    const id = importSkillId.trim();
    const content = importSkillContent.trim();
    if (!id || !content) return;

    setIsImportingSkill(true);
    setSkillsError("");
    try {
      const payload = await importManagedSkill({
        id,
        content,
        expectedHash: configHash || undefined,
        enable: true,
      });
      setImportSkillId("");
      setImportSkillContent("");
      setSkillsDraft(payload.skills.join("\n"));
      if (payload.hash) setConfigHash(payload.hash);
      await refreshSkillCatalog();
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : "Failed to import skill");
    } finally {
      setIsImportingSkill(false);
    }
  }

  function updateMcpServer(id: string, updater: (server: ConfiguredMcpServer) => ConfiguredMcpServer) {
    setMcpServers(current => current.map(server => (server.id === id ? updater(server) : server)));
  }

  function renameMcpServer(id: string, nextId: string) {
    const trimmed = nextId.trim();
    if (!trimmed) return;
    setMcpServers(current => {
      if (current.some(server => server.id !== id && server.id === trimmed)) return current;
      return current.map(server => (server.id === id ? { ...server, id: trimmed } : server));
    });
    setMcpsDraft(configuredMcps.map(value => (value === id ? trimmed : value)).join("\n"));
  }

  function setMcpServerType(id: string, type: "remote" | "local") {
    updateMcpServer(id, server => {
      if (server.type === type) return server;
      if (type === "remote") {
        return {
          id: server.id,
          type: "remote",
          enabled: server.enabled,
          url: "http://127.0.0.1:8000/mcp",
          headers: {},
          oauth: "auto",
        };
      }
      return {
        id: server.id,
        type: "local",
        enabled: server.enabled,
        command: ["bun", "run", "mcp-server.ts"],
        environment: {},
      };
    });
  }

  async function runMcpRuntimeAction(id: string, action: "connect" | "disconnect" | "authStart" | "authRemove") {
    setMcpActionBusyId(`${action}:${id}`);
    setMcpActionError("");
    try {
      const path =
        action === "connect"
          ? `/api/config/mcps/${encodeURIComponent(id)}/connect`
          : action === "disconnect"
            ? `/api/config/mcps/${encodeURIComponent(id)}/disconnect`
            : action === "authStart"
              ? `/api/config/mcps/${encodeURIComponent(id)}/auth/start`
              : `/api/config/mcps/${encodeURIComponent(id)}/auth/remove`;
      const response = await fetch(path, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        mcps?: RuntimeMcp[];
        authorizationUrl?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to ${action} MCP server`);
      }
      if (Array.isArray(payload.mcps)) {
        setAvailableMcps(payload.mcps);
      }
      if (action === "authStart" && typeof payload.authorizationUrl === "string" && payload.authorizationUrl.trim()) {
        window.open(payload.authorizationUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      setMcpActionError(error instanceof Error ? error.message : `Failed to ${action} MCP server`);
    } finally {
      setMcpActionBusyId("");
    }
  }

  function addMcp() {
    const next = mcpInput.trim();
    if (!next) return;
    const merged = [...configuredMcps, next];
    setMcpsDraft(normalizeListInput(merged.join("\n")).join("\n"));
    if (!mcpServerIdSet.has(next)) {
      setMcpServers(current => [
        ...current,
        {
          id: next,
          type: "remote",
          enabled: true,
          url: "http://127.0.0.1:8000/mcp",
          headers: {},
          oauth: "auto",
        },
      ]);
    }
    setMcpInput("");
  }

  function removeMcp(mcp: string) {
    setMcpsDraft(configuredMcps.filter(value => value !== mcp).join("\n"));
    setMcpServers(current => current.filter(server => server.id !== mcp));
  }

  function addAgentType() {
    const next: AgentTypeDefinition = {
      id: `agent-${crypto.randomUUID().slice(0, 8)}`,
      name: "New Agent Type",
      description: "Describe when to use this agent type.",
      prompt: "Describe how this agent type should behave.",
      model: activeSession?.model ?? modelOptions[0]?.id ?? "opencode/kimi-k2.5-free",
      mode: "subagent",
      hidden: false,
      disable: false,
      options: {},
    };
    setAgentTypes(current => [...current, next]);
  }

  function removeAgentType(agentTypeId: string) {
    setAgentTypes(current => current.filter(agentType => agentType.id !== agentTypeId));
  }

  function updateAgentTypeField<K extends keyof AgentTypeDefinition>(
    agentTypeId: string,
    field: K,
    value: AgentTypeDefinition[K],
  ) {
    setAgentTypes(current =>
      current.map(agentType => {
        if (agentType.id !== agentTypeId) return agentType;
        return {
          ...agentType,
          [field]: value,
        };
      }),
    );
  }

  async function saveSkillsConfig() {
    setIsSavingSkills(true);
    setSkillsError("");
    try {
      const payload = await saveSkills({
        skills: configuredSkills,
        expectedHash: configHash || undefined,
      });
      setSkillsDraft(payload.skills.join("\n"));
      setConfigHash(payload.hash || configHash);
      await refreshSkillCatalog();
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : "Failed to save skills");
    } finally {
      setIsSavingSkills(false);
    }
  }

  async function saveMcpsConfig() {
    setIsSavingMcps(true);
    setMcpsError("");
    try {
      const enabledSet = new Set(configuredMcps);
      const serversForSave = normalizedMcpServers.map(server => ({
        ...server,
        enabled: enabledSet.has(server.id),
      }));
      const undefinedEnabledIds = configuredMcps.filter(id => serversForSave.length > 0 && !serversForSave.some(server => server.id === id));
      if (undefinedEnabledIds.length > 0) {
        throw new Error(`Missing MCP definition for enabled server(s): ${undefinedEnabledIds.join(", ")}`);
      }
      const payload = await saveMcps({
        ...(serversForSave.length > 0 ? { servers: serversForSave } : { mcps: configuredMcps }),
        expectedHash: configHash || undefined,
      });

      setMcpsDraft(payload.mcps.join("\n"));
      setMcpServers(payload.servers);
      setConfigHash(payload.hash || configHash);
      await refreshMcpCatalog();
    } catch (error) {
      setMcpsError(error instanceof Error ? error.message : "Failed to save MCP servers");
    } finally {
      setIsSavingMcps(false);
    }
  }

  async function saveAgentTypesConfig() {
    setIsSavingAgents(true);
    setAgentsError("");
    try {
      const normalizedCurrent = agentTypes.map(normalizeAgentTypeDraft);
      const normalizedBaseline = agentTypesBaseline.map(normalizeAgentTypeDraft);
      const baselineById = new Map(normalizedBaseline.map(agentType => [agentType.id, agentType]));
      const currentById = new Map(normalizedCurrent.map(agentType => [agentType.id, agentType]));

      const upserts = normalizedCurrent.filter(agentType => {
        const previous = baselineById.get(agentType.id);
        if (!previous) return true;
        return JSON.stringify(previous) !== JSON.stringify(agentType);
      });
      const deletes = normalizedBaseline.map(agentType => agentType.id).filter(id => !currentById.has(id));
      if (upserts.length === 0 && deletes.length === 0) {
        setIsSavingAgents(false);
        return;
      }

      const validationPayload = await validateAgentTypeChanges({
        upserts,
        deletes,
      });
      if (validationPayload.ok !== true) {
        const firstIssue = validationPayload.issues?.[0];
        throw new Error(firstIssue?.message || "Agent validation failed");
      }
      if (!agentConfigHash.trim()) {
        throw new Error("Agent config hash missing. Refresh agents and try again.");
      }

      const payload = await saveAgentTypeChanges({
        upserts,
        deletes,
        expectedHash: agentConfigHash,
      });

      setAgentTypes(payload.agentTypes);
      setAgentTypesBaseline(payload.agentTypes);
      setAgentConfigHash(payload.hash || agentConfigHash);
      setOpencodeDirectory(typeof payload.storage.directory === "string" ? payload.storage.directory : opencodeDirectory);
      setOpencodeConfigFilePath(
        typeof payload.storage.configFilePath === "string" ? payload.storage.configFilePath : opencodeConfigFilePath,
      );
      setOpencodePersistenceMode(
        typeof payload.storage.persistenceMode === "string" ? payload.storage.persistenceMode : opencodePersistenceMode,
      );
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : "Failed to save agent types");
    } finally {
      setIsSavingAgents(false);
    }
  }

  async function refreshOtherConfig() {
    setLoadingOtherConfig(true);
    setOtherConfigError("");
    try {
      const payload = await fetchOtherConfig();
      setRuntimeFallbackModels([...new Set(payload.fallbackModels.map(model => model.trim()).filter(Boolean))]);
      setRuntimeImageModel(payload.imageModel.trim());
      if (payload.hash) setConfigHash(payload.hash);
    } catch (error) {
      setOtherConfigError(error instanceof Error ? error.message : "Failed to load runtime config");
    } finally {
      setLoadingOtherConfig(false);
    }
  }

  async function saveOtherConfig() {
    setIsSavingOtherConfig(true);
    setOtherConfigError("");
    try {
      const normalizedFallbackModels = [...new Set(runtimeFallbackModels.map(model => model.trim()).filter(Boolean))];
      const payload = await saveOtherConfigPatch({
        fallbackModels: normalizedFallbackModels,
        imageModel: runtimeImageModel,
        expectedHash: configHash || undefined,
      });
      setRuntimeFallbackModels(payload.fallbackModels);
      setRuntimeImageModel(payload.imageModel.trim());
      setConfigHash(payload.hash || configHash);
      setOpenFallbackModelPickerIndex(null);
      setFallbackModelQuery("");
    } catch (error) {
      setOtherConfigError(error instanceof Error ? error.message : "Failed to save runtime config");
    } finally {
      setIsSavingOtherConfig(false);
    }
  }

  function addFallbackModel() {
    const firstModelId = availableFallbackModels[0]?.id;
    if (!firstModelId) {
      setOtherConfigError("No available models to add as fallback.");
      return;
    }
    setOtherConfigError("");
    setRuntimeFallbackModels(current => [...current, firstModelId]);
  }

  function removeFallbackModel(index: number) {
    setRuntimeFallbackModels(current => current.filter((_, currentIndex) => currentIndex !== index));
    setOpenFallbackModelPickerIndex(current => {
      if (current === null) return current;
      if (current === index) return null;
      if (current > index) return current - 1;
      return current;
    });
  }

  function selectFallbackModelFromPicker(index: number, model: string) {
    setRuntimeFallbackModels(current =>
      current.map((currentModel, currentIndex) => (currentIndex === index ? model.trim() : currentModel)),
    );
    setFallbackModelQuery("");
    setOpenFallbackModelPickerIndex(null);
  }

  function handleFallbackModelSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFallbackFocusedModelIndex(current => Math.min(current + 1, filteredFallbackModelOptions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFallbackFocusedModelIndex(current => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const focusedModel = filteredFallbackModelOptions[fallbackFocusedModelIndex];
      if (focusedModel?.id) {
        selectFallbackModelFromPicker(index, focusedModel.id);
      }
    }
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
      if (typeof payload.configHash === "string" && payload.configHash.trim()) {
        setConfigHash(payload.configHash);
      }
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
      if (typeof payload.configHash === "string" && payload.configHash.trim()) {
        setConfigHash(payload.configHash);
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

  function filteredAgentModelOptions() {
    const query = agentModelQuery.trim().toLowerCase();
    if (!query) return availableModels;
    return availableModels.filter(option => {
      const haystack = `${option.label} ${option.id} ${option.providerId} ${option.modelId}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  function selectAgentModelFromPicker(agentId: string, model: string) {
    updateAgentTypeField(agentId, "model", model.trim() || undefined);
    setAgentModelQuery("");
    setOpenAgentModelPickerId(null);
  }

  function handleAgentModelSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, agentId: string) {
    const options = filteredAgentModelOptions();
    const maxIndex = options.length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setAgentFocusedModelIndex(current => Math.min(current + 1, maxIndex));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setAgentFocusedModelIndex(current => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (agentFocusedModelIndex === 0) {
        selectAgentModelFromPicker(agentId, "");
        return;
      }
      const focused = options[agentFocusedModelIndex - 1];
      if (focused?.id) {
        selectAgentModelFromPicker(agentId, focused.id);
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
    isSending,
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

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:h-screen lg:overflow-hidden lg:px-8">
      {renderConfirmDialog()}
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-4">
        <header className="panel-noise rounded-2xl border border-border bg-card px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-display text-sm uppercase tracking-[0.2em] text-muted-foreground">Wafflebot</p>
              <h1 className="font-display text-2xl leading-none sm:text-3xl">OpenCode Dashboard</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                OpenCode-native chat and orchestration with live session events.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="success">online</Badge>
              <Badge variant={streamStatus === "connected" ? "success" : "warning"}>{streamStatus}</Badge>
              <Badge variant="outline">heartbeat {heartbeatAt ? formatTimestampSummary(heartbeatAt) : "pending"}</Badge>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={dashboardPage === "chat" ? "default" : "outline"}
              size="sm"
              onClick={() => setDashboardPage("chat")}
            >
              <Activity className="size-4" />
              Chat
            </Button>
            <Button
              type="button"
              variant={dashboardPage === "skills" ? "default" : "outline"}
              size="sm"
              onClick={() => setDashboardPage("skills")}
            >
              <Wrench className="size-4" />
              Skills
            </Button>
            <Button
              type="button"
              variant={dashboardPage === "mcp" ? "default" : "outline"}
              size="sm"
              onClick={() => setDashboardPage("mcp")}
            >
              <Cpu className="size-4" />
              MCP
            </Button>
            <Button
              type="button"
              variant={dashboardPage === "agents" ? "default" : "outline"}
              size="sm"
              onClick={() => setDashboardPage("agents")}
            >
              <Users className="size-4" />
              Agents
            </Button>
            <Button
              type="button"
              variant={dashboardPage === "other" ? "default" : "outline"}
              size="sm"
              onClick={() => setDashboardPage("other")}
            >
              <Settings2 className="size-4" />
              Other Config
            </Button>
          </div>
        </header>

        {dashboardPage === "chat" && <ChatPage model={chatPageModel} />}

        {dashboardPage === "skills" && (
          <SkillsPage
            skillInput={skillInput}
            setSkillInput={setSkillInput}
            addSkill={addSkill}
            loadingSkillCatalog={loadingSkillCatalog}
            availableSkills={availableSkills}
            configuredSkillSet={configuredSkillSet}
            toggleSkillEnabled={toggleSkillEnabled}
            configuredUnavailableSkills={configuredUnavailableSkills}
            requestRemoveSkill={requestRemoveSkill}
            refreshSkillCatalog={refreshSkillCatalog}
            saveSkillsConfig={saveSkillsConfig}
            isSavingSkills={isSavingSkills}
            skillCatalogError={skillCatalogError}
            skillsError={skillsError}
            importSkillId={importSkillId}
            setImportSkillId={setImportSkillId}
            importSkillContent={importSkillContent}
            setImportSkillContent={setImportSkillContent}
            importSkill={importSkill}
            isImportingSkill={isImportingSkill}
            skillsDraft={skillsDraft}
            setSkillsDraft={setSkillsDraft}
            configuredSkills={configuredSkills}
          />
        )}

        {dashboardPage === "mcp" && (
          <McpPage
            mcpInput={mcpInput}
            setMcpInput={setMcpInput}
            addMcp={addMcp}
            configuredMcps={configuredMcps}
            runtimeMcpById={runtimeMcpById}
            mcpStatusVariant={mcpStatusVariant}
            mcpStatusLabel={mcpStatusLabel}
            runMcpRuntimeAction={runMcpRuntimeAction}
            mcpActionBusyId={mcpActionBusyId}
            requestDisconnectMcp={requestDisconnectMcp}
            requestRemoveMcp={requestRemoveMcp}
            discoverableMcps={discoverableMcps}
            setMcpsDraft={setMcpsDraft}
            mcpServerIdSet={mcpServerIdSet}
            setMcpServers={setMcpServers}
            refreshMcpCatalog={refreshMcpCatalog}
            loadingMcpCatalog={loadingMcpCatalog}
            saveMcpsConfig={saveMcpsConfig}
            isSavingMcps={isSavingMcps}
            mcpCatalogError={mcpCatalogError}
            mcpsError={mcpsError}
            mcpActionError={mcpActionError}
            normalizedMcpServers={normalizedMcpServers}
            renameMcpServer={renameMcpServer}
            setMcpServerType={setMcpServerType}
            configuredMcpSet={configuredMcpSet}
            updateMcpServer={updateMcpServer}
          />
        )}

        {dashboardPage === "agents" && (
          <AgentsPage
            refreshAgentCatalog={refreshAgentCatalog}
            loadingAgentCatalog={loadingAgentCatalog}
            saveAgentTypesConfig={saveAgentTypesConfig}
            isSavingAgents={isSavingAgents}
            agentsError={agentsError}
            agentCatalogError={agentCatalogError}
            opencodeConfigFilePath={opencodeConfigFilePath}
            opencodeDirectory={opencodeDirectory}
            opencodePersistenceMode={opencodePersistenceMode}
            addAgentType={addAgentType}
            agentTypes={agentTypes}
            requestRemoveAgent={requestRemoveAgent}
            updateAgentTypeField={updateAgentTypeField}
            openAgentModelPickerId={openAgentModelPickerId}
            setOpenAgentModelPickerId={setOpenAgentModelPickerId}
            setAgentModelQuery={setAgentModelQuery}
            agentModelPickerRef={agentModelPickerRef}
            availableModels={availableModels}
            agentModelSearchInputRef={agentModelSearchInputRef}
            agentModelQuery={agentModelQuery}
            handleAgentModelSearchKeyDown={handleAgentModelSearchKeyDown}
            selectAgentModelFromPicker={selectAgentModelFromPicker}
            filteredAgentModelOptions={filteredAgentModelOptions}
            agentFocusedModelIndex={agentFocusedModelIndex}
          />
        )}

        {dashboardPage === "other" && (
          <OtherConfigPage
            refreshOtherConfig={refreshOtherConfig}
            loadingOtherConfig={loadingOtherConfig}
            saveOtherConfig={saveOtherConfig}
            isSavingOtherConfig={isSavingOtherConfig}
            otherConfigError={otherConfigError}
            runtimeFallbackModels={runtimeFallbackModels}
            availableFallbackModels={availableFallbackModels}
            addFallbackModel={addFallbackModel}
            removeFallbackModel={removeFallbackModel}
            openFallbackModelPickerIndex={openFallbackModelPickerIndex}
            setOpenFallbackModelPickerIndex={setOpenFallbackModelPickerIndex}
            setFallbackModelQuery={setFallbackModelQuery}
            fallbackModelPickerRef={fallbackModelPickerRef}
            fallbackModelSearchInputRef={fallbackModelSearchInputRef}
            fallbackModelQuery={fallbackModelQuery}
            handleFallbackModelSearchKeyDown={handleFallbackModelSearchKeyDown}
            selectFallbackModelFromPicker={selectFallbackModelFromPicker}
            filteredFallbackModelOptions={() => filteredFallbackModelOptions}
            fallbackFocusedModelIndex={fallbackFocusedModelIndex}
            runtimeImageModel={runtimeImageModel}
            setRuntimeImageModel={setRuntimeImageModel}
          />
        )}
      </div>
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
