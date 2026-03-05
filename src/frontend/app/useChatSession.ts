import { useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";

import { mergeMessages, normalizeRequestError } from "@/frontend/app/chatHelpers";
import type { ActiveSend, LocalChatMessage, LocalInputPart } from "@/frontend/app/chatHelpers";
import { extractRunErrorMessage, RUN_POLL_INTERVAL_MS, upsertSessionList } from "@/frontend/app/dashboardUtils";
import type {
  ChatMessage,
  SessionRunStatusSnapshot,
  SessionSummary,
} from "@/types/dashboard";

interface AgentRunSnapshot {
  id: string;
  sessionId: string;
  state: "queued" | "running" | "completed" | "failed";
  result?: unknown;
  error?: unknown;
}

interface AgentRunCompletedPayload {
  queued?: boolean;
  detached?: boolean;
  queueDepth?: number;
}

export interface ComposerAttachment {
  id: string;
  mime: string;
  filename?: string;
  url: string;
  size: number;
}

interface UseChatSessionInput {
  activeSession: SessionSummary | undefined;
  draftMessage: string;
  draftAttachments: ComposerAttachment[];
  runWaitTimeoutMs: number;
  composerFormRef: RefObject<HTMLFormElement | null>;
  messagesBySession: Record<string, LocalChatMessage[]>;
  loadedSessionsRef: MutableRefObject<Set<string>>;
  activeSendRef: MutableRefObject<ActiveSend | null>;
  activeAbortControllerRef: MutableRefObject<AbortController | null>;
  abortedRequestIdsRef: MutableRefObject<Set<string>>;
  setDraftMessage: Dispatch<SetStateAction<string>>;
  setDraftAttachments: Dispatch<SetStateAction<ComposerAttachment[]>>;
  setMessagesBySession: Dispatch<SetStateAction<Record<string, LocalChatMessage[]>>>;
  setRunErrorsBySession: Dispatch<SetStateAction<Record<string, string>>>;
  setRunStatusBySession: Dispatch<SetStateAction<Record<string, SessionRunStatusSnapshot>>>;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  setCompactedAtBySession: Dispatch<SetStateAction<Record<string, string>>>;
  setActiveSend: Dispatch<SetStateAction<ActiveSend | null>>;
}

export function useChatSession(input: UseChatSessionInput) {
  const [isAborting, setIsAborting] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [chatControlError, setChatControlError] = useState("");
  const RUN_WAIT_TIMEOUT_MESSAGE = "Run timed out waiting for completion.";

  function appendOptimisticRequest(sessionId: string, content: string, requestId: string, parts?: LocalInputPart[]) {
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
      parts: [],
      uiMeta: {
        type: "assistant-pending",
        requestId,
        status: "pending",
        retryContent: content,
        retryParts: parts,
      },
    };

    input.loadedSessionsRef.current.add(sessionId);
    input.setMessagesBySession(current => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), optimisticUserMessage, pendingAssistantMessage],
    }));
  }

  function removeOptimisticRequest(sessionId: string, requestId: string) {
    input.setMessagesBySession(current => ({
      ...current,
      [sessionId]: (current[sessionId] ?? []).filter(message => message.uiMeta?.requestId !== requestId),
    }));
  }

  function markRequestPending(sessionId: string, requestId: string) {
    input.setMessagesBySession(current => ({
      ...current,
      [sessionId]: (current[sessionId] ?? []).map(message => {
        if (message.uiMeta?.type !== "assistant-pending" || message.uiMeta.requestId !== requestId) {
          return message;
        }
        return {
          ...message,
          content: "",
          parts: [],
          uiMeta: {
            ...message.uiMeta,
            status: "pending",
            errorMessage: undefined,
            runtimeMessageId: undefined,
          },
        };
      }),
    }));
  }

  function markRequestFailed(sessionId: string, requestId: string, errorMessage: string) {
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
            errorMessage,
          },
        };
      }),
    }));
    input.setRunErrorsBySession(current => ({
      ...current,
      [sessionId]: errorMessage,
    }));
    input.setRunStatusBySession(current => ({
      ...current,
      [sessionId]: {
        sessionId,
        status: "idle",
      },
    }));
  }

  function markRequestDetached(sessionId: string, requestId: string, message: string) {
    input.setMessagesBySession(current => ({
      ...current,
      [sessionId]: (current[sessionId] ?? []).map(entry => {
        if (entry.uiMeta?.type !== "assistant-pending" || entry.uiMeta.requestId !== requestId) {
          return entry;
        }
        return {
          ...entry,
          uiMeta: {
            ...entry.uiMeta,
            status: "detached",
            errorMessage: message,
          },
        };
      }),
    }));
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
  }

  function markRequestQueued(sessionId: string, requestId: string, message: string) {
    input.setMessagesBySession(current => ({
      ...current,
      [sessionId]: (current[sessionId] ?? []).map(entry => {
        if (entry.uiMeta?.type !== "assistant-pending" || entry.uiMeta.requestId !== requestId) {
          return entry;
        }
        return {
          ...entry,
          uiMeta: {
            ...entry.uiMeta,
            status: "queued",
            errorMessage: message,
          },
        };
      }),
    }));
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
  }

  function isRunWaitTimeoutError(error: unknown) {
    return error instanceof Error && error.message === RUN_WAIT_TIMEOUT_MESSAGE;
  }

  function resolveRunCompletedOutcome(value: unknown): "completed" | "queued" | "detached" {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "completed";
    const payload = value as AgentRunCompletedPayload;
    if (payload.detached === true) return "detached";
    if (payload.queued === true) return "queued";
    return "completed";
  }

  async function waitForRunTerminalStateByPolling(
    runId: string,
    abortSignal: AbortSignal,
  ): Promise<"completed" | "queued" | "detached"> {
    let lastActivityAt = Date.now();
    while (true) {
      if (abortSignal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      if (Date.now() - lastActivityAt > input.runWaitTimeoutMs) {
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
        return resolveRunCompletedOutcome(run.result);
      }
      if (run.state === "failed") {
        throw new Error(extractRunErrorMessage(run.error));
      }
      if (run.state === "running") {
        lastActivityAt = Date.now();
      }

      await new Promise<void>(resolve => {
        setTimeout(resolve, RUN_POLL_INTERVAL_MS);
      });
    }
  }

  async function waitForRunTerminalState(
    runId: string,
    abortSignal: AbortSignal,
  ): Promise<"completed" | "queued" | "detached"> {
    if (typeof EventSource !== "function") {
      return waitForRunTerminalStateByPolling(runId, abortSignal);
    }

    return await new Promise<"completed" | "queued" | "detached">((resolve, reject) => {
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

      const succeed = (outcome: "completed" | "queued" | "detached") => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(outcome);
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const resetTimeout = () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
          fail(new Error(RUN_WAIT_TIMEOUT_MESSAGE));
        }, input.runWaitTimeoutMs);
      };

      const onAbort = () => {
        fail(new DOMException("Aborted", "AbortError"));
      };

      resetTimeout();

      abortSignal.addEventListener("abort", onAbort, { once: true });
      stream.addEventListener("run-event", event => {
        resetTimeout();
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as {
            type?: string;
            payload?: unknown;
          };
          if (payload.type === "run.completed") {
            succeed(resolveRunCompletedOutcome(payload.payload));
            return;
          }
          if (payload.type === "run.failed") {
            fail(new Error(extractRunErrorMessage(payload.payload)));
          }
        } catch {
          // Ignore malformed stream event payloads and continue listening.
        }
      });
      stream.addEventListener("run-heartbeat", () => {
        resetTimeout();
      });
      stream.onerror = () => {
        if (abortSignal.aborted) {
          onAbort();
        }
      };
    });
  }

  async function submitChatRequest(payloadInput: {
    sessionId: string;
    content: string;
    parts?: LocalInputPart[];
    requestId?: string;
    retry?: boolean;
  }) {
    const requestId = payloadInput.requestId ?? crypto.randomUUID();
    setChatControlError("");
    input.setRunErrorsBySession(current => {
      if (!current[payloadInput.sessionId]) return current;
      const next = { ...current };
      delete next[payloadInput.sessionId];
      return next;
    });

    if (payloadInput.retry) {
      markRequestPending(payloadInput.sessionId, requestId);
    } else {
      appendOptimisticRequest(payloadInput.sessionId, payloadInput.content, requestId, payloadInput.parts);
    }

    const nextActiveSend: ActiveSend = {
      requestId,
      sessionId: payloadInput.sessionId,
      content: payloadInput.content,
      parts: payloadInput.parts,
    };
    const abortController = new AbortController();
    input.activeSendRef.current = nextActiveSend;
    input.activeAbortControllerRef.current = abortController;
    input.setActiveSend(nextActiveSend);
    input.setRunStatusBySession(current => ({
      ...current,
      [payloadInput.sessionId]: {
        sessionId: payloadInput.sessionId,
        status: "busy",
      },
    }));

    let runAccepted = false;
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          sessionId: payloadInput.sessionId,
          content: payloadInput.content,
          parts: payloadInput.parts,
          idempotencyKey: requestId,
        }),
      });
      const runPayload = (await response.json()) as {
        run?: AgentRunSnapshot;
        runId?: string;
        error?: string;
      };
      if (!response.ok || !runPayload.run) {
        throw new Error(runPayload.error ?? `Request failed (${response.status})`);
      }
      runAccepted = true;

      const runId = runPayload.runId ?? runPayload.run.id;
      const outcome = await waitForRunTerminalState(runId, abortController.signal);
      if (outcome === "queued") {
        markRequestQueued(
          payloadInput.sessionId,
          requestId,
          "Queued behind the current run. It will be sent automatically when the session is ready.",
        );
        return;
      }
      if (outcome === "detached") {
        markRequestDetached(
          payloadInput.sessionId,
          requestId,
          "Still running in background. Results will appear here when the run finishes.",
        );
        return;
      }

      const [messagesResponse, sessionsResponse] = await Promise.all([
        fetch(`/api/sessions/${encodeURIComponent(payloadInput.sessionId)}/messages`, {
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

      input.loadedSessionsRef.current.add(payloadInput.sessionId);
      input.setMessagesBySession(current => ({
        ...current,
        [payloadInput.sessionId]: mergeMessages(current[payloadInput.sessionId] ?? [], messagesPayload.messages ?? []),
      }));

      if (sessionsResponse.ok && Array.isArray(sessionsPayload.sessions)) {
        const updatedSession = sessionsPayload.sessions.find(session => session.id === payloadInput.sessionId);
        if (updatedSession) {
          input.setSessions(current => upsertSessionList(current, updatedSession));
        }
      }

      removeOptimisticRequest(payloadInput.sessionId, requestId);
      input.setRunStatusBySession(current => ({
        ...current,
        [payloadInput.sessionId]: {
          sessionId: payloadInput.sessionId,
          status: "idle",
        },
      }));
      input.setRunErrorsBySession(current => {
        if (!current[payloadInput.sessionId]) return current;
        const next = { ...current };
        delete next[payloadInput.sessionId];
        return next;
      });
    } catch (error) {
      if (input.abortedRequestIdsRef.current.has(requestId)) {
        input.abortedRequestIdsRef.current.delete(requestId);
        markRequestFailed(payloadInput.sessionId, requestId, "Request aborted.");
      } else if (runAccepted && isRunWaitTimeoutError(error)) {
        markRequestDetached(
          payloadInput.sessionId,
          requestId,
          "Still running in background. Results will appear here when the run finishes.",
        );
      } else {
        markRequestFailed(payloadInput.sessionId, requestId, normalizeRequestError(error));
      }
    } finally {
      if (input.activeSendRef.current?.requestId === requestId) {
        input.activeSendRef.current = null;
      }
      if (input.activeAbortControllerRef.current === abortController) {
        input.activeAbortControllerRef.current = null;
      }
      input.setActiveSend(current => (current?.requestId === requestId ? null : current));
    }
  }

  function retryFailedRequest(requestId: string) {
    for (const [sessionId, messages] of Object.entries(input.messagesBySession)) {
      const failedMessage = messages.find(message => {
        if (message.uiMeta?.type !== "assistant-pending") return false;
        return message.uiMeta.requestId === requestId && message.uiMeta.status === "failed";
      });
      if (!failedMessage || failedMessage.uiMeta?.type !== "assistant-pending") continue;

      void submitChatRequest({
        sessionId,
        content: failedMessage.uiMeta.retryContent,
        parts: failedMessage.uiMeta.retryParts,
        requestId,
        retry: true,
      });
      return;
    }
  }

  async function abortActiveRun() {
    const currentSend = input.activeSendRef.current;
    if (!currentSend || isAborting) return;

    setIsAborting(true);
    setChatControlError("");
    input.abortedRequestIdsRef.current.add(currentSend.requestId);

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
      input.abortedRequestIdsRef.current.delete(currentSend.requestId);
      setChatControlError(error instanceof Error ? error.message : "Failed to abort session run");
      return;
    } finally {
      setIsAborting(false);
    }

    input.activeAbortControllerRef.current?.abort();
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
      input.setCompactedAtBySession(current => ({
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

    const content = input.draftMessage.trim();
    const attachments = input.draftAttachments;
    if ((!content && attachments.length === 0) || !input.activeSession) return;

    const parts: LocalInputPart[] = [];
    if (content) {
      parts.push({
        type: "text",
        text: content,
      });
    }
    for (const attachment of attachments) {
      parts.push({
        type: "file",
        mime: attachment.mime,
        filename: attachment.filename,
        url: attachment.url,
      });
    }

    const optimisticContent =
      content ||
      `[Sent ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}]`;

    const sessionId = input.activeSession.id;
    input.setDraftMessage("");
    input.setDraftAttachments([]);

    await submitChatRequest({
      sessionId,
      content: optimisticContent,
      parts,
    });
  }

  async function handleComposerPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const clipboardItems = Array.from(event.clipboardData?.items ?? []);
    const imageItems = clipboardItems.filter(item => item.kind === "file" && item.type.startsWith("image/"));
    if (imageItems.length === 0) return;

    event.preventDefault();
    const nextAttachments: ComposerAttachment[] = [];
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      if (file.size > 5 * 1024 * 1024) {
        setChatControlError(`Skipped ${file.name || "pasted image"}: file is larger than 5MB.`);
        continue;
      }
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Failed to read pasted image"));
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.readAsDataURL(file);
      }).catch(() => "");
      if (!url) continue;
      nextAttachments.push({
        id: crypto.randomUUID(),
        mime: file.type || "image/png",
        filename: file.name || undefined,
        size: file.size,
        url,
      });
    }

    if (nextAttachments.length > 0) {
      setChatControlError("");
      input.setDraftAttachments(current => [...current, ...nextAttachments]);
    }
  }

  function removeComposerAttachment(id: string) {
    input.setDraftAttachments(current => current.filter(attachment => attachment.id !== id));
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      input.composerFormRef.current?.requestSubmit();
    }
  }

  return {
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
  };
}
