import { serve } from "bun";
import { websocket } from "hono/bun";

import { SignalChannelService } from "./backend/channels/signal/service";
import { ensureConfigFile, getConfigSnapshot } from "./backend/config/service";
import { CronService } from "./backend/cron/service";
import "./backend/db/migrate";
import { ensureSeedData, getHeartbeatSnapshot, getUsageSnapshot } from "./backend/db/repository";
import { env } from "./backend/env";
import { HeartbeatRuntimeService } from "./backend/heartbeat/runtimeService";
import { dispatchRoute } from "./backend/http/router";
import { createApiRoutes } from "./backend/http/routes";
import { createRuntimeEventStream, type MobileRealtimeSocketData } from "./backend/http/sse";
import { initializeMemory } from "./backend/memory/service";
import { resolveAppDistDir } from "./backend/paths";
import { RunService } from "./backend/run/service";
import { createRuntime, getRuntimeStartupInfo } from "./backend/runtime";

const OPENCODE_SERVER_PREFIXES = [
  "/agent",
  "/auth",
  "/command",
  "/config",
  "/doc",
  "/event",
  "/experimental",
  "/file",
  "/find",
  "/formatter",
  "/global",
  "/instance",
  "/log",
  "/lsp",
  "/mcp",
  "/path",
  "/permission",
  "/project",
  "/provider",
  "/pty",
  "/question",
  "/session",
  "/skill",
  "/tui",
  "/vcs",
];

function isOpenCodeServerPath(pathname: string) {
  return OPENCODE_SERVER_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

ensureSeedData();
ensureConfigFile();
const configSnapshot = getConfigSnapshot();
const runtime = createRuntime();
const cronService = new CronService(runtime);
const heartbeatService = new HeartbeatRuntimeService();
const signalService = new SignalChannelService(runtime);
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
  signalService,
  eventStream,
  runService,
});

const unsubscribeRuntimeEvents = runtime.subscribe(eventStream.publish);

async function proxyOpenCodeSidecar(req: Request) {
  const sidecarBaseUrl = getConfigSnapshot().config.runtime.opencode.baseUrl;
  const incoming = new URL(req.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, sidecarBaseUrl);
  const headers = new Headers(req.headers);
  headers.delete("host");
  return fetch(target, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    redirect: "manual",
  });
}

async function serveOpenCodeApp(req: Request) {
  if (!appDistDir) {
    return new Response("Missing built OpenCode app assets (dist/app).", { status: 500 });
  }

  const url = new URL(req.url);
  const pathname = decodeURIComponent(url.pathname);
  if (isOpenCodeServerPath(pathname)) {
    return proxyOpenCodeSidecar(req);
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
signalService.start();

const server = serve({
  idleTimeout: 120,
  fetch: async (req, server) => {
    if (new URL(req.url).pathname === "/api/mobile/events/ws") {
      return eventStream.websocketRoute(req, server as unknown as Bun.Server<MobileRealtimeSocketData>);
    }
    const apiResponse = await dispatchRoute(apiRoutes, req);
    if (apiResponse) {
      return apiResponse;
    }
    return serveOpenCodeApp(req);
  },
  development: env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
  websocket,
});

const shutdown = () => {
  unsubscribeRuntimeEvents();
  runService.stop();
  cronService.stop();
  heartbeatService.stop();
  signalService.stop();
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
  opencode: runtimeInfo.opencode,
  cron: {
    enabled: env.AGENT_MOCKINGBIRD_CRON_ENABLED,
    schedulerPollMs: env.AGENT_MOCKINGBIRD_CRON_SCHEDULER_POLL_MS,
    workerPollMs: env.AGENT_MOCKINGBIRD_CRON_WORKER_POLL_MS,
  },
});
console.log(`Agent Mockingbird running at ${server.url}`);
