import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { mergeMessages, upsertChatMessagePart } from "@/frontend/app/chatHelpers";
import type {
  ActiveSend,
  LocalChatMessage,
} from "@/frontend/app/chatHelpers";
import type {
  BackgroundRunsResponse,
  ConfigSnapshotResponse,
  OpencodeAgentStorageResponse,
  RuntimeInfoResponse,
} from "@/frontend/app/dashboardTypes";
import { fromLegacyAgent } from "@/frontend/app/dashboardTypes";
import {
  DEFAULT_RUN_WAIT_TIMEOUT_MS,
  mergeBackgroundRunsBySession,
  normalizeAgentTypeDraft,
  normalizeChildSessionHideAfterDays,
  sortSessionsByActivity,
  upsertSessionList,
} from "@/frontend/app/dashboardUtils";
import type {
  AgentTypeDefinition,
  BackgroundRunSnapshot,
  ChatMessage,
  ChatMessagePart,
  ConfiguredMcpServer,
  DashboardBootstrap,
  MemoryStatusSnapshot,
  MemoryWriteEvent,
  ModelOption,
  RuntimeMcp,
  RuntimeSkill,
  SessionCompactedSnapshot,
  SessionRunErrorSnapshot,
  SessionRunStatusSnapshot,
  SessionSummary,
  UsageSnapshot,
} from "@/types/dashboard";

type StreamStatus = "connecting" | "connected" | "reconnecting";
const IN_FLIGHT_BACKGROUND_STATUSES = new Set<BackgroundRunSnapshot["status"]>([
  "created",
  "running",
  "retrying",
  "idle",
]);

interface UseDashboardBootstrapInput {
  backgroundRunsBySessionRef: MutableRefObject<Record<string, BackgroundRunSnapshot[]>>;
  loadedSessionsRef: MutableRefObject<Set<string>>;
  loadedBackgroundSessionsRef: MutableRefObject<Set<string>>;
  activeSendRef: MutableRefObject<ActiveSend | null>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setLoadingModels: Dispatch<SetStateAction<boolean>>;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  setSkillsDraft: Dispatch<SetStateAction<string>>;
  setMcpsDraft: Dispatch<SetStateAction<string>>;
  setAgentTypes: Dispatch<SetStateAction<AgentTypeDefinition[]>>;
  setAgentTypesBaseline: Dispatch<SetStateAction<AgentTypeDefinition[]>>;
  setUsage: Dispatch<SetStateAction<UsageSnapshot>>;
  setHeartbeatAt: Dispatch<SetStateAction<string>>;
  setActiveSessionId: Dispatch<SetStateAction<string>>;
  setModelOptions: Dispatch<SetStateAction<ModelOption[]>>;
  setModelError: Dispatch<SetStateAction<string>>;
  setMemoryStatus: Dispatch<SetStateAction<MemoryStatusSnapshot | null>>;
  setMemoryActivity: Dispatch<SetStateAction<MemoryWriteEvent[]>>;
  setAvailableSkills: Dispatch<SetStateAction<RuntimeSkill[]>>;
  setAvailableMcps: Dispatch<SetStateAction<RuntimeMcp[]>>;
  setAgentConfigHash: Dispatch<SetStateAction<string>>;
  setOpencodeDirectory: Dispatch<SetStateAction<string>>;
  setOpencodeConfigFilePath: Dispatch<SetStateAction<string>>;
  setOpencodePersistenceMode: Dispatch<SetStateAction<string>>;
  setMcpServers: Dispatch<SetStateAction<ConfiguredMcpServer[]>>;
  setRunWaitTimeoutMs: Dispatch<SetStateAction<number>>;
  setChildSessionHideAfterDays: Dispatch<SetStateAction<number>>;
  setRuntimeDefaultModel: Dispatch<SetStateAction<string>>;
  setRuntimeFallbackModels: Dispatch<SetStateAction<string[]>>;
  setRuntimeImageModel: Dispatch<SetStateAction<string>>;
  setConfigHash: Dispatch<SetStateAction<string>>;
  setSkillCatalogError: Dispatch<SetStateAction<string>>;
  setMcpCatalogError: Dispatch<SetStateAction<string>>;
  setAgentCatalogError: Dispatch<SetStateAction<string>>;
  setBackgroundRunsBySession: Dispatch<SetStateAction<Record<string, BackgroundRunSnapshot[]>>>;
  setMemoryError: Dispatch<SetStateAction<string>>;
  setStreamStatus: Dispatch<SetStateAction<StreamStatus>>;
  setMessagesBySession: Dispatch<SetStateAction<Record<string, LocalChatMessage[]>>>;
  setRunStatusBySession: Dispatch<SetStateAction<Record<string, SessionRunStatusSnapshot>>>;
  setRunErrorsBySession: Dispatch<SetStateAction<Record<string, string>>>;
  setCompactedAtBySession: Dispatch<SetStateAction<Record<string, string>>>;
  setBackgroundSteerDraftByRun: Dispatch<SetStateAction<Record<string, string>>>;
  setBackgroundActionBusyByRun: Dispatch<SetStateAction<Record<string, "steer" | "abort">>>;
  setFocusedBackgroundRunId: Dispatch<SetStateAction<string>>;
}

