import {
  Activity,
  Cpu,
  Users,
  Wrench,
} from "lucide-react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import {
  type ActiveSend,
  type LocalChatMessage,
  mergeMessages,
  normalizeListInput,
  normalizeRequestError,
  relativeFromIso,
} from "@/frontend/app/chatHelpers";
import {
  type AgentRunSnapshot,
  type BackgroundRunsResponse,
  type ConfigSnapshotResponse,
  type ConfirmAction,
  type OpencodeAgentStorageResponse,
  type RuntimeInfoResponse,
  fromLegacyAgent,
  getConfirmDialogProps,
} from "@/frontend/app/dashboardTypes";
import {
  DEFAULT_CHILD_SESSION_HIDE_AFTER_DAYS,
  DEFAULT_RUN_WAIT_TIMEOUT_MS,
  RUN_POLL_INTERVAL_MS,
  extractRunErrorMessage,
  mergeBackgroundRunsBySession,
  normalizeAgentTypeDraft,
  normalizeChildSessionHideAfterDays,
  sortBackgroundRuns,
  sortSessionsByActivity,
  upsertSessionList,
} from "@/frontend/app/dashboardUtils";
import { AgentsPage } from "@/frontend/app/pages/AgentsPage";
import { ChatPage } from "@/frontend/app/pages/ChatPage";
import { McpPage } from "@/frontend/app/pages/McpPage";
import { SkillsPage } from "@/frontend/app/pages/SkillsPage";
import { useSessionHierarchy } from "@/frontend/app/useSessionHierarchy";
import type {
  AgentTypeDefinition,
  BackgroundRunSnapshot,
  ChatMessage,
  DashboardBootstrap,
  MemoryStatusSnapshot,
  MemoryWriteEvent,
  ModelOption,
  ConfiguredMcpServer,
  SessionCompactedSnapshot,
  SessionRunErrorSnapshot,
  SessionRunStatusSnapshot,
  SessionSummary,
  RuntimeMcp,
  RuntimeSkill,
  UsageSnapshot,
} from "@/types/dashboard";
import "@/index.css";

