import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { mergeMessages } from "@/frontend/app/chatHelpers";
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

interface UseDashboardBootstrapInput {
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
      input.setMessagesBySession(current => ({
        ...current,
        [payload.sessionId]: mergeMessages(current[payload.sessionId] ?? [], [payload.message]),
      }));
      if (payload.message.role === "assistant" && input.activeSendRef.current?.sessionId === payload.sessionId) {
        const requestId = input.activeSendRef.current.requestId;
        input.setMessagesBySession(current => ({
          ...current,
          [payload.sessionId]: (current[payload.sessionId] ?? []).filter(message => message.uiMeta?.requestId !== requestId),
        }));
      }
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
