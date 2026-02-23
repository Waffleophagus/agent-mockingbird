import { serve } from "bun";

import { ensureConfigFile, getConfigSnapshot } from "./backend/config/service";
import { createHeartbeatUpdatedEvent, createUsageUpdatedEvent } from "./backend/contracts/events";
import { CronService } from "./backend/cron/service";
import "./backend/db/migrate";
import {
  ensureSeedData,
  getHeartbeatSnapshot,
  getUsageSnapshot,
  recordHeartbeat,
} from "./backend/db/repository";
import { env } from "./backend/env";
import { createApiRoutes } from "./backend/http/routes";
import { createRuntimeEventStream } from "./backend/http/sse";
import { initializeMemory } from "./backend/memory/service";
import { initLaneQueue, getLaneQueue } from "./backend/queue/service";
import { RunService } from "./backend/run/service";
import { createRuntime, getRuntimeStartupInfo } from "./backend/runtime";
import { SignalChannelService } from "./backend/channels/signal/service";
import index from "./index.html";

ensureSeedData();
ensureConfigFile();
const configSnapshot = getConfigSnapshot();

const queueConfig = configSnapshot.config.runtime.queue;
const laneQueue = initLaneQueue({
  enabled: queueConfig.enabled,
  defaultMode: queueConfig.defaultMode,
  maxDepth: queueConfig.maxDepth,
  coalesceDebounceMs: queueConfig.coalesceDebounceMs,
});

const runtime = createRuntime();

laneQueue.setDrainHandler(async (sessionId, messages, _mode) => {
  if (messages.length === 0) return;
  const msg = messages[0];
  if (!msg) return;
  try {
    await runtime.sendUserMessage({
      sessionId,
      content: msg.content,
      agent: msg.agent,
      metadata: msg.metadata,
    });
  } catch (err) {
    console.error("Queue drain handler error:", err);
  }
});

const cronService = new CronService(runtime);
const runService = new RunService(runtime);
const signalService = new SignalChannelService(runtime);
const runtimeInfo = getRuntimeStartupInfo();
const eventStream = createRuntimeEventStream({
  getHeartbeatSnapshot,
  getUsageSnapshot,
});

if (env.NODE_ENV === "production" && !runtimeInfo.opencode.directoryConfigured) {
  console.warn(
    "[startup] WAFFLEBOT_OPENCODE_DIRECTORY is not configured. OpenCode config visibility may differ across workspaces.",
  );
}

void initializeMemory().catch(() => {
  // Memory startup should not block server boot.
});

runtime.subscribe(event => {
  eventStream.publish(event);
});
signalService.subscribe(event => {
  eventStream.publish(event);
});
cronService.start();
runService.start();
signalService.start();

const heartbeatTimer = setInterval(() => {
  const heartbeat = recordHeartbeat("scheduler");
  eventStream.publish(createHeartbeatUpdatedEvent(heartbeat, "scheduler"));
  eventStream.publish(createUsageUpdatedEvent(getUsageSnapshot(), "scheduler"));
}, 12_000);

const server = serve({
  idleTimeout: 120,
  routes: {
    "/*": index,
    ...createApiRoutes({
      runtime,
      cronService,
      eventStream,
      runService,
      signalService,
    }),
  },
  development: env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

const shutdown = () => {
  clearInterval(heartbeatTimer);
  cronService.stop();
  runService.stop();
  signalService.stop();
  try {
    getLaneQueue().clearAll();
  } catch {
    // Queue not initialized
  }
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdown();
    process.exit(0);
  });
}

console.log("[startup] wafflebot runtime", {
  nodeEnv: env.NODE_ENV,
  config: {
    path: configSnapshot.path,
    hash: configSnapshot.hash,
  },
  opencode: runtimeInfo.opencode,
  cron: {
    enabled: env.WAFFLEBOT_CRON_ENABLED,
    schedulerPollMs: env.WAFFLEBOT_CRON_SCHEDULER_POLL_MS,
    workerPollMs: env.WAFFLEBOT_CRON_WORKER_POLL_MS,
  },
});
console.log(`Wafflebot dashboard running at ${server.url}`);
