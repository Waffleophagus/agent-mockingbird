import type {
  ChatMessage,
  ChatMessagePart,
  ChatRole,
  PermissionPromptRequest,
  QuestionPromptRequest,
  SessionSummary,
  StreamdownCodeLineHighlight,
  StreamdownRenderSnapshot,
} from "@agent-mockingbird/contracts/dashboard";

export interface OptimisticUserMeta {
  type: "optimistic-user";
  requestId: string;
}

export interface PendingAssistantMeta {
  type: "assistant-pending";
  requestId: string;
  status: "pending" | "failed";
  retryContent: string;
  errorMessage?: string;
  runtimeMessageId?: string;
}

export type LocalMessageMeta = OptimisticUserMeta | PendingAssistantMeta;

export interface LocalChatMessage extends ChatMessage {
  liveCodeHighlights?: StreamdownCodeLineHighlight[];
  uiMeta?: LocalMessageMeta;
}

export interface MessageTurn {
  id: string;
  user?: LocalChatMessage;
  assistantMessages: LocalChatMessage[];
}

const compactTimestampFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  month: "short",
  day: "2-digit",
});

const MEMORY_USER_MESSAGE_BLOCK_RE = /\[User Message\]\s*([\s\S]*?)\s*\[\/User Message\]/i;
const NORMALIZED_WHITESPACE_RE = /\s+/g;

export function formatCompactTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  const parts = compactTimestampFormatter.formatToParts(new Date(parsed));
  const hour = parts.find(part => part.type === "hour")?.value ?? "";
  const minute = parts.find(part => part.type === "minute")?.value ?? "";
  const month = (parts.find(part => part.type === "month")?.value ?? "").toUpperCase();
  const day = parts.find(part => part.type === "day")?.value ?? "";
  if (!hour || !minute || !month || !day) return "";
  return `${hour}:${minute} ${month} ${day}`;
}

