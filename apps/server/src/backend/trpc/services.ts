import type { AppApiServices } from "@agent-mockingbird/api";
import type {
  ChatMessage,
  SessionMessageCursor,
  SessionMessageCheckpoint,
  SessionMessagesDeltaResponse,
  SessionMessagesWindowResponse,
} from "@agent-mockingbird/contracts/dashboard";

import type { RuntimeEngine } from "../contracts/runtime";
import {
  createSession,
  getSessionById,
  listMessageWindowForSession,
  listMessagesForSession,
  listSessions,
} from "../db/repository";
import {
  removeNotificationDevice,
  setNotificationDeviceEnabled,
  upsertNotificationDevice,
} from "../notifications/repository";
import { listOpencodeModelOptions } from "../opencode/models";
import { listPendingPrompts, rejectQuestionPrompt, replyPermissionPrompt, replyQuestionPrompt } from "../prompts/service";
import { createRuntimeSessionBootstrap } from "../ui/bootstrap";

function ensureSession(sessionId: string) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("Unknown session");
  }
  return session;
}

function compareMessageWithRole(
  message: ChatMessage,
  checkpoint: SessionMessageCheckpoint & { role?: ChatMessage["role"] },
) {
  const messageAt = Date.parse(message.at);
  const checkpointAt = Date.parse(checkpoint.lastMessageAt);
  const normalizedMessageAt = Number.isFinite(messageAt) ? messageAt : 0;
  const normalizedCheckpointAt = Number.isFinite(checkpointAt) ? checkpointAt : 0;

  if (normalizedMessageAt !== normalizedCheckpointAt) {
    return normalizedMessageAt - normalizedCheckpointAt;
  }

  if (checkpoint.role && message.role !== checkpoint.role) {
    return message.role === "user" ? -1 : 1;
  }

  return message.id.localeCompare(checkpoint.lastMessageId);
}

function checkpointFromMessages(messages: ChatMessage[]): SessionMessageCheckpoint | null {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return null;
  return {
    lastMessageAt: lastMessage.at,
    lastMessageId: lastMessage.id,
  };
}

function buildSessionMessagesDeltaResponse(
  messages: ChatMessage[],
  checkpoint?: SessionMessageCheckpoint,
): SessionMessagesDeltaResponse {
  const latestCheckpoint = checkpointFromMessages(messages);
  if (!checkpoint) {
    return {
      messages,
      checkpoint: latestCheckpoint,
    };
  }

  const latestMessage = messages[messages.length - 1];
  if (!latestMessage) {
    return {
      messages,
      checkpoint: null,
      requiresReset: true,
    };
  }

  const checkpointMessage = messages.find(message => message.id === checkpoint.lastMessageId);
  const resolvedCheckpoint = checkpointMessage ? { ...checkpoint, role: checkpointMessage.role } : checkpoint;

  if (latestMessage && compareMessageWithRole(latestMessage, resolvedCheckpoint) < 0) {
    return {
      messages,
      checkpoint: latestCheckpoint,
      requiresReset: true,
    };
  }

  return {
    messages: messages.filter(message => compareMessageWithRole(message, resolvedCheckpoint) > 0),
    checkpoint: latestCheckpoint,
  };
}

