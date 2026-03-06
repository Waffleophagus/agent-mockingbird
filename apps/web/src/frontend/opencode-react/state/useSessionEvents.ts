import type {
  BackgroundRunSnapshot,
  ChatMessage,
  ChatMessagePart,
  MemoryStatusSnapshot,
  MemoryWriteEvent,
  PermissionPromptRequest,
  QuestionPromptRequest,
  SessionCompactedSnapshot,
  SessionRunErrorSnapshot,
  SessionRunStatusSnapshot,
  SessionSummary,
  UsageSnapshot,
} from "@agent-mockingbird/contracts/dashboard";
import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { mergeMessages, upsertChatMessagePart } from "@/frontend/app/chatHelpers";
import type { ActiveSend, LocalChatMessage } from "@/frontend/app/chatHelpers";
import type { ConfigSnapshotResponse } from "@/frontend/app/dashboardTypes";
import {
  DEFAULT_RUN_WAIT_TIMEOUT_MS,
  mergeBackgroundRunsBySession,
  normalizeChildSessionHideAfterDays,
  upsertSessionList,
} from "@/frontend/app/dashboardUtils";

const IN_FLIGHT_BACKGROUND_STATUSES = new Set<BackgroundRunSnapshot["status"]>([
  "created",
  "running",
  "retrying",
  "idle",
]);

interface UseSessionEventsInput {
  backgroundRunsBySessionRef: MutableRefObject<Record<string, BackgroundRunSnapshot[]>>;
  loadedSessionsRef: MutableRefObject<Set<string>>;
  loadedBackgroundSessionsRef: MutableRefObject<Set<string>>;
  activeSendRef: MutableRefObject<ActiveSend | null>;
  setHeartbeatAt: Dispatch<SetStateAction<string>>;
  setUsage: Dispatch<SetStateAction<UsageSnapshot>>;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  setMessagesBySession: Dispatch<SetStateAction<Record<string, LocalChatMessage[]>>>;
  setRunStatusBySession: Dispatch<SetStateAction<Record<string, SessionRunStatusSnapshot>>>;
  setRunErrorsBySession: Dispatch<SetStateAction<Record<string, string>>>;
  setCompactedAtBySession: Dispatch<SetStateAction<Record<string, string>>>;
  setBackgroundRunsBySession: Dispatch<SetStateAction<Record<string, BackgroundRunSnapshot[]>>>;
  setBackgroundSteerDraftByRun: Dispatch<SetStateAction<Record<string, string>>>;
  setBackgroundActionBusyByRun: Dispatch<SetStateAction<Record<string, "steer" | "abort">>>;
  setFocusedBackgroundRunId: Dispatch<SetStateAction<string>>;
  setPendingPermissionsBySession: Dispatch<SetStateAction<Record<string, PermissionPromptRequest[]>>>;
  setPendingQuestionsBySession: Dispatch<SetStateAction<Record<string, QuestionPromptRequest[]>>>;
  setRunWaitTimeoutMs: Dispatch<SetStateAction<number>>;
  setChildSessionHideAfterDays: Dispatch<SetStateAction<number>>;
  setRuntimeDefaultModel: Dispatch<SetStateAction<string>>;
  setStreamStatus: Dispatch<SetStateAction<"connecting" | "connected" | "reconnecting">>;
  setMemoryStatus: Dispatch<SetStateAction<MemoryStatusSnapshot | null>>;
  setMemoryActivity: Dispatch<SetStateAction<MemoryWriteEvent[]>>;
  setMemoryError: Dispatch<SetStateAction<string>>;
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

  const normalizedUserContent = normalizeComparableMessageText(precedingPersistedUser.content);
  if (!normalizedUserContent) return null;

  const stalledCandidates = input.messages.filter(message => {
    if (message.uiMeta?.type !== "assistant-pending") return false;
    if (!(message.uiMeta.status === "detached" || message.uiMeta.status === "queued")) return false;
    return normalizeComparableMessageText(message.uiMeta.retryContent) === normalizedUserContent;
  });
  if (stalledCandidates.length !== 1) return null;
  const stalled = stalledCandidates[0];
  if (!stalled || stalled.uiMeta?.type !== "assistant-pending") return null;
  return stalled.uiMeta.requestId;
}

function normalizeComparableMessageText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function applyTextDelta(input: { currentContent: string; text: string; mode: "append" | "replace" }): string {
  return input.mode === "replace" ? input.text : `${input.currentContent}${input.text}`;
}

function isTimeoutLikeMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes("timed out") || normalized.includes("timeout") || normalized.includes("operation timed out");
}

