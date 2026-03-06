import { signalCheck, signalRpcRequest, streamSignalEvents } from "./client";
import { normalizeSignalId, normalizeSignalMentionRegexes, parseSignalTarget, splitSignalText } from "./format";
import { getConfigSnapshot } from "../../config/service";
import {
  createSignalChannelStatusUpdatedEvent,
  createSignalErrorEvent,
  createSignalMessageReceivedEvent,
  createSignalMessageSentEvent,
  createSignalPairingRequestedEvent,
  type RuntimeEvent,
} from "../../contracts/events";
import type { RuntimeEngine , RuntimeInputPart } from "../../contracts/runtime";
import {
  approveChannelPairingRequest,
  ensureSessionForChannelConversation,
  listChannelPairingRequests,
  listChannelAllowlistEntries,
  recordChannelInboundEventIfFirstSeen,
  rejectChannelPairingRequest,
  upsertChannelPairingRequest,
  type ChannelAllowlistEntryRecord,
  type ChannelPairingRequestRecord,
} from "../../db/repository";
import { RuntimeSessionBusyError, RuntimeSessionQueuedError } from "../../runtime";

const CHANNEL_ID = "signal";
const LOOP_IDLE_MS = 5_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface SignalEnvelope {
  source?: string;
  sourceName?: string;
  sourceUuid?: string;
  timestamp?: number;
  dataMessage?: {
    message?: string;
    attachments?: Array<{
      contentType?: string;
      mimeType?: string;
      filename?: string;
      fileName?: string;
      size?: number;
      id?: string;
      url?: string;
      remoteUrl?: string;
      uri?: string;
    }>;
    mentions?: Array<{ uuid?: string; number?: string; start?: number; length?: number }>;
    groupInfo?: {
      groupId?: string;
      groupName?: string;
    };
  };
}

interface SignalReceivePayload {
  envelope?: SignalEnvelope;
}

export interface SignalChannelStatus {
  running: boolean;
  enabled: boolean;
  connected: boolean;
  baseUrl: string;
  account: string | null;
  lastEventAt: string | null;
  lastError: string | null;
}

function normalizeSenderFromEnvelope(envelope: SignalEnvelope): string {
  const uuid = envelope.sourceUuid?.trim();
  if (uuid) {
    return normalizeSignalId(`uuid:${uuid}`);
  }
  const source = envelope.source?.trim();
  if (!source) return "";
  return normalizeSignalId(source);
}

function renderSignalMentions(message: string, mentions?: Array<{ uuid?: string; number?: string; start?: number; length?: number }>) {
  if (!message || !mentions?.length) return message;
  let normalized = message;
  const sorted = mentions
    .filter(mention => (mention.uuid || mention.number) && Number.isFinite(mention.start) && Number.isFinite(mention.length))
    .sort((left, right) => (Number(right.start) || 0) - (Number(left.start) || 0));
  for (const mention of sorted) {
    const id = mention.uuid ?? mention.number;
    if (!id) continue;
    const start = Math.max(0, Math.floor(mention.start ?? 0));
    const length = Math.max(1, Math.floor(mention.length ?? 1));
    const end = Math.min(normalized.length, start + length);
    normalized = `${normalized.slice(0, start)}@${id}${normalized.slice(end)}`;
  }
  return normalized;
}

function buildPairingMessage(code: string) {
  return `Pairing required. Reply is blocked until approved.\nCode: ${code}\nApprove in Agent Mockingbird API or dashboard.`;
}

function messageIncludesMention(content: string, mentionRegexes: Array<RegExp>) {
  if (!content.trim()) return false;
  if (mentionRegexes.length === 0) return false;
  return mentionRegexes.some(pattern => pattern.test(content));
}

function toSignalAttachmentParts(attachments: Array<unknown> | undefined): RuntimeInputPart[] {
  if (!attachments?.length) return [];
  const parts: RuntimeInputPart[] = [];
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object") continue;
    const record = attachment as Record<string, unknown>;
    const mime = String(record.contentType ?? record.mimeType ?? "").trim();
    const url = String(record.url ?? record.remoteUrl ?? record.uri ?? "").trim();
    const filename = String(record.filename ?? record.fileName ?? "").trim();
    if (!mime) continue;
    if (url) {
      parts.push({
        type: "file",
        mime,
        url,
        filename: filename || undefined,
      });
      continue;
    }
    const label = filename || `${mime} attachment`;
    const size = typeof record.size === "number" && Number.isFinite(record.size) ? record.size : null;
    const sizeSuffix = size !== null ? ` (${size} bytes)` : "";
    parts.push({
      type: "text",
      text: `[Signal attachment: ${label}${sizeSuffix}]`,
    });
  }
  return parts;
}

export class SignalChannelService {
  private running = false;
  private connected = false;
  private lastEventAt: string | null = null;
  private lastError: string | null = null;
  private loopAbortController: AbortController | null = null;
  private backoffMs = RECONNECT_MIN_MS;
  private listeners = new Set<(event: RuntimeEvent) => void>();

  constructor(private runtime: RuntimeEngine) {}

  start() {
    if (this.running) return;
    this.running = true;
    void this.runLoop();
  }