export function relativeFromIso(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.floor(deltaMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function sanitizeMessageContentForDisplay(role: ChatRole, content: string): string {
  if (role !== "user") return content;
  if (!content.includes("[Memory Context]") && !content.includes("[User Message]")) {
    return content;
  }
  const matched = content.match(MEMORY_USER_MESSAGE_BLOCK_RE);
  const extracted = matched?.[1]?.trim();
  if (!extracted) return content;
  return extracted;
}

function normalizeComparableText(content: string): string {
  return content
    .replace(NORMALIZED_WHITESPACE_RE, " ")
    .trim()
    .toLowerCase();
}

export function mergeMessages(current: LocalChatMessage[], incoming: ChatMessage[]): LocalChatMessage[] {
  if (incoming.length === 0) return current;
  const merged = [...current];
  for (const message of incoming) {
    const index = merged.findIndex(existing => existing.id === message.id);
    if (index === -1) {
      merged.push(message);
      continue;
    }
    const existing = merged[index];
    if (!existing) continue;
    merged[index] = {
      ...existing,
      ...message,
      liveCodeHighlights: existing.liveCodeHighlights,
      uiMeta: existing.uiMeta,
    };
  }
  return sortMessages(merged);
}

export function sortMessages(messages: LocalChatMessage[]): LocalChatMessage[] {
  return [...messages].sort((left, right) => {
    const leftTs = Date.parse(left.at);
    const rightTs = Date.parse(right.at);
    const normalizedLeftTs = Number.isFinite(leftTs) ? leftTs : Number.MAX_SAFE_INTEGER;
    const normalizedRightTs = Number.isFinite(rightTs) ? rightTs : Number.MAX_SAFE_INTEGER;
    if (normalizedLeftTs !== normalizedRightTs) return normalizedLeftTs - normalizedRightTs;
    if (left.role !== right.role) return left.role === "user" ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
}

export function upsertSessionList(current: SessionSummary[], nextSession: SessionSummary): SessionSummary[] {
  const next = [...current];
  const index = next.findIndex(item => item.id === nextSession.id);
  if (index === -1) {
    next.push(nextSession);
  } else {
    next[index] = nextSession;
  }
  return sortSessionsByActivity(next);
}

export function sortSessionsByActivity(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((left, right) => {
    const leftTs = Date.parse(left.lastActiveAt);
    const rightTs = Date.parse(right.lastActiveAt);
    const normalizedLeftTs = Number.isFinite(leftTs) ? leftTs : 0;
    const normalizedRightTs = Number.isFinite(rightTs) ? rightTs : 0;
    if (normalizedLeftTs !== normalizedRightTs) return normalizedRightTs - normalizedLeftTs;
    return left.title.localeCompare(right.title);
  });
}

export function upsertChatMessagePart(parts: ChatMessagePart[] | undefined, part: ChatMessagePart): ChatMessagePart[] {
  const next = Array.isArray(parts) ? [...parts] : [];
  const index = next.findIndex(existing => existing.id === part.id);
  if (index === -1) {
    next.push(part);
    return next;
  }
  next[index] = {
    ...next[index],
    ...part,
  };
  return next;
}

export function buildTurns(messages: LocalChatMessage[]): MessageTurn[] {
  const turns: MessageTurn[] = [];
  let current: MessageTurn | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      current = {
        id: message.id,
        user: message,
        assistantMessages: [],
      };
      turns.push(current);
      continue;
    }

    if (!current) {
      current = {
        id: message.id,
        assistantMessages: [message],
      };
      turns.push(current);
      continue;
    }

    current.assistantMessages.push(message);
  }

  return turns;
}

export function appendOptimisticRequest(messages: LocalChatMessage[], requestId: string, content: string): LocalChatMessage[] {
  const createdAt = new Date().toISOString();
  return sortMessages([
    ...messages,
    {
      id: `local-user-${requestId}`,
      role: "user",
      content,
      at: createdAt,
      uiMeta: {
        type: "optimistic-user",
        requestId,
      },
    },
    {
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
      },
    },
  ]);
}

function findPendingAssistant(messages: LocalChatMessage[], messageId?: string) {
  return messages.findIndex(message => {
    if (message.uiMeta?.type !== "assistant-pending") return false;
    if (!messageId) return true;
    return message.uiMeta.runtimeMessageId === messageId;
  });
}

export function markPendingAssistantFailed(
  messages: LocalChatMessage[],
  requestId: string,
  errorMessage: string,
): LocalChatMessage[] {
  return messages.map(message => {
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
  });
}

export function removeRequestMessages(messages: LocalChatMessage[], requestId: string): LocalChatMessage[] {
  return messages.filter(message => message.uiMeta?.requestId !== requestId);
}

function findMatchingOptimisticUser(messages: LocalChatMessage[], message: ChatMessage) {
  if (message.role !== "user") return -1;
  return messages.findIndex(candidate => {
    if (candidate.uiMeta?.type !== "optimistic-user") return false;
    return normalizeComparableText(candidate.content) === normalizeComparableText(message.content);
  });
}

export function reconcileIncomingMessage(messages: LocalChatMessage[], message: ChatMessage): LocalChatMessage[] {
  const optimisticUserIndex = findMatchingOptimisticUser(messages, message);
  const pendingIndexByRuntimeId = findPendingAssistant(messages, message.id);
  const pendingIndex = pendingIndexByRuntimeId >= 0 ? pendingIndexByRuntimeId : findPendingAssistant(messages);
  const pendingMessage =
    message.role === "assistant" && pendingIndex >= 0 ? messages[pendingIndex] : undefined;
  const nextMessages =
    message.role === "assistant" && pendingIndex >= 0
      ? messages.filter((_, index) => index !== pendingIndex)
      : optimisticUserIndex >= 0
        ? messages.filter((_, index) => index !== optimisticUserIndex)
        : messages;
  const nextMessage =
    pendingMessage?.uiMeta?.type === "assistant-pending"
      ? {
          ...message,
          uiMeta: {
            ...pendingMessage.uiMeta,
            runtimeMessageId: message.id,
          },
        }
      : message;
  return mergeMessages(nextMessages, [nextMessage]);
}

export function clearPendingAssistantUiMeta(messages: LocalChatMessage[]): LocalChatMessage[] {
  let changed = false;
  const nextMessages = messages.map(message => {
    if (message.uiMeta?.type !== "assistant-pending") {
      return message;
    }
    changed = true;
    return {
      ...message,
      uiMeta: undefined,
    };
  });
  return changed ? nextMessages : messages;
}

export function applyMessageDelta(
  messages: LocalChatMessage[],
  messageId: string,
  text: string,
  mode: "append" | "replace",
): LocalChatMessage[] {
  const next = [...messages];
  const targetIndex = next.findIndex(message => message.id === messageId);
  const pendingIndex = targetIndex >= 0 ? -1 : findPendingAssistant(next, messageId);
  const fallbackPendingIndex = targetIndex >= 0 || pendingIndex >= 0 ? -1 : findPendingAssistant(next);
  const resolvedIndex = targetIndex >= 0 ? targetIndex : pendingIndex >= 0 ? pendingIndex : fallbackPendingIndex;
  if (resolvedIndex < 0) return messages;

  const target = next[resolvedIndex];
  if (!target) return messages;

  const nextContent = mode === "replace" ? text : `${target.content}${text}`;
  const nextMeta =
    target.uiMeta?.type === "assistant-pending"
      ? {
          ...target.uiMeta,
          runtimeMessageId: messageId,
        }
      : target.uiMeta;

  next[resolvedIndex] = {
    ...target,
    content: nextContent,
    liveCodeHighlights:
      mode === "replace" ? undefined : target.liveCodeHighlights,
    uiMeta: nextMeta,
  };
  return next;
}

export function applyMessagePart(
  messages: LocalChatMessage[],
  messageId: string,
  part: ChatMessagePart,
): LocalChatMessage[] {
  const next = [...messages];
  const targetIndex = next.findIndex(message => message.id === messageId);
  const pendingIndex = targetIndex >= 0 ? -1 : findPendingAssistant(next, messageId);
  const fallbackPendingIndex = targetIndex >= 0 || pendingIndex >= 0 ? -1 : findPendingAssistant(next);
  const resolvedIndex = targetIndex >= 0 ? targetIndex : pendingIndex >= 0 ? pendingIndex : fallbackPendingIndex;
  if (resolvedIndex < 0) return messages;

  const target = next[resolvedIndex];
  if (!target) return messages;

  const nextMeta =
    target.uiMeta?.type === "assistant-pending"
      ? {
          ...target.uiMeta,
          runtimeMessageId: messageId,
        }
      : target.uiMeta;

  next[resolvedIndex] = {
    ...target,
    parts: upsertChatMessagePart(target.parts, part),
    uiMeta: nextMeta,
  };
  return next;
}

export function applyMessageRenderSnapshot(
  messages: LocalChatMessage[],
  messageId: string,
  renderSnapshot: StreamdownRenderSnapshot,
): LocalChatMessage[] {
  const next = [...messages];
  const targetIndex = next.findIndex(message => message.id === messageId);
  const pendingIndex = targetIndex >= 0 ? -1 : findPendingAssistant(next, messageId);
  const fallbackPendingIndex = targetIndex >= 0 || pendingIndex >= 0 ? -1 : findPendingAssistant(next);
  const resolvedIndex = targetIndex >= 0 ? targetIndex : pendingIndex >= 0 ? pendingIndex : fallbackPendingIndex;
  if (resolvedIndex < 0) return messages;

  const target = next[resolvedIndex];
  if (!target) return messages;

  const nextMeta =
    target.uiMeta?.type === "assistant-pending"
      ? {
          ...target.uiMeta,
          runtimeMessageId: messageId,
        }
      : target.uiMeta;

  next[resolvedIndex] = {
    ...target,
    renderSnapshot,
    uiMeta: nextMeta,
  };
  return next;
}

export function applyMessageCodeHighlight(
  messages: LocalChatMessage[],
  messageId: string,
  highlight: StreamdownCodeLineHighlight,
): LocalChatMessage[] {
  const next = [...messages];
  const targetIndex = next.findIndex(message => message.id === messageId);
  const pendingIndex = targetIndex >= 0 ? -1 : findPendingAssistant(next, messageId);
  const fallbackPendingIndex = targetIndex >= 0 || pendingIndex >= 0 ? -1 : findPendingAssistant(next);
  const resolvedIndex = targetIndex >= 0 ? targetIndex : pendingIndex >= 0 ? pendingIndex : fallbackPendingIndex;
  if (resolvedIndex < 0) return messages;

  const target = next[resolvedIndex];
  if (!target) return messages;

  const nextMeta =
    target.uiMeta?.type === "assistant-pending"
      ? {
          ...target.uiMeta,
          runtimeMessageId: messageId,
        }
      : target.uiMeta;

  const currentHighlights = target.liveCodeHighlights ?? [];
  const existingIndex = currentHighlights.findIndex(
    item =>
      item.blockIndex === highlight.blockIndex &&
      item.lineIndex === highlight.lineIndex,
  );
  const nextHighlights =
    existingIndex === -1
      ? [...currentHighlights, highlight]
      : currentHighlights.map((item, index) =>
          index === existingIndex ? highlight : item,
        );

  next[resolvedIndex] = {
    ...target,
    liveCodeHighlights: nextHighlights.sort((left, right) => {
      if (left.blockIndex !== right.blockIndex) {
        return left.blockIndex - right.blockIndex;
      }
      return left.lineIndex - right.lineIndex;
    }),
    uiMeta: nextMeta,
  };
  return next;
}

export function normalizeRequestError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Request failed.";
}

export function groupPromptRequests<T extends PermissionPromptRequest | QuestionPromptRequest>(
  items: T[] | undefined,
): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};
  for (const item of items ?? []) {
    if (!item.sessionId || !item.id) continue;
    if (!grouped[item.sessionId]) grouped[item.sessionId] = [];
    grouped[item.sessionId]?.push(item);
  }
  for (const value of Object.values(grouped)) {
    value.sort((left, right) => left.id.localeCompare(right.id));
  }
  return grouped;
}

export function removePromptById<T extends { id: string }>(items: T[] | undefined, id: string): T[] {
  return (items ?? []).filter(item => item.id !== id);
}