function shouldClearActiveOptimisticRequest(input: {
  messages: LocalChatMessage[];
  requestId: string;
  message: ChatMessage;
}): boolean {
  const pending = input.messages.find(message => {
    if (message.uiMeta?.type !== "assistant-pending") return false;
    return message.uiMeta.requestId === input.requestId && message.uiMeta.status === "pending";
  });
  if (!pending || pending.uiMeta?.type !== "assistant-pending") return false;

  const runtimeMessageId = pending.uiMeta.runtimeMessageId?.trim();
  if (runtimeMessageId && runtimeMessageId === input.message.id) return true;
  return Array.isArray(input.message.parts) && input.message.parts.length > 0;
}

function stalledOptimisticRequestIdToClear(input: {
  messages: LocalChatMessage[];
  message: ChatMessage;
}): string | null {
  if (input.message.role !== "assistant") return null;
  const hasVisiblePayload = Boolean(input.message.content.trim()) || Boolean(input.message.parts?.length);
  if (!hasVisiblePayload) return null;

  const byRuntimeMessageId = input.messages.find(message => {
    if (message.uiMeta?.type !== "assistant-pending") return false;
    if (!(message.uiMeta.status === "detached" || message.uiMeta.status === "queued")) return false;
    return message.uiMeta.runtimeMessageId === input.message.id;
  });
  if (byRuntimeMessageId?.uiMeta?.type === "assistant-pending") {
    return byRuntimeMessageId.uiMeta.requestId;
  }

  const assistantIndex = input.messages.findIndex(message => message.id === input.message.id);
  if (assistantIndex <= 0) return null;

  let precedingPersistedUser: LocalChatMessage | null = null;
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const candidate = input.messages[index];
    if (!candidate || candidate.role !== "user") continue;
    if (candidate.uiMeta?.type === "optimistic-user") continue;
    precedingPersistedUser = candidate;
    break;
  }
  if (!precedingPersistedUser) return null;

  const normalizedUserContent = precedingPersistedUser.content.trim();
  if (!normalizedUserContent) return null;

  const stalled = input.messages.find(message => {
    if (message.uiMeta?.type !== "assistant-pending") return false;
    if (!(message.uiMeta.status === "detached" || message.uiMeta.status === "queued")) return false;
    return message.uiMeta.retryContent.trim() === normalizedUserContent;
  });
  if (!stalled || stalled.uiMeta?.type !== "assistant-pending") return null;
  return stalled.uiMeta.requestId;
}

function isTimeoutLikeMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes("timed out") || normalized.includes("timeout") || normalized.includes("operation timed out");
}

