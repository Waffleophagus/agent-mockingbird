import type {
  ChatMessage,
  ChatMessagePart,
  ChatRole,
  StreamdownRenderSnapshot,
} from "@agent-mockingbird/contracts/dashboard";

export interface LocalTextInputPart {
  type: "text";
  text: string;
}

export interface LocalFileInputPart {
  type: "file";
  mime: string;
  filename?: string;
  url: string;
}

export type LocalInputPart = LocalTextInputPart | LocalFileInputPart;

export interface OptimisticUserMeta {
  type: "optimistic-user";
  requestId: string;
}

export interface PendingAssistantMeta {
  type: "assistant-pending";
  requestId: string;
  status: "pending" | "queued" | "detached" | "failed";
  retryContent: string;
  retryParts?: LocalInputPart[];
  errorMessage?: string;
  runtimeMessageId?: string;
}

export type LocalMessageMeta = OptimisticUserMeta | PendingAssistantMeta;

export interface LocalChatMessage extends ChatMessage {
  uiMeta?: LocalMessageMeta;
}

export interface ActiveSend {
  requestId: string;
  sessionId: string;
  content: string;
  parts?: LocalInputPart[];
}

export function relativeFromIso(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.floor(deltaMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

const compactTimestampFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  month: "short",
  day: "2-digit",
});

export function formatCompactTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  const parts = compactTimestampFormatter.formatToParts(new Date(parsed));
  const hour = parts.find(part => part.type === "hour")?.value ?? "";
  const minute = parts.find(part => part.type === "minute")?.value ?? "";
  const month = (parts.find(part => part.type === "month")?.value ?? "").toUpperCase();
  const day = parts.find(part => part.type === "day")?.value ?? "";
  if (!hour || !minute || !month || !day) return "";
  return `${hour}${minute} ${month} ${day}`;
}

export function formatElapsedFrom(startIso: string, endIso: string): string {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  const deltaSeconds = (end - start) / 1_000;
  return `+${deltaSeconds.toFixed(1)}s`;
}

const MEMORY_USER_MESSAGE_BLOCK_RE = /\[User Message\]\s*([\s\S]*?)\s*\[\/User Message\]/i;

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

export interface BackgroundAnnouncement {
  runId: string;
  summary: string;
  childSessionId: string;
  raw: string;
}

const BACKGROUND_ANNOUNCEMENT_RE = /\[Background ([^\]]+)\]\s*([\s\S]*?)\nChild session:\s*([^\s\n]+)/g;

export function extractBackgroundAnnouncements(content: string): {
  announcements: BackgroundAnnouncement[];
  remainingContent: string;
} {
  if (!content.includes("[Background ") || !content.includes("Child session:")) {
    return {
      announcements: [],
      remainingContent: content,
    };
  }

  const announcements: BackgroundAnnouncement[] = [];
  let remainingContent = content;

  for (const match of content.matchAll(BACKGROUND_ANNOUNCEMENT_RE)) {
    const raw = match[0];
    const runId = match[1]?.trim() ?? "";
    const summary = match[2]?.trim() ?? "";
    const childSessionId = match[3]?.trim() ?? "";
    if (!raw || !runId || !childSessionId) continue;
    announcements.push({
      runId,
      summary,
      childSessionId,
      raw,
    });
    remainingContent = remainingContent.replace(raw, "");
  }

  return {
    announcements,
    remainingContent: remainingContent.replace(/\n{3,}/g, "\n\n").trim(),
  };
}

export function normalizeListInput(value: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    list.push(trimmed);
  }
  return list;
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
      uiMeta: existing.uiMeta,
    };
  }
  return merged.sort((left, right) => {
    const leftTs = Date.parse(left.at);
    const rightTs = Date.parse(right.at);
    const normalizedLeftTs = Number.isFinite(leftTs) ? leftTs : Number.MAX_SAFE_INTEGER;
    const normalizedRightTs = Number.isFinite(rightTs) ? rightTs : Number.MAX_SAFE_INTEGER;
    if (normalizedLeftTs !== normalizedRightTs) {
      return normalizedLeftTs - normalizedRightTs;
    }
    if (left.role !== right.role) {
      if (left.role === "user") return -1;
      if (right.role === "user") return 1;
    }
    return left.id.localeCompare(right.id);
  });
}

function findPendingAssistant(messages: LocalChatMessage[], runtimeMessageId?: string): number {
  return messages.findIndex(message => {
    if (message.uiMeta?.type !== "assistant-pending") return false;
    if (runtimeMessageId) {
      return message.uiMeta.runtimeMessageId === runtimeMessageId;
    }
    return true;
  });
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

export function normalizeRequestError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Request timed out.";
  }
  if (error instanceof TypeError) {
    return "Network error while sending request.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Request failed.";
}

export function upsertChatMessagePart(
  parts: ChatMessagePart[] | undefined,
  part: ChatMessagePart,
): ChatMessagePart[] {
  const next = Array.isArray(parts) ? [...parts] : [];
  const index = next.findIndex(existing => existing.id === part.id);
  if (index === -1) {
    next.push(part);
    return next;
  }
  next[index] = part;
  return next;
}
