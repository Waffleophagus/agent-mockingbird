import { serve, type Server as BunServer } from "bun";

import { SignalChannelService } from "./backend/channels/signal/service";
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
import { syncHeartbeatJobsForAgents } from "./backend/heartbeat/jobSync";
import { createApiRoutes } from "./backend/http/routes";
import { createRuntimeEventStream } from "./backend/http/sse";
import type { MobileRealtimeSocketData } from "./backend/http/sse";
import { initializeMemory } from "./backend/memory/service";
import { NotificationService } from "./backend/notifications/service";
import { resolveWebDistDir } from "./backend/paths";
import { initLaneQueue, getLaneQueue } from "./backend/queue/service";
import { RunService } from "./backend/run/service";
import { createRuntime, getRuntimeStartupInfo } from "./backend/runtime";
import { startSkillsCatalogWatcher } from "./backend/skills/watcher";

ensureSeedData();
ensureConfigFile();
const configSnapshot = getConfigSnapshot();
let heartbeatConfigSyncHash = configSnapshot.hash;

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
  for (const msg of messages) {
    try {
      await runtime.sendUserMessage({
        sessionId,
        content: msg.content,
        parts: msg.parts,
        agent: msg.agent,
        metadata: {
          ...(msg.metadata ?? {}),
          __queueDrain: true,
        },
      });
    } catch (err) {
      console.error("Queue drain handler error:", err);
      break;
    }
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
const notificationService = new NotificationService();
const stopSkillsCatalogWatcher = startSkillsCatalogWatcher({ eventStream });

if (env.NODE_ENV === "production" && !runtimeInfo.opencode.directoryConfigured) {
  console.warn(
    "[startup] runtime.opencode.directory is not configured in agent-mockingbird config. OpenCode config visibility may differ across workspaces.",
  );
}

void initializeMemory().catch(() => {
  // Memory startup should not block server boot.
});

runtime.subscribe(event => {
  eventStream.publish(event);
  void notificationService.publishRuntimeEvent(event);
});
signalService.subscribe(event => {
  eventStream.publish(event);
});
cronService.start();
runService.start();
signalService.start();

void syncHeartbeatJobsForAgents(cronService, configSnapshot.config.ui.agentTypes).catch(err => {
  console.error("[startup] Failed to sync heartbeat jobs:", err);
});

const heartbeatJobSyncTimer = setInterval(() => {
  const nextSnapshot = getConfigSnapshot();
  if (nextSnapshot.hash === heartbeatConfigSyncHash) return;
  heartbeatConfigSyncHash = nextSnapshot.hash;
  void syncHeartbeatJobsForAgents(cronService, nextSnapshot.config.ui.agentTypes).catch(err => {
    console.error("[heartbeat] Failed to sync heartbeat jobs:", err);
  });
}, 5_000);

const heartbeatTimer = setInterval(() => {
  const heartbeat = recordHeartbeat("scheduler");
  eventStream.publish(createHeartbeatUpdatedEvent(heartbeat, "scheduler"));
  eventStream.publish(createUsageUpdatedEvent(getUsageSnapshot(), "scheduler"));
}, 12_000);

const webDistDir = resolveWebDistDir();

async function serveDashboard(req: Request) {
  if (!webDistDir) {
    return new Response("Missing built dashboard assets (dist/web).", { status: 500 });
  }

  const url = new URL(req.url);
  const requestPath = decodeURIComponent(url.pathname);
  const normalizedPath = requestPath.replace(/^\/+/, "");
  const relativePath = normalizedPath === "" ? "index.html" : normalizedPath;
  const candidate = Bun.file(`${webDistDir}/${relativePath}`);
  if (await candidate.exists()) {
    return new Response(candidate);
  }

  return new Response(Bun.file(`${webDistDir}/index.html`));
}

const dashboardRoute =
  env.NODE_ENV === "production" ? serveDashboard : (await import("../../web/index.html")).default;

const server: BunServer<MobileRealtimeSocketData> = serve({
  idleTimeout: 120,
  routes: {
    "/*": dashboardRoute,
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
  websocket: eventStream.websocket,
});

const shutdown = () => {
  clearInterval(heartbeatTimer);
  clearInterval(heartbeatJobSyncTimer);
  stopSkillsCatalogWatcher();
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

console.log("[startup] agent-mockingbird runtime", {
  nodeEnv: env.NODE_ENV,
  webDistDir,
  config: {
    path: configSnapshot.path,
    hash: configSnapshot.hash,
  },
  opencode: runtimeInfo.opencode,
  cron: {
    enabled: env.AGENT_MOCKINGBIRD_CRON_ENABLED,
    schedulerPollMs: env.AGENT_MOCKINGBIRD_CRON_SCHEDULER_POLL_MS,
    workerPollMs: env.AGENT_MOCKINGBIRD_CRON_WORKER_POLL_MS,
  },
});
console.log(`Agent Mockingbird dashboard running at ${server.url}`);