export function useDashboardBootstrap(input: UseDashboardBootstrapInput) {
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => {
    const input = inputRef.current;
    let alive = true;
    const bootstrap = async () => {
      const response = await fetch("/api/dashboard/bootstrap");
      const payload = (await response.json()) as DashboardBootstrap;
      if (!alive) return;

      input.setSessions(sortSessionsByActivity(payload.sessions));
      input.setSkillsDraft(payload.skills.join("\n"));
      input.setMcpsDraft(payload.mcps.join("\n"));
      input.setAgentTypes(payload.agents.map(fromLegacyAgent));
      input.setUsage(payload.usage);
      input.setHeartbeatAt(payload.heartbeat.at);
      input.setActiveSessionId(payload.sessions[0]?.id ?? "");
      input.setLoading(false);

      input.setLoadingModels(true);
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

        input.setModelOptions(modelsPayload.models ?? []);
        input.setModelError(modelsResponse.ok ? "" : (modelsPayload.error ?? "Failed to load OpenCode models"));
        input.setMemoryStatus(memoryStatusPayload.status ?? null);
        input.setMemoryActivity(memoryActivityPayload.events ?? []);
        input.setAvailableSkills(Array.isArray(skillsCatalogPayload.skills) ? skillsCatalogPayload.skills : []);
        input.setAvailableMcps(Array.isArray(mcpsCatalogPayload.mcps) ? mcpsCatalogPayload.mcps : []);
        if (Array.isArray(opencodeAgentsPayload.agentTypes)) {
          const normalized = opencodeAgentsPayload.agentTypes.map(normalizeAgentTypeDraft);
          input.setAgentTypes(normalized);
          input.setAgentTypesBaseline(normalized);
          input.setAgentConfigHash(typeof opencodeAgentsPayload.hash === "string" ? opencodeAgentsPayload.hash : "");
        } else if (Array.isArray(configPayload.config?.ui?.agentTypes)) {
          const fallback = configPayload.config.ui.agentTypes.map(normalizeAgentTypeDraft);
          input.setAgentTypes(fallback);
          input.setAgentTypesBaseline(fallback);
          input.setAgentConfigHash("");
        }
        input.setOpencodeDirectory(
          (typeof opencodeAgentsPayload.storage?.directory === "string" && opencodeAgentsPayload.storage.directory) ||
            (typeof runtimeInfoPayload.opencode?.directory === "string" ? runtimeInfoPayload.opencode.directory : ""),
        );
        input.setOpencodeConfigFilePath(
          (typeof opencodeAgentsPayload.storage?.configFilePath === "string" && opencodeAgentsPayload.storage.configFilePath) ||
            (typeof runtimeInfoPayload.opencode?.effectiveConfigPath === "string"
              ? runtimeInfoPayload.opencode.effectiveConfigPath
              : ""),
        );
        input.setOpencodePersistenceMode(
          (typeof opencodeAgentsPayload.storage?.persistenceMode === "string" && opencodeAgentsPayload.storage.persistenceMode) ||
            (typeof runtimeInfoPayload.opencode?.persistenceMode === "string"
              ? runtimeInfoPayload.opencode.persistenceMode
              : ""),
        );
        input.setMcpServers(Array.isArray(mcpsCatalogPayload.servers) ? mcpsCatalogPayload.servers : []);
        if (Array.isArray(skillsCatalogPayload.enabled)) {
          input.setSkillsDraft(skillsCatalogPayload.enabled.join("\n"));
        }
        if (Array.isArray(mcpsCatalogPayload.enabled)) {
          input.setMcpsDraft(mcpsCatalogPayload.enabled.join("\n"));
        }
        input.setRunWaitTimeoutMs(
          typeof configPayload.config?.runtime?.opencode?.runWaitTimeoutMs === "number"
            ? configPayload.config.runtime.opencode.runWaitTimeoutMs
            : DEFAULT_RUN_WAIT_TIMEOUT_MS,
        );
        input.setChildSessionHideAfterDays(
          normalizeChildSessionHideAfterDays(configPayload.config?.runtime?.opencode?.childSessionHideAfterDays),
        );
        const providerId = configPayload.config?.runtime?.opencode?.providerId?.trim() ?? "";
        const modelId = configPayload.config?.runtime?.opencode?.modelId?.trim() ?? "";
        input.setRuntimeDefaultModel(providerId && modelId ? `${providerId}/${modelId}` : "");
        input.setRuntimeFallbackModels(
          Array.isArray(configPayload.config?.runtime?.opencode?.fallbackModels)
            ? configPayload.config.runtime.opencode.fallbackModels
            : [],
        );
        input.setRuntimeImageModel(
          typeof configPayload.config?.runtime?.opencode?.imageModel === "string"
            ? configPayload.config.runtime.opencode.imageModel
            : "",
        );
        input.setConfigHash(typeof configPayload.hash === "string" ? configPayload.hash : "");
        input.setSkillCatalogError(skillsCatalogResponse.ok ? "" : (skillsCatalogPayload.error ?? "Failed to load runtime skills"));
        input.setMcpCatalogError(mcpsCatalogResponse.ok ? "" : (mcpsCatalogPayload.error ?? "Failed to load runtime MCP servers"));
        input.setAgentCatalogError(opencodeAgentsResponse.ok ? "" : (opencodeAgentsPayload.error ?? "Failed to load OpenCode agent definitions"));
        if (backgroundInFlightResponse.ok && Array.isArray(backgroundInFlightPayload.runs)) {
          input.setBackgroundRunsBySession(current => mergeBackgroundRunsBySession(current, backgroundInFlightPayload.runs ?? []));
        }
        const failedMemoryMessage =
          (!memoryStatusResponse.ok && (memoryStatusPayload.error ?? "Failed to load memory status")) ||
          (!memoryActivityResponse.ok && (memoryActivityPayload.error ?? "Failed to load memory activity")) ||
          "";
        input.setMemoryError(failedMemoryMessage);
      } catch (error) {
        if (!alive) return;
        input.setModelError(error instanceof Error ? error.message : "Failed to load OpenCode models");
        input.setMemoryError(error instanceof Error ? error.message : "Failed to load memory data");
      } finally {
        if (alive) {
          input.setLoadingModels(false);
        }
      }
    };

    bootstrap().catch(error => {
      console.error("Failed to load dashboard bootstrap", error);
      input.setLoading(false);
    });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    const events = new EventSource("/api/events");
    input.setStreamStatus("connecting");

    events.onopen = () => {
      input.setStreamStatus("connected");
    };
    events.onerror = () => {
      input.setStreamStatus("reconnecting");
    };

    events.addEventListener("heartbeat", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { at: string };
      input.setHeartbeatAt(payload.at);
    });

    events.addEventListener("usage", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as UsageSnapshot;
      input.setUsage(payload);
    });

    events.addEventListener("session-updated", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as SessionSummary;
      input.setSessions(current => upsertSessionList(current, payload));
    });

    events.addEventListener("session-message", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        sessionId: string;
        message: ChatMessage;
      };
      input.loadedSessionsRef.current.add(payload.sessionId);
      input.setMessagesBySession(current => {
        const merged = mergeMessages(current[payload.sessionId] ?? [], [payload.message]);
        let nextMessages = merged;
        let requestIdToClear: string | null = null;

        if (payload.message.role === "assistant" && input.activeSendRef.current?.sessionId === payload.sessionId) {
          const requestId = input.activeSendRef.current.requestId;
          if (shouldClearActiveOptimisticRequest({ messages: merged, requestId, message: payload.message })) {
            requestIdToClear = requestId;
          }
        }

        if (!requestIdToClear) {
          requestIdToClear = stalledOptimisticRequestIdToClear({
            messages: merged,
            message: payload.message,
          });
        }
        if (requestIdToClear) {
          nextMessages = merged.filter(message => message.uiMeta?.requestId !== requestIdToClear);
        }

        return {
          ...current,
          [payload.sessionId]: nextMessages,
        };
      });
      input.setRunStatusBySession(current => ({
        ...current,
        [payload.sessionId]: {
          sessionId: payload.sessionId,
          status: "idle",
        },
      }));
      input.setRunErrorsBySession(current => {
        if (!current[payload.sessionId]) return current;
        const next = { ...current };
        delete next[payload.sessionId];
        return next;
      });
    });

    events.addEventListener("session-message-part", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        sessionId?: string;
        messageId?: string;
        part?: ChatMessagePart;
        observedAt?: string;
      };
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
      const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
      if (!sessionId || !messageId || !payload.part) return;
      const observedAt = typeof payload.observedAt === "string" ? payload.observedAt : new Date().toISOString();
      const partWithObservedAt = { ...payload.part, observedAt } as ChatMessagePart;

      input.loadedSessionsRef.current.add(sessionId);
      input.setMessagesBySession(current => {
        const existing = current[sessionId] ?? [];
        if (!existing.length) return current;

        let updated = false;
        let nextMessages = existing.map(message => {
          if (message.id === messageId) {
            updated = true;
            return {
              ...message,
              parts: upsertChatMessagePart(message.parts, partWithObservedAt),
            };
          }
          if (message.uiMeta?.type === "assistant-pending" && message.uiMeta.runtimeMessageId === messageId) {
            updated = true;
            return {
              ...message,
              parts: upsertChatMessagePart(message.parts, partWithObservedAt),
            };
          }
          return message;
        });

        if (!updated && input.activeSendRef.current?.sessionId === sessionId) {
          const requestId = input.activeSendRef.current.requestId;
          let pendingUpdated = false;
          nextMessages = nextMessages.map(message => {
            if (message.uiMeta?.type !== "assistant-pending") return message;
            if (message.uiMeta.requestId !== requestId || message.uiMeta.status !== "pending") {
              return message;
            }
            pendingUpdated = true;
            return {
              ...message,
              parts: upsertChatMessagePart(message.parts, partWithObservedAt),
              uiMeta: {
                ...message.uiMeta,
                runtimeMessageId: messageId,
              },
            };
          });
          updated = pendingUpdated;
        }

        if (!updated) {
          const stalledCandidates = nextMessages.filter(message => {
            if (message.uiMeta?.type !== "assistant-pending") return false;
            if (!(message.uiMeta.status === "queued" || message.uiMeta.status === "detached")) return false;
            return !message.uiMeta.runtimeMessageId;
          });

          if (stalledCandidates.length === 1) {
            const requestId = stalledCandidates[0]?.uiMeta?.requestId;
            if (requestId) {
              let stalledUpdated = false;
              nextMessages = nextMessages.map(message => {
                if (message.uiMeta?.type !== "assistant-pending") return message;
                if (message.uiMeta.requestId !== requestId) return message;
                stalledUpdated = true;
                return {
                  ...message,
                  parts: upsertChatMessagePart(message.parts, partWithObservedAt),
                  uiMeta: {
                    ...message.uiMeta,
                    runtimeMessageId: messageId,
                  },
                };
              });
              updated = stalledUpdated;
            }
          }
        }

        if (!updated) return current;
        return {
          ...current,
          [sessionId]: nextMessages,
        };
      });
    });

    events.addEventListener("session-status", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as SessionRunStatusSnapshot;
      input.setRunStatusBySession(current => ({
        ...current,
        [payload.sessionId]: payload,
      }));
      if (payload.status === "idle") {
        input.setRunErrorsBySession(current => {
          if (!current[payload.sessionId]) return current;
          const next = { ...current };
          delete next[payload.sessionId];
          return next;
        });
      }
    });

    events.addEventListener("session-compacted", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as SessionCompactedSnapshot;
      input.setCompactedAtBySession(current => ({
        ...current,
        [payload.sessionId]: new Date().toISOString(),
      }));
    });

    events.addEventListener("session-error", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as SessionRunErrorSnapshot;
      if (!payload.sessionId) return;
      const sessionId = payload.sessionId;
      const activeSend = input.activeSendRef.current;
      const hasInFlightChildRun =
        (input.backgroundRunsBySessionRef.current[sessionId] ?? []).filter(run =>
          IN_FLIGHT_BACKGROUND_STATUSES.has(run.status),
        ).length > 0;
      const shouldSuppressFailure =
        activeSend?.sessionId === sessionId &&
        hasInFlightChildRun &&
        isTimeoutLikeMessage(payload.message);
      if (shouldSuppressFailure) {
        input.setRunErrorsBySession(current => {
          if (!current[sessionId]) return current;
          const next = { ...current };
          delete next[sessionId];
          return next;
        });
        input.setRunStatusBySession(current => ({
          ...current,
          [sessionId]: {
            sessionId,
            status: "busy",
          },
        }));
        const requestId = activeSend.requestId;
        input.setMessagesBySession(current => ({
          ...current,
          [sessionId]: (current[sessionId] ?? []).map(message => {
            if (message.uiMeta?.type !== "assistant-pending" || message.uiMeta.requestId !== requestId) {
              return message;
            }
            if (message.uiMeta.status !== "pending") {
              return message;
            }
            return {
              ...message,
              uiMeta: {
                ...message.uiMeta,
                status: "detached",
                errorMessage: "Still running in background. Results will appear here when the run finishes.",
              },
            };
          }),
        }));
        return;
      }
      input.setRunErrorsBySession(current => ({
        ...current,
        [sessionId]: payload.message,
      }));
      input.setRunStatusBySession(current => ({
        ...current,
        [sessionId]: {
          sessionId,
          status: "idle",
        },
      }));
      if (input.activeSendRef.current?.sessionId === sessionId) {
        const requestId = input.activeSendRef.current.requestId;
        input.setMessagesBySession(current => ({
          ...current,
          [sessionId]: (current[sessionId] ?? []).map(message => {
            if (message.uiMeta?.type !== "assistant-pending" || message.uiMeta.requestId !== requestId) {
              return message;
            }
            if (message.uiMeta.status !== "pending") {
              return message;
            }
            return {
              ...message,
              uiMeta: {
                ...message.uiMeta,
                status: "failed",
                errorMessage: payload.message,
              },
            };
          }),
        }));
      }
    });

    events.addEventListener("background-run", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as BackgroundRunSnapshot;
      input.loadedBackgroundSessionsRef.current.add(payload.parentSessionId);
      input.setBackgroundRunsBySession(current => mergeBackgroundRunsBySession(current, [payload]));
      if (payload.status === "completed" || payload.status === "failed" || payload.status === "aborted") {
        input.setBackgroundSteerDraftByRun(current => {
          if (!current[payload.runId]) return current;
          const next = { ...current };
          delete next[payload.runId];
          return next;
        });
        input.setBackgroundActionBusyByRun(current => {
          if (!current[payload.runId]) return current;
          const next = { ...current };
          delete next[payload.runId];
          return next;
        });
        input.setFocusedBackgroundRunId(current => (current === payload.runId ? "" : current));
      }
    });

    events.addEventListener("config-updated", () => {
      void (async () => {
        try {
          const response = await fetch("/api/config");
          if (!response.ok) return;
          const payload = (await response.json()) as ConfigSnapshotResponse;
          input.setRunWaitTimeoutMs(
            typeof payload.config?.runtime?.opencode?.runWaitTimeoutMs === "number"
              ? payload.config.runtime.opencode.runWaitTimeoutMs
              : DEFAULT_RUN_WAIT_TIMEOUT_MS,
          );
          input.setChildSessionHideAfterDays(
            normalizeChildSessionHideAfterDays(payload.config?.runtime?.opencode?.childSessionHideAfterDays),
          );
          input.setRuntimeFallbackModels(
            Array.isArray(payload.config?.runtime?.opencode?.fallbackModels)
              ? payload.config.runtime.opencode.fallbackModels
              : [],
          );
          input.setRuntimeImageModel(
            typeof payload.config?.runtime?.opencode?.imageModel === "string"
              ? payload.config.runtime.opencode.imageModel
              : "",
          );
          input.setConfigHash(typeof payload.hash === "string" ? payload.hash : "");
        } catch {
          return;
        }
      })();
    });

    return () => {
      events.close();
    };
  }, []);
}
