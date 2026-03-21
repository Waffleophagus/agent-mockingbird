import { parentPort, workerData } from "node:worker_threads";

import type { CronConditionalModule, CronConditionalModuleContext } from "./types";
import { normalizeConditionalModuleResult } from "./utils";

interface ConditionalModuleWorkerData {
  absoluteModulePath: string;
  moduleUrl: string;
  ctx: CronConditionalModuleContext;
}

function readWorkerData(): ConditionalModuleWorkerData {
  const data = workerData as Partial<ConditionalModuleWorkerData> | undefined;
  if (!data?.absoluteModulePath || !data.moduleUrl || !data.ctx) {
    throw new Error("conditional module worker missing required workerData");
  }
  return data as ConditionalModuleWorkerData;
}

async function main() {
  if (!parentPort) {
    throw new Error("conditional module worker requires parentPort");
  }

  const { moduleUrl, ctx } = readWorkerData();
  const loaded = (await import(`${moduleUrl}?cronRun=${Date.now()}`)) as {
    default?: CronConditionalModule;
  };

  if (typeof loaded.default !== "function") {
    throw new Error("conditional module must export a default function");
  }

  parentPort.postMessage(normalizeConditionalModuleResult(await loaded.default(ctx)));
}

void main();
