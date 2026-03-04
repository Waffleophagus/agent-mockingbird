import { pathToFileURL } from "node:url";

import type { CronConditionalModule, CronConditionalModuleContext, CronHandlerResult } from "./types";

interface WorkerRequest {
  modulePath: string;
  context: CronConditionalModuleContext;
}

interface WorkerResponse {
  ok: boolean;
  result?: CronHandlerResult;
  error?: {
    message: string;
    stack?: string;
  };
}

function normalizeModuleResult(value: unknown): CronHandlerResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("conditional module must return an object");
  }
  const result = value as Record<string, unknown>;
  if (result.status !== "ok" && result.status !== "error") {
    throw new Error("conditional module result.status must be 'ok' or 'error'");
  }
  return value as CronHandlerResult;
}

async function run(request: WorkerRequest): Promise<CronHandlerResult> {
  if (!request.modulePath?.trim()) {
    throw new Error("conditional module path was empty");
  }
  const moduleUrl = `${pathToFileURL(request.modulePath).href}?cronRun=${Date.now()}`;
  const loaded = (await import(moduleUrl)) as {
    default?: CronConditionalModule;
  };
  if (typeof loaded.default !== "function") {
    throw new Error("conditional module must export a default function");
  }
  const output = await loaded.default(request.context);
  return normalizeModuleResult(output);
}

addEventListener("message", async event => {
  const request = event.data as WorkerRequest;
  try {
    const result = await run(request);
    const response: WorkerResponse = {
      ok: true,
      result,
    };
    postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      ok: false,
      error: {
        message: error instanceof Error ? error.message : "conditional module failed",
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
    postMessage(response);
  }
});
