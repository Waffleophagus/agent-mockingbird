import type {
  ChatMessage,
  SessionMessageCheckpoint,
  SessionSummary,
} from "@agent-mockingbird/contracts/dashboard";
import { MMKV } from "react-native-mmkv";

import type { LocalChatMessage } from "@/features/chat/chat-helpers";

const storage = new MMKV({
  id: "agent-mockingbird.mobile.chat-cache",
});

const SESSIONS_KEY = "sessions";
const LAST_APPLIED_SEQ_KEY = "lastAppliedSeq";

function safeParseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function sessionMessagesKey(sessionId: string) {
  return `session:${sessionId}:messages`;
}

function sessionCheckpointKey(sessionId: string) {
  return `session:${sessionId}:checkpoint`;
}

function stripUiState(messages: LocalChatMessage[]): ChatMessage[] {
  return messages.flatMap(message => {
    if (message.uiMeta) return [];
    const { uiMeta, ...persisted } = message;
    return [persisted];
  });
}

export function readCachedSessions(): SessionSummary[] {
  return safeParseJson<SessionSummary[]>(storage.getString(SESSIONS_KEY)) ?? [];
}

export function writeCachedSessions(sessions: SessionSummary[]) {
  storage.set(SESSIONS_KEY, JSON.stringify(sessions));
}

export function readCachedSessionMessages(sessionId: string): ChatMessage[] {
  return safeParseJson<ChatMessage[]>(storage.getString(sessionMessagesKey(sessionId))) ?? [];
}

export function writeCachedSessionMessages(sessionId: string, messages: LocalChatMessage[]) {
  storage.set(sessionMessagesKey(sessionId), JSON.stringify(stripUiState(messages)));
}

export function readCachedSessionCheckpoint(sessionId: string): SessionMessageCheckpoint | null {
  return safeParseJson<SessionMessageCheckpoint>(storage.getString(sessionCheckpointKey(sessionId)));
}

export function writeCachedSessionCheckpoint(sessionId: string, checkpoint: SessionMessageCheckpoint | null) {
  if (!checkpoint) {
    storage.delete(sessionCheckpointKey(sessionId));
    return;
  }

  storage.set(sessionCheckpointKey(sessionId), JSON.stringify(checkpoint));
}

export function readCachedLastAppliedSeq(): number {
  return storage.getNumber(LAST_APPLIED_SEQ_KEY) ?? 0;
}

export function writeCachedLastAppliedSeq(seq: number) {
  storage.set(LAST_APPLIED_SEQ_KEY, seq);
}
