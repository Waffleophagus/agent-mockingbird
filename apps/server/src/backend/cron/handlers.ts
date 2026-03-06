import type { CronHandler, CronHandlerResult } from "./types";
import { getConfigSnapshot } from "../config/service";
import { executeHeartbeat } from "../heartbeat/service";
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
  const agentId = asString(ctx.payload.agentId);
  const sessionId = asString(ctx.payload.sessionId);

  if (!agentId || !sessionId) {
    return {
      status: "error",
      summary: "heartbeat.check requires agentId and sessionId in payload",
    };
  }

  const config = getConfigSnapshot();
  const agentType = config.config.ui.agentTypes.find(a => a.id === agentId);
  const heartbeatConfig = agentType?.heartbeat;

  if (!heartbeatConfig || !heartbeatConfig.enabled) {
    return {
      status: "ok",
      summary: `Heartbeat disabled for agent ${agentId}`,
      data: { agentId, sessionId, disabled: true },
    };
  }

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
