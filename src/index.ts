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
import { RunService } from "./backend/run/service";
import { createRuntime, getRuntimeStartupInfo } from "./backend/runtime";
import index from "./index.html";

ensureSeedData();
ensureConfigFile();
const configSnapshot = getConfigSnapshot();

const runtime = createRuntime();
const cronService = new CronService(runtime);
const runService = new RunService(runtime);
const runtimeInfo = getRuntimeStartupInfo();
const eventStream = createRuntimeEventStream({
  getHeartbeatSnapshot,
  getUsageSnapshot,
});

void initializeMemory().catch(() => {
  // Memory startup should not block server boot.
});

runtime.subscribe(event => {
  eventStream.publish(event);
});
cronService.start();
runService.start();

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