  stop() {
    this.running = false;
    this.loopAbortController?.abort();
    this.loopAbortController = null;
    this.connected = false;
    this.publishStatus();
  }

  subscribe(onEvent: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(onEvent);
    return () => {
      this.listeners.delete(onEvent);
    };
  }

  getStatus(): SignalChannelStatus {
    const signalConfig = getConfigSnapshot().config.runtime.channels.signal;
    return {
      running: this.running,
      enabled: signalConfig.enabled,
      connected: this.connected,
      baseUrl: signalConfig.httpUrl,
      account: signalConfig.account,
      lastEventAt: this.lastEventAt,
      lastError: this.lastError,
    };
  }

  listPairingRequests(): Array<ChannelPairingRequestRecord> {
    return listChannelPairingRequests(CHANNEL_ID);
  }

  listStoredAllowlist(): Array<ChannelAllowlistEntryRecord> {
    return listChannelAllowlistEntries(CHANNEL_ID);
  }

  approvePairing(input: { code?: string; senderId?: string }) {
    return approveChannelPairingRequest({
      channel: CHANNEL_ID,
      code: input.code,
      senderId: input.senderId,
      source: "pairing",
    });
  }

  rejectPairing(input: { code?: string; senderId?: string }) {
    return rejectChannelPairingRequest({
      channel: CHANNEL_ID,
      code: input.code,
      senderId: input.senderId,
    });
  }

