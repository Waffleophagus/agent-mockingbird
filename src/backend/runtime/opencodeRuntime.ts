import type { Part, Session, SessionMessagesResponse, SessionPromptResponse } from "@opencode-ai/sdk/client";

import { RuntimeSessionNotFoundError } from "./errors";
import type { MemoryToolCallTrace, MessageMemoryTrace } from "../../types/dashboard";
import {
  createHeartbeatUpdatedEvent,
  createSessionMessageCreatedEvent,
  createSessionStateUpdatedEvent,
  createUsageUpdatedEvent,
  type RuntimeEvent,
} from "../contracts/events";
import type { RuntimeEngine, RuntimeMessageAck, SendUserMessageInput } from "../contracts/runtime";
import {
  appendChatExchange,
  getLocalSessionIdByRuntimeBinding,
  getRuntimeSessionBinding,
  getSessionById,
  setMessageMemoryTrace,
  setSessionTitle,
  setRuntimeSessionBinding,
} from "../db/repository";
import { env } from "../env";
import { searchMemory } from "../memory/service";
import { createOpencodeClient, getOpencodeErrorStatus, unwrapSdkData } from "../opencode/client";

type Listener = (event: RuntimeEvent) => void;

interface OpencodeRuntimeOptions {
  defaultProviderId: string;
  defaultModelId: string;
}

interface SessionUpdatedEvent {
  type: "session.updated";
  properties: {
    info: {
      id: string;
      title: string;
    };
  };
}

const MODEL_MEMORY_TOOLS = new Set(["memory_search", "memory_get", "memory_remember"]);

export class OpencodeRuntime implements RuntimeEngine {
  private listeners = new Set<Listener>();
  private client = createOpencodeClient();
  private eventSyncStarted = false;

  constructor(private options: OpencodeRuntimeOptions) {
    this.startEventSync();
  }

  subscribe(onEvent: Listener): () => void {
    this.listeners.add(onEvent);
    return () => {
      this.listeners.delete(onEvent);
    };
  }

  async sendUserMessage(input: SendUserMessageInput): Promise<RuntimeMessageAck> {
    const session = getSessionById(input.sessionId);
    if (!session) {
      throw new RuntimeSessionNotFoundError(input.sessionId);
    }

    const model = this.resolveModel(session.model);
    let opencodeSessionId = await this.resolveOrCreateOpencodeSession(session.id, session.title);

    const promptInput = await this.buildPromptInputWithMemory(input.content);
    const memorySystemPrompt = this.buildMemorySystemPrompt();

    let promptResult: SessionPromptResponse;
    try {
      promptResult = await this.sendPrompt(opencodeSessionId, model, promptInput.content, memorySystemPrompt);
    } catch (error) {
      // Bound OpenCode sessions can disappear if server state is reset.
      if (getOpencodeErrorStatus(error) === 404) {
        opencodeSessionId = await this.createOpencodeSession(session.id, session.title);
        promptResult = await this.sendPrompt(opencodeSessionId, model, promptInput.content, memorySystemPrompt);
      } else {
        throw this.normalizeRuntimeError(error);
      }
    }

    await this.syncSessionTitleFromOpencode(session.id, opencodeSessionId, session.title);
    this.startSessionTitlePolling(session.id, opencodeSessionId);

    const assistantHistoryParts = await this.fetchAssistantMessageParts(opencodeSessionId, promptResult.info.id);
    const trace = this.buildMessageMemoryTrace(
      assistantHistoryParts ?? promptResult.parts,
      promptInput.injectedContextResults,
    );
    const promptText = this.extractText(promptResult.parts) ?? this.extractText(assistantHistoryParts ?? []);
    const assistantText =
      promptText ??
      this.extractText(assistantHistoryParts ?? []) ??
      "OpenCode finished the request, but no assistant text payload was found.";

    const createdAt = promptResult.info.time?.completed ?? promptResult.info.time?.created ?? Date.now();
    const result = appendChatExchange({
      sessionId: session.id,
      userContent: input.content,
      assistantContent: assistantText,
      source: "runtime",
      createdAt,
      assistantMessageId: promptResult.info.id,
      usage: {
        requestCountDelta: 1,
        inputTokensDelta: promptResult.info.tokens?.input ?? Math.max(8, input.content.length * 2),
        outputTokensDelta: promptResult.info.tokens?.output ?? Math.max(24, Math.floor(input.content.length * 2.5)),
        estimatedCostUsdDelta: promptResult.info.cost ?? 0,
      },
    });

    if (!result) {
      throw new RuntimeSessionNotFoundError(input.sessionId);
    }

    if (trace) {
      setMessageMemoryTrace({
        sessionId: session.id,
        messageId: promptResult.info.id,
        trace,
        createdAt,
      });
      for (const message of result.messages) {
        if (message.id === promptResult.info.id && message.role === "assistant") {
          message.memoryTrace = trace;
        }
      }
    }

    for (const message of result.messages) {
      this.emit(
        createSessionMessageCreatedEvent(
          {
            sessionId: result.session.id,
            message,
          },
          "runtime",
        ),
      );
    }
    this.emit(createSessionStateUpdatedEvent(result.session, "runtime"));
    this.emit(createUsageUpdatedEvent(result.usage, "runtime"));
    this.emit(createHeartbeatUpdatedEvent(result.heartbeat, "runtime"));

    return {
      sessionId: result.session.id,
      messages: result.messages,
    };
  }

