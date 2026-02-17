import { Activity, AlertTriangle, BookOpen, Bot, ChevronsUpDown, Cpu, LoaderCircle, Plus, RefreshCcw, Send, Users, Wrench } from "lucide-react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  ChatMessage,
  DashboardBootstrap,
  MemoryPolicySnapshot,
  MemoryStatusSnapshot,
  MemoryWriteEvent,
  ModelOption,
  SessionSummary,
  SpecialistAgent,
  UsageSnapshot,
} from "@/types/dashboard";
import "@/index.css";

interface OptimisticUserMeta {
  type: "optimistic-user";
  requestId: string;
}

interface PendingAssistantMeta {
  type: "assistant-pending";
  requestId: string;
  status: "pending" | "failed";
  retryContent: string;
  errorMessage?: string;
}

type LocalMessageMeta = OptimisticUserMeta | PendingAssistantMeta;

interface LocalChatMessage extends ChatMessage {
  uiMeta?: LocalMessageMeta;
}

interface ActiveSend {
  requestId: string;
  sessionId: string;
  content: string;
}

function relativeFromIso(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.floor(deltaMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function normalizeListInput(value: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    list.push(trimmed);
  }
  return list;
}

function mergeMessages(current: LocalChatMessage[], incoming: ChatMessage[]): LocalChatMessage[] {
  if (incoming.length === 0) return current;
  const merged = [...current];
  for (const message of incoming) {
    const index = merged.findIndex(existing => existing.id === message.id);
    if (index === -1) {
      merged.push(message);
      continue;
    }
    const existing = merged[index];
    if (!existing) continue;
    merged[index] = {
      ...existing,
      ...message,
      uiMeta: existing.uiMeta,
    };
  }
  return merged;
}

function normalizeRequestError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Request timed out.";
  }
  if (error instanceof TypeError) {
    return "Network error while sending request.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Request failed.";
}

