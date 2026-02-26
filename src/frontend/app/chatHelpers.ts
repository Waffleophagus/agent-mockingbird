import type { ChatMessage, ChatMessagePart } from "@/types/dashboard";

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
  status: "pending" | "failed";
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
  return merged;
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
