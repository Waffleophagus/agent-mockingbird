import type { ChatMessage } from "@/types/dashboard";

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
}

export type LocalMessageMeta = OptimisticUserMeta | PendingAssistantMeta;

export interface LocalChatMessage extends ChatMessage {
  uiMeta?: LocalMessageMeta;
}

export interface ActiveSend {
  requestId: string;
  sessionId: string;
  content: string;
}

export function relativeFromIso(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.floor(deltaMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
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
