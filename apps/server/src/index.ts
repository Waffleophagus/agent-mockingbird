import { serve } from "bun";
import { websocket as honoWebsocket } from "hono/bun";

import { ensureConfigFile, getConfigSnapshot } from "./backend/config/service";
import { CronService } from "./backend/cron/service";
import "./backend/db/migrate";
import { ensureSeedData, getHeartbeatSnapshot, getUsageSnapshot } from "./backend/db/repository";
import { proxyEmbeddedExternalRequest, proxyEmbeddedServiceRequest } from "./backend/embed/gateway";
import { env } from "./backend/env";
import { HeartbeatRuntimeService } from "./backend/heartbeat/runtimeService";
import { dispatchRoute } from "./backend/http/router";
import { createApiRoutes } from "./backend/http/routes";
import { createRuntimeEventStream } from "./backend/http/sse";
import { initializeMemory } from "./backend/memory/service";
import {
  handleEmbeddedOpenCodeRequest,
  isOpenCodeServerPath,
} from "./backend/opencode/embeddedServer";
import { ensureExecutorMcpServerConfigured } from "./backend/opencode/managedConfig";
import { resolveAppDistDir } from "./backend/paths";
import { RunService } from "./backend/run/service";
import { createRuntime, getRuntimeStartupInfo } from "./backend/runtime";

ensureSeedData();
ensureConfigFile();
const configSnapshot = getConfigSnapshot();
await ensureExecutorMcpServerConfigured(configSnapshot.config);
const runtime = createRuntime();
const cronService = new CronService(runtime);
const heartbeatService = new HeartbeatRuntimeService();
const runService = new RunService(runtime);
const eventStream = createRuntimeEventStream({
  getHeartbeatSnapshot,
  getUsageSnapshot,
});
const runtimeInfo = getRuntimeStartupInfo();
const appDistDir = resolveAppDistDir();
const apiRoutes = createApiRoutes({
  runtime,
  cronService,
  heartbeatService,
  eventStream,
  runService,
});

const unsubscribeRuntimeEvents = runtime.subscribe(eventStream.publish);

async function serveOpenCodeApp(req: Request, server: Bun.Server<unknown>) {
  const url = new URL(req.url);
  const pathname = decodeURIComponent(url.pathname);
  const config = getConfigSnapshot().config;
  const embeddedServiceResponse = await proxyEmbeddedServiceRequest(req, config);
  if (embeddedServiceResponse) {
    return embeddedServiceResponse;
  }
  const embeddedExternalResponse = await proxyEmbeddedExternalRequest(req, config);
  if (embeddedExternalResponse) {
    return embeddedExternalResponse;
  }
  if (isOpenCodeServerPath(pathname)) {
    return handleEmbeddedOpenCodeRequest(req, server);
  }
  if (!appDistDir) {
    return new Response("Missing built OpenCode app assets (dist/app).", { status: 500 });
  }

  const relativePath = pathname.replace(/^\/+/, "") || "index.html";
  const candidate = Bun.file(`${appDistDir}/${relativePath}`);
  if (await candidate.exists()) {
    return new Response(candidate);
  }

  if (relativePath.includes(".")) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(Bun.file(`${appDistDir}/index.html`));
}

void initializeMemory().catch(() => {
  // Memory startup should not block server boot.
});

runService.start();
cronService.start();
heartbeatService.start();

const serverPort = Number(
  process.env.PORT?.trim() ||
  process.env.AGENT_MOCKINGBIRD_PORT?.trim() ||
  "3001",
);

const server = serve({
  port: Number.isFinite(serverPort) && serverPort > 0 ? serverPort : 3001,
  idleTimeout: 120,
  fetch: async (req, server) => {
    const apiResponse = await dispatchRoute(apiRoutes, req);
    if (apiResponse) {
      return apiResponse;
    }
    return serveOpenCodeApp(req, server);
  },
  websocket: honoWebsocket,
  development: env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

const shutdown = () => {
  unsubscribeRuntimeEvents();
  runService.stop();
  cronService.stop();
  heartbeatService.stop();
};

let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdown();
    void Promise.resolve(runtime.dispose?.())
      .catch(() => {})
      .finally(() => {
        try {
          server.stop(true);
        } catch {
          // ignore shutdown races
        }
        process.exit(0);
      });
  });
}

console.log("[startup] agent-mockingbird runtime", {
  nodeEnv: env.NODE_ENV,
  appDistDir,
  runtimeMode: process.env.AGENT_MOCKINGBIRD_RUNTIME_MODE || "unknown",
  config: {
    path: configSnapshot.path,
    hash: configSnapshot.hash,
  },
  workspace: {
    pinnedDirectory: configSnapshot.config.workspace.pinnedDirectory,
  },
  executor: runtimeInfo.executor,
  opencode: runtimeInfo.opencode,
  cron: {
    enabled: env.AGENT_MOCKINGBIRD_CRON_ENABLED,
    schedulerPollMs: env.AGENT_MOCKINGBIRD_CRON_SCHEDULER_POLL_MS,
    workerPollMs: env.AGENT_MOCKINGBIRD_CRON_WORKER_POLL_MS,
  },
});
console.log(`Agent Mockingbird running at ${server.url}`);
