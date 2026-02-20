import {
  Activity,
  AlertTriangle,
  BookOpen,
  Bot,
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
  ChatMessage,
  DashboardBootstrap,
  MemoryPolicySnapshot,
  MemoryStatusSnapshot,
  MemoryWriteEvent,
  ModelOption,
  ConfiguredMcpServer,
  SessionCompactedSnapshot,
  SessionRunErrorSnapshot,
  SessionRunStatusSnapshot,
  SessionSummary,
  RuntimeAgent,
  RuntimeMcp,
  RuntimeSkill,
  SpecialistAgent,
  UsageSnapshot,
} from "@/types/dashboard";
import "@/index.css";

const RUN_POLL_INTERVAL_MS = 350;
const DEFAULT_RUN_WAIT_TIMEOUT_MS = 180_000;

type AgentRunState = "queued" | "running" | "completed" | "failed";

interface AgentRunSnapshot {
  id: string;
  sessionId: string;
  state: AgentRunState;
  error?: unknown;
}

interface ConfigSnapshotResponse {
  hash?: string;
  config?: {
    runtime?: {
      opencode?: {
        runWaitTimeoutMs?: number;
      };
    };
  };
}

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

export function App() {
  type StreamStatus = "connecting" | "connected" | "reconnecting";
  type DashboardPage = "chat" | "skills" | "mcp" | "agents";

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
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [agents, setAgents] = useState<SpecialistAgent[]>([]);
  const [dashboardPage, setDashboardPage] = useState<DashboardPage>("chat");
  const [configHash, setConfigHash] = useState("");
  const [skillsDraft, setSkillsDraft] = useState("");
  const [availableSkills, setAvailableSkills] = useState<RuntimeSkill[]>([]);
  const [availableMcps, setAvailableMcps] = useState<RuntimeMcp[]>([]);
  const [availableAgents, setAvailableAgents] = useState<RuntimeAgent[]>([]);
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
  const [usage, setUsage] = useState<UsageSnapshot>({
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  });
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatusSnapshot | null>(null);
  const [memoryPolicy, setMemoryPolicy] = useState<MemoryPolicySnapshot | null>(null);
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
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const composerFormRef = useRef<HTMLFormElement>(null);
  const loadedSessionsRef = useRef(new Set<string>());
  const activeSendRef = useRef<ActiveSend | null>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const abortedRequestIdsRef = useRef(new Set<string>());
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const modelSearchInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const previousActiveSessionIdRef = useRef("");
  const isSending = activeSend !== null;

  useEffect(() => {
    let alive = true;
    const bootstrap = async () => {
      const response = await fetch("/api/dashboard/bootstrap");
      const payload = (await response.json()) as DashboardBootstrap;
      if (!alive) return;

      setSessions(payload.sessions);
      setSkillsDraft(payload.skills.join("\n"));
      setMcpsDraft(payload.mcps.join("\n"));
      setAgents(payload.agents);
      setUsage(payload.usage);
      setHeartbeatAt(payload.heartbeat.at);
      setActiveSessionId(payload.sessions[0]?.id ?? "");
      setLoading(false);

      setLoadingModels(true);
      try {
        const [
          modelsResponse,
          memoryStatusResponse,
          memoryPolicyResponse,
          memoryActivityResponse,
          configResponse,
          skillsCatalogResponse,
          mcpsCatalogResponse,
          agentsCatalogResponse,
        ] = await Promise.all([
          fetch("/api/opencode/models"),
          fetch("/api/memory/status"),
          fetch("/api/memory/policy"),
          fetch("/api/memory/activity?limit=12"),
          fetch("/api/config"),
          fetch("/api/config/skills/catalog"),
          fetch("/api/config/mcps/catalog"),
          fetch("/api/config/agents/catalog"),
        ]);
        const modelsPayload = (await modelsResponse.json()) as { models?: ModelOption[]; error?: string };
        const memoryStatusPayload = (await memoryStatusResponse.json()) as {
          status?: MemoryStatusSnapshot;
          error?: string;
        };
        const memoryPolicyPayload = (await memoryPolicyResponse.json()) as {
          policy?: MemoryPolicySnapshot;
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
        const agentsCatalogPayload = (await agentsCatalogResponse.json()) as {
          agents?: RuntimeAgent[];
          configured?: string[];
          hash?: string;
          error?: string;
        };
        if (!alive) return;

        setModelOptions(modelsPayload.models ?? []);
        setModelError(modelsResponse.ok ? "" : (modelsPayload.error ?? "Failed to load OpenCode models"));
        setMemoryStatus(memoryStatusPayload.status ?? null);
        setMemoryPolicy(memoryPolicyPayload.policy ?? null);
        setMemoryActivity(memoryActivityPayload.events ?? []);
        setAvailableSkills(Array.isArray(skillsCatalogPayload.skills) ? skillsCatalogPayload.skills : []);
        setAvailableMcps(Array.isArray(mcpsCatalogPayload.mcps) ? mcpsCatalogPayload.mcps : []);
        setAvailableAgents(Array.isArray(agentsCatalogPayload.agents) ? agentsCatalogPayload.agents : []);
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
        setConfigHash(typeof configPayload.hash === "string" ? configPayload.hash : "");
        setSkillCatalogError(skillsCatalogResponse.ok ? "" : (skillsCatalogPayload.error ?? "Failed to load runtime skills"));
        setMcpCatalogError(mcpsCatalogResponse.ok ? "" : (mcpsCatalogPayload.error ?? "Failed to load runtime MCP servers"));
        setAgentCatalogError(agentsCatalogResponse.ok ? "" : (agentsCatalogPayload.error ?? "Failed to load runtime agents"));
        const failedMemoryMessage =
          (!memoryStatusResponse.ok && (memoryStatusPayload.error ?? "Failed to load memory status")) ||
          (!memoryPolicyResponse.ok && (memoryPolicyPayload.error ?? "Failed to load memory policy")) ||
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
      setSessions(current => current.map(session => (session.id === payload.id ? payload : session)));
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
  const runtimeAgentById = useMemo(() => new Map(availableAgents.map(agent => [agent.id, agent])), [availableAgents]);
  const configuredAgentIdSet = useMemo(
    () => new Set(agents.map(agent => agent.id.trim()).filter(Boolean)),
    [agents],
  );
  const discoverableAgents = useMemo(
    () => availableAgents.filter(agent => !configuredAgentIdSet.has(agent.id)),
    [availableAgents, configuredAgentIdSet],
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
    const container = chatScrollRef.current;
    if (!container) return;
    const behavior: ScrollBehavior = previousActiveSessionIdRef.current !== activeSessionId ? "auto" : "smooth";
    container.scrollTo({ top: container.scrollHeight, behavior });
    previousActiveSessionIdRef.current = activeSessionId;
  }, [activeSessionId, activeMessages.length, loadingMessages, isSending]);

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
          setSessions(current => current.map(session => (session.id === updatedSession.id ? updatedSession : session)));
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
      const response = await fetch("/api/config/agents/catalog");
      const payload = (await response.json()) as {
        agents?: RuntimeAgent[];
        configured?: string[];
        hash?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load runtime agents");
      }
      setAvailableAgents(Array.isArray(payload.agents) ? payload.agents : []);
      if (typeof payload.hash === "string") {
        setConfigHash(payload.hash);
      }
    } catch (error) {
      setAgentCatalogError(error instanceof Error ? error.message : "Failed to load runtime agents");
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

  function addAgent() {
    const next: SpecialistAgent = {
      id: `agent-${crypto.randomUUID().slice(0, 8)}`,
      name: "New Agent",
      specialty: "Add specialty",
      summary: "Describe what this agent should handle.",
      model: activeSession?.model ?? modelOptions[0]?.id ?? "opencode/kimi-k2.5-free",
      status: "available",
    };
    setAgents(current => [...current, next]);
  }

  function addRuntimeAgent(agent: RuntimeAgent) {
    if (!agent.id.trim()) return;
    setAgents(current => {
      if (current.some(existing => existing.id === agent.id)) return current;
      const next: SpecialistAgent = {
        id: agent.id,
        name: agent.id,
        specialty: agent.description?.trim() || "Runtime-discovered agent",
        summary: agent.description?.trim() || "Runtime-discovered OpenCode agent.",
        model: agent.model?.trim() || activeSession?.model || modelOptions[0]?.id || "opencode/kimi-k2.5-free",
        status: agent.enabled ? "available" : "offline",
      };
      return [...current, next];
    });
  }

  function removeAgent(agentId: string) {
    setAgents(current => current.filter(agent => agent.id !== agentId));
  }

  function updateAgentField<K extends keyof SpecialistAgent>(agentId: string, field: K, value: SpecialistAgent[K]) {
    setAgents(current =>
      current.map(agent => {
        if (agent.id !== agentId) return agent;
        return {
          ...agent,
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

  async function saveAgentsConfig() {
    setIsSavingAgents(true);
    setAgentsError("");
    try {
      const response = await fetch("/api/config/agents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agents,
          expectedHash: configHash || undefined,
        }),
      });
      const payload = (await response.json()) as {
        agents?: SpecialistAgent[];
        hash?: string;
        error?: string;
      };
      if (!response.ok || !Array.isArray(payload.agents)) {
        throw new Error(payload.error ?? "Failed to save agents");
      }

      setAgents(payload.agents);
      setConfigHash(typeof payload.hash === "string" ? payload.hash : configHash);
      await refreshAgentCatalog();
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : "Failed to save agents");
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

      setSessions(current => current.map(session => (session.id === updated.id ? updated : session)));
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
      setMessagesBySession(current => ({
        ...current,
        [created.id]: current[created.id] ?? [],
      }));
      setSessions(current => [created, ...current.filter(session => session.id !== created.id)]);
      setActiveSessionId(created.id);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Failed to create session");
    } finally {
      setIsCreatingSession(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:h-screen lg:overflow-hidden lg:px-8">
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
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Bot className="size-4" />
                    Sessions
                  </CardTitle>
                  <CardDescription>Switch sessions and set the model for each conversation.</CardDescription>
                </div>
                <Button type="button" size="sm" onClick={createNewSession} disabled={isCreatingSession}>
                  <Plus className="size-4" />
                  {isCreatingSession ? "Creating..." : "New"}
                </Button>
              </div>
              {sessionError && <p className="text-xs text-destructive">{sessionError}</p>}
            </CardHeader>
            <CardContent className="space-y-2 overflow-y-auto">
              {loading && <p className="text-sm text-muted-foreground">Loading sessions...</p>}
              {sessions.map(session => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setActiveSessionId(session.id)}
                  className="w-full rounded-xl border border-border bg-muted/70 p-3 text-left transition hover:bg-muted data-[active=true]:border-primary/40 data-[active=true]:bg-primary/10"
                  data-active={activeSessionId === session.id}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-display text-sm">{session.title}</p>
                    <Badge variant={session.status === "active" ? "success" : "warning"}>{session.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{session.model}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {session.messageCount} msgs • {relativeFromIso(session.lastActiveAt)}
                  </p>
                </button>
              ))}
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
                        placeholder="Search model..."
                        className="h-8"
                      />
                      <div className="mt-2 max-h-64 overflow-y-auto" role="listbox">
                        {filteredModelOptions.length === 0 ? (
                          <p className="px-2 py-2 text-xs text-muted-foreground">No models match your search.</p>
                        ) : (
                          filteredModelOptions.map(option => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                void selectModelFromPicker(option.id);
                              }}
                              className="w-full rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-muted data-[active=true]:bg-primary/10"
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void abortActiveRun();
                  }}
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
              {chatControlError && <p className="text-xs text-destructive">{chatControlError}</p>}
              {activeSessionCompactedAt && (
                <p className="text-xs text-muted-foreground">Last compacted {relativeFromIso(activeSessionCompactedAt)}</p>
              )}
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
              <div
                className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-input/50 p-3"
                ref={chatScrollRef}
              >
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
              <Tabs defaultValue="usage">
                <TabsList className="w-full justify-between">
                  <TabsTrigger value="usage">Usage</TabsTrigger>
                  <TabsTrigger value="memory">Memory</TabsTrigger>
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
                    <p className="mt-1 text-xs text-muted-foreground">
                      policy: {memoryStatus?.writePolicy ?? "unknown"} · min confidence{" "}
                      {typeof memoryStatus?.minConfidence === "number"
                        ? memoryStatus.minConfidence.toFixed(2)
                        : "n/a"}
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
                                {event.status} · {event.type}
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
                  {memoryPolicy && (
                    <div className="rounded-lg border border-border bg-muted/70 p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Allowed types</p>
                      <p className="mt-1 text-xs">{memoryPolicy.allowedTypes.join(", ") || "none"}</p>
                    </div>
                  )}
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
              <CardContent className="min-h-0 space-y-3 overflow-y-auto">
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
                          onClick={() => removeSkill(skill)}
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
                          onClick={() => void runMcpRuntimeAction(mcp, "disconnect")}
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
                          onClick={() => removeMcp(mcp)}
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
          <section className="min-h-0 flex-1">
            <Card className="panel-noise flex min-h-0 flex-col">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="size-4" />
                      Agent Config Management
                    </CardTitle>
                    <CardDescription>Edit delegation agents and persist config changes.</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" onClick={addAgent}>
                      <Plus className="size-4" />
                      Add agent
                    </Button>
                    <Button type="button" onClick={saveAgentsConfig} disabled={isSavingAgents}>
                      {isSavingAgents ? "Saving..." : "Save agents"}
                    </Button>
                  </div>
                </div>
                {agentsError && <p className="text-xs text-destructive">{agentsError}</p>}
                {agentCatalogError && <p className="text-xs text-destructive">{agentCatalogError}</p>}
              </CardHeader>
              <CardContent className="min-h-0 space-y-3 overflow-y-auto">
                <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">Runtime Agents</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => void refreshAgentCatalog()} disabled={loadingAgentCatalog}>
                      {loadingAgentCatalog ? "Refreshing..." : "Refresh"}
                    </Button>
                  </div>
                  {availableAgents.length === 0 && (
                    <p className="text-xs text-muted-foreground">No runtime agents discovered yet.</p>
                  )}
                  {availableAgents.map(runtimeAgent => (
                    <div key={runtimeAgent.id} className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-2 py-1.5">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm">{runtimeAgent.id}</p>
                          <Badge variant={runtimeAgent.enabled ? "success" : "outline"}>
                            {runtimeAgent.enabled ? "enabled" : "disabled"}
                          </Badge>
                          <Badge variant="outline">{runtimeAgent.mode}</Badge>
                          {runtimeAgent.native && <Badge variant="outline">native</Badge>}
                        </div>
                        {runtimeAgent.model && <p className="truncate text-xs text-muted-foreground">{runtimeAgent.model}</p>}
                      </div>
                      {!configuredAgentIdSet.has(runtimeAgent.id) && (
                        <Button type="button" variant="outline" size="sm" onClick={() => addRuntimeAgent(runtimeAgent)}>
                          Add
                        </Button>
                      )}
                    </div>
                  ))}
                  {discoverableAgents.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {discoverableAgents.length} runtime agent{discoverableAgents.length === 1 ? "" : "s"} not yet in Wafflebot config.
                    </p>
                  )}
                </div>

                {agents.length === 0 && (
                  <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                    No agent configs yet. Add one to get started.
                  </p>
                )}
                {agents.map(agent => {
                  const runtimeAgent = runtimeAgentById.get(agent.id);
                  return (
                    <div key={agent.id} className="space-y-3 rounded-lg border border-border bg-muted/60 p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate font-display text-sm">{agent.name || agent.id}</p>
                          <Badge variant={runtimeAgent ? "success" : "outline"}>
                            {runtimeAgent ? "runtime" : "not detected"}
                          </Badge>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => removeAgent(agent.id)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>

                      <div className="grid gap-2 md:grid-cols-2">
                        <Input
                          value={agent.id}
                          onChange={event => updateAgentField(agent.id, "id", event.target.value)}
                          placeholder="id"
                        />
                        <Input
                          value={agent.name}
                          onChange={event => updateAgentField(agent.id, "name", event.target.value)}
                          placeholder="name"
                        />
                      </div>

                      <div className="grid gap-2 md:grid-cols-2">
                        <Input
                          value={agent.specialty}
                          onChange={event => updateAgentField(agent.id, "specialty", event.target.value)}
                          placeholder="specialty"
                        />
                        <Input
                          value={agent.model}
                          onChange={event => updateAgentField(agent.id, "model", event.target.value)}
                          placeholder="provider/model"
                        />
                      </div>

                      <Textarea
                        value={agent.summary}
                        onChange={event => updateAgentField(agent.id, "summary", event.target.value)}
                        placeholder="summary"
                        className="min-h-20 resize-y"
                      />

                      <div className="flex items-center gap-2">
                        <ShieldCheck className="size-4 text-muted-foreground" />
                        <select
                          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                          value={agent.status}
                          onChange={event =>
                            updateAgentField(
                              agent.id,
                              "status",
                              event.target.value as SpecialistAgent["status"],
                            )
                          }
                        >
                          <option value="available">available</option>
                          <option value="busy">busy</option>
                          <option value="offline">offline</option>
                        </select>
                      </div>
                    </div>
                  );
                })}
                <div className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                  {agents.length} configured agent{agents.length === 1 ? "" : "s"}.
                </div>
              </CardContent>
            </Card>
          </section>
        )}
      </div>
    </main>
  );
}