  private async buildPromptInputWithMemory(userContent: string): Promise<{
    content: string;
    injectedContextResults: number;
  }> {
    if (env.WAFFLEBOT_MEMORY_TOOL_MODE === "tool_only") {
      return { content: userContent, injectedContextResults: 0 };
    }

    const query = userContent.trim();
    if (!query) return { content: userContent, injectedContextResults: 0 };

    try {
      const results = await searchMemory(query);
      if (!results.length) {
        return { content: userContent, injectedContextResults: 0 };
      }
      const contextLines = results.map(
        (result, index) =>
          `${index + 1}. (${result.score.toFixed(3)}) ${result.citation}\n${result.snippet}`,
      );
      const contextBlock = contextLines.join("\n\n");
      return {
        content: [
          "Use the memory context below only if relevant and non-contradictory to current user intent.",
          "",
          "[Memory Context]",
          contextBlock,
          "[/Memory Context]",
          "",
          "[User Message]",
          userContent,
          "[/User Message]",
        ].join("\n"),
        injectedContextResults: results.length,
      };
    } catch {
      return { content: userContent, injectedContextResults: 0 };
    }
  }

  private buildMemorySystemPrompt(): string | undefined {
    if (!env.WAFFLEBOT_MEMORY_ENABLED) return undefined;
    if (env.WAFFLEBOT_MEMORY_TOOL_MODE === "inject_only") return undefined;

    const lines = [
      "Memory policy:",
      "- Use memory_search first for questions about prior facts/preferences/decisions/todos.",
      "- Use memory_get to inspect cited records before relying on them.",
      "- Use memory_remember only for durable information worth reusing later.",
      `- Current write policy: ${env.WAFFLEBOT_MEMORY_WRITE_POLICY}; minimum confidence: ${env.WAFFLEBOT_MEMORY_MIN_CONFIDENCE.toFixed(2)}.`,
      "- Prefer supersedes when replacing older memory records.",
    ];
    return lines.join("\n");
  }

