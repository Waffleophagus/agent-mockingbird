import type { MemoryRecordSource } from "../memory/types";

export function parseStringListBody(body: unknown, field: string): string[] | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>)[field];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    return null;
  }
  return value;
}

export function parseMemoryRememberBody(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const source = typeof value.source === "string" ? value.source.trim() : "user";
  const content = typeof value.content === "string" ? value.content.trim() : "";
  const sessionId = typeof value.sessionId === "string" ? value.sessionId.trim() : undefined;
  const topic = typeof value.topic === "string" ? value.topic.trim() : undefined;
  const ttl = typeof value.ttl === "number" ? value.ttl : undefined;
  const entities = Array.isArray(value.entities)
    ? value.entities.filter((item): item is string => typeof item === "string")
    : [];
  const supersedes = Array.isArray(value.supersedes)
    ? value.supersedes.filter((item): item is string => typeof item === "string")
    : [];
  const confidence = typeof value.confidence === "number" ? value.confidence : undefined;
  if (!content) return null;
  const allowedSources = ["user", "assistant", "system"] as const;
  if (!allowedSources.includes(source as MemoryRecordSource)) return null;
  return {
    source: source as MemoryRecordSource,
    content,
    entities,
    supersedes,
    confidence,
    sessionId: sessionId || undefined,
    topic: topic || undefined,
    ttl,
  };
}