export function App() {
  type StreamStatus = "connecting" | "connected" | "reconnecting";
  type DashboardPage = "chat" | "skills" | "mcp" | "agents";
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
  const [activeSend, setActiveSend] = useState<ActiveSend | null>(null);
  const [runWaitTimeoutMs, setRunWaitTimeoutMs] = useState(DEFAULT_RUN_WAIT_TIMEOUT_MS);
  const [isAborting, setIsAborting] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [chatControlError, setChatControlError] = useState("");
  const [runStatusBySession, setRunStatusBySession] = useState<Record<string, SessionRunStatusSnapshot>>({});
  const [runErrorsBySession, setRunErrorsBySession] = useState<Record<string, string>>({});
  const [compactedAtBySession, setCompactedAtBySession] = useState<Record<string, string>>({});
  const [backgroundRunsBySession, setBackgroundRunsBySession] = useState<Record<string, BackgroundRunSnapshot[]>>({});
  const [loadingBackgroundRuns, setLoadingBackgroundRuns] = useState(false);
  const [backgroundRunsError, setBackgroundRunsError] = useState("");
  const [backgroundPrompt, setBackgroundPrompt] = useState("");
  const [backgroundSpawnBusy, setBackgroundSpawnBusy] = useState(false);
  const [backgroundSteerDraftByRun, setBackgroundSteerDraftByRun] = useState<Record<string, string>>({});
  const [backgroundActionBusyByRun, setBackgroundActionBusyByRun] = useState<Record<string, "steer" | "abort">>({});
  const [backgroundCheckInBusyByRun, setBackgroundCheckInBusyByRun] = useState<Record<string, boolean>>({});
  const [activeConfigPanelTab, setActiveConfigPanelTab] = useState<ConfigPanelTab>("usage");
  const [focusedBackgroundRunId, setFocusedBackgroundRunId] = useState("");
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
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const previousActiveSessionIdRef = useRef("");
  const isSending = activeSend !== null;

  useEffect(() => {
    let alive = true;
    const bootstrap = async () => {
      const response = await fetch("/api/dashboard/bootstrap");
      const payload = (await response.json()) as DashboardBootstrap;
      if (!alive) return;

      setSessions(sortSessionsByActivity(payload.sessions));
      setSkillsDraft(payload.skills.join("\n"));
      setMcpsDraft(payload.mcps.join("\n"));
      setAgentTypes(payload.agents.map(fromLegacyAgent));
      setUsage(payload.usage);
      setHeartbeatAt(payload.heartbeat.at);
      setActiveSessionId(payload.sessions[0]?.id ?? "");
      setLoading(false);

      setLoadingModels(true);
      try {
        const [
          modelsResponse,
          memoryStatusResponse,
          memoryActivityResponse,
          configResponse,
          skillsCatalogResponse,
          mcpsCatalogResponse,
          opencodeAgentsResponse,
          runtimeInfoResponse,
          backgroundInFlightResponse,
        ] = await Promise.all([
          fetch("/api/opencode/models"),
          fetch("/api/memory/status"),
          fetch("/api/memory/activity?limit=12"),
          fetch("/api/config"),
          fetch("/api/config/skills/catalog"),
          fetch("/api/config/mcps/catalog"),
          fetch("/api/opencode/agents"),
          fetch("/api/runtime/info"),
          fetch("/api/background?limit=500"),
        ]);
        const modelsPayload = (await modelsResponse.json()) as { models?: ModelOption[]; error?: string };
        const memoryStatusPayload = (await memoryStatusResponse.json()) as {
          status?: MemoryStatusSnapshot;
          error?: string;
        };
        const memoryActivityPayload = (await memoryActivityResponse.json()) as {
          events?: MemoryWriteEvent[];
          error?: string;
        };
        const configPayload = (await configResponse.json()) as ConfigSnapshotResponse;
        const skillsCatalogPayload = (await skillsCatalogResponse.json()) as {
          skills?: RuntimeSkill[];
          enabled?: string[];
          hash?: string;
          error?: string;
        };
        const mcpsCatalogPayload = (await mcpsCatalogResponse.json()) as {
          mcps?: RuntimeMcp[];
          enabled?: string[];
          servers?: ConfiguredMcpServer[];
          hash?: string;
          error?: string;
        };
        const opencodeAgentsPayload = (await opencodeAgentsResponse.json()) as {
          agentTypes?: AgentTypeDefinition[];
          hash?: string;
          storage?: OpencodeAgentStorageResponse;
          error?: string;
        };
        const runtimeInfoPayload = (await runtimeInfoResponse.json()) as RuntimeInfoResponse;
        const backgroundInFlightPayload = (await backgroundInFlightResponse.json()) as BackgroundRunsResponse;
        if (!alive) return;

        setModelOptions(modelsPayload.models ?? []);
        setModelError(modelsResponse.ok ? "" : (modelsPayload.error ?? "Failed to load OpenCode models"));
        setMemoryStatus(memoryStatusPayload.status ?? null);
        setMemoryActivity(memoryActivityPayload.events ?? []);
        setAvailableSkills(Array.isArray(skillsCatalogPayload.skills) ? skillsCatalogPayload.skills : []);
        setAvailableMcps(Array.isArray(mcpsCatalogPayload.mcps) ? mcpsCatalogPayload.mcps : []);
        if (Array.isArray(opencodeAgentsPayload.agentTypes)) {
          const normalized = opencodeAgentsPayload.agentTypes.map(normalizeAgentTypeDraft);
          setAgentTypes(normalized);
          setAgentTypesBaseline(normalized);
          setAgentConfigHash(typeof opencodeAgentsPayload.hash === "string" ? opencodeAgentsPayload.hash : "");
        } else if (Array.isArray(configPayload.config?.ui?.agentTypes)) {
          const fallback = configPayload.config.ui.agentTypes.map(normalizeAgentTypeDraft);
          setAgentTypes(fallback);
          setAgentTypesBaseline(fallback);
          setAgentConfigHash("");
        }
        setOpencodeDirectory(
          (typeof opencodeAgentsPayload.storage?.directory === "string" && opencodeAgentsPayload.storage.directory) ||
            (typeof runtimeInfoPayload.opencode?.directory === "string" ? runtimeInfoPayload.opencode.directory : ""),
        );
        setOpencodeConfigFilePath(
          (typeof opencodeAgentsPayload.storage?.configFilePath === "string" && opencodeAgentsPayload.storage.configFilePath) ||
            (typeof runtimeInfoPayload.opencode?.effectiveConfigPath === "string"
              ? runtimeInfoPayload.opencode.effectiveConfigPath
              : ""),
        );
        setOpencodePersistenceMode(
          (typeof opencodeAgentsPayload.storage?.persistenceMode === "string" && opencodeAgentsPayload.storage.persistenceMode) ||
            (typeof runtimeInfoPayload.opencode?.persistenceMode === "string"
              ? runtimeInfoPayload.opencode.persistenceMode
              : ""),
        );
        setMcpServers(Array.isArray(mcpsCatalogPayload.servers) ? mcpsCatalogPayload.servers : []);
        if (Array.isArray(skillsCatalogPayload.enabled)) {
          setSkillsDraft(skillsCatalogPayload.enabled.join("\n"));
        }
        if (Array.isArray(mcpsCatalogPayload.enabled)) {
          setMcpsDraft(mcpsCatalogPayload.enabled.join("\n"));
        }
        setRunWaitTimeoutMs(
          typeof configPayload.config?.runtime?.opencode?.runWaitTimeoutMs === "number"
            ? configPayload.config.runtime.opencode.runWaitTimeoutMs
            : DEFAULT_RUN_WAIT_TIMEOUT_MS,
        );
        setChildSessionHideAfterDays(
          normalizeChildSessionHideAfterDays(configPayload.config?.runtime?.opencode?.childSessionHideAfterDays),
        );
        setConfigHash(typeof configPayload.hash === "string" ? configPayload.hash : "");
        setSkillCatalogError(skillsCatalogResponse.ok ? "" : (skillsCatalogPayload.error ?? "Failed to load runtime skills"));
        setMcpCatalogError(mcpsCatalogResponse.ok ? "" : (mcpsCatalogPayload.error ?? "Failed to load runtime MCP servers"));
        setAgentCatalogError(opencodeAgentsResponse.ok ? "" : (opencodeAgentsPayload.error ?? "Failed to load OpenCode agent definitions"));
        if (backgroundInFlightResponse.ok && Array.isArray(backgroundInFlightPayload.runs)) {
          setBackgroundRunsBySession(current => mergeBackgroundRunsBySession(current, backgroundInFlightPayload.runs ?? []));
        }
        const failedMemoryMessage =
          (!memoryStatusResponse.ok && (memoryStatusPayload.error ?? "Failed to load memory status")) ||
          (!memoryActivityResponse.ok && (memoryActivityPayload.error ?? "Failed to load memory activity")) ||
          "";
        setMemoryError(failedMemoryMessage);
      } catch (error) {
        if (!alive) return;
        setModelError(error instanceof Error ? error.message : "Failed to load OpenCode models");
        setMemoryError(error instanceof Error ? error.message : "Failed to load memory data");
      } finally {
        if (alive) {
          setLoadingModels(false);
        }
      }
    };

    bootstrap().catch(error => {
      console.error("Failed to load dashboard bootstrap", error);
      setLoading(false);
    });

    return () => {
      alive = false;
    };
  }, []);

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

    let cancelled = false;
    const loadBackgroundRuns = async () => {
      setLoadingBackgroundRuns(true);
      setBackgroundRunsError("");
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(activeSessionId)}/background`);
        const payload = (await response.json()) as BackgroundRunsResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load background runs");
        }
        if (cancelled) return;

        const runs = Array.isArray(payload.runs) ? sortBackgroundRuns(payload.runs) : [];
        setBackgroundRunsBySession(current => ({
          ...current,
          [activeSessionId]: runs,
        }));
        loadedBackgroundSessionsRef.current.add(activeSessionId);
      } catch (error) {
        if (!cancelled) {
          setBackgroundRunsError(error instanceof Error ? error.message : "Failed to load background runs");
        }
      } finally {
        if (!cancelled) {
          setLoadingBackgroundRuns(false);
        }
      }
    };

    void loadBackgroundRuns();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  useEffect(() => {
    let cancelled = false;

    const refreshInFlightBackgroundRunsSilently = async () => {
      try {
        const response = await fetch("/api/background?inFlightOnly=1&limit=500");
        const payload = (await response.json()) as BackgroundRunsResponse;
        if (!response.ok || !Array.isArray(payload.runs) || cancelled) {
          return;
        }
        setBackgroundRunsBySession(current => mergeBackgroundRunsBySession(current, payload.runs ?? []));
      } catch {
        // non-blocking; sidebar hierarchy should degrade gracefully when listing is unavailable
      }
    };

    void refreshInFlightBackgroundRunsSilently();
    const interval = setInterval(() => {
      void refreshInFlightBackgroundRunsSilently();
    }, 15_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const events = new EventSource("/api/events");
    setStreamStatus("connecting");

    events.onopen = () => {
      setStreamStatus("connected");
    };
    events.onerror = () => {
      setStreamStatus("reconnecting");
    };

    events.addEventListener("heartbeat", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { at: string };
      setHeartbeatAt(payload.at);
    });

    events.addEventListener("usage", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as UsageSnapshot;
      setUsage(payload);
    });

    events.addEventListener("session-updated", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as SessionSummary;
      setSessions(current => upsertSessionList(current, payload));
    });

    events.addEventListener("session-message", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        sessionId: string;
        message: ChatMessage;
      };
      loadedSessionsRef.current.add(payload.sessionId);
      setMessagesBySession(current => ({
        ...current,
        [payload.sessionId]: mergeMessages(current[payload.sessionId] ?? [], [payload.message]),
      }));
      if (payload.message.role === "assistant" && activeSendRef.current?.sessionId === payload.sessionId) {
        removeOptimisticRequest(payload.sessionId, activeSendRef.current.requestId);
      }
      setRunStatusBySession(current => ({
        ...current,
        [payload.sessionId]: {
          sessionId: payload.sessionId,
          status: "idle",
        },
      }));
      setRunErrorsBySession(current => {
        if (!current[payload.sessionId]) return current;
        const next = { ...current };
        delete next[payload.sessionId];
        return next;
      });
    });

    events.addEventListener("session-status", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as SessionRunStatusSnapshot;
      setRunStatusBySession(current => ({
        ...current,
        [payload.sessionId]: payload,
      }));
      if (payload.status === "idle") {
        setRunErrorsBySession(current => {
          if (!current[payload.sessionId]) return current;
          const next = { ...current };
          delete next[payload.sessionId];
          return next;
        });
      }
    });

    events.addEventListener("session-compacted", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as SessionCompactedSnapshot;
      setCompactedAtBySession(current => ({
        ...current,
        [payload.sessionId]: new Date().toISOString(),
      }));
    });

    events.addEventListener("session-error", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as SessionRunErrorSnapshot;
      if (payload.sessionId) {
        const sessionId = payload.sessionId;
        setRunErrorsBySession(current => ({
          ...current,
          [sessionId]: payload.message,
        }));
        setRunStatusBySession(current => ({
          ...current,
          [sessionId]: {
            sessionId,
            status: "idle",
          },
        }));
        if (activeSendRef.current?.sessionId === sessionId) {
          markRequestFailed(sessionId, activeSendRef.current.requestId, payload.message);
        }
      }
    });

    events.addEventListener("background-run", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as BackgroundRunSnapshot;
      loadedBackgroundSessionsRef.current.add(payload.parentSessionId);
      setBackgroundRunsBySession(current => mergeBackgroundRunsBySession(current, [payload]));
      if (payload.status === "completed" || payload.status === "failed" || payload.status === "aborted") {
        setBackgroundSteerDraftByRun(current => {
          if (!current[payload.runId]) return current;
          const next = { ...current };
          delete next[payload.runId];
          return next;
        });
        setBackgroundActionBusyByRun(current => {
          if (!current[payload.runId]) return current;
          const next = { ...current };
          delete next[payload.runId];
          return next;
        });
        setFocusedBackgroundRunId(current => (current === payload.runId ? "" : current));
      }
    });

    events.addEventListener("config-updated", () => {
      void (async () => {
        try {
          const response = await fetch("/api/config");
          if (!response.ok) return;
          const payload = (await response.json()) as ConfigSnapshotResponse;
          setRunWaitTimeoutMs(
            typeof payload.config?.runtime?.opencode?.runWaitTimeoutMs === "number"
              ? payload.config.runtime.opencode.runWaitTimeoutMs
              : DEFAULT_RUN_WAIT_TIMEOUT_MS,
          );
          setChildSessionHideAfterDays(
            normalizeChildSessionHideAfterDays(payload.config?.runtime?.opencode?.childSessionHideAfterDays),
          );
          setConfigHash(typeof payload.hash === "string" ? payload.hash : "");
        } catch {
          return;
        }
      })();
    });

    return () => {
      events.close();
    };
  }, []);

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

  const activeMessages = useMemo(() => messagesBySession[activeSessionId] ?? [], [messagesBySession, activeSessionId]);
  const activeSession = useMemo(
    () => sessions.find(session => session.id === activeSessionId) ?? sessions[0],
    [sessions, activeSessionId],
  );
  const activeSessionRunStatus = activeSession ? runStatusBySession[activeSession.id] : undefined;
  const activeSessionRunError = activeSession ? (runErrorsBySession[activeSession.id] ?? "") : "";
  const activeSessionCompactedAt = activeSession ? (compactedAtBySession[activeSession.id] ?? "") : "";
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
          activeSessionRunStatus.nextAt ? ` · next ${relativeFromIso(activeSessionRunStatus.nextAt)}` : ""
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
  const selectedModelLabel = useMemo(() => {
    if (!activeSession) return "Select model";
    return availableModels.find(option => option.id === activeSession.model)?.label ?? activeSession.model;
  }, [availableModels, activeSession]);
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
  }, [filteredModelOptions.length]);
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

  function appendOptimisticRequest(sessionId: string, content: string, requestId: string) {
    const createdAt = new Date().toISOString();
    const optimisticUserMessage: LocalChatMessage = {
      id: `local-user-${requestId}`,
      role: "user",
      content,
      at: createdAt,
      uiMeta: {
        type: "optimistic-user",
        requestId,
      },
    };
    const pendingAssistantMessage: LocalChatMessage = {
      id: `local-assistant-${requestId}`,
      role: "assistant",
      content: "",
      at: createdAt,
      uiMeta: {
        type: "assistant-pending",
        requestId,
        status: "pending",
        retryContent: content,
      },
    };

    loadedSessionsRef.current.add(sessionId);
    setMessagesBySession(current => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), optimisticUserMessage, pendingAssistantMessage],
    }));
  }

  function removeOptimisticRequest(sessionId: string, requestId: string) {
    setMessagesBySession(current => ({
      ...current,
      [sessionId]: (current[sessionId] ?? []).filter(message => message.uiMeta?.requestId !== requestId),
    }));
  }

  function markRequestPending(sessionId: string, requestId: string) {
    setMessagesBySession(current => ({
      ...current,
      [sessionId]: (current[sessionId] ?? []).map(message => {
        if (message.uiMeta?.type !== "assistant-pending" || message.uiMeta.requestId !== requestId) {
          return message;
        }
        return {
          ...message,
          content: "",
          uiMeta: {
            ...message.uiMeta,
            status: "pending",
            errorMessage: undefined,
          },
        };
      }),
    }));
  }

  function markRequestFailed(sessionId: string, requestId: string, errorMessage: string) {
    setMessagesBySession(current => ({
      ...current,
      [sessionId]: (current[sessionId] ?? []).map(message => {
        if (message.uiMeta?.type !== "assistant-pending" || message.uiMeta.requestId !== requestId) {
          return message;
        }
        return {
          ...message,
          uiMeta: {
            ...message.uiMeta,
            status: "failed",
            errorMessage,
          },
        };
      }),
    }));
    setRunErrorsBySession(current => ({
      ...current,
      [sessionId]: errorMessage,
    }));
    setRunStatusBySession(current => ({
      ...current,
      [sessionId]: {
        sessionId,
        status: "idle",
      },
    }));
  }

  async function waitForRunTerminalStateByPolling(runId: string, abortSignal: AbortSignal) {
    const startedAt = Date.now();
    while (true) {
      if (abortSignal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      if (Date.now() - startedAt > runWaitTimeoutMs) {
        throw new Error("Run timed out waiting for completion.");
      }

      const runResponse = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
        signal: abortSignal,
      });
      const runPayload = (await runResponse.json()) as { run?: AgentRunSnapshot; error?: string };
      if (!runResponse.ok || !runPayload.run) {
        throw new Error(runPayload.error ?? `Run lookup failed (${runResponse.status})`);
      }

      const run = runPayload.run;
      if (run.state === "completed") {
        return;
      }
      if (run.state === "failed") {
        throw new Error(extractRunErrorMessage(run.error));
      }

      await new Promise<void>(resolve => {
        setTimeout(resolve, RUN_POLL_INTERVAL_MS);
      });
    }
  }

  async function waitForRunTerminalState(runId: string, abortSignal: AbortSignal) {
    if (typeof EventSource !== "function") {
      await waitForRunTerminalStateByPolling(runId, abortSignal);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const stream = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events/stream?afterSeq=0`);
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        stream.close();
        abortSignal.removeEventListener("abort", onAbort);
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const onAbort = () => {
        fail(new DOMException("Aborted", "AbortError"));
      };

      timeout = setTimeout(() => {
        fail(new Error("Run timed out waiting for completion."));
      }, runWaitTimeoutMs);

      abortSignal.addEventListener("abort", onAbort, { once: true });
      stream.addEventListener("run-event", event => {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as {
            type?: string;
            payload?: unknown;
          };
          if (payload.type === "run.completed") {
            succeed();
            return;
          }
          if (payload.type === "run.failed") {
            fail(new Error(extractRunErrorMessage(payload.payload)));
          }
        } catch {
          // Ignore malformed stream event payloads and continue listening.
        }
      });
      stream.onerror = () => {
        if (abortSignal.aborted) {
          onAbort();
        }
      };
    });
  }

  async function submitChatRequest(input: {
    sessionId: string;
    content: string;
    requestId?: string;
    retry?: boolean;
  }) {
    if (activeSendRef.current) return;

    const requestId = input.requestId ?? crypto.randomUUID();
    setChatControlError("");
    setRunErrorsBySession(current => {
      if (!current[input.sessionId]) return current;
      const next = { ...current };
      delete next[input.sessionId];
      return next;
    });

    if (input.retry) {
      markRequestPending(input.sessionId, requestId);
    } else {
      appendOptimisticRequest(input.sessionId, input.content, requestId);
    }

    const nextActiveSend: ActiveSend = {
      requestId,
      sessionId: input.sessionId,
      content: input.content,
    };
    const abortController = new AbortController();
    activeSendRef.current = nextActiveSend;
    activeAbortControllerRef.current = abortController;
    setActiveSend(nextActiveSend);
    setRunStatusBySession(current => ({
      ...current,
      [input.sessionId]: {
        sessionId: input.sessionId,
        status: "busy",
      },
    }));

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          sessionId: input.sessionId,
          content: input.content,
          idempotencyKey: requestId,
        }),
      });
      const payload = (await response.json()) as {
        run?: AgentRunSnapshot;
        runId?: string;
        error?: string;
      };
      if (!response.ok || !payload.run) {
        throw new Error(payload.error ?? `Request failed (${response.status})`);
      }

      const runId = payload.runId ?? payload.run.id;
      await waitForRunTerminalState(runId, abortController.signal);

      const [messagesResponse, sessionsResponse] = await Promise.all([
        fetch(`/api/sessions/${encodeURIComponent(input.sessionId)}/messages`, {
          signal: abortController.signal,
        }),
        fetch("/api/sessions", { signal: abortController.signal }),
      ]);
      const messagesPayload = (await messagesResponse.json()) as {
        messages?: ChatMessage[];
        error?: string;
      };
      const sessionsPayload = (await sessionsResponse.json()) as {
        sessions?: SessionSummary[];
        error?: string;
      };

      if (!messagesResponse.ok || !Array.isArray(messagesPayload.messages)) {
        throw new Error(messagesPayload.error ?? "Failed to refresh session messages");
      }

      loadedSessionsRef.current.add(input.sessionId);
      setMessagesBySession(current => ({
        ...current,
        [input.sessionId]: mergeMessages(current[input.sessionId] ?? [], messagesPayload.messages ?? []),
      }));

      if (sessionsResponse.ok && Array.isArray(sessionsPayload.sessions)) {
        const updatedSession = sessionsPayload.sessions.find(session => session.id === input.sessionId);
        if (updatedSession) {
          setSessions(current => upsertSessionList(current, updatedSession));
        }
      }

      removeOptimisticRequest(input.sessionId, requestId);
      setRunStatusBySession(current => ({
        ...current,
        [input.sessionId]: {
          sessionId: input.sessionId,
          status: "idle",
        },
      }));
      setRunErrorsBySession(current => {
        if (!current[input.sessionId]) return current;
        const next = { ...current };
        delete next[input.sessionId];
        return next;
      });
    } catch (error) {
      if (abortedRequestIdsRef.current.has(requestId)) {
        abortedRequestIdsRef.current.delete(requestId);
        markRequestFailed(input.sessionId, requestId, "Request aborted.");
      } else {
        markRequestFailed(input.sessionId, requestId, normalizeRequestError(error));
      }
    } finally {
      if (activeSendRef.current?.requestId === requestId) {
        activeSendRef.current = null;
      }
      if (activeAbortControllerRef.current === abortController) {
        activeAbortControllerRef.current = null;
      }
      setActiveSend(current => (current?.requestId === requestId ? null : current));
    }
  }

  function retryFailedRequest(requestId: string) {
    if (isSending) return;

    for (const [sessionId, messages] of Object.entries(messagesBySession)) {
      const failedMessage = messages.find(message => {
        if (message.uiMeta?.type !== "assistant-pending") return false;
        return message.uiMeta.requestId === requestId && message.uiMeta.status === "failed";
      });
      if (!failedMessage || failedMessage.uiMeta?.type !== "assistant-pending") continue;

      void submitChatRequest({
        sessionId,
        content: failedMessage.uiMeta.retryContent,
        requestId,
        retry: true,
      });
      return;
    }
  }

  async function abortActiveRun() {
    const currentSend = activeSendRef.current;
    if (!currentSend || isAborting) return;

    setIsAborting(true);
    setChatControlError("");
    abortedRequestIdsRef.current.add(currentSend.requestId);

    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(currentSend.sessionId)}/abort`, {
        method: "POST",
      });
      const payload = (await response.json()) as { aborted?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to abort session run");
      }
      if (!payload.aborted) {
        setChatControlError("No active runtime turn was available to abort.");
      }
    } catch (error) {
      abortedRequestIdsRef.current.delete(currentSend.requestId);
      setChatControlError(error instanceof Error ? error.message : "Failed to abort session run");
      return;
    } finally {
      setIsAborting(false);
    }

    activeAbortControllerRef.current?.abort();
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

  async function compactSession(sessionId: string) {
    if (isCompacting) return;

    setIsCompacting(true);
    setChatControlError("");
    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(sessionId)}/compact`, {
        method: "POST",
      });
      const payload = (await response.json()) as { compacted?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to compact session");
      }
      if (!payload.compacted) {
        throw new Error("Runtime reported session compaction was skipped.");
      }
      setCompactedAtBySession(current => ({
        ...current,
        [sessionId]: new Date().toISOString(),
      }));
    } catch (error) {
      setChatControlError(error instanceof Error ? error.message : "Failed to compact session");
    } finally {
      setIsCompacting(false);
    }
  }

  async function refreshBackgroundRunsForSession(sessionId: string) {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) return;

    setLoadingBackgroundRuns(true);
    setBackgroundRunsError("");
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(normalizedSessionId)}/background`);
      const payload = (await response.json()) as BackgroundRunsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load background runs");
      }
      const runs = Array.isArray(payload.runs) ? sortBackgroundRuns(payload.runs) : [];
      setBackgroundRunsBySession(current => ({
        ...current,
        [normalizedSessionId]: runs,
      }));
      loadedBackgroundSessionsRef.current.add(normalizedSessionId);
    } catch (error) {
      setBackgroundRunsError(error instanceof Error ? error.message : "Failed to load background runs");
    } finally {
      setLoadingBackgroundRuns(false);
    }
  }

  async function refreshSessionsList() {
    try {
      const response = await fetch("/api/sessions");
      const payload = (await response.json()) as { sessions?: SessionSummary[]; error?: string };
      if (!response.ok || !Array.isArray(payload.sessions)) {
        throw new Error(payload.error ?? "Failed to refresh sessions");
      }
      setSessions(sortSessionsByActivity(payload.sessions));
    } catch {
      // best-effort only; caller can continue with local view
    }
  }

  function toggleSessionGroup(sessionId: string) {
    setExpandedSessionGroupsById(current => ({
      ...current,
      [sessionId]: !current[sessionId],
    }));
  }

  async function refreshInFlightBackgroundRuns() {
    setBackgroundRunsError("");
    try {
      const response = await fetch("/api/background?inFlightOnly=1&limit=500");
      const payload = (await response.json()) as BackgroundRunsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to refresh in-flight background runs");
      }
      if (Array.isArray(payload.runs)) {
        setBackgroundRunsBySession(current => mergeBackgroundRunsBySession(current, payload.runs ?? []));
      }
    } catch (error) {
      setBackgroundRunsError(error instanceof Error ? error.message : "Failed to refresh in-flight background runs");
    }
  }

  async function spawnBackgroundRun() {
    if (!activeSession) return;
    const prompt = backgroundPrompt.trim();
    if (!prompt) return;

    setBackgroundSpawnBusy(true);
    setBackgroundRunsError("");
    try {
      const response = await fetch("/api/background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSession.id,
          prompt,
          requestedBy: "dashboard-ui",
        }),
      });
      const payload = (await response.json()) as BackgroundRunsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to spawn background run");
      }
      if (payload.run) {
        const run = payload.run;
        loadedBackgroundSessionsRef.current.add(run.parentSessionId);
        setBackgroundRunsBySession(current => mergeBackgroundRunsBySession(current, [run]));
      }
      setBackgroundPrompt("");
      await refreshBackgroundRunsForSession(activeSession.id);
    } catch (error) {
      setBackgroundRunsError(error instanceof Error ? error.message : "Failed to spawn background run");
    } finally {
      setBackgroundSpawnBusy(false);
    }
  }

  async function steerBackgroundRun(runId: string, rawContent?: string) {
    const content = (rawContent ?? backgroundSteerDraftByRun[runId] ?? "").trim();
    if (!content) return;

    setBackgroundActionBusyByRun(current => ({
      ...current,
      [runId]: "steer",
    }));
    setBackgroundRunsError("");
    try {
      const response = await fetch(`/api/background/${encodeURIComponent(runId)}/steer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const payload = (await response.json()) as BackgroundRunsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to steer background run");
      }
      if (payload.run) {
        const run = payload.run;
        loadedBackgroundSessionsRef.current.add(run.parentSessionId);
        setBackgroundRunsBySession(current => mergeBackgroundRunsBySession(current, [run]));
      }
      setBackgroundSteerDraftByRun(current => {
        if (!current[runId]) return current;
        const next = { ...current };
        delete next[runId];
        return next;
      });
    } catch (error) {
      setBackgroundRunsError(error instanceof Error ? error.message : "Failed to steer background run");
    } finally {
      setBackgroundActionBusyByRun(current => {
        if (!current[runId]) return current;
        const next = { ...current };
        delete next[runId];
        return next;
      });
    }
  }

  async function checkInBackgroundRun(run: BackgroundRunSnapshot) {
    setFocusedBackgroundRunId(run.runId);
    setBackgroundRunsError("");
    setBackgroundCheckInBusyByRun(current => ({
      ...current,
      [run.runId]: true,
    }));
    try {
      const response = await fetch(`/api/background/${encodeURIComponent(run.runId)}`);
      const payload = (await response.json()) as BackgroundRunsResponse;
      if (!response.ok || !payload.run) {
        throw new Error(payload.error ?? "Failed to check in on background run");
      }
      const latest = payload.run;
      setBackgroundRunsBySession(current => mergeBackgroundRunsBySession(current, [latest]));
      await refreshBackgroundRunsForSession(latest.parentSessionId);
      const targetSessionId = latest.childSessionId ?? run.childSessionId;
      if (targetSessionId) {
        await refreshSessionsList();
        setActiveSessionId(targetSessionId);
      } else {
        setActiveSessionId(latest.parentSessionId);
        setActiveConfigPanelTab("background");
      }
    } catch (error) {
      setBackgroundRunsError(error instanceof Error ? error.message : "Failed to check in on background run");
    } finally {
      setBackgroundCheckInBusyByRun(current => {
        if (!current[run.runId]) return current;
        const next = { ...current };
        delete next[run.runId];
        return next;
      });
    }
  }

  async function abortBackgroundRun(runId: string) {
    setBackgroundActionBusyByRun(current => ({
      ...current,
      [runId]: "abort",
    }));
    setBackgroundRunsError("");
    try {
      const response = await fetch(`/api/background/${encodeURIComponent(runId)}/abort`, {
        method: "POST",
      });
      const payload = (await response.json()) as BackgroundRunsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to abort background run");
      }
      if (!payload.aborted) {
        throw new Error("No active background run was available to abort.");
      }
    } catch (error) {
      setBackgroundRunsError(error instanceof Error ? error.message : "Failed to abort background run");
    } finally {
      setBackgroundActionBusyByRun(current => {
        if (!current[runId]) return current;
        const next = { ...current };
        delete next[runId];
        return next;
      });
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSending) return;

    const content = draftMessage.trim();
    if (!content || !activeSession) return;

    setDraftMessage("");
    await submitChatRequest({
      sessionId: activeSession.id,
      content,
    });
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (isSending) return;

    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      composerFormRef.current?.requestSubmit();
    }
  }

  async function refreshSkillCatalog() {
    setLoadingSkillCatalog(true);
    setSkillCatalogError("");
    try {
      const response = await fetch("/api/config/skills/catalog");
      const payload = (await response.json()) as {
        skills?: RuntimeSkill[];
        enabled?: string[];
        hash?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load runtime skills");
      }
      setAvailableSkills(Array.isArray(payload.skills) ? payload.skills : []);
      if (Array.isArray(payload.enabled)) {
        setSkillsDraft(payload.enabled.join("\n"));
      }
      if (typeof payload.hash === "string") {
        setConfigHash(payload.hash);
      }
    } catch (error) {
      setSkillCatalogError(error instanceof Error ? error.message : "Failed to load runtime skills");
    } finally {
      setLoadingSkillCatalog(false);
    }
  }

  async function refreshMcpCatalog() {
    setLoadingMcpCatalog(true);
    setMcpCatalogError("");
    try {
      const response = await fetch("/api/config/mcps/catalog");
      const payload = (await response.json()) as {
        mcps?: RuntimeMcp[];
        enabled?: string[];
        servers?: ConfiguredMcpServer[];
        hash?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load runtime MCP servers");
      }
      setAvailableMcps(Array.isArray(payload.mcps) ? payload.mcps : []);
      setMcpServers(Array.isArray(payload.servers) ? payload.servers : []);
      if (Array.isArray(payload.enabled)) {
        setMcpsDraft(payload.enabled.join("\n"));
      }
      if (typeof payload.hash === "string") {
        setConfigHash(payload.hash);
      }
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
      const response = await fetch("/api/opencode/agents");
      const payload = (await response.json()) as {
        agentTypes?: AgentTypeDefinition[];
        hash?: string;
        storage?: OpencodeAgentStorageResponse;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load OpenCode agent definitions");
      }
      const normalized = Array.isArray(payload.agentTypes) ? payload.agentTypes.map(normalizeAgentTypeDraft) : [];
      setAgentTypes(normalized);
      setAgentTypesBaseline(normalized);
      if (typeof payload.hash === "string") {
        setAgentConfigHash(payload.hash);
      }
      setOpencodeDirectory(typeof payload.storage?.directory === "string" ? payload.storage.directory : "");
      setOpencodeConfigFilePath(typeof payload.storage?.configFilePath === "string" ? payload.storage.configFilePath : "");
      setOpencodePersistenceMode(typeof payload.storage?.persistenceMode === "string" ? payload.storage.persistenceMode : "");
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
      const response = await fetch("/api/config/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          content,
          expectedHash: configHash || undefined,
          enable: true,
        }),
      });
      const payload = (await response.json()) as {
        skills?: string[];
        hash?: string;
        error?: string;
      };
      if (!response.ok || !payload.skills) {
        throw new Error(payload.error ?? "Failed to import skill");
      }
      setImportSkillId("");
      setImportSkillContent("");
      setSkillsDraft(payload.skills.join("\n"));
      if (typeof payload.hash === "string") {
        setConfigHash(payload.hash);
      }
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
      const response = await fetch("/api/config/skills", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: configuredSkills,
          expectedHash: configHash || undefined,
        }),
      });
      const payload = (await response.json()) as { skills?: string[]; hash?: string; error?: string };
      if (!response.ok || !payload.skills) {
        throw new Error(payload.error ?? "Failed to save skills");
      }

      setSkillsDraft(payload.skills.join("\n"));
      setConfigHash(typeof payload.hash === "string" ? payload.hash : configHash);
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
      const response = await fetch("/api/config/mcps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(serversForSave.length > 0 ? { servers: serversForSave } : { mcps: configuredMcps }),
          expectedHash: configHash || undefined,
        }),
      });
      const payload = (await response.json()) as {
        mcps?: string[];
        servers?: ConfiguredMcpServer[];
        hash?: string;
        error?: string;
      };
      if (!response.ok || !payload.mcps) {
        throw new Error(payload.error ?? "Failed to save MCP servers");
      }

      setMcpsDraft(payload.mcps.join("\n"));
      if (Array.isArray(payload.servers)) {
        setMcpServers(payload.servers);
      }
      setConfigHash(typeof payload.hash === "string" ? payload.hash : configHash);
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

      const validationResponse = await fetch("/api/opencode/agents/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upserts,
          deletes,
        }),
      });
      const validationPayload = (await validationResponse.json()) as {
        ok?: boolean;
        issues?: Array<{ path?: string; message?: string }>;
        error?: string;
      };
      if (!validationResponse.ok) {
        throw new Error(validationPayload.error ?? "Failed to validate agent changes");
      }
      if (validationPayload.ok !== true) {
        const firstIssue = validationPayload.issues?.[0];
        throw new Error(firstIssue?.message || "Agent validation failed");
      }
      if (!agentConfigHash.trim()) {
        throw new Error("Agent config hash missing. Refresh agents and try again.");
      }

      const response = await fetch("/api/opencode/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upserts,
          deletes,
          expectedHash: agentConfigHash || undefined,
        }),
      });
      const payload = (await response.json()) as {
        agentTypes?: AgentTypeDefinition[];
        hash?: string;
        storage?: OpencodeAgentStorageResponse;
        error?: string;
      };
      if (!response.ok || !Array.isArray(payload.agentTypes)) {
        throw new Error(payload.error ?? "Failed to save agent types");
      }

      const normalized = payload.agentTypes.map(normalizeAgentTypeDraft);
      setAgentTypes(normalized);
      setAgentTypesBaseline(normalized);
      setAgentConfigHash(typeof payload.hash === "string" ? payload.hash : agentConfigHash);
      setOpencodeDirectory(typeof payload.storage?.directory === "string" ? payload.storage.directory : opencodeDirectory);
      setOpencodeConfigFilePath(
        typeof payload.storage?.configFilePath === "string" ? payload.storage.configFilePath : opencodeConfigFilePath,
      );
      setOpencodePersistenceMode(
        typeof payload.storage?.persistenceMode === "string" ? payload.storage.persistenceMode : opencodePersistenceMode,
      );
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : "Failed to save agent types");
    } finally {
      setIsSavingAgents(false);
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
      const payload = (await response.json()) as { session?: SessionSummary; error?: string };
      if (!response.ok || !payload.session) {
        throw new Error(payload.error ?? "Failed to update session model");
      }
      const updated = payload.session;

      setSessions(current => upsertSessionList(current, updated));
    } catch (error) {
      setModelError(error instanceof Error ? error.message : "Failed to update session model");
    } finally {
      setIsSavingModel(false);
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
              <Badge variant="outline">heartbeat {heartbeatAt ? relativeFromIso(heartbeatAt) : "pending"}</Badge>
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
          </div>
        </header>

        {dashboardPage === "chat" && (
          <ChatPage
            activeBackgroundInFlightCount={activeBackgroundInFlightCount}
            activeBackgroundRuns={activeBackgroundRuns}
            activeConfigPanelTab={activeConfigPanelTab}
            activeMessages={activeMessages}
            activeRunStatusHint={activeRunStatusHint}
            activeRunStatusLabel={activeRunStatusLabel}
            activeSession={activeSession}
            activeSessionCompactedAt={activeSessionCompactedAt}
            activeSessionId={activeSessionId}
            activeSessionRunError={activeSessionRunError}
            availableModels={availableModels}
            backgroundActionBusyByRun={backgroundActionBusyByRun}
            backgroundCheckInBusyByRun={backgroundCheckInBusyByRun}
            backgroundPrompt={backgroundPrompt}
            backgroundRunsError={backgroundRunsError}
            backgroundSpawnBusy={backgroundSpawnBusy}
            backgroundSteerDraftByRun={backgroundSteerDraftByRun}
            canAbortActiveSession={canAbortActiveSession}
            chatControlError={chatControlError}
            chatScrollRef={chatScrollRef}
            checkInBackgroundRun={checkInBackgroundRun}
            childSessionHideAfterDays={childSessionHideAfterDays}
            childSessionSearchMatchBySessionId={childSessionSearchMatchBySessionId}
            childSessionSearchQuery={childSessionSearchQuery}
            childSessionVisibilityByParentSessionId={childSessionVisibilityByParentSessionId}
            childSessionsByParentSessionId={childSessionsByParentSessionId}
            compactSession={compactSession}
            composerFormRef={composerFormRef}
            createNewSession={createNewSession}
            draftMessage={draftMessage}
            expandedSessionGroupsById={expandedSessionGroupsById}
            filteredModelOptions={filteredModelOptions}
            focusedBackgroundRunId={focusedBackgroundRunId}
            focusedModelIndex={focusedModelIndex}
            handleComposerKeyDown={handleComposerKeyDown}
            handleModelSearchKeyDown={handleModelSearchKeyDown}
            hasNewMessages={hasNewMessages}
            inFlightBackgroundRunsBySession={inFlightBackgroundRunsBySession}
            isAborting={isAborting}
            isActiveSessionRunning={isActiveSessionRunning}
            isCompacting={isCompacting}
            isCreatingSession={isCreatingSession}
            isModelPickerOpen={isModelPickerOpen}
            isSavingModel={isSavingModel}
            isSending={isSending}
            isUserScrolledUp={isUserScrolledUp}
            latestBackgroundRunByChildSessionId={latestBackgroundRunByChildSessionId}
            loading={loading}
            loadingBackgroundRuns={loadingBackgroundRuns}
            loadingMessages={loadingMessages}
            loadingModels={loadingModels}
            memoryActivity={memoryActivity}
            memoryError={memoryError}
            memoryStatus={memoryStatus}
            modelError={modelError}
            modelPickerRef={modelPickerRef}
            modelQuery={modelQuery}
            modelSearchInputRef={modelSearchInputRef}
            parentSessionSearchMatchBySessionId={parentSessionSearchMatchBySessionId}
            refreshBackgroundRunsForSession={refreshBackgroundRunsForSession}
            refreshInFlightBackgroundRuns={refreshInFlightBackgroundRuns}
            refreshSessionsList={refreshSessionsList}
            requestAbortBackgroundRun={requestAbortBackgroundRun}
            requestAbortRun={requestAbortRun}
            retryFailedRequest={retryFailedRequest}
            rootSessions={rootSessions}
            scrollToBottom={scrollToBottom}
            selectModelFromPicker={selectModelFromPicker}
            selectedModelLabel={selectedModelLabel}
            sendMessage={sendMessage}
            sessionError={sessionError}
            sessionSearchNeedle={sessionSearchNeedle}
            setActiveConfigPanelTab={setActiveConfigPanelTab}
            setActiveSessionId={setActiveSessionId}
            setBackgroundPrompt={setBackgroundPrompt}
            setBackgroundSteerDraftByRun={setBackgroundSteerDraftByRun}
            setChildSessionSearchQuery={setChildSessionSearchQuery}
            setDraftMessage={setDraftMessage}
            setIsModelPickerOpen={setIsModelPickerOpen}
            setModelQuery={setModelQuery}
            setShowAllChildren={setShowAllChildren}
            showAllChildren={showAllChildren}
            spawnBackgroundRun={spawnBackgroundRun}
            steerBackgroundRun={steerBackgroundRun}
            toggleSessionGroup={toggleSessionGroup}
            totalHiddenChildSessionsByAge={totalHiddenChildSessionsByAge}
            totalInFlightBackgroundRuns={totalInFlightBackgroundRuns}
            totalSessionSearchMatches={totalSessionSearchMatches}
            usage={usage}
          />
        )}

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