  private publish(event: RuntimeEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private publishStatus() {
    const status = this.getStatus();
    this.publish(
      createSignalChannelStatusUpdatedEvent(
        {
          connected: status.connected,
          baseUrl: status.baseUrl,
          account: status.account,
          lastEventAt: status.lastEventAt,
          lastError: status.lastError,
        },
        "runtime",
      ),
    );
  }

  private reportError(message: string, detail?: string) {
    this.lastError = detail ? `${message}: ${detail}` : message;
    this.publish(createSignalErrorEvent({ message, detail }, "runtime"));
    this.publishStatus();
  }

  private async runLoop() {
    while (this.running) {
      const signalConfig = getConfigSnapshot().config.runtime.channels.signal;
      if (!signalConfig.enabled) {
        this.connected = false;
        this.publishStatus();
        await Bun.sleep(LOOP_IDLE_MS);
        continue;
      }

      const health = await signalCheck(signalConfig.httpUrl, 2_000);
      if (!health.ok) {
        this.connected = false;
        this.reportError("Signal daemon health check failed", health.error ?? undefined);
        await Bun.sleep(this.backoffMs);
        this.backoffMs = Math.min(RECONNECT_MAX_MS, this.backoffMs * 2);
        continue;
      }

      this.loopAbortController = new AbortController();
      try {
        this.connected = true;
        this.lastError = null;
        this.publishStatus();
        await streamSignalEvents({
          baseUrl: signalConfig.httpUrl,
          account: signalConfig.account,
          signal: this.loopAbortController.signal,
          onEvent: event => {
            void this.handleEvent(event);
          },
        });
      } catch (error) {
        if (!this.running) break;
        this.connected = false;
        this.reportError("Signal stream disconnected", error instanceof Error ? error.message : String(error));
      } finally {
        this.loopAbortController = null;
      }
      await Bun.sleep(this.backoffMs);
      this.backoffMs = Math.min(RECONNECT_MAX_MS, this.backoffMs * 2);
    }
  }

  private async handleEvent(event: { event?: string; data?: string }) {
    if (event.event !== "receive" || !event.data) return;
    this.backoffMs = RECONNECT_MIN_MS;
    this.lastEventAt = new Date().toISOString();
    this.publishStatus();

    let payload: SignalReceivePayload;
    try {
      payload = JSON.parse(event.data) as SignalReceivePayload;
    } catch {
      return;
    }
    const envelope = payload.envelope;
    if (!envelope?.dataMessage) return;

    const signalConfig = getConfigSnapshot().config.runtime.channels.signal;
    const senderId = normalizeSenderFromEnvelope(envelope);
    if (!senderId) return;

    const configuredAccount = signalConfig.account?.trim() ?? null;
    if (configuredAccount && normalizeSignalId(configuredAccount) === senderId) {
      return;
    }

    const groupId = envelope.dataMessage.groupInfo?.groupId?.trim() || null;
    const isGroup = Boolean(groupId);
    const rawContent = envelope.dataMessage.message ?? "";
    const content = renderSignalMentions(rawContent, envelope.dataMessage.mentions).trim();
    const attachmentParts = toSignalAttachmentParts(envelope.dataMessage.attachments);
    if (!content && attachmentParts.length === 0) return;

    const dedupeKey = `${senderId}|${groupId ?? "dm"}|${envelope.timestamp ?? 0}|${content}|${attachmentParts.length}`;
    if (!recordChannelInboundEventIfFirstSeen({ channel: CHANNEL_ID, eventId: dedupeKey })) {
      return;
    }

    const configuredAllow = new Set(signalConfig.allowFrom.map(entry => normalizeSignalId(entry)));
    const pairedAllow = new Set(this.listStoredAllowlist().map(entry => normalizeSignalId(entry.senderId)));
    const dmAllowed = configuredAllow.has("*") || configuredAllow.has(senderId) || pairedAllow.has(senderId);

    if (!isGroup) {
      if (signalConfig.dmPolicy === "disabled") return;
      if (signalConfig.dmPolicy === "allowlist" && !dmAllowed) return;
      if (signalConfig.dmPolicy === "pairing" && !dmAllowed) {
        const pairing = upsertChannelPairingRequest({
          channel: CHANNEL_ID,
          senderId,
          ttlMs: signalConfig.pairing.ttlMs,
          maxPending: signalConfig.pairing.maxPending,
          meta: {
            name: envelope.sourceName ?? "",
          },
        });
        if (pairing.created) {
          this.publish(
            createSignalPairingRequestedEvent(
              {
                senderId,
                code: pairing.code,
                expiresAt: pairing.expiresAt,
              },
              "runtime",
            ),
          );
        }
        await this.sendText(`signal:${senderId}`, buildPairingMessage(pairing.code), signalConfig.httpUrl, configuredAccount);
        return;
      }
      if (signalConfig.dmPolicy === "open" && !configuredAllow.has("*")) {
        return;
      }
    }

    if (isGroup) {
      if (signalConfig.groupPolicy === "disabled") return;
      const effectiveGroupAllow = signalConfig.groupAllowFrom.length ? signalConfig.groupAllowFrom : signalConfig.allowFrom;
      const normalizedGroupAllow = new Set(effectiveGroupAllow.map(entry => normalizeSignalId(entry)));
      if (signalConfig.groupPolicy === "allowlist") {
        const groupAllowed = normalizedGroupAllow.has("*") || normalizedGroupAllow.has(senderId) || pairedAllow.has(senderId);
        if (!groupAllowed) return;
      }
    }

    const groupConfig = (groupId && signalConfig.groups[groupId]) || signalConfig.groups["*"] || {};
    const requireMention = typeof groupConfig.requireMention === "boolean" ? groupConfig.requireMention : true;
    const activation = groupConfig.activation ?? signalConfig.groupActivationDefault;
    const mentionRegexes = normalizeSignalMentionRegexes(signalConfig.mentionPatterns);
    const mentioned = messageIncludesMention(content, mentionRegexes);
    if (isGroup && activation === "mention" && requireMention && mentionRegexes.length > 0 && !mentioned) {
      return;
    }

    const conversationKey = isGroup ? `signal:group:${groupId}` : `signal:dm:${senderId}`;
    const target = isGroup ? `group:${groupId}` : senderId;
    const session = ensureSessionForChannelConversation({
      channel: CHANNEL_ID,
      conversationKey,
      lastTarget: target,
      title: isGroup ? `Signal Group ${groupId}` : `Signal ${envelope.sourceName?.trim() || senderId}`,
    });
    if (!session) return;

    this.publish(
      createSignalMessageReceivedEvent(
        {
          senderId,
          groupId,
          sessionId: session.id,
        },
        "runtime",
      ),
    );

    const promptContent =
      isGroup && activation === "always"
        ? `${content}\n\nOnly reply if useful in this group context. If not useful, output exactly NO_REPLY.`
        : content;
    const promptParts: RuntimeInputPart[] = [];
    if (promptContent.trim()) {
      promptParts.push({
        type: "text",
        text: promptContent,
      });
    }
    promptParts.push(...attachmentParts);

    let ack;
    try {
      ack = await this.runtime.sendUserMessage({
        sessionId: session.id,
        content: promptContent,
        parts: promptParts,
        metadata: {
          channel: CHANNEL_ID,
          senderId,
          groupId,
          mentioned,
          activation,
        },
      });
    } catch (error) {
      if (error instanceof RuntimeSessionBusyError || error instanceof RuntimeSessionQueuedError) {
        return;
      }
      this.reportError("Signal inbound runtime call failed", error instanceof Error ? error.message : String(error));
      return;
    }

    const assistantMessage = [...ack.messages].reverse().find(message => message.role === "assistant");
    const replyText = assistantMessage?.content?.trim();
    if (!replyText) return;
    if (replyText === "NO_REPLY") return;

    await this.sendText(target, replyText, signalConfig.httpUrl, configuredAccount, signalConfig.textChunkLimit, signalConfig.chunkMode);
    this.publish(
      createSignalMessageSentEvent(
        {
          target,
          sessionId: session.id,
        },
        "runtime",
      ),
    );
  }

  private async sendText(
    to: string,
    text: string,
    baseUrl: string,
    account: string | null,
    limit = 4_000,
    mode: "length" | "newline" = "length",
  ) {
    const target = parseSignalTarget(to);
    for (const chunk of splitSignalText({ text, limit, mode })) {
      const params: Record<string, unknown> = {
        message: chunk,
      };
      if (account?.trim()) {
        params.account = account.trim();
      }
      if (target.type === "group") {
        params.groupId = target.groupId;
      } else {
        params.recipient = [target.recipient];
      }
      await signalRpcRequest("send", params, { baseUrl });
    }
  }
}
