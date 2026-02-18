import type {
  Config,
  Event as OpencodeEvent,
  Message,
  Part,
  Session,
} from "@opencode-ai/sdk/client";

import { RuntimeSessionBusyError, RuntimeSessionNotFoundError } from "./errors";
import type { MemoryToolCallTrace, MessageMemoryTrace } from "../../types/dashboard";
import {
  createHeartbeatUpdatedEvent,
  createSessionCompactedEvent,
  createSessionMessageCreatedEvent,
  createSessionMessagePartUpdatedEvent,
  createSessionRunErrorEvent,
  createSessionRunStatusUpdatedEvent,
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
type AssistantInfo = Extract<Message, { role: "assistant" }>;

interface OpencodeRuntimeOptions {
  defaultProviderId: string;
  defaultModelId: string;
}

const MODEL_MEMORY_TOOLS = new Set(["memory_search", "memory_get", "memory_remember"]);

export class OpencodeRuntime implements RuntimeEngine {
  private listeners = new Set<Listener>();
  private client = createOpencodeClient();
  private eventSyncStarted = false;
  private busySessions = new Set<string>();
  private messageRoles = new Map<string, Message["role"]>();
  private userFacingAssistantMessageIds = new Set<string>();
  private pendingAssistantTextParts = new Map<
    string,
    Array<{ part: Extract<Part, { type: "text" }>; delta?: string }>
  >();

  constructor(private options: OpencodeRuntimeOptions) {
    this.syncOpencodeSmallModel();
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

    if (this.busySessions.has(session.id)) {
      throw new RuntimeSessionBusyError(session.id);
    }
    this.busySessions.add(session.id);

    try {
      const model = this.resolveModel(session.model);
      let opencodeSessionId = await this.resolveOrCreateOpencodeSession(session.id, session.title);

      const promptInput = await this.buildPromptInputWithMemory(input.content);
      const memorySystemPrompt = this.buildWafflebotSystemPrompt();

      let assistantMessage: { info: AssistantInfo; parts: Array<Part> };
      try {
        assistantMessage = await this.sendPrompt(opencodeSessionId, model, promptInput.content, memorySystemPrompt);
      } catch (error) {
        // Bound OpenCode sessions can disappear if server state is reset.
        if (getOpencodeErrorStatus(error) === 404) {
          opencodeSessionId = await this.createOpencodeSession(session.id, session.title);
          assistantMessage = await this.sendPrompt(opencodeSessionId, model, promptInput.content, memorySystemPrompt);
        } else {
          throw this.normalizeRuntimeError(error);
        }
      }

      await this.syncSessionTitleFromOpencode(session.id, opencodeSessionId, session.title);
      this.startSessionTitlePolling(session.id, opencodeSessionId);

      const trace = this.buildMessageMemoryTrace(assistantMessage.parts, promptInput.injectedContextResults);
      const assistantError = this.extractAssistantError(assistantMessage.info, assistantMessage.parts);
      if (assistantError) {
        this.emit(
          createSessionRunErrorEvent(
            {
              sessionId: session.id,
              message: assistantError,
            },
            "runtime",
          ),
        );
        throw new Error(`OpenCode run failed: ${assistantError}`);
      }

      const assistantText = this.extractText(assistantMessage.parts);
      if (!assistantText) {
        const finish = assistantMessage.info.finish ?? "unknown";
        const toolPartCount = assistantMessage.parts.filter((part) => part.type === "tool").length;
        const detail = `finish=${finish}, tool_parts=${toolPartCount}`;
        throw new Error(`OpenCode returned no assistant text (${detail}).`);
      }

      const createdAt =
        assistantMessage.info.time?.completed ?? assistantMessage.info.time?.created ?? Date.now();
      const result = appendChatExchange({
        sessionId: session.id,
        userContent: input.content,
        assistantContent: assistantText,
        source: "runtime",
        createdAt,
        assistantMessageId: assistantMessage.info.id,
        usage: {
          requestCountDelta: 1,
          inputTokensDelta:
            assistantMessage.info.tokens?.input ?? Math.max(8, input.content.length * 2),
          outputTokensDelta:
            assistantMessage.info.tokens?.output ?? Math.max(24, Math.floor(input.content.length * 2.5)),
          estimatedCostUsdDelta: assistantMessage.info.cost ?? 0,
        },
      });

      if (!result) {
        throw new RuntimeSessionNotFoundError(input.sessionId);
      }

      if (trace) {
        setMessageMemoryTrace({
          sessionId: session.id,
          messageId: assistantMessage.info.id,
          trace,
          createdAt,
        });
        for (const message of result.messages) {
          if (message.id === assistantMessage.info.id && message.role === "assistant") {
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
    } finally {
      this.busySessions.delete(session.id);
    }
  }

  async abortSession(sessionId: string): Promise<boolean> {
    const opencodeSessionId = getRuntimeSessionBinding("opencode", sessionId);
    if (!opencodeSessionId) return false;
    try {
      const result = await this.client.session.abort({
        path: { id: opencodeSessionId },
        responseStyle: "data",
        throwOnError: true,
      });
      return Boolean(unwrapSdkData<boolean>(result));
    } catch (error) {
      if (getOpencodeErrorStatus(error) === 404) {
        return false;
      }
      throw this.normalizeRuntimeError(error);
    }
  }

  async compactSession(sessionId: string): Promise<boolean> {
    const session = getSessionById(sessionId);
    if (!session) throw new RuntimeSessionNotFoundError(sessionId);

    let opencodeSessionId = await this.resolveOrCreateOpencodeSession(session.id, session.title);
    const model = this.resolveModel(session.model);
    try {
      const result = await this.client.session.summarize({
        path: { id: opencodeSessionId },
        body: {
          providerID: model.providerId,
          modelID: model.modelId,
        },
        responseStyle: "data",
        throwOnError: true,
      });
      return Boolean(unwrapSdkData<boolean>(result));
    } catch (error) {
      if (getOpencodeErrorStatus(error) === 404) {
        opencodeSessionId = await this.createOpencodeSession(session.id, session.title);
        const retry = await this.client.session.summarize({
          path: { id: opencodeSessionId },
          body: {
            providerID: model.providerId,
            modelID: model.modelId,
          },
          responseStyle: "data",
          throwOnError: true,
        });
        return Boolean(unwrapSdkData<boolean>(retry));
      }
      throw this.normalizeRuntimeError(error);
    }
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

  private buildWafflebotSystemPrompt(): string | undefined {
    const lines: string[] = [];

    if (env.WAFFLEBOT_MEMORY_ENABLED && env.WAFFLEBOT_MEMORY_TOOL_MODE !== "inject_only") {
      lines.push(
        "Memory policy:",
        "- Use memory_search first for questions about prior facts/preferences/decisions/todos.",
        "- Use memory_get to inspect cited records before relying on them.",
        "- Use memory_remember only for durable information worth reusing later.",
        `- Current write policy: ${env.WAFFLEBOT_MEMORY_WRITE_POLICY}; minimum confidence: ${env.WAFFLEBOT_MEMORY_MIN_CONFIDENCE.toFixed(2)}.`,
        "- Prefer supersedes when replacing older memory records.",
      );
    }

    if (env.WAFFLEBOT_CRON_ENABLED) {
      if (lines.length > 0) lines.push("");
      lines.push(
        "Cron policy:",
        "- Use cron_manager for recurring automation and background checks.",
        "- Prefer deterministic jobs when possible; only invoke the model when useful.",
        "- Review existing jobs before creating new ones to avoid duplicates.",
      );
    }

    return lines.length ? lines.join("\n") : undefined;
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

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  private handleOpencodeEvent(event: unknown) {
    if (!this.isOpencodeEvent(event)) return;

    switch (event.type) {
      case "session.updated":
        this.handleSessionUpdatedEvent(event);
        return;
      case "session.status":
        this.handleSessionStatusEvent(event);
        return;
      case "session.idle":
        this.handleSessionIdleEvent(event);
        return;
      case "session.compacted":
        this.handleSessionCompactedEvent(event);
        return;
      case "message.updated":
        this.handleMessageUpdatedEvent(event);
        return;
      case "message.part.updated":
        this.handleMessagePartUpdatedEvent(event);
        return;
      case "session.error":
        this.handleSessionErrorEvent(event);
        return;
      default:
        return;
    }
  }

  private handleSessionUpdatedEvent(event: Extract<OpencodeEvent, { type: "session.updated" }>) {
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

  private handleSessionStatusEvent(event: Extract<OpencodeEvent, { type: "session.status" }>) {
    const opencodeSessionId = event.properties.sessionID;
    const status = event.properties.status;

    const localSessionId = getLocalSessionIdByRuntimeBinding("opencode", opencodeSessionId);
    if (!localSessionId) return;

    this.emit(
      createSessionRunStatusUpdatedEvent(
        {
          sessionId: localSessionId,
          status: status.type,
          attempt: status.type === "retry" ? status.attempt : undefined,
          message: status.type === "retry" ? status.message : undefined,
          nextAt:
            status.type === "retry" && Number.isFinite(status.next)
              ? new Date(status.next).toISOString()
              : undefined,
        },
        "runtime",
      ),
    );
  }

  private handleSessionIdleEvent(event: Extract<OpencodeEvent, { type: "session.idle" }>) {
    const opencodeSessionId = event.properties.sessionID;

    const localSessionId = getLocalSessionIdByRuntimeBinding("opencode", opencodeSessionId);
    if (!localSessionId) return;

    this.emit(
      createSessionRunStatusUpdatedEvent(
        {
          sessionId: localSessionId,
          status: "idle",
        },
        "runtime",
      ),
    );
  }

  private handleSessionCompactedEvent(event: Extract<OpencodeEvent, { type: "session.compacted" }>) {
    const opencodeSessionId = event.properties.sessionID;
    const localSessionId = getLocalSessionIdByRuntimeBinding("opencode", opencodeSessionId);
    if (!localSessionId) return;

    this.emit(
      createSessionCompactedEvent(
        {
          sessionId: localSessionId,
        },
        "runtime",
      ),
    );
  }

  private handleMessageUpdatedEvent(event: Extract<OpencodeEvent, { type: "message.updated" }>) {
    const message = event.properties.info;
    this.trackMessageRole(message.id, message.role);
    if (message.role !== "assistant") {
      this.userFacingAssistantMessageIds.delete(message.id);
      this.pendingAssistantTextParts.delete(message.id);
      return;
    }
    if (!this.isUserFacingAssistantInfo(message)) {
      this.userFacingAssistantMessageIds.delete(message.id);
      this.pendingAssistantTextParts.delete(message.id);
      return;
    }
    this.userFacingAssistantMessageIds.add(message.id);
    this.flushPendingAssistantTextParts(message.id);
  }

  private handleMessagePartUpdatedEvent(event: Extract<OpencodeEvent, { type: "message.part.updated" }>) {
    if (!env.WAFFLEBOT_OPENCODE_STREAM_PARTS) return;
    const part = event.properties.part;
    if (part.type !== "text") return;

    if (this.userFacingAssistantMessageIds.has(part.messageID)) {
      this.emitSessionMessagePartUpdated(part, event.properties.delta);
      return;
    }

    const pending = this.pendingAssistantTextParts.get(part.messageID) ?? [];
    pending.push({ part, delta: event.properties.delta });
    if (pending.length > 512) pending.shift();
    this.pendingAssistantTextParts.set(part.messageID, pending);
  }

  private handleSessionErrorEvent(event: Extract<OpencodeEvent, { type: "session.error" }>) {
    const error = event.properties.error;
    if (!error) return;

    const localSessionId = event.properties.sessionID
      ? getLocalSessionIdByRuntimeBinding("opencode", event.properties.sessionID)
      : null;

    const message =
      typeof error.data?.message === "string"
        ? error.data.message
        : typeof error.name === "string"
          ? error.name
          : "OpenCode session error";

    this.emit(
      createSessionRunErrorEvent(
        {
          sessionId: localSessionId,
          name: error.name,
          message,
        },
        "runtime",
      ),
    );
  }

  private isOpencodeEvent(event: unknown): event is OpencodeEvent {
    if (!event || typeof event !== "object") return false;
    const maybeEvent = event as { type?: unknown };
    return typeof maybeEvent.type === "string";
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
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n");
    return text || null;
  }

  private extractAssistantError(info: AssistantInfo, parts: Array<Part>): string | null {
    const infoError = this.describeUnknownError(info.error);
    if (infoError) {
      return infoError;
    }

    for (const part of parts) {
      if (part.type !== "tool" || part.state.status !== "error") continue;
      const reason = part.state.error?.trim();
      if (reason) {
        return `Tool ${part.tool} failed: ${reason}`;
      }
      return `Tool ${part.tool} failed.`;
    }

    return null;
  }

  private describeUnknownError(error: unknown): string | null {
    if (!error) return null;
    if (typeof error === "string") {
      const trimmed = error.trim();
      return trimmed || null;
    }

    if (error instanceof Error) {
      const message = error.message.trim();
      return message || error.name || "Unknown error";
    }

    if (typeof error !== "object") {
      return String(error);
    }

    const record = error as Record<string, unknown>;
    const directMessage = typeof record.message === "string" ? record.message.trim() : "";
    if (directMessage) return directMessage;

    const dataMessage =
      record.data && typeof record.data === "object" && typeof (record.data as Record<string, unknown>).message === "string"
        ? ((record.data as Record<string, unknown>).message as string).trim()
        : "";
    if (dataMessage) return dataMessage;

    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (name) return name;

    return null;
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
  ): Promise<{ info: AssistantInfo; parts: Array<Part> }> {
    const response = unwrapSdkData<{ info: Message; parts: Array<Part> }>(
      await this.client.session.prompt({
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
      }),
    );
    if (response.info.role !== "assistant") {
      throw new Error(`OpenCode returned unexpected message role: ${response.info.role}`);
    }
    return response as { info: AssistantInfo; parts: Array<Part> };
  }

  private isUserFacingAssistantInfo(info: AssistantInfo): boolean {
    if (info.summary) return false;
    const mode = info.mode.trim().toLowerCase();
    return !["title", "summary", "compaction"].includes(mode);
  }

  private trackMessageRole(messageId: string, role: Message["role"]) {
    this.messageRoles.set(messageId, role);
    if (this.messageRoles.size <= 12_000) return;

    const firstKey = this.messageRoles.keys().next().value as string | undefined;
    if (!firstKey) return;
    this.messageRoles.delete(firstKey);
    this.userFacingAssistantMessageIds.delete(firstKey);
    this.pendingAssistantTextParts.delete(firstKey);
  }

  private flushPendingAssistantTextParts(messageId: string) {
    const pending = this.pendingAssistantTextParts.get(messageId);
    if (!pending || pending.length === 0) {
      this.pendingAssistantTextParts.delete(messageId);
      return;
    }
    this.pendingAssistantTextParts.delete(messageId);
    for (const item of pending) {
      this.emitSessionMessagePartUpdated(item.part, item.delta);
    }
  }

  private emitSessionMessagePartUpdated(part: Extract<Part, { type: "text" }>, delta?: string) {
    const localSessionId = getLocalSessionIdByRuntimeBinding("opencode", part.sessionID);
    if (!localSessionId) return;

    this.emit(
      createSessionMessagePartUpdatedEvent(
        {
          sessionId: localSessionId,
          messageId: part.messageID,
          part: part as Record<string, unknown>,
          delta,
        },
        "runtime",
      ),
    );
  }

  private async resolveOrCreateOpencodeSession(localSessionId: string, localTitle: string) {
    const bound = getRuntimeSessionBinding("opencode", localSessionId);
    if (bound) return bound;
    return this.createOpencodeSession(localSessionId, localTitle);
  }

  private async createOpencodeSession(localSessionId: string, localTitle: string) {
    const body = localSessionId === "main" ? { title: localTitle } : {};
    const created = unwrapSdkData<Session>(
      await this.client.session.create({
        body,
        responseStyle: "data",
        throwOnError: true,
      }),
    );
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
        await new Promise((resolve) => setTimeout(resolve, delayMs));
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
      const opencodeSession = unwrapSdkData<Session>(
        await this.client.session.get({
          path: { id: opencodeSessionId },
          responseStyle: "data",
          throwOnError: true,
        }),
      );
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

  private async syncOpencodeSmallModel() {
    const desiredSmallModel = env.WAFFLEBOT_OPENCODE_SMALL_MODEL.trim();
    if (!desiredSmallModel) return;

    try {
      const current = unwrapSdkData<Config>(
        await this.client.config.get({
          responseStyle: "data",
          throwOnError: true,
        }),
      );
      if (current.small_model === desiredSmallModel) return;

      await this.client.config.update({
        body: {
          ...current,
          small_model: desiredSmallModel,
        },
        responseStyle: "data",
        throwOnError: true,
      });
    } catch {
      // Non-blocking: config sync should not prevent runtime startup.
    }
  }
}
