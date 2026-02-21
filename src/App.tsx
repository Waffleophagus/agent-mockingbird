import {
  Activity,
  AlertTriangle,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleSlash,
  Cpu,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Scissors,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  type ActiveSend,
  type LocalChatMessage,
  mergeMessages,
  normalizeListInput,
  normalizeRequestError,
  relativeFromIso,
} from "@/frontend/app/chatHelpers";
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

const RUN_POLL_INTERVAL_MS = 350;
const DEFAULT_RUN_WAIT_TIMEOUT_MS = 180_000;
const DEFAULT_CHILD_SESSION_HIDE_AFTER_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

type AgentRunState = "queued" | "running" | "completed" | "failed";

interface AgentRunSnapshot {
  id: string;
  sessionId: string;
  state: AgentRunState;
  error?: unknown;
}

interface BackgroundRunsResponse {
  runs?: BackgroundRunSnapshot[];
  run?: BackgroundRunSnapshot;
  aborted?: boolean;
  error?: string;
}

interface ConfigSnapshotResponse {
  hash?: string;
  config?: {
    runtime?: {
      opencode?: {
        runWaitTimeoutMs?: number;
        childSessionHideAfterDays?: number;
      };
    };
    ui?: {
      agentTypes?: AgentTypeDefinition[];
    };
  };
}

interface OpencodeAgentStorageResponse {
  directory?: string;
  configFilePath?: string;
  persistenceMode?: string;
}

interface RuntimeInfoResponse {
  opencode?: {
    directory?: string;
    effectiveConfigPath?: string;
    persistenceMode?: string;
  };
}

const IN_FLIGHT_BACKGROUND_STATUSES = new Set<BackgroundRunSnapshot["status"]>([
  "created",
  "running",
  "retrying",
  "idle",
]);

function extractRunErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "Run failed.";
  }
  const record = error as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }
  if (typeof record.name === "string" && record.name.trim()) {
    return record.name.trim();
  }
  return "Run failed.";
}

function sortBackgroundRuns(input: BackgroundRunSnapshot[]) {
  return [...input].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function upsertBackgroundRunList(current: BackgroundRunSnapshot[], nextRun: BackgroundRunSnapshot) {
  const filtered = current.filter(run => run.runId !== nextRun.runId);
  return sortBackgroundRuns([nextRun, ...filtered]);
}

function sortSessionsByActivity(input: SessionSummary[]) {
  return [...input].sort((left, right) => {
    if (left.id === "main" && right.id !== "main") return -1;
    if (right.id === "main" && left.id !== "main") return 1;
    return Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt);
  });
}

function upsertSessionList(current: SessionSummary[], nextSession: SessionSummary) {
  const filtered = current.filter(session => session.id !== nextSession.id);
  return sortSessionsByActivity([nextSession, ...filtered]);
}

function mergeBackgroundRunsBySession(
  current: Record<string, BackgroundRunSnapshot[]>,
  runs: BackgroundRunSnapshot[],
) {
  if (runs.length === 0) return current;
  const next = { ...current };
  for (const run of runs) {
    next[run.parentSessionId] = upsertBackgroundRunList(next[run.parentSessionId] ?? [], run);
  }
  return next;
}

function isBackgroundRunInFlight(run: BackgroundRunSnapshot) {
  return IN_FLIGHT_BACKGROUND_STATUSES.has(run.status);
}

function normalizeChildSessionHideAfterDays(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CHILD_SESSION_HIDE_AFTER_DAYS;
  }
  return Math.max(0, Math.min(365, Math.floor(value)));
}

function fromLegacyAgent(agent: DashboardBootstrap["agents"][number]): AgentTypeDefinition {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.specialty,
    prompt: agent.summary,
    model: agent.model || undefined,
    mode: "subagent",
    hidden: false,
    disable: agent.status === "offline",
    options: {
      wafflebotManagedLegacy: true,
      wafflebotDisplayName: agent.name,
      wafflebotStatus: agent.status,
    },
  };
}

function normalizeAgentTypeDraft(agentType: AgentTypeDefinition): AgentTypeDefinition {
  return {
    ...agentType,
    id: agentType.id.trim(),
    name: agentType.name?.trim() || undefined,
    description: agentType.description?.trim() || undefined,
    prompt: agentType.prompt?.trim() || undefined,
    model: agentType.model?.trim() || undefined,
    variant: agentType.variant?.trim() || undefined,
    options: agentType.options ?? {},
  };
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted/70",
        className
      )}
    />
  );
}

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}