export function useSessionEvents(input: UseSessionEventsInput) {
  const inputRef = useRef(input);

  useEffect(() => {
    inputRef.current = input;
  }, [input]);

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
          requestIdToClear = stalledOptimisticRequestIdToClear({ messages: merged, message: payload.message });
        }
        if (requestIdToClear) {
          nextMessages = merged.filter(message => message.uiMeta?.requestId !== requestIdToClear);
        }

        return {
          ...current,
          [payload.sessionId]: nextMessages,
        };
      });
      if (payload.message.role === "assistant") {
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
      }
    });

    events.addEventListener("session-message-delta", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        sessionId?: string;
        messageId?: string;
        text?: string;
        mode?: "append" | "replace";
      };
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
      const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
      const text = typeof payload.text === "string" ? payload.text : "";
      const mode = payload.mode === "replace" ? "replace" : "append";
      if (!sessionId || !messageId || !text) return;

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
              content: applyTextDelta({ currentContent: message.content, text, mode }),
            };
          }
          if (message.uiMeta?.type === "assistant-pending" && message.uiMeta.runtimeMessageId === messageId) {
            updated = true;
            return {
              ...message,
              content: applyTextDelta({ currentContent: message.content, text, mode }),
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
              content: applyTextDelta({ currentContent: message.content, text, mode }),
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
                  content: applyTextDelta({ currentContent: message.content, text, mode }),
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
        (input.backgroundRunsBySessionRef.current[sessionId] ?? []).filter(run => IN_FLIGHT_BACKGROUND_STATUSES.has(run.status)).length > 0;
      const shouldSuppressFailure = activeSend?.sessionId === sessionId && hasInFlightChildRun && isTimeoutLikeMessage(payload.message);
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

    events.addEventListener("permission-requested", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as PermissionPromptRequest;
      if (!payload?.id || !payload?.sessionId) return;
      input.setPendingPermissionsBySession(current => {
        const existing = current[payload.sessionId] ?? [];
        const index = existing.findIndex(item => item.id === payload.id);
        const nextList =
          index === -1
            ? [...existing, payload].sort((left, right) => left.id.localeCompare(right.id))
            : existing.map(item => (item.id === payload.id ? payload : item));
        return {
          ...current,
          [payload.sessionId]: nextList,
        };
      });
    });

    events.addEventListener("permission-resolved", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        sessionId?: string;
        requestId?: string;
      };
      if (!payload?.sessionId || !payload?.requestId) return;
      const sessionId = payload.sessionId;
      const requestId = payload.requestId;
      input.setPendingPermissionsBySession(current => {
        const existing = current[sessionId] ?? [];
        if (existing.length === 0) return current;
        const nextList = existing.filter(item => item.id !== requestId);
        if (nextList.length === existing.length) return current;
        return {
          ...current,
          [sessionId]: nextList,
        };
      });
    });

    events.addEventListener("question-requested", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as QuestionPromptRequest;
      if (!payload?.id || !payload?.sessionId) return;
      input.setPendingQuestionsBySession(current => {
        const existing = current[payload.sessionId] ?? [];
        const index = existing.findIndex(item => item.id === payload.id);
        const nextList =
          index === -1
            ? [...existing, payload].sort((left, right) => left.id.localeCompare(right.id))
            : existing.map(item => (item.id === payload.id ? payload : item));
        return {
          ...current,
          [payload.sessionId]: nextList,
        };
      });
    });

    events.addEventListener("question-resolved", event => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        sessionId?: string;
        requestId?: string;
      };
      if (!payload?.sessionId || !payload?.requestId) return;
      const sessionId = payload.sessionId;
      const requestId = payload.requestId;
      input.setPendingQuestionsBySession(current => {
        const existing = current[sessionId] ?? [];
        if (existing.length === 0) return current;
        const nextList = existing.filter(item => item.id !== requestId);
        if (nextList.length === existing.length) return current;
        return {
          ...current,
          [sessionId]: nextList,
        };
      });
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
          const [configResponse, memoryStatusResponse, memoryActivityResponse] = await Promise.all([
            fetch("/api/config"),
            fetch("/api/memory/status"),
            fetch("/api/memory/activity?limit=12"),
          ]);
          if (!configResponse.ok) return;
          const payload = (await configResponse.json()) as ConfigSnapshotResponse;
          input.setRunWaitTimeoutMs(
            typeof payload.config?.runtime?.opencode?.runWaitTimeoutMs === "number"
              ? payload.config.runtime.opencode.runWaitTimeoutMs
              : DEFAULT_RUN_WAIT_TIMEOUT_MS,
          );
          input.setChildSessionHideAfterDays(
            normalizeChildSessionHideAfterDays(payload.config?.runtime?.opencode?.childSessionHideAfterDays),
          );
          const providerId = payload.config?.runtime?.opencode?.providerId?.trim() ?? "";
          const modelId = payload.config?.runtime?.opencode?.modelId?.trim() ?? "";
          input.setRuntimeDefaultModel(providerId && modelId ? `${providerId}/${modelId}` : "");

          const memoryStatusPayload = (await memoryStatusResponse.json()) as { status?: MemoryStatusSnapshot; error?: string };
          const memoryActivityPayload = (await memoryActivityResponse.json()) as { events?: MemoryWriteEvent[]; error?: string };
          input.setMemoryStatus(memoryStatusPayload.status ?? null);
          input.setMemoryActivity(Array.isArray(memoryActivityPayload.events) ? memoryActivityPayload.events : []);
          const memoryMessage =
            (!memoryStatusResponse.ok && (memoryStatusPayload.error ?? "Failed to load memory status")) ||
            (!memoryActivityResponse.ok && (memoryActivityPayload.error ?? "Failed to load memory activity")) ||
            "";
          input.setMemoryError(memoryMessage);
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
