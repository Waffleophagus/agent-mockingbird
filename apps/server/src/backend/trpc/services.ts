import type { AppApiServices } from "@wafflebot/api";
import type { RuntimeEngine } from "../contracts/runtime";
import {
  createSession,
  getSessionById,
  listMessagesForSession,
  listSessions,
} from "../db/repository";
import { listOpencodeModelOptions } from "../opencode/models";
import { listPendingPrompts, rejectQuestionPrompt, replyPermissionPrompt, replyQuestionPrompt } from "../prompts/service";
import { createRuntimeSessionBootstrap } from "../ui/bootstrap";
import {
  removeNotificationDevice,
  setNotificationDeviceEnabled,
  upsertNotificationDevice,
} from "../notifications/repository";

function ensureSession(sessionId: string) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("Unknown session");
  }
  return session;
}

export function createAppApiServices(runtime: RuntimeEngine): AppApiServices {
  return {
    getSessionBootstrap: input => createRuntimeSessionBootstrap(runtime, input?.sessionId),
    listSessions: async () => listSessions(),
    createSession: async input => createSession(input),
    getSessionMessages: async sessionId => {
      ensureSession(sessionId);
      if (runtime.syncSessionMessages) {
        await runtime.syncSessionMessages(sessionId).catch(() => undefined);
      }
      return listMessagesForSession(sessionId);
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
