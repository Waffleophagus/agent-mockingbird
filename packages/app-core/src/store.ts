import { flow, types } from "mobx-state-tree";

import type { Instance } from "mobx-state-tree";
import type {
  BackgroundRunSnapshot,
  ChatMessage,
  PermissionPromptRequest,
  QuestionPromptRequest,
  SessionScreenBootstrapResponse,
  SessionSummary,
} from "@agent-mockingbird/contracts/dashboard";

export interface AppCoreEnvironment {
  api: {
    sessions: {
      bootstrap: (input?: { sessionId?: string }) => Promise<SessionScreenBootstrapResponse>;
      create: (input?: { title?: string; model?: string }) => Promise<SessionSummary>;
      messages: (input: { sessionId: string }) => Promise<ChatMessage[]>;
    };
    chat: {
      send: (input: { sessionId: string; content: string }) => Promise<{
        session: SessionSummary;
        messages: ChatMessage[];
      }>;
    };
    backgroundRuns: {
      list: (input?: { sessionId?: string }) => Promise<BackgroundRunSnapshot[]>;
    };
    prompts: {
      list: () => Promise<{
        pendingPermissions: PermissionPromptRequest[];
        pendingQuestions: QuestionPromptRequest[];
      }>;
    };
  };
}

const SessionModel = types.model("Session", {
  id: types.string,
  title: types.string,
  model: types.string,
  status: types.enumeration(["active", "idle"]),
  lastActiveAt: types.string,
  messageCount: types.number,
});

const MessageModel = types.model("Message", {
  id: types.string,
  role: types.enumeration(["user", "assistant"]),
  content: types.string,
  at: types.string,
});

export const RootStore = types
  .model("RootStore", {
    sessions: types.array(SessionModel),
    activeSessionId: types.optional(types.string, ""),
    messagesBySession: types.map(types.array(MessageModel)),
    pendingPermissionCount: types.optional(types.number, 0),
    pendingQuestionCount: types.optional(types.number, 0),
    inFlightBackgroundCount: types.optional(types.number, 0),
    connectionState: types.optional(types.enumeration(["connecting", "connected", "offline"]), "connecting"),
    lastBootstrapAt: types.maybeNull(types.string),
  })
  .actions(self => ({
    applyBootstrap(payload: SessionScreenBootstrapResponse) {
      self.sessions.replace(payload.sessions);
      self.activeSessionId = payload.activeSessionId;
      self.messagesBySession.set(payload.activeSessionId, payload.messages as never);
      self.pendingPermissionCount = payload.pendingPermissions?.length ?? 0;
      self.pendingQuestionCount = payload.pendingQuestions?.length ?? 0;
      self.inFlightBackgroundCount = payload.backgroundRuns.filter(run =>
        ["created", "running", "retrying"].includes(run.status),
      ).length;
      self.connectionState = "connected";
      self.lastBootstrapAt = new Date().toISOString();
    },
    setSessionMessages(sessionId: string, messages: ChatMessage[]) {
      self.messagesBySession.set(sessionId, messages as never);
    },
    setActiveSession(sessionId: string) {
      self.activeSessionId = sessionId;
    },
  }))
  .actions(self => ({
    bootstrap: flow(function* bootstrap(env: AppCoreEnvironment, input?: { sessionId?: string }) {
      self.connectionState = "connecting";
      const payload: SessionScreenBootstrapResponse = yield env.api.sessions.bootstrap(input);
      self.applyBootstrap(payload);
    }),
    createSession: flow(function* createSession(env: AppCoreEnvironment, input?: { title?: string; model?: string }) {
      const session: SessionSummary = yield env.api.sessions.create(input);
      self.sessions.unshift(session as never);
      self.activeSessionId = session.id;
      return session;
    }),
    loadMessages: flow(function* loadMessages(env: AppCoreEnvironment, sessionId: string) {
      const messages: ChatMessage[] = yield env.api.sessions.messages({ sessionId });
      self.setSessionMessages(sessionId, messages);
    }),
    sendMessage: flow(function* sendMessage(env: AppCoreEnvironment, input: { sessionId: string; content: string }) {
      const result: { session: SessionSummary; messages: ChatMessage[] } = yield env.api.chat.send(input);
      self.setSessionMessages(input.sessionId, result.messages);
      return result;
    }),
  }));

export interface RootStoreApi extends Instance<typeof RootStore> {}