  private emit(event: RuntimeEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private startEventSync() {
    if (this.eventSyncStarted) return;
    this.eventSyncStarted = true;
    void this.runEventSyncLoop();
  }

  private async runEventSyncLoop() {
    while (true) {
      try {
        const subscription = await this.client.event.subscribe({
          responseStyle: "data",
          throwOnError: true,
        });
        for await (const event of subscription.stream) {
          this.handleOpencodeEvent(event);
        }
      } catch {
        // Non-blocking: event stream issues should not disrupt prompt handling.
      }

      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  }

  private handleOpencodeEvent(event: unknown) {
    if (!this.isSessionUpdatedEvent(event)) return;

    const opencodeSessionId = event.properties.info.id.trim();
    const remoteTitle = event.properties.info.title.trim();
    if (!opencodeSessionId || !remoteTitle) return;

    const localSessionId = getLocalSessionIdByRuntimeBinding("opencode", opencodeSessionId);
    if (!localSessionId || localSessionId === "main") return;

    const localSession = getSessionById(localSessionId);
    if (!localSession || localSession.title === remoteTitle) return;

    const updated = setSessionTitle(localSessionId, remoteTitle);
    if (!updated) return;
    this.emit(createSessionStateUpdatedEvent(updated, "runtime"));
  }

  private isSessionUpdatedEvent(event: unknown): event is SessionUpdatedEvent {
    if (!event || typeof event !== "object") return false;
    const maybeEvent = event as {
      type?: unknown;
      properties?: {
        info?: {
          id?: unknown;
          title?: unknown;
        };
      };
    };
    return (
      maybeEvent.type === "session.updated" &&
      typeof maybeEvent.properties?.info?.id === "string" &&
      typeof maybeEvent.properties?.info?.title === "string"
    );
  }

  private resolveModel(rawModel: string): { providerId: string; modelId: string } {
    const trimmed = rawModel.trim();
    if (trimmed.includes("/")) {
      const [providerId, ...rest] = trimmed.split("/");
      const modelId = rest.join("/").trim();
      if (providerId && modelId) {
        return { providerId, modelId };
      }
    }

    return {
      providerId: this.options.defaultProviderId,
      modelId: trimmed || this.options.defaultModelId,
    };
  }

  private extractText(parts: Array<Part>): string | null {
    const text = parts
      .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
      .map(part => part.text.trim())
      .filter(Boolean)
      .join("\n\n");
    return text || null;
  }

  private async fetchAssistantMessageParts(sessionId: string, messageId: string): Promise<Array<Part> | null> {
    try {
      const messages = unwrapSdkData<SessionMessagesResponse>(await this.client.session.messages({
        path: { id: sessionId },
        query: { limit: 40 },
        responseStyle: "data",
        throwOnError: true,
      }));
      const assistantMessage = messages.find(message => message.info.id === messageId);
      if (assistantMessage?.parts?.length) return assistantMessage.parts;
      const latestAssistant = [...messages].reverse().find(message => message.info.role === "assistant");
      return latestAssistant?.parts ?? null;
    } catch {
      return null;
    }
  }

  private buildMessageMemoryTrace(parts: Array<Part>, injectedContextResults: number): MessageMemoryTrace | null {
    const toolCalls: MemoryToolCallTrace[] = [];
    for (const part of parts) {
      if (part.type !== "tool" || !MODEL_MEMORY_TOOLS.has(part.tool)) continue;
      const call: MemoryToolCallTrace = {
        tool: part.tool,
        status: part.state.status,
      };

      if (part.state.status === "error") {
        call.error = part.state.error;
        call.summary = "tool call failed";
      } else if (part.state.status === "completed") {
        call.summary = this.summarizeMemoryToolOutput(part.tool, part.state.output);
      }
      toolCalls.push(call);
    }

    if (injectedContextResults <= 0 && toolCalls.length === 0) {
      return null;
    }

    return {
      mode: env.WAFFLEBOT_MEMORY_TOOL_MODE,
      injectedContextResults,
      toolCalls,
      createdAt: new Date().toISOString(),
    };
  }

  private summarizeMemoryToolOutput(tool: string, output: string): string {
    if (tool !== "memory_remember") {
      return "completed";
    }
    try {
      const parsed = JSON.parse(output) as unknown;
      if (!parsed || typeof parsed !== "object") return "completed";
      const container = parsed as Record<string, unknown>;
      const result = (container.result as Record<string, unknown> | undefined) ?? container;
      const accepted = result.accepted;
      const reason = result.reason;
      if (typeof accepted === "boolean" && typeof reason === "string") {
        return accepted ? `accepted: ${reason}` : `rejected: ${reason}`;
      }
      if (typeof accepted === "boolean") {
        return accepted ? "accepted" : "rejected";
      }
    } catch {
      // ignore parse errors and fall back to generic summary
    }
    return "completed";
  }

  private async sendPrompt(
    sessionId: string,
    model: { providerId: string; modelId: string },
    content: string,
    system?: string,
  ): Promise<SessionPromptResponse> {
    const result = await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        model: {
          providerID: model.providerId,
          modelID: model.modelId,
        },
        system,
        parts: [{ type: "text", text: content }],
      },
      responseStyle: "data",
      throwOnError: true,
    });
    return unwrapSdkData<SessionPromptResponse>(result);
  }

  private async resolveOrCreateOpencodeSession(localSessionId: string, localTitle: string) {
    const bound = getRuntimeSessionBinding("opencode", localSessionId);
    if (bound) return bound;
    return this.createOpencodeSession(localSessionId, localTitle);
  }

  private async createOpencodeSession(localSessionId: string, localTitle: string) {
    const body = localSessionId === "main" ? { title: localTitle } : {};
    const created = unwrapSdkData<Session>(await this.client.session.create({
      body,
      responseStyle: "data",
      throwOnError: true,
    }));
    setRuntimeSessionBinding("opencode", localSessionId, created.id);
    return created.id;
  }

  private isPlaceholderSessionTitle(title: string) {
    const normalized = title.trim();
    if (!normalized) return true;
    return /^session \d+$/i.test(normalized) || normalized === "New Session";
  }

  private startSessionTitlePolling(localSessionId: string, opencodeSessionId: string) {
    if (localSessionId === "main") return;
    const localSession = getSessionById(localSessionId);
    if (!localSession || !this.isPlaceholderSessionTitle(localSession.title)) return;

    void (async () => {
      const retryDelaysMs = [600, 1200, 2200, 3500, 5000, 7000];
      for (const delayMs of retryDelaysMs) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        const currentLocal = getSessionById(localSessionId);
        if (!currentLocal) return;
        if (!this.isPlaceholderSessionTitle(currentLocal.title)) return;

        const synced = await this.syncSessionTitleFromOpencode(
          localSessionId,
          opencodeSessionId,
          currentLocal.title,
          true,
        );
        if (synced) return;
      }
    })();
  }

  private async syncSessionTitleFromOpencode(
    localSessionId: string,
    opencodeSessionId: string,
    localTitle: string,
    emitUpdateEvent = false,
  ) {
    if (localSessionId === "main") return;

    try {
      const opencodeSession = unwrapSdkData<Session>(await this.client.session.get({
        path: { id: opencodeSessionId },
        responseStyle: "data",
        throwOnError: true,
      }));
      const remoteTitle = opencodeSession.title.trim();
      if (!remoteTitle || remoteTitle === localTitle) return false;
      const updated = setSessionTitle(localSessionId, remoteTitle);
      if (emitUpdateEvent && updated) {
        this.emit(createSessionStateUpdatedEvent(updated, "runtime"));
      }
      return true;
    } catch {
      // Non-blocking: title sync should never break prompt handling.
      return false;
    }
  }

  private normalizeRuntimeError(error: unknown): Error {
    const status = getOpencodeErrorStatus(error);
    if (status !== null) {
      const message = error instanceof Error ? error.message : "OpenCode request failed";
      return new Error(`OpenCode API error (${status}): ${message}`);
    }
    if (error instanceof Error) return error;
    return new Error("OpenCode request failed.");
  }
}
