import type {
  BackgroundRunSnapshot,
  ChatMessage,
  ModelOption,
  NotificationDeviceRecord,
  PermissionPromptRequest,
  QuestionPromptRequest,
  SessionMessageCursor,
  SessionMessageCheckpoint,
  SessionMessagesDeltaResponse,
  SessionMessagesWindowResponse,
  SessionScreenBootstrapResponse,
  SessionSummary,
} from "@agent-mockingbird/contracts/dashboard";
import { initTRPC } from "@trpc/server";
import { z } from "zod";


export interface AppApiServices {
  getSessionBootstrap: (input?: { sessionId?: string; messageWindowLimit?: number }) => Promise<SessionScreenBootstrapResponse>;
  listSessions: () => Promise<SessionSummary[]>;
  createSession: (input?: { title?: string; model?: string }) => Promise<SessionSummary>;
  getSessionMessages: (input: {
    sessionId: string;
    checkpoint?: SessionMessageCheckpoint;
  }) => Promise<SessionMessagesDeltaResponse>;
  getSessionHistory: (input: {
    sessionId: string;
    limit: number;
    before?: SessionMessageCursor;
  }) => Promise<SessionMessagesWindowResponse>;
  sendChat: (input: { sessionId: string; content: string }) => Promise<{ session: SessionSummary; messages: ChatMessage[] }>;
  abortChat: (sessionId: string) => Promise<{ aborted: boolean }>;
  listBackgroundRuns: (input?: {
    sessionId?: string;
    limit?: number;
    inFlightOnly?: boolean;
  }) => Promise<BackgroundRunSnapshot[]>;
  spawnBackgroundRun: (input: { sessionId: string; prompt?: string; requestedBy?: string }) => Promise<BackgroundRunSnapshot>;
  steerBackgroundRun: (input: { runId: string; content: string }) => Promise<BackgroundRunSnapshot>;
  abortBackgroundRun: (runId: string) => Promise<{ aborted: boolean }>;
  listPendingPrompts: () => Promise<{
    pendingPermissions: PermissionPromptRequest[];
    pendingQuestions: QuestionPromptRequest[];
  }>;
  replyPermissionPrompt: (input: {
    requestId: string;
    reply: "once" | "always" | "reject";
    message?: string;
  }) => Promise<{ ok: true }>;
  replyQuestionPrompt: (input: {
    requestId: string;
    answers: Array<Array<string>>;
  }) => Promise<{ ok: true }>;
  rejectQuestionPrompt: (input: { requestId: string }) => Promise<{ ok: true }>;
  listModelOptions: () => Promise<ModelOption[]>;
  registerNotificationDevice: (input: {
    installationId: string;
    expoPushToken: string;
    platform: "ios" | "android";
    label?: string;
  }) => Promise<NotificationDeviceRecord>;
  setNotificationDeviceEnabled: (input: { installationId: string; enabled: boolean }) => Promise<NotificationDeviceRecord>;
  unregisterNotificationDevice: (input: { installationId: string }) => Promise<{ removed: boolean }>;
}

export interface AppRouterContext {
  services: AppApiServices;
}

const t = initTRPC.context<AppRouterContext>().create();

const sessionIdSchema = z.string().trim().min(1);
const runIdSchema = z.string().trim().min(1);
const requestIdSchema = z.string().trim().min(1);
const checkpointSchema = z.object({
  lastMessageAt: z.string().trim().min(1),
  lastMessageId: z.string().trim().min(1),
});
const cursorSchema = z.object({
  at: z.string().trim().min(1),
  role: z.enum(["user", "assistant"]),
  id: z.string().trim().min(1),
});