export function createAppApiServices(runtime: RuntimeEngine, getLatestSeq: () => number): AppApiServices {
  return {
    getSessionBootstrap: input =>
      createRuntimeSessionBootstrap(runtime, getLatestSeq(), input?.sessionId, input?.messageWindowLimit),
    listSessions: async () => listSessions(),
    createSession: async input => createSession(input),
    getSessionMessages: async input => {
      ensureSession(input.sessionId);
      if (runtime.syncSessionMessages) {
        await runtime.syncSessionMessages(input.sessionId).catch(() => undefined);
      }
      return buildSessionMessagesDeltaResponse(listMessagesForSession(input.sessionId), input.checkpoint);
    },
    getSessionHistory: async (input: {
      sessionId: string;
      limit: number;
      before?: SessionMessageCursor;
    }): Promise<SessionMessagesWindowResponse> => {
      ensureSession(input.sessionId);
      if (runtime.syncSessionMessages) {
        await runtime.syncSessionMessages(input.sessionId).catch(() => undefined);
      }
      return listMessageWindowForSession(input.sessionId, input);
    },
    sendChat: async input => {
      ensureSession(input.sessionId);
      const ack = await runtime.sendUserMessage(input);
      const session = ensureSession(ack.sessionId);
      return {
        session,
        messages: ack.messages,
      };
    },
    abortChat: async sessionId => {
      ensureSession(sessionId);
      if (!runtime.abortSession) {
        throw new Error("Runtime does not support abort");
      }
      return { aborted: await runtime.abortSession(sessionId) };
    },
    listBackgroundRuns: async input => {
      if (!runtime.listBackgroundRuns) {
        throw new Error("Runtime does not support background runs");
      }
      const runs = await runtime.listBackgroundRuns({
        parentSessionId: input?.sessionId,
        limit: input?.limit,
        inFlightOnly: input?.inFlightOnly,
      });
      return runs.map(run => ({
        runId: run.runId,
        parentSessionId: run.parentSessionId,
        parentExternalSessionId: run.parentExternalSessionId,
        childExternalSessionId: run.childExternalSessionId,
        childSessionId: run.childSessionId,
        requestedBy: run.requestedBy,
        prompt: run.prompt,
        status: run.status,
        resultSummary: run.resultSummary,
        error: run.error,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      }));
    },
    spawnBackgroundRun: async input => {
      if (!runtime.spawnBackgroundSession) {
        throw new Error("Runtime does not support background runs");
      }
      ensureSession(input.sessionId);
      const run = await runtime.spawnBackgroundSession({
        parentSessionId: input.sessionId,
        prompt: input.prompt,
        requestedBy: input.requestedBy,
      });
      return {
        runId: run.runId,
        parentSessionId: run.parentSessionId,
        parentExternalSessionId: run.parentExternalSessionId,
        childExternalSessionId: run.childExternalSessionId,
        childSessionId: run.childSessionId,
        requestedBy: run.requestedBy,
        prompt: run.prompt,
        status: run.status,
        resultSummary: run.resultSummary,
        error: run.error,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      };
    },
    steerBackgroundRun: async input => {
      if (!runtime.promptBackgroundAsync) {
        throw new Error("Runtime does not support background steering");
      }
      const run = await runtime.promptBackgroundAsync({
        runId: input.runId,
        content: input.content,
      });
      return {
        runId: run.runId,
        parentSessionId: run.parentSessionId,
        parentExternalSessionId: run.parentExternalSessionId,
        childExternalSessionId: run.childExternalSessionId,
        childSessionId: run.childSessionId,
        requestedBy: run.requestedBy,
        prompt: run.prompt,
        status: run.status,
        resultSummary: run.resultSummary,
        error: run.error,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      };
    },
    abortBackgroundRun: async runId => {
      if (!runtime.abortBackground) {
        throw new Error("Runtime does not support background abort");
      }
      return { aborted: await runtime.abortBackground(runId) };
    },
    listPendingPrompts,
    replyPermissionPrompt: async input => {
      await replyPermissionPrompt(input);
      return { ok: true as const };
    },
    replyQuestionPrompt: async input => {
      await replyQuestionPrompt(input);
      return { ok: true as const };
    },
    rejectQuestionPrompt: async input => {
      await rejectQuestionPrompt(input);
      return { ok: true as const };
    },
    listModelOptions: () => listOpencodeModelOptions(),
    registerNotificationDevice: async input => upsertNotificationDevice(input),
    setNotificationDeviceEnabled: async input => setNotificationDeviceEnabled(input),
    unregisterNotificationDevice: async input => ({ removed: removeNotificationDevice(input.installationId) }),
  };
}
