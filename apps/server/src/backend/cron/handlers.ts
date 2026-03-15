import type { CronHandler, CronHandlerResult } from "./types";
import {
  executeHeartbeat,
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  DEFAULT_HEARTBEAT_PROMPT,
} from "../heartbeat/service";
import type { HeartbeatConfig, HeartbeatJobPayload } from "../heartbeat/types";
import { syncMemoryIndex } from "../memory/service";

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

const memoryMaintenanceHandler: CronHandler = async () => {
  await syncMemoryIndex();
  return {
    status: "ok",
    summary: "memory index synced",
  };
};

const heartbeatCheckHandler: CronHandler = async ctx => {
  const payload = (ctx.payload ?? {}) as unknown as Partial<HeartbeatJobPayload>;
  const agentId = asString(payload.agentId);
  const sessionId = asString(payload.sessionId);

  if (!agentId || !sessionId) {
    return {
      status: "error",
      summary: "heartbeat.check requires agentId and sessionId in payload",
    };
  }

  const heartbeatConfig: HeartbeatConfig = {
    enabled: true,
    interval: "30m",
    prompt: asString(payload.prompt) ?? DEFAULT_HEARTBEAT_PROMPT,
    ackMaxChars:
      typeof payload.ackMaxChars === "number" && Number.isFinite(payload.ackMaxChars)
        ? Math.max(0, payload.ackMaxChars)
        : DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
    activeHours:
      payload.activeHours &&
      typeof payload.activeHours === "object" &&
      typeof payload.activeHours.start === "string" &&
      typeof payload.activeHours.end === "string" &&
      typeof payload.activeHours.timezone === "string"
        ? payload.activeHours
        : undefined,
  };

  const result = await executeHeartbeat(agentId, sessionId, heartbeatConfig);

  return {
    status: result.error ? "error" : "ok",
    summary: result.error
      ? result.error
      : result.suppressed
        ? result.response ?? (result.acknowledged ? "Heartbeat acknowledged (suppressed)" : "Heartbeat skipped")
        : result.response ?? "Heartbeat executed",
    data: {
      agentId,
      sessionId,
      acknowledged: result.acknowledged,
      skipped: result.skipped ?? false,
      suppressed: result.suppressed,
      response: result.response,
    },
  };
};

const handlers: Record<string, CronHandler> = {
  "memory.maintenance": memoryMaintenanceHandler,
  "heartbeat.check": heartbeatCheckHandler,
};

export function getCronHandler(key: string): CronHandler | null {
  return handlers[key] ?? null;
}

export function listCronHandlerKeys(): string[] {
  return Object.keys(handlers).sort();
}

export function normalizeHandlerResult(value: CronHandlerResult): CronHandlerResult {
  return value;
}