type ConfirmAction =
  | { type: "abort-run"; sessionId: string }
  | { type: "abort-background"; runId: string }
  | { type: "remove-skill"; skillId: string }
  | { type: "remove-mcp"; mcpId: string }
  | { type: "disconnect-mcp"; mcpId: string }
  | { type: "remove-agent"; agentId: string }
  | null;

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
  const activeSessionRunError = activeSession ? runErrorsBySession[activeSession.id] : "";
  const activeSessionCompactedAt = activeSession ? compactedAtBySession[activeSession.id] : "";
  const activeBackgroundRuns = useMemo(
    () => sortBackgroundRuns(backgroundRunsBySession[activeSessionId] ?? []),
    [backgroundRunsBySession, activeSessionId],
  );
  const inFlightBackgroundRunsBySession = useMemo(() => {
    const next: Record<string, BackgroundRunSnapshot[]> = {};
    for (const [sessionId, runs] of Object.entries(backgroundRunsBySession)) {
      const inFlight = runs.filter(isBackgroundRunInFlight);
      if (inFlight.length > 0) {
        next[sessionId] = sortBackgroundRuns(inFlight);
      }
    }
    return next;
  }, [backgroundRunsBySession]);
  const latestBackgroundRunByChildSessionId = useMemo(() => {
    const next = new Map<string, BackgroundRunSnapshot>();
    for (const runs of Object.values(backgroundRunsBySession)) {
      for (const run of runs) {
        if (!run.childSessionId) continue;
        const current = next.get(run.childSessionId);
        if (!current || Date.parse(run.updatedAt) > Date.parse(current.updatedAt)) {
          next.set(run.childSessionId, run);
        }
      }
    }
    return next;
  }, [backgroundRunsBySession]);
  const childParentSessionIdByChildSessionId = useMemo(() => {
    const next = new Map<string, string>();
    for (const runs of Object.values(backgroundRunsBySession)) {
      for (const run of runs) {
        if (!run.childSessionId) continue;
        next.set(run.childSessionId, run.parentSessionId);
      }
    }
    return next;
  }, [backgroundRunsBySession]);
  const sessionsById = useMemo(() => new Map(sessions.map(session => [session.id, session])), [sessions]);
  const rootSessions = useMemo(
    () =>
      sessions.filter(session => {
        const parentSessionId = childParentSessionIdByChildSessionId.get(session.id);
        if (!parentSessionId) return true;
        return !sessionsById.has(parentSessionId);
      }),
    [sessions, childParentSessionIdByChildSessionId, sessionsById],
  );
  const childSessionsByParentSessionId = useMemo(() => {
    const next: Record<string, SessionSummary[]> = {};
    for (const session of sessions) {
      const parentSessionId = childParentSessionIdByChildSessionId.get(session.id);
      if (!parentSessionId || !sessionsById.has(parentSessionId)) continue;
      if (!next[parentSessionId]) next[parentSessionId] = [];
      next[parentSessionId].push(session);
    }
    for (const [parentSessionId, children] of Object.entries(next)) {
      next[parentSessionId] = sortSessionsByActivity(children);
    }
    return next;
  }, [sessions, childParentSessionIdByChildSessionId, sessionsById]);
  const sessionSearchNeedle = useMemo(() => childSessionSearchQuery.trim().toLowerCase(), [childSessionSearchQuery]);
  const childSessionVisibilityByParentSessionId = useMemo(() => {
    const visible: Record<string, SessionSummary[]> = {};
    const hiddenByAgeCount: Record<string, number> = {};
    const hideAfterMs = childSessionHideAfterDays * DAY_MS;
    const now = Date.now();

    for (const [parentSessionId, children] of Object.entries(childSessionsByParentSessionId)) {
      const nextVisible: SessionSummary[] = [];
      let hidden = 0;

      for (const child of children) {
        const childRun = latestBackgroundRunByChildSessionId.get(child.id) ?? null;
        const inFlight = childRun ? isBackgroundRunInFlight(childRun) : false;
        const lastActiveAtMs = Date.parse(child.lastActiveAt);
        const hiddenByAge =
          !showAllChildren &&
          hideAfterMs > 0 &&
          Number.isFinite(lastActiveAtMs) &&
          now - lastActiveAtMs > hideAfterMs &&
          child.id !== activeSessionId &&
          !inFlight;
        if (hiddenByAge) {
          hidden += 1;
          continue;
        }
        nextVisible.push(child);
      }

      visible[parentSessionId] = nextVisible;
      hiddenByAgeCount[parentSessionId] = hidden;
    }

    return { visible, hiddenByAgeCount };
  }, [
    childSessionsByParentSessionId,
    latestBackgroundRunByChildSessionId,
    showAllChildren,
    childSessionHideAfterDays,
    activeSessionId,
  ]);
  const childSessionSearchMatchBySessionId = useMemo(() => {
    const matches = new Map<string, boolean>();
    if (!sessionSearchNeedle) return matches;
    for (const [parentSessionId, children] of Object.entries(childSessionVisibilityByParentSessionId.visible)) {
      for (const child of children) {
        const childRun = latestBackgroundRunByChildSessionId.get(child.id) ?? null;
        const haystack = `${child.title}\n${child.model}\n${childRun?.prompt ?? ""}`.toLowerCase();
        matches.set(child.id, haystack.includes(sessionSearchNeedle));
      }
      if (!children.length) {
        matches.set(parentSessionId, false);
      }
    }
    return matches;
  }, [childSessionVisibilityByParentSessionId.visible, latestBackgroundRunByChildSessionId, sessionSearchNeedle]);
  const parentSessionSearchMatchBySessionId = useMemo(() => {
    const matches = new Map<string, boolean>();
    if (!sessionSearchNeedle) return matches;

    for (const session of rootSessions) {
      const inFlightRuns = inFlightBackgroundRunsBySession[session.id] ?? [];
      const children = childSessionVisibilityByParentSessionId.visible[session.id] ?? [];
      const parentMatch = `${session.title}\n${session.model}`.toLowerCase().includes(sessionSearchNeedle);
      const childMatch = children.some(child => childSessionSearchMatchBySessionId.get(child.id) === true);
      const runMatch = inFlightRuns.some(run => (run.prompt ?? "").toLowerCase().includes(sessionSearchNeedle));
      matches.set(session.id, parentMatch || childMatch || runMatch);
    }

    return matches;
  }, [
    sessionSearchNeedle,
    rootSessions,
    inFlightBackgroundRunsBySession,
    childSessionVisibilityByParentSessionId.visible,
    childSessionSearchMatchBySessionId,
  ]);
  const totalSessionSearchMatches = useMemo(() => {
    if (!sessionSearchNeedle) return 0;
    let count = 0;
    for (const matched of parentSessionSearchMatchBySessionId.values()) {
      if (matched) count += 1;
    }
    for (const matched of childSessionSearchMatchBySessionId.values()) {
      if (matched) count += 1;
    }
    return count;
  }, [sessionSearchNeedle, parentSessionSearchMatchBySessionId, childSessionSearchMatchBySessionId]);
  const totalHiddenChildSessionsByAge = useMemo(
    () =>
      Object.values(childSessionVisibilityByParentSessionId.hiddenByAgeCount).reduce((count, value) => count + value, 0),
    [childSessionVisibilityByParentSessionId.hiddenByAgeCount],
  );
  const totalInFlightBackgroundRuns = useMemo(
    () =>
      Object.values(inFlightBackgroundRunsBySession).reduce((count, runs) => {
        return count + runs.length;
      }, 0),
    [inFlightBackgroundRunsBySession],
  );
  const activeBackgroundInFlightCount = useMemo(
    () => activeBackgroundRuns.filter(run => isBackgroundRunInFlight(run)).length,
    [activeBackgroundRuns],
  );
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

  function getConfirmDialogProps(): {
    open: boolean;
    title: string;
    description?: string;
    confirmLabel: string;
    variant: "default" | "danger";
  } {
    if (!confirmAction) {
      return { open: false, title: "", confirmLabel: "", variant: "default" };
    }

    switch (confirmAction.type) {
      case "abort-run":
        return {
          open: true,
          title: "Abort active run?",
          description: "This will cancel the current OpenCode request. The session state may be inconsistent.",
          confirmLabel: "Abort",
          variant: "danger",
        };
      case "abort-background":
        return {
          open: true,
          title: "Abort background run?",
          description: "This will stop the background task. Progress will be lost.",
          confirmLabel: "Abort",
          variant: "danger",
        };
      case "remove-skill":
        return {
          open: true,
          title: "Remove skill?",
          description: `This will remove "${confirmAction.skillId}" from the configured skills.`,
          confirmLabel: "Remove",
          variant: "danger",
        };
      case "remove-mcp":
        return {
          open: true,
          title: "Remove MCP server?",
          description: `This will remove "${confirmAction.mcpId}" from the allow-list and delete its configuration.`,
          confirmLabel: "Remove",
          variant: "danger",
        };
      case "disconnect-mcp":
        return {
          open: true,
          title: "Disconnect MCP server?",
          description: `This will disconnect "${confirmAction.mcpId}" from the runtime. You can reconnect later.`,
          confirmLabel: "Disconnect",
          variant: "danger",
        };
      case "remove-agent":
        return {
          open: true,
          title: "Remove agent type?",
          description: "This will delete the agent type configuration.",
          confirmLabel: "Remove",
          variant: "danger",
        };
      default:
        return { open: false, title: "", confirmLabel: "", variant: "default" };
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
          <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
          <Card className="panel-noise flex min-h-0 flex-col">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2">
                    <Bot className="size-4" />
                    Sessions
                  </CardTitle>
                  <CardDescription>Switch sessions and set the model for each conversation.</CardDescription>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshInFlightBackgroundRuns()}
                  className="w-full justify-center"
                >
                  <RefreshCcw className="size-4" />
                  runs {totalInFlightBackgroundRuns}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={createNewSession}
                  disabled={isCreatingSession}
                  className="w-full justify-center"
                >
                  <Plus className="size-4" />
                  {isCreatingSession ? "Creating..." : "New"}
                </Button>
              </div>
              <div className="space-y-2">
                <div className="relative">
                  <Input
                    value={childSessionSearchQuery}
                    onChange={event => setChildSessionSearchQuery(event.target.value)}
                    placeholder="Search threads and topics..."
                    className="h-8 pr-8 text-xs"
                  />
                  {childSessionSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setChildSessionSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <CircleSlash className="size-4" />
                    </button>
                  )}
                </div>
                {sessionSearchNeedle && (
                  <p className="px-1 text-[11px] text-muted-foreground">
                    {totalSessionSearchMatches} match{totalSessionSearchMatches === 1 ? "" : "es"}
                  </p>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-full justify-start px-2 text-xs text-muted-foreground"
                  onClick={() => setShowAllChildren(current => !current)}
                >
                  {showAllChildren
                    ? "Hide old children"
                    : `Show all children${totalHiddenChildSessionsByAge > 0 ? ` (${totalHiddenChildSessionsByAge} hidden)` : ""}`}
                </Button>
              </div>
              {sessionError && <p className="text-xs text-destructive">{sessionError}</p>}
            </CardHeader>
            <CardContent className="space-y-2 overflow-y-auto">
              {loading && (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="rounded-xl border border-border bg-muted/70 p-3">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="mt-2 h-3 w-1/2" />
                      <Skeleton className="mt-2 h-3 w-1/4" />
                    </div>
                  ))}
                </div>
              )}
              {!loading && rootSessions.map(session => {
                const childSessions = childSessionsByParentSessionId[session.id] ?? [];
                const visibleChildSessions = childSessionVisibilityByParentSessionId.visible[session.id] ?? [];
                const hiddenChildrenByAge = childSessionVisibilityByParentSessionId.hiddenByAgeCount[session.id] ?? 0;
                const parentSearchMatch = sessionSearchNeedle
                  ? parentSessionSearchMatchBySessionId.get(session.id) === true
                  : false;
                const matchingVisibleChildCount = sessionSearchNeedle
                  ? visibleChildSessions.filter(child => childSessionSearchMatchBySessionId.get(child.id) === true).length
                  : 0;
                const hasChildren = childSessions.length > 0;
                const inFlightRuns = inFlightBackgroundRunsBySession[session.id] ?? [];
                const expanded = Boolean(expandedSessionGroupsById[session.id]);
                return (
                  <div
                    key={session.id}
                    className="space-y-2 rounded-xl border border-border bg-muted/70 p-2 transition data-[active=true]:border-primary/40 data-[active=true]:bg-primary/10 data-[search-match=true]:border-amber-500/40 data-[search-match=true]:bg-amber-500/5"
                    data-active={activeSessionId === session.id}
                    data-search-match={parentSearchMatch}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveSessionId(session.id)}
                      className="w-full rounded-lg p-1.5 text-left transition hover:bg-muted"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="line-clamp-2 break-words font-display text-sm">{session.title}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground" title={session.model}>
                            {session.model}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {parentSearchMatch && <Badge variant="warning">match</Badge>}
                          {matchingVisibleChildCount > 0 && (
                            <Badge variant="outline">{matchingVisibleChildCount} child match</Badge>
                          )}
                          {hasChildren && <Badge variant="outline">{childSessions.length} child</Badge>}
                          <Badge variant={session.status === "active" ? "success" : "warning"}>{session.status}</Badge>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {session.messageCount} msgs • {relativeFromIso(session.lastActiveAt)}
                        {inFlightRuns.length > 0 ? ` • ${inFlightRuns.length} bg running` : ""}
                      </p>
                    </button>

                    {hasChildren && (
                      <div className="space-y-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-full justify-start px-2 text-xs text-muted-foreground"
                          onClick={() => toggleSessionGroup(session.id)}
                        >
                          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                          {expanded ? "Hide child sessions" : "Show child sessions"}
                        </Button>
                        {expanded && (
                          <div className="space-y-2 border-l border-border/70 pl-2">
                            {visibleChildSessions.map(childSession => {
                              const childRun = latestBackgroundRunByChildSessionId.get(childSession.id) ?? null;
                              const childRunInFlight = childRun ? isBackgroundRunInFlight(childRun) : false;
                              const childSearchMatch = sessionSearchNeedle
                                ? childSessionSearchMatchBySessionId.get(childSession.id) === true
                                : false;
                              const checkInBusy = childRun ? Boolean(backgroundCheckInBusyByRun[childRun.runId]) : false;
                              const steerBusy = childRun ? backgroundActionBusyByRun[childRun.runId] === "steer" : false;
                              const nudgeDraft = childRun ? (backgroundSteerDraftByRun[childRun.runId] ?? "") : "";
                              return (
                                <div
                                  key={childSession.id}
                                  className="space-y-2 rounded-md border border-border/70 bg-background/60 p-2 data-[active=true]:border-primary/40 data-[active=true]:bg-primary/10 data-[search-match=true]:border-amber-500/40 data-[search-match=true]:bg-amber-500/5"
                                  data-active={activeSessionId === childSession.id}
                                  data-search-match={childSearchMatch}
                                >
                                  <button
                                    type="button"
                                    onClick={() => setActiveSessionId(childSession.id)}
                                    className="w-full rounded-md p-1 text-left transition hover:bg-muted"
                                  >
                                    <div className="space-y-1">
                                      <p className="line-clamp-2 break-words text-xs font-medium leading-tight">
                                        {childSession.title}
                                      </p>
                                      <div className="flex flex-wrap items-center gap-1">
                                        {childSearchMatch && <Badge variant="warning">match</Badge>}
                                        {childRun && (
                                          <Badge variant={childRunInFlight ? "warning" : "outline"}>
                                            {childRun.status}
                                          </Badge>
                                        )}
                                        <Badge variant={childSession.status === "active" ? "success" : "outline"}>
                                          {childSession.status}
                                        </Badge>
                                      </div>
                                    </div>
                                    {childRun?.prompt && (
                                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                                        {childRun.prompt}
                                      </p>
                                    )}
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                      {childSession.messageCount} msgs • {relativeFromIso(childSession.lastActiveAt)}
                                    </p>
                                  </button>
                                  {childRun && (
                                    <div className="flex items-center gap-1">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-[11px]"
                                        onClick={() => {
                                          void checkInBackgroundRun(childRun);
                                        }}
                                        disabled={checkInBusy}
                                      >
                                        {checkInBusy ? "Opening..." : "Open"}
                                      </Button>
                                      {childRunInFlight && (
                                        <>
                                          <Input
                                            value={nudgeDraft}
                                            onChange={event =>
                                              setBackgroundSteerDraftByRun(current => ({
                                                ...current,
                                                [childRun.runId]: event.target.value,
                                              }))
                                            }
                                            className="h-7 text-[11px]"
                                            placeholder="Nudge..."
                                            disabled={steerBusy}
                                          />
                                          <Button
                                            type="button"
                                            size="sm"
                                            className="h-7 px-2 text-[11px]"
                                            onClick={() => {
                                              void steerBackgroundRun(childRun.runId);
                                            }}
                                            disabled={steerBusy || !nudgeDraft.trim()}
                                          >
                                            {steerBusy ? "..." : "Nudge"}
                                          </Button>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {visibleChildSessions.length === 0 && (
                              <p className="rounded-md border border-border/70 bg-background/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                                No child sessions visible with current filters.
                              </p>
                            )}
                            {hiddenChildrenByAge > 0 && !showAllChildren && (
                              <p className="text-[11px] text-muted-foreground">
                                {hiddenChildrenByAge} old child session{hiddenChildrenByAge === 1 ? "" : "s"} hidden by age
                                filter ({childSessionHideAfterDays}d).
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="panel-noise flex min-h-0 flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-4" />
                {activeSession?.title ?? "Chat"}
              </CardTitle>
              <CardDescription>Chat with the selected OpenCode session.</CardDescription>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <label htmlFor="session-model" className="text-xs font-medium text-muted-foreground">
                  Model
                </label>
                <div className="relative w-full max-w-sm" ref={modelPickerRef}>
                  <button
                    id="session-model"
                    type="button"
                    onClick={() => setIsModelPickerOpen(open => !open)}
                    disabled={!activeSession || isSavingModel || loadingModels || availableModels.length === 0}
                    className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-background px-2 text-left text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-50"
                    aria-expanded={isModelPickerOpen}
                    aria-haspopup="listbox"
                  >
                    <span className="truncate">{selectedModelLabel}</span>
                    <ChevronsUpDown className="size-4 text-muted-foreground" />
                  </button>
                  {isModelPickerOpen && (
                    <div className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-card p-2 shadow-lg">
                      <Input
                        ref={modelSearchInputRef}
                        value={modelQuery}
                        onChange={event => setModelQuery(event.target.value)}
                        onKeyDown={handleModelSearchKeyDown}
                        placeholder="Search model..."
                        className="h-8"
                      />
                      <div className="mt-2 max-h-64 overflow-y-auto" role="listbox">
                        {filteredModelOptions.length === 0 ? (
                          <p className="px-2 py-2 text-xs text-muted-foreground">No models match your search.</p>
                        ) : (
                          filteredModelOptions.map((option, index) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                void selectModelFromPicker(option.id);
                              }}
                              className={cn(
                                "w-full rounded-md px-2 py-1.5 text-left text-sm transition",
                                index === focusedModelIndex ? "bg-primary/10" : "hover:bg-muted",
                              )}
                              data-active={activeSession?.model === option.id}
                            >
                              <p className="truncate">{option.label}</p>
                              <p className="truncate text-xs text-muted-foreground">{option.id}</p>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {isSavingModel && <p className="text-xs text-muted-foreground">Saving model...</p>}
                <Badge
                  variant={
                    activeRunStatusLabel === "idle"
                      ? "success"
                      : activeRunStatusLabel === "retry"
                        ? "warning"
                        : "outline"
                  }
                >
                  run {activeRunStatusLabel}
                </Badge>
                <Badge variant={activeBackgroundInFlightCount > 0 ? "warning" : "outline"}>
                  bg {activeBackgroundInFlightCount}
                </Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={requestAbortRun}
                  disabled={!canAbortActiveSession}
                >
                  <CircleSlash className="size-3.5" />
                  {isAborting ? "Aborting..." : "Abort"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!activeSession) return;
                    void refreshBackgroundRunsForSession(activeSession.id);
                  }}
                  disabled={!activeSession || loadingBackgroundRuns}
                >
                  <RefreshCcw className="size-3.5" />
                  {loadingBackgroundRuns ? "Refreshing..." : "Refresh BG"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!activeSession) return;
                    void compactSession(activeSession.id);
                  }}
                  disabled={!activeSession || isCompacting || isActiveSessionRunning}
                >
                  <Scissors className="size-3.5" />
                  {isCompacting ? "Compacting..." : "Compact"}
                </Button>
              </div>
              {modelError && <p className="text-xs text-destructive">{modelError}</p>}
              {activeRunStatusHint && <p className="text-xs text-muted-foreground">{activeRunStatusHint}</p>}
              {activeSessionRunError && <p className="text-xs text-destructive">{activeSessionRunError}</p>}
              {backgroundRunsError && <p className="text-xs text-destructive">{backgroundRunsError}</p>}
              {chatControlError && <p className="text-xs text-destructive">{chatControlError}</p>}
              {activeSessionCompactedAt && (
                <p className="text-xs text-muted-foreground">Last compacted {relativeFromIso(activeSessionCompactedAt)}</p>
              )}
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
              <div
                className="scrollbar-thin relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-input/50 p-3"
                ref={chatScrollRef}
              >
                {hasNewMessages && isUserScrolledUp && (
                  <button
                    type="button"
                    onClick={scrollToBottom}
                    className="sticky top-2 z-10 mx-auto rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg transition hover:bg-primary/85"
                  >
                    New messages
                  </button>
                )}
                {loadingMessages && <p className="text-sm text-muted-foreground">Loading messages...</p>}
                {!loadingMessages && activeMessages.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
                {activeMessages.map(message => {
                  const isOptimisticUser = message.uiMeta?.type === "optimistic-user";
                  const pendingMeta = message.uiMeta?.type === "assistant-pending" ? message.uiMeta : null;
                  const isPending = pendingMeta?.status === "pending";
                  const isFailed = pendingMeta?.status === "failed";

                  return (
                    <article
                      key={message.id}
                      className="max-w-[92%] rounded-xl border border-border px-3 py-2 text-sm data-[role=assistant]:self-start data-[role=assistant]:bg-muted/80 data-[role=user]:self-end data-[role=user]:bg-primary/20"
                      data-role={message.role}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground">{message.role}</p>
                        {isOptimisticUser && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <LoaderCircle className="size-3 animate-spin" />
                            submitted
                          </span>
                        )}
                        {isPending && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <LoaderCircle className="size-3 animate-spin" />
                            working
                          </span>
                        )}
                      </div>
                      {isPending && (
                        <div className="mt-1 space-y-2">
                          <p className="inline-flex items-center gap-2 leading-relaxed text-muted-foreground">
                            <LoaderCircle className="size-4 animate-spin" />
                            OpenCode is responding...
                          </p>
                          {message.content && (
                            <p className="whitespace-pre-wrap leading-relaxed text-foreground">{message.content}</p>
                          )}
                        </div>
                      )}
                      {isFailed && pendingMeta && (
                        <div className="mt-1 space-y-2">
                          <p className="inline-flex items-center gap-2 leading-relaxed text-destructive">
                            <AlertTriangle className="size-4" />
                            Failed to send request.
                          </p>
                          {message.content && (
                            <p className="whitespace-pre-wrap leading-relaxed text-foreground">{message.content}</p>
                          )}
                          {pendingMeta.errorMessage && (
                            <p className="text-xs text-muted-foreground">{pendingMeta.errorMessage}</p>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => retryFailedRequest(pendingMeta.requestId)}
                            disabled={isSending}
                          >
                            <RefreshCcw className="size-3.5" />
                            Retry
                          </Button>
                        </div>
                      )}
                      {!isPending && !isFailed && <p className="mt-1 whitespace-pre-wrap leading-relaxed">{message.content}</p>}
                      {!isPending && !isFailed && message.role === "assistant" && message.memoryTrace && (
                        <div className="mt-2 space-y-1 rounded-md border border-border/70 bg-background/60 p-2 text-[11px]">
                          <p className="font-medium uppercase tracking-wide text-muted-foreground">
                            memory trace · {message.memoryTrace.mode}
                          </p>
                          <p className="text-muted-foreground">
                            injected results: {message.memoryTrace.injectedContextResults}
                          </p>
                          {message.memoryTrace.toolCalls.length > 0 && (
                            <div className="space-y-1">
                              {message.memoryTrace.toolCalls.map((call, index) => (
                                <p key={`${message.id}-trace-${index}`} className="text-muted-foreground">
                                  {call.tool} · {call.status}
                                  {call.summary ? ` · ${call.summary}` : ""}
                                  {call.error ? ` · ${call.error}` : ""}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              <form className="space-y-2" onSubmit={sendMessage} ref={composerFormRef} aria-busy={isSending}>
                <Textarea
                  value={draftMessage}
                  onChange={event => setDraftMessage(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={isSending ? "Waiting for response..." : "Send a message to the active session..."}
                  disabled={isSending}
                  className="min-h-24 resize-y"
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {isSending ? "Working on your request..." : "Enter to send, Shift+Enter for newline."}
                  </p>
                  <Button type="submit" disabled={isSending || !draftMessage.trim()}>
                    <Send className="size-4" />
                    {isSending ? "Sending..." : "Send"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="panel-noise flex min-h-0 flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="size-4" />
                OpenCode Config
              </CardTitle>
              <CardDescription>Manage skill/MCP config and monitor usage telemetry.</CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 overflow-y-auto">
              <Tabs
                value={activeConfigPanelTab}
                onValueChange={value => setActiveConfigPanelTab(value as ConfigPanelTab)}
              >
                <TabsList className="w-full justify-between">
                  <TabsTrigger value="usage">Usage</TabsTrigger>
                  <TabsTrigger value="memory">Memory</TabsTrigger>
                  <TabsTrigger value="background">Background</TabsTrigger>
                </TabsList>

                <TabsContent value="usage" className="space-y-2">
                  <div className="rounded-lg border border-border bg-muted/70 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Requests</p>
                    <p className="mt-1 font-display text-2xl">{usage.requestCount.toLocaleString()}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-border bg-muted/70 p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Input tokens</p>
                      <p className="mt-1 text-base font-semibold">{usage.inputTokens.toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/70 p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Output tokens</p>
                      <p className="mt-1 text-base font-semibold">{usage.outputTokens.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/70 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Estimated cost</p>
                    <p className="mt-1 flex items-center gap-1 text-xl font-semibold">
                      <Cpu className="size-4 text-muted-foreground" />${usage.estimatedCostUsd.toFixed(4)}
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="memory" className="space-y-2">
                  {memoryError && <p className="text-xs text-destructive">{memoryError}</p>}
                  <div className="rounded-lg border border-border bg-muted/70 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Mode</p>
                    <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
                      <BookOpen className="size-4 text-muted-foreground" />
                      {memoryStatus?.toolMode ?? "unknown"}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-border bg-muted/70 p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Files</p>
                      <p className="mt-1 text-base font-semibold">{memoryStatus?.files ?? 0}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/70 p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Chunks</p>
                      <p className="mt-1 text-base font-semibold">{memoryStatus?.chunks ?? 0}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/70 p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Records</p>
                      <p className="mt-1 text-base font-semibold">{memoryStatus?.records ?? 0}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/70 p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Cache</p>
                      <p className="mt-1 text-base font-semibold">{memoryStatus?.cacheEntries ?? 0}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/70 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Recent writes</p>
                    {memoryActivity.length === 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">No memory write activity yet.</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {memoryActivity.slice(0, 6).map(event => (
                          <div key={event.id} className="rounded-md border border-border/70 bg-background/60 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                {event.status}
                              </p>
                              <p className="text-[11px] text-muted-foreground">{relativeFromIso(event.createdAt)}</p>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed">{event.content}</p>
                            {event.status === "rejected" && (
                              <p className="mt-1 text-[11px] text-destructive">{event.reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="background" className="space-y-3">
                  <div className="rounded-lg border border-border bg-muted/70 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Spawn background run</p>
                    <Textarea
                      value={backgroundPrompt}
                      onChange={event => setBackgroundPrompt(event.target.value)}
                      className="mt-2 min-h-20 resize-y"
                      placeholder="Describe a background task for this session..."
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-[11px] text-muted-foreground">
                        Runs are attached to this session and report back automatically.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          void spawnBackgroundRun();
                        }}
                        disabled={!activeSession || !backgroundPrompt.trim() || backgroundSpawnBusy}
                      >
                        <Plus className="size-3.5" />
                        {backgroundSpawnBusy ? "Spawning..." : "Spawn"}
                      </Button>
                    </div>
                  </div>

                  {loadingBackgroundRuns && (
                    <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                      Loading background runs...
                    </p>
                  )}

                  {!loadingBackgroundRuns && activeBackgroundRuns.length === 0 && (
                    <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                      No background runs for this session yet.
                    </p>
                  )}

                  {activeBackgroundRuns.map(run => {
                    const isTerminal =
                      run.status === "completed" || run.status === "failed" || run.status === "aborted";
                    const busyAction = backgroundActionBusyByRun[run.runId];
                    return (
                      <div
                        key={run.runId}
                        className="space-y-2 rounded-md border border-border bg-muted/70 p-3 data-[focused=true]:border-primary/40 data-[focused=true]:bg-primary/10"
                        data-focused={focusedBackgroundRunId === run.runId}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-medium">{run.runId}</p>
                          <Badge
                            variant={
                              run.status === "completed"
                                ? "success"
                                : run.status === "failed" || run.status === "aborted"
                                  ? "warning"
                                  : "outline"
                            }
                          >
                            {run.status}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          updated {relativeFromIso(run.updatedAt)}
                          {run.startedAt ? ` · started ${relativeFromIso(run.startedAt)}` : ""}
                          {run.completedAt ? ` · completed ${relativeFromIso(run.completedAt)}` : ""}
                        </p>
                        {run.prompt && <p className="text-xs">prompt: {run.prompt}</p>}
                        {run.resultSummary && <p className="text-xs text-muted-foreground">result: {run.resultSummary}</p>}
                        {run.error && <p className="text-xs text-destructive">{run.error}</p>}

                        <div className="space-y-2">
                          {!isTerminal && (
                            <>
                              <Textarea
                                value={backgroundSteerDraftByRun[run.runId] ?? ""}
                                onChange={event =>
                                  setBackgroundSteerDraftByRun(current => ({
                                    ...current,
                                    [run.runId]: event.target.value,
                                  }))
                                }
                                className="min-h-16 max-h-48 resize-y"
                                placeholder="Steer this background run with additional instructions..."
                                disabled={busyAction === "abort"}
                              />
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => requestAbortBackgroundRun(run.runId)}
                                  disabled={Boolean(busyAction)}
                                >
                                  <CircleSlash className="size-3.5" />
                                  {busyAction === "abort" ? "Aborting..." : "Abort"}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => {
                                    void steerBackgroundRun(run.runId);
                                  }}
                                  disabled={
                                    busyAction === "abort" ||
                                    !(backgroundSteerDraftByRun[run.runId]?.trim())
                                  }
                                >
                                  <Send className="size-3.5" />
                                  {busyAction === "steer" ? "Sending..." : "Steer"}
                                </Button>
                              </div>
                            </>
                          )}
                          {isTerminal && (
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (run.childSessionId) {
                                    void refreshSessionsList();
                                    setActiveSessionId(run.childSessionId);
                                  } else {
                                    setActiveSessionId(run.parentSessionId);
                                    setActiveConfigPanelTab("background");
                                  }
                                }}
                              >
                                View session
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
          </section>
        )}

        {dashboardPage === "skills" && (
          <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <Card className="panel-noise flex min-h-0 flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="size-4" />
                  Skill Exposure
                </CardTitle>
                <CardDescription>Toggle which OpenCode skills are exposed to runtime sessions.</CardDescription>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                <div className="flex gap-2">
                  <Input
                    value={skillInput}
                    onChange={event => setSkillInput(event.target.value)}
                    placeholder="skill id (e.g. btca-cli)"
                    onKeyDown={event => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addSkill();
                      }
                    }}
                  />
                  <Button type="button" onClick={addSkill} disabled={!skillInput.trim()}>
                    <Plus className="size-4" />
                    Add
                  </Button>
                </div>

                {loadingSkillCatalog && (
                  <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                    Loading runtime skills...
                  </p>
                )}

                <div className="space-y-2">
                  {!loadingSkillCatalog && availableSkills.length === 0 && (
                    <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                      No runtime skills discovered yet.
                    </p>
                  )}
                  {availableSkills.map(skill => {
                    const enabled = configuredSkillSet.has(skill.id);
                    return (
                      <div
                        key={skill.id}
                        className="space-y-1 rounded-md border border-border bg-muted/70 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{skill.name}</span>
                          <Button
                            type="button"
                            size="sm"
                            variant={enabled ? "default" : "outline"}
                            onClick={() => toggleSkillEnabled(skill.id)}
                          >
                            {enabled ? "Enabled" : "Disabled"}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">{skill.description || "No description provided."}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{skill.location}</p>
                      </div>
                    );
                  })}
                </div>

                {configuredUnavailableSkills.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Configured but unavailable</p>
                    {configuredUnavailableSkills.map(skill => (
                      <div
                        key={skill}
                        className="flex items-center justify-between rounded-md border border-border bg-muted/70 px-3 py-2"
                      >
                        <span className="text-sm">{skill}</span>
<Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => requestRemoveSkill(skill)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => void refreshSkillCatalog()} disabled={loadingSkillCatalog}>
                    {loadingSkillCatalog ? "Refreshing..." : "Refresh"}
                  </Button>
                  <Button type="button" onClick={saveSkillsConfig} disabled={isSavingSkills}>
                    {isSavingSkills ? "Saving..." : "Save skills"}
                  </Button>
                </div>
                {skillCatalogError && <p className="text-xs text-destructive">{skillCatalogError}</p>}
                {skillsError && <p className="text-xs text-destructive">{skillsError}</p>}
              </CardContent>
            </Card>

            <Card className="panel-noise flex min-h-0 flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SlidersHorizontal className="size-4" />
                  Import + Bulk Editor
                </CardTitle>
                <CardDescription>Import managed skills and keep a bulk editable allow-list.</CardDescription>
              </CardHeader>
              <CardContent className="min-h-0 space-y-3 overflow-y-auto">
                <div className="space-y-2 rounded-md border border-border bg-muted/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Import managed skill</p>
                  <Input
                    value={importSkillId}
                    onChange={event => setImportSkillId(event.target.value)}
                    placeholder="new skill id (e.g. my-skill)"
                  />
                  <Textarea
                    value={importSkillContent}
                    onChange={event => setImportSkillContent(event.target.value)}
                    className="min-h-28 resize-y"
                    placeholder="Paste SKILL.md content"
                  />
                  <div className="flex items-center justify-end">
                    <Button
                      type="button"
                      onClick={importSkill}
                      disabled={isImportingSkill || !importSkillId.trim() || !importSkillContent.trim()}
                    >
                      {isImportingSkill ? "Importing..." : "Import skill"}
                    </Button>
                  </div>
                </div>

                <Textarea
                  value={skillsDraft}
                  onChange={event => setSkillsDraft(event.target.value)}
                  className="min-h-64 resize-y"
                  placeholder="One skill per line"
                />
                <div className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                  {configuredSkills.length} configured skill{configuredSkills.length === 1 ? "" : "s"}.
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {dashboardPage === "mcp" && (
          <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <Card className="panel-noise flex min-h-0 flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="size-4" />
                  MCP Management
                </CardTitle>
                <CardDescription>Manage MCP allow-list and verify runtime status from OpenCode.</CardDescription>
              </CardHeader>
              <CardContent className="min-h-0 space-y-3 overflow-y-auto">
                <div className="flex gap-2">
                  <Input
                    value={mcpInput}
                    onChange={event => setMcpInput(event.target.value)}
                    placeholder="mcp id (e.g. github)"
                    onKeyDown={event => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addMcp();
                      }
                    }}
                  />
                  <Button type="button" onClick={addMcp} disabled={!mcpInput.trim()}>
                    <Plus className="size-4" />
                    Add
                  </Button>
                </div>

                <div className="space-y-2">
                  {configuredMcps.length === 0 && (
                    <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                      No MCP servers configured yet.
                    </p>
                  )}
                  {configuredMcps.map(mcp => (
                    <div
                      key={mcp}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/70 px-3 py-2"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm">{mcp}</p>
                        <div className="flex items-center gap-2">
                          <Badge variant={mcpStatusVariant(runtimeMcpById.get(mcp)?.status ?? "unknown")}>
                            {mcpStatusLabel(runtimeMcpById.get(mcp)?.status ?? "unknown")}
                          </Badge>
                          {runtimeMcpById.get(mcp)?.error && (
                            <p className="truncate text-xs text-muted-foreground">{runtimeMcpById.get(mcp)?.error}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void runMcpRuntimeAction(mcp, "connect")}
                          disabled={mcpActionBusyId.length > 0}
                        >
                          Connect
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => requestDisconnectMcp(mcp)}
                          disabled={mcpActionBusyId.length > 0}
                        >
                          Disconnect
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void runMcpRuntimeAction(mcp, "authStart")}
                          disabled={mcpActionBusyId.length > 0}
                        >
                          Auth
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void runMcpRuntimeAction(mcp, "authRemove")}
                          disabled={mcpActionBusyId.length > 0}
                        >
                          Reset Auth
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => requestRemoveMcp(mcp)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                {discoverableMcps.length > 0 && (
                  <div className="space-y-2 rounded-md border border-border bg-muted/60 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Detected in runtime</p>
                    <div className="space-y-2">
                      {discoverableMcps.map(mcp => (
                        <div key={mcp.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5">
                          <div className="min-w-0">
                            <p className="truncate text-sm">{mcp.id}</p>
                            <Badge variant={mcpStatusVariant(mcp.status)}>{mcpStatusLabel(mcp.status)}</Badge>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setMcpsDraft([...configuredMcps, mcp.id].join("\n"));
                              if (!mcpServerIdSet.has(mcp.id)) {
                                setMcpServers(current => [
                                  ...current,
                                  {
                                    id: mcp.id,
                                    type: "remote",
                                    enabled: true,
                                    url: "http://127.0.0.1:8000/mcp",
                                    headers: {},
                                    oauth: "auto",
                                  },
                                ]);
                              }
                            }}
                          >
                            Enable
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => void refreshMcpCatalog()} disabled={loadingMcpCatalog}>
                    {loadingMcpCatalog ? "Refreshing..." : "Refresh"}
                  </Button>
                  <Button type="button" onClick={saveMcpsConfig} disabled={isSavingMcps}>
                    {isSavingMcps ? "Saving..." : "Save MCPs"}
                  </Button>
                </div>
                {mcpCatalogError && <p className="text-xs text-destructive">{mcpCatalogError}</p>}
                {mcpsError && <p className="text-xs text-destructive">{mcpsError}</p>}
                {mcpActionError && <p className="text-xs text-destructive">{mcpActionError}</p>}
              </CardContent>
            </Card>

            <Card className="panel-noise flex min-h-0 flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SlidersHorizontal className="size-4" />
                  Server Definitions
                </CardTitle>
                <CardDescription>Configure remote/local MCP server details used by OpenCode.</CardDescription>
              </CardHeader>
              <CardContent className="min-h-0 space-y-3 overflow-y-auto">
                {normalizedMcpServers.length === 0 && (
                  <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                    No MCP server definitions yet. Add one from the panel on the left.
                  </p>
                )}
                {normalizedMcpServers.map(server => (
                  <div key={server.id} className="space-y-2 rounded-md border border-border bg-muted/60 p-3">
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_120px_96px]">
                      <Input
                        value={server.id}
                        onChange={event => renameMcpServer(server.id, event.target.value)}
                        placeholder="mcp id"
                      />
                      <select
                        value={server.type}
                        onChange={event => setMcpServerType(server.id, event.target.value === "local" ? "local" : "remote")}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="remote">remote</option>
                        <option value="local">local</option>
                      </select>
                      <label className="flex items-center gap-2 rounded-md border border-input px-3 text-sm">
                        <input
                          type="checkbox"
                          checked={configuredMcpSet.has(server.id)}
                          onChange={event => {
                            if (event.target.checked) {
                              setMcpsDraft([...configuredMcps, server.id].join("\n"));
                            } else {
                              setMcpsDraft(configuredMcps.filter(value => value !== server.id).join("\n"));
                            }
                          }}
                        />
                        enabled
                      </label>
                    </div>
                    {server.type === "remote" ? (
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_140px]">
                        <Input
                          value={server.url}
                          onChange={event =>
                            updateMcpServer(server.id, current =>
                              current.type === "remote" ? { ...current, url: event.target.value } : current,
                            )
                          }
                          placeholder="https://example.com/mcp"
                        />
                        <select
                          value={server.oauth}
                          onChange={event =>
                            updateMcpServer(server.id, current =>
                              current.type === "remote"
                                ? { ...current, oauth: event.target.value === "off" ? "off" : "auto" }
                                : current,
                            )
                          }
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="auto">oauth auto</option>
                          <option value="off">oauth off</option>
                        </select>
                        <Input
                          value={typeof server.timeoutMs === "number" ? String(server.timeoutMs) : ""}
                          onChange={event =>
                            updateMcpServer(server.id, current =>
                              current.type === "remote"
                                ? {
                                    ...current,
                                    timeoutMs: event.target.value.trim()
                                      ? Number.isFinite(Number(event.target.value))
                                        ? Number(event.target.value)
                                        : undefined
                                      : undefined,
                                  }
                                : current,
                            )
                          }
                          placeholder="timeout ms"
                        />
                      </div>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px]">
                        <Input
                          value={server.command.join(" ")}
                          onChange={event =>
                            updateMcpServer(server.id, current =>
                              current.type === "local"
                                ? {
                                    ...current,
                                    command: event.target.value.split(" ").map(value => value.trim()).filter(Boolean),
                                  }
                                : current,
                            )
                          }
                          placeholder="bun run mcp-server.ts"
                        />
                        <Input
                          value={typeof server.timeoutMs === "number" ? String(server.timeoutMs) : ""}
                          onChange={event =>
                            updateMcpServer(server.id, current =>
                              current.type === "local"
                                ? {
                                    ...current,
                                    timeoutMs: event.target.value.trim()
                                      ? Number.isFinite(Number(event.target.value))
                                        ? Number(event.target.value)
                                        : undefined
                                      : undefined,
                                  }
                                : current,
                            )
                          }
                          placeholder="timeout ms"
                        />
                      </div>
                    )}
                  </div>
                ))}
                <div className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                  {configuredMcps.length} enabled MCP server{configuredMcps.length === 1 ? "" : "s"} across {normalizedMcpServers.length} definition
                  {normalizedMcpServers.length === 1 ? "" : "s"}.
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {dashboardPage === "agents" && (
          <section className="min-h-0 flex-1 overflow-hidden">
            <Card className="panel-noise flex h-full min-h-0 flex-col overflow-hidden">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="size-4" />
                      Agent Type Management
                    </CardTitle>
                    <CardDescription>
                      Edit OpenCode agent definitions directly. Changes are applied to OpenCode config immediately on save.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void refreshAgentCatalog()}
                      disabled={loadingAgentCatalog}
                    >
                      {loadingAgentCatalog ? "Refreshing..." : "Refresh"}
                    </Button>
                    <Button type="button" onClick={saveAgentTypesConfig} disabled={isSavingAgents}>
                      {isSavingAgents ? "Saving..." : "Save agent types"}
                    </Button>
                  </div>
                </div>
                {agentsError && <p className="text-xs text-destructive">{agentsError}</p>}
                {agentCatalogError && <p className="text-xs text-destructive">{agentCatalogError}</p>}
              </CardHeader>
              <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">OpenCode Agents</p>
                    <p className="text-xs text-muted-foreground">
                      Add, edit, or remove agent definitions managed in OpenCode.
                    </p>
                    {(opencodeConfigFilePath || opencodeDirectory) && (
                      <div className="space-y-0.5 pt-1 text-xs text-muted-foreground">
                        {opencodeConfigFilePath && <p>Saving to: <code>{opencodeConfigFilePath}</code></p>}
                        {opencodeDirectory && <p>Bound directory: <code>{opencodeDirectory}</code></p>}
                        {opencodePersistenceMode && <p>Mode: <code>{opencodePersistenceMode}</code></p>}
                      </div>
                    )}
                  </div>
                  <Button type="button" variant="outline" onClick={addAgentType}>
                    <Plus className="size-4" />
                    Create custom type
                  </Button>
                </div>

                {agentTypes.length === 0 && (
                  <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                    No OpenCode agent definitions found. Create one to get started.
                  </p>
                )}
                {agentTypes.map(agentType => (
                  <div key={agentType.id} className="space-y-3 rounded-lg border border-border bg-muted/60 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate font-display text-sm">{agentType.name || agentType.id}</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => requestRemoveAgent(agentType.id)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">ID</p>
                        <Input
                          id={`agent-type-${agentType.id}-id`}
                          value={agentType.id}
                          onChange={event => updateAgentTypeField(agentType.id, "id", event.target.value)}
                          placeholder="agent-id"
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Name</p>
                        <Input
                          id={`agent-type-${agentType.id}-name`}
                          value={agentType.name ?? ""}
                          onChange={event => updateAgentTypeField(agentType.id, "name", event.target.value)}
                          placeholder="Agent name"
                        />
                      </div>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Description</p>
                        <Input
                          id={`agent-type-${agentType.id}-description`}
                          value={agentType.description ?? ""}
                          onChange={event => updateAgentTypeField(agentType.id, "description", event.target.value)}
                          placeholder="When this agent should be used"
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Model</p>
                        <div className="relative" ref={openAgentModelPickerId === agentType.id ? agentModelPickerRef : undefined}>
                          <button
                            type="button"
                            onClick={() => {
                              setAgentModelQuery("");
                              setOpenAgentModelPickerId(current => (current === agentType.id ? null : agentType.id));
                            }}
                            className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-background px-2 text-left text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring/70"
                            aria-expanded={openAgentModelPickerId === agentType.id}
                            aria-haspopup="listbox"
                          >
                            <span className="truncate">
                              {agentType.model
                                ? availableModels.find(model => model.id === agentType.model)?.label ?? agentType.model
                                : "Default runtime model"}
                            </span>
                            <ChevronsUpDown className="size-4 text-muted-foreground" />
                          </button>
                          {openAgentModelPickerId === agentType.id && (
                            <div className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-card p-2 shadow-lg">
                              <Input
                                ref={agentModelSearchInputRef}
                                value={agentModelQuery}
                                onChange={event => setAgentModelQuery(event.target.value)}
                                onKeyDown={event => handleAgentModelSearchKeyDown(event, agentType.id)}
                                placeholder="Search model..."
                                className="h-8"
                              />
                              <div className="mt-2 max-h-64 overflow-y-auto" role="listbox">
                                <button
                                  type="button"
                                  onClick={() => selectAgentModelFromPicker(agentType.id, "")}
                                  className={cn(
                                    "w-full rounded-md px-2 py-1.5 text-left text-sm transition",
                                    !agentType.model && agentFocusedModelIndex === 0 ? "bg-primary/10" : "hover:bg-muted",
                                  )}
                                >
                                  <p className="truncate">Default runtime model</p>
                                </button>
                                {filteredAgentModelOptions().length === 0 ? (
                                  <p className="px-2 py-2 text-xs text-muted-foreground">No models match your search.</p>
                                ) : (
                                  filteredAgentModelOptions().map((option, index) => (
                                    <button
                                      key={option.id}
                                      type="button"
                                      onClick={() => selectAgentModelFromPicker(agentType.id, option.id)}
                                      className={cn(
                                        "w-full rounded-md px-2 py-1.5 text-left text-sm transition",
                                        index + 1 === agentFocusedModelIndex ? "bg-primary/10" : "hover:bg-muted",
                                      )}
                                      data-active={agentType.model === option.id}
                                    >
                                      <p className="truncate">{option.label}</p>
                                      <p className="truncate text-xs text-muted-foreground">{option.id}</p>
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Prompt</p>
                      <Textarea
                        id={`agent-type-${agentType.id}-prompt`}
                        value={agentType.prompt ?? ""}
                        onChange={event => updateAgentTypeField(agentType.id, "prompt", event.target.value)}
                        placeholder="Instructions for this agent"
                        className="min-h-20 resize-y"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="space-y-1">
                        <label htmlFor={`agent-type-${agentType.id}-mode`} className="text-xs text-muted-foreground">Mode</label>
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="size-4 text-muted-foreground" />
                          <select
                            id={`agent-type-${agentType.id}-mode`}
                            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                            value={agentType.mode}
                            onChange={event =>
                              updateAgentTypeField(agentType.id, "mode", event.target.value as AgentTypeDefinition["mode"])
                            }
                          >
                            <option value="subagent">subagent</option>
                            <option value="primary">primary</option>
                            <option value="all">all</option>
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`agent-type-${agentType.id}-enabled`} className="text-xs text-muted-foreground">
                          Enabled
                        </label>
                        <label htmlFor={`agent-type-${agentType.id}-enabled`} className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                          <input
                            id={`agent-type-${agentType.id}-enabled`}
                            type="checkbox"
                            checked={!agentType.disable}
                            onChange={event => updateAgentTypeField(agentType.id, "disable", !event.target.checked)}
                          />
                          Active
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                  {agentTypes.length} OpenCode agent definition{agentTypes.length === 1 ? "" : "s"}.
                </div>
              </CardContent>
            </Card>
          </section>
        )}
      </div>
    </main>
  );

  function renderConfirmDialog() {
    const props = getConfirmDialogProps();
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
