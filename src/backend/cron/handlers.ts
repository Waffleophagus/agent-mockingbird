import type { CronHandler, CronHandlerResult } from "./types";
import { rememberMemory, syncMemoryIndex } from "../memory/service";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

const locationSyncHandler: CronHandler = async ctx => {
  const url = asString(ctx.payload.url);
  if (!url) {
    return {
      status: "error",
      summary: "location sync missing payload.url",
    };
  }

  const token = asString(ctx.payload.token);
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    return {
      status: "error",
      summary: `location sync request failed (${response.status})`,
      data: await response.text().catch(() => null),
    };
  }

  const body = asRecord(await response.json().catch(() => ({})));
  const locationText =
    asString(body.location) ??
    asString(body.state) ??
    asString(body.address) ??
    asString(ctx.payload.fallbackLocation) ??
    null;

  if (!locationText) {
    return {
      status: "error",
      summary: "location sync response did not include location text",
      data: body,
    };
  }

  await rememberMemory({
    type: "observation",
    source: "system",
    content: `Current user location: ${locationText}`,
    confidence: 0.95,
    entities: ["location"],
    topic: "presence",
  });

  return {
    status: "ok",
    summary: `location synced: ${locationText}`,
    data: {
      location: locationText,
    },
  };
};

const memoryMaintenanceHandler: CronHandler = async () => {
  await syncMemoryIndex();
  return {
    status: "ok",
    summary: "memory index synced",
  };
};

const marketPriceWatchHandler: CronHandler = async ctx => {
  const symbol = asString(ctx.payload.symbol) ?? "UNKNOWN";
  const current = asNumber(ctx.payload.currentPrice);
  const baseline = asNumber(ctx.payload.baselinePrice);
  const thresholdPct = asNumber(ctx.payload.thresholdPercent) ?? 3;

  if (current === null || baseline === null || baseline === 0) {
    return {
      status: "error",
      summary: "price watch requires payload.currentPrice and payload.baselinePrice",
    };
  }

  const changePct = ((current - baseline) / baseline) * 100;
  const absChangePct = Math.abs(changePct);
  const shouldInvoke = absChangePct >= thresholdPct;

  return {
    status: "ok",
    summary: `${symbol} moved ${changePct.toFixed(2)}%`,
    data: {
      symbol,
      currentPrice: current,
      baselinePrice: baseline,
      changePct,
      thresholdPct,
    },
    invokeAgent: {
      shouldInvoke,
      severity: absChangePct >= thresholdPct * 2 ? "critical" : "warn",
      prompt: `Assess ${symbol} price move: baseline ${baseline}, current ${current}, change ${changePct.toFixed(2)}%. Provide concise alert guidance.`,
      context: {
        symbol,
        currentPrice: current,
        baselinePrice: baseline,
        changePct,
        thresholdPct,
      },
    },
  };
};

const handlers: Record<string, CronHandler> = {
  "home_assistant.location_sync": locationSyncHandler,
  "memory.maintenance": memoryMaintenanceHandler,
  "market.price_watch": marketPriceWatchHandler,
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