export function App() {
  type StreamStatus = "connecting" | "connected" | "reconnecting";

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
  const [skillsDraft, setSkillsDraft] = useState("");
  const [mcpsDraft, setMcpsDraft] = useState("");
  const [isSavingSkills, setIsSavingSkills] = useState(false);
  const [isSavingMcps, setIsSavingMcps] = useState(false);
  const [skillsError, setSkillsError] = useState("");
  const [mcpsError, setMcpsError] = useState("");
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
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const composerFormRef = useRef<HTMLFormElement>(null);
  const loadedSessionsRef = useRef(new Set<string>());
  const activeSendRef = useRef<ActiveSend | null>(null);
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
        const [modelsResponse, memoryStatusResponse, memoryPolicyResponse, memoryActivityResponse] =
          await Promise.all([
            fetch("/api/opencode/models"),
            fetch("/api/memory/status"),
            fetch("/api/memory/policy"),
            fetch("/api/memory/activity?limit=12"),
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
        if (!alive) return;

        setModelOptions(modelsPayload.models ?? []);
        setModelError(modelsResponse.ok ? "" : (modelsPayload.error ?? "Failed to load OpenCode models"));
        setMemoryStatus(memoryStatusPayload.status ?? null);
        setMemoryPolicy(memoryPolicyPayload.policy ?? null);
        setMemoryActivity(memoryActivityPayload.events ?? []);
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

  function applyConversationUpdate(payload: { messages: ChatMessage[]; session: SessionSummary }) {
    loadedSessionsRef.current.add(payload.session.id);
    setMessagesBySession(current => ({
      ...current,
      [payload.session.id]: mergeMessages(current[payload.session.id] ?? [], payload.messages),
    }));
    setSessions(current => current.map(session => (session.id === payload.session.id ? payload.session : session)));
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
  }

  async function submitChatRequest(input: {
    sessionId: string;
    content: string;
    requestId?: string;
    retry?: boolean;
  }) {
    if (activeSendRef.current) return;

    const requestId = input.requestId ?? crypto.randomUUID();
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
    activeSendRef.current = nextActiveSend;
    setActiveSend(nextActiveSend);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: input.sessionId,
          content: input.content,
        }),
      });
      const payload = (await response.json()) as { messages?: ChatMessage[]; session?: SessionSummary; error?: string };
      if (!response.ok || !payload.messages || !payload.session) {
        throw new Error(payload.error ?? `Request failed (${response.status})`);
      }

      removeOptimisticRequest(input.sessionId, requestId);
      applyConversationUpdate({
        messages: payload.messages,
        session: payload.session,
      });
    } catch (error) {
      markRequestFailed(input.sessionId, requestId, normalizeRequestError(error));
    } finally {
      if (activeSendRef.current?.requestId === requestId) {
        activeSendRef.current = null;
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

  async function saveSkillsConfig() {
    setIsSavingSkills(true);
    setSkillsError("");
    try {
      const response = await fetch("/api/config/skills", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: normalizeListInput(skillsDraft),
        }),
      });
      const payload = (await response.json()) as { skills?: string[]; error?: string };
      if (!response.ok || !payload.skills) {
        throw new Error(payload.error ?? "Failed to save skills");
      }

      setSkillsDraft(payload.skills.join("\n"));
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
      const response = await fetch("/api/config/mcps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mcps: normalizeListInput(mcpsDraft),
        }),
      });
      const payload = (await response.json()) as { mcps?: string[]; error?: string };
      if (!response.ok || !payload.mcps) {
        throw new Error(payload.error ?? "Failed to save MCP servers");
      }

      setMcpsDraft(payload.mcps.join("\n"));
    } catch (error) {
      setMcpsError(error instanceof Error ? error.message : "Failed to save MCP servers");
    } finally {
      setIsSavingMcps(false);
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
        </header>

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
              </div>
              {modelError && <p className="text-xs text-destructive">{modelError}</p>}
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
                        <p className="mt-1 inline-flex items-center gap-2 leading-relaxed text-muted-foreground">
                          <LoaderCircle className="size-4 animate-spin" />
                          OpenCode is responding...
                        </p>
                      )}
                      {isFailed && pendingMeta && (
                        <div className="mt-1 space-y-2">
                          <p className="inline-flex items-center gap-2 leading-relaxed text-destructive">
                            <AlertTriangle className="size-4" />
                            Failed to send request.
                          </p>
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
              <Tabs defaultValue="skills">
                <TabsList className="w-full justify-between">
                  <TabsTrigger value="agents">Agents</TabsTrigger>
                  <TabsTrigger value="skills">Skills</TabsTrigger>
                  <TabsTrigger value="mcp">MCP</TabsTrigger>
                  <TabsTrigger value="usage">Usage</TabsTrigger>
                  <TabsTrigger value="memory">Memory</TabsTrigger>
                </TabsList>

                <TabsContent value="agents" className="space-y-2">
                  {agents.length === 0 && (
                    <p className="rounded-lg border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                      No delegation agents configured yet.
                    </p>
                  )}
                  {agents.map(agent => (
                    <div key={agent.id} className="rounded-lg border border-border bg-muted/70 p-3">
                      <div className="flex items-center justify-between">
                        <p className="flex items-center gap-1 text-sm font-semibold">
                          <Users className="size-3.5 text-muted-foreground" />
                          {agent.name}
                        </p>
                        <Badge variant={agent.status === "available" ? "success" : "warning"}>{agent.status}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{agent.specialty}</p>
                      <p className="mt-2 text-xs text-muted-foreground">{agent.summary}</p>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="skills" className="space-y-2">
                  <Textarea
                    value={skillsDraft}
                    onChange={event => setSkillsDraft(event.target.value)}
                    className="min-h-44 resize-y"
                    placeholder="One skill per line"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">One skill per line.</p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={saveSkillsConfig}
                      disabled={isSavingSkills}
                    >
                      {isSavingSkills ? "Saving..." : "Save skills"}
                    </Button>
                  </div>
                  {skillsError && <p className="text-xs text-destructive">{skillsError}</p>}
                </TabsContent>

                <TabsContent value="mcp" className="space-y-2">
                  <Textarea
                    value={mcpsDraft}
                    onChange={event => setMcpsDraft(event.target.value)}
                    className="min-h-44 resize-y"
                    placeholder="One MCP server per line"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">One MCP server per line.</p>
                    <Button type="button" size="sm" onClick={saveMcpsConfig} disabled={isSavingMcps}>
                      {isSavingMcps ? "Saving..." : "Save MCPs"}
                    </Button>
                  </div>
                  {mcpsError && <p className="text-xs text-destructive">{mcpsError}</p>}
                </TabsContent>

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
      </div>
    </main>
  );
}
