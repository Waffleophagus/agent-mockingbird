import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { LocalChatMessage } from "@/frontend/app/chatHelpers";
import type { ConfigSnapshotResponse } from "@/frontend/app/dashboardTypes";
import {
  DEFAULT_RUN_WAIT_TIMEOUT_MS,
  mergeBackgroundRunsBySession,
  normalizeChildSessionHideAfterDays,
  sortSessionsByActivity,
} from "@/frontend/app/dashboardUtils";
import type { SessionScreenBootstrapResponse } from "@/frontend/opencode-react/types";
import type {
  BackgroundRunSnapshot,
  HeartbeatSnapshot,
  MemoryStatusSnapshot,
  MemoryWriteEvent,
  ModelOption,
  PermissionPromptRequest,
  QuestionPromptRequest,
  SessionSummary,
  UsageSnapshot,
} from "@wafflebot/contracts/dashboard";

interface UseSessionScreenBootstrapInput {
  loadedSessionsRef: MutableRefObject<Set<string>>;
  loadedBackgroundSessionsRef: MutableRefObject<Set<string>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setLoadingModels: Dispatch<SetStateAction<boolean>>;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  setMessagesBySession: Dispatch<SetStateAction<Record<string, LocalChatMessage[]>>>;
  setUsage: Dispatch<SetStateAction<UsageSnapshot>>;
  setHeartbeatAt: Dispatch<SetStateAction<string>>;
  setActiveSessionId: Dispatch<SetStateAction<string>>;
  setModelOptions: Dispatch<SetStateAction<ModelOption[]>>;
  setModelError: Dispatch<SetStateAction<string>>;
  setMemoryStatus: Dispatch<SetStateAction<MemoryStatusSnapshot | null>>;
  setMemoryActivity: Dispatch<SetStateAction<MemoryWriteEvent[]>>;
  setMemoryError: Dispatch<SetStateAction<string>>;
  setBackgroundRunsBySession: Dispatch<SetStateAction<Record<string, BackgroundRunSnapshot[]>>>;
  setPendingPermissionsBySession: Dispatch<SetStateAction<Record<string, PermissionPromptRequest[]>>>;
  setPendingQuestionsBySession: Dispatch<SetStateAction<Record<string, QuestionPromptRequest[]>>>;
  setRunWaitTimeoutMs: Dispatch<SetStateAction<number>>;
  setChildSessionHideAfterDays: Dispatch<SetStateAction<number>>;
  setRuntimeDefaultModel: Dispatch<SetStateAction<string>>;
  setStreamStatus: Dispatch<SetStateAction<"connecting" | "connected" | "reconnecting">>;
}

export function useSessionScreenBootstrap(input: UseSessionScreenBootstrapInput) {
  const inputRef = useRef(input);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    const input = inputRef.current;
    let alive = true;

    const bootstrap = async () => {
      input.setLoading(true);
      input.setLoadingModels(true);
      input.setStreamStatus("connecting");

      try {
        const response = await fetch("/api/ui/session-screen/bootstrap");
        const payload = (await response.json()) as SessionScreenBootstrapResponse & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load session bootstrap");
        }
        if (!alive) return;

        const sortedSessions = sortSessionsByActivity(payload.sessions ?? []);
        const activeSessionId = payload.activeSessionId || sortedSessions[0]?.id || "";

        input.setSessions(sortedSessions);
        input.setActiveSessionId(activeSessionId);
        input.setUsage(payload.usage ?? { requestCount: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 });
        input.setHeartbeatAt((payload.heartbeat as HeartbeatSnapshot | undefined)?.at ?? "");
        input.setModelOptions(Array.isArray(payload.models) ? payload.models : []);
        input.setModelError("");
        if (activeSessionId) {
          input.loadedSessionsRef.current.add(activeSessionId);
          input.setMessagesBySession(current => ({
            ...current,
            [activeSessionId]: payload.messages ?? current[activeSessionId] ?? [],
          }));
        }

        if (Array.isArray(payload.backgroundRuns) && payload.backgroundRuns.length > 0) {
          input.setBackgroundRunsBySession(current => mergeBackgroundRunsBySession(current, payload.backgroundRuns));
          for (const run of payload.backgroundRuns) {
            input.loadedBackgroundSessionsRef.current.add(run.parentSessionId);
          }
        }

        input.setPendingPermissionsBySession(() => {
          const grouped: Record<string, PermissionPromptRequest[]> = {};
          for (const item of payload.pendingPermissions ?? []) {
            if (!item?.id || !item?.sessionId) continue;
            if (!grouped[item.sessionId]) grouped[item.sessionId] = [];
            grouped[item.sessionId]?.push(item);
          }
          for (const list of Object.values(grouped)) {
            list.sort((left, right) => left.id.localeCompare(right.id));
          }
          return grouped;
        });

        input.setPendingQuestionsBySession(() => {
          const grouped: Record<string, QuestionPromptRequest[]> = {};
          for (const item of payload.pendingQuestions ?? []) {
            if (!item?.id || !item?.sessionId) continue;
            if (!grouped[item.sessionId]) grouped[item.sessionId] = [];
            grouped[item.sessionId]?.push(item);
          }
          for (const list of Object.values(grouped)) {
            list.sort((left, right) => left.id.localeCompare(right.id));
          }
          return grouped;
        });

        input.setLoading(false);

        const [memoryStatusResponse, memoryActivityResponse, configResponse] = await Promise.all([
          fetch("/api/memory/status"),
          fetch("/api/memory/activity?limit=12"),
          fetch("/api/config"),
        ]);
        if (!alive) return;

        const memoryStatusPayload = (await memoryStatusResponse.json()) as { status?: MemoryStatusSnapshot; error?: string };
        const memoryActivityPayload = (await memoryActivityResponse.json()) as { events?: MemoryWriteEvent[]; error?: string };
        const configPayload = (await configResponse.json()) as ConfigSnapshotResponse;

        input.setMemoryStatus(memoryStatusPayload.status ?? null);
        input.setMemoryActivity(Array.isArray(memoryActivityPayload.events) ? memoryActivityPayload.events : []);

        const failedMemoryMessage =
          (!memoryStatusResponse.ok && (memoryStatusPayload.error ?? "Failed to load memory status")) ||
          (!memoryActivityResponse.ok && (memoryActivityPayload.error ?? "Failed to load memory activity")) ||
          "";
        input.setMemoryError(failedMemoryMessage);

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
      } catch (error) {
        if (!alive) return;
        input.setLoading(false);
        input.setModelError(error instanceof Error ? error.message : "Failed to load session bootstrap");
      } finally {
        if (alive) {
          input.setLoadingModels(false);
        }
      }
    };

    void bootstrap();

    return () => {
      alive = false;
    };
  }, []);
}