export const createAppRouter = () =>
  t.router({
    sessions: t.router({
      bootstrap: t.procedure
        .input(
          z
            .object({
              sessionId: z.string().trim().min(1).optional(),
              messageWindowLimit: z.number().int().min(1).max(500).optional(),
            })
            .optional(),
        )
        .query(({ ctx, input }) => ctx.services.getSessionBootstrap(input)),
      list: t.procedure.query(({ ctx }) => ctx.services.listSessions()),
      create: t.procedure
        .input(
          z
            .object({
              title: z.string().trim().min(1).optional(),
              model: z.string().trim().min(1).optional(),
            })
            .optional(),
        )
        .mutation(({ ctx, input }) => ctx.services.createSession(input)),
      messages: t.procedure
        .input(
          z.object({
            sessionId: sessionIdSchema,
            checkpoint: checkpointSchema.optional(),
          }),
        )
        .query(({ ctx, input }) => ctx.services.getSessionMessages(input)),
      history: t.procedure
        .input(
          z.object({
            sessionId: sessionIdSchema,
            limit: z.number().int().min(1).max(500),
            before: cursorSchema.optional(),
          }),
        )
        .query(({ ctx, input }) => ctx.services.getSessionHistory(input)),
    }),
    chat: t.router({
      send: t.procedure
        .input(
          z.object({
            sessionId: sessionIdSchema,
            content: z.string().trim().min(1),
          }),
        )
        .mutation(({ ctx, input }) => ctx.services.sendChat(input)),
      abort: t.procedure
        .input(z.object({ sessionId: sessionIdSchema }))
        .mutation(({ ctx, input }) => ctx.services.abortChat(input.sessionId)),
    }),
    backgroundRuns: t.router({
      list: t.procedure
        .input(
          z
            .object({
              sessionId: z.string().trim().min(1).optional(),
              limit: z.number().int().min(1).max(500).optional(),
              inFlightOnly: z.boolean().optional(),
            })
            .optional(),
        )
        .query(({ ctx, input }) => ctx.services.listBackgroundRuns(input)),
      spawn: t.procedure
        .input(
          z.object({
            sessionId: sessionIdSchema,
            prompt: z.string().trim().optional(),
            requestedBy: z.string().trim().optional(),
          }),
        )
        .mutation(({ ctx, input }) => ctx.services.spawnBackgroundRun(input)),
      steer: t.procedure
        .input(
          z.object({
            runId: runIdSchema,
            content: z.string().trim().min(1),
          }),
        )
        .mutation(({ ctx, input }) => ctx.services.steerBackgroundRun(input)),
      abort: t.procedure
        .input(z.object({ runId: runIdSchema }))
        .mutation(({ ctx, input }) => ctx.services.abortBackgroundRun(input.runId)),
    }),
    prompts: t.router({
      list: t.procedure.query(({ ctx }) => ctx.services.listPendingPrompts()),
      replyPermission: t.procedure
        .input(
          z.object({
            requestId: requestIdSchema,
            reply: z.enum(["once", "always", "reject"]),
            message: z.string().trim().optional(),
          }),
        )
        .mutation(({ ctx, input }) => ctx.services.replyPermissionPrompt(input)),
      replyQuestion: t.procedure
        .input(
          z.object({
            requestId: requestIdSchema,
            answers: z.array(z.array(z.string())),
          }),
        )
        .mutation(({ ctx, input }) => ctx.services.replyQuestionPrompt(input)),
      rejectQuestion: t.procedure
        .input(z.object({ requestId: requestIdSchema }))
        .mutation(({ ctx, input }) => ctx.services.rejectQuestionPrompt(input)),
    }),
    runtime: t.router({
      models: t.procedure.query(({ ctx }) => ctx.services.listModelOptions()),
    }),
    notifications: t.router({
      registerDevice: t.procedure
        .input(
          z.object({
            installationId: z.string().trim().min(1),
            expoPushToken: z.string().trim().min(1),
            platform: z.enum(["ios", "android"]),
            label: z.string().trim().optional(),
          }),
        )
        .mutation(({ ctx, input }) => ctx.services.registerNotificationDevice(input)),
      setEnabled: t.procedure
        .input(
          z.object({
            installationId: z.string().trim().min(1),
            enabled: z.boolean(),
          }),
        )
        .mutation(({ ctx, input }) => ctx.services.setNotificationDeviceEnabled(input)),
      unregisterDevice: t.procedure
        .input(
          z.object({
            installationId: z.string().trim().min(1),
          }),
        )
        .mutation(({ ctx, input }) => ctx.services.unregisterNotificationDevice(input)),
    }),
  });

export type AppRouter = ReturnType<typeof createAppRouter>;
