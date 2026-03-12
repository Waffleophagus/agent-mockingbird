import { serve } from "bun";
import { websocket } from "hono/bun";

import { listOpencodeAgentTypes } from "./backend/agents/opencodeConfig";
import { SignalChannelService } from "./backend/channels/signal/service";
import { ensureConfigFile, getConfigSnapshot } from "./backend/config/service";
import { CronService } from "./backend/cron/service";
import "./backend/db/migrate";
import { ensureSeedData } from "./backend/db/repository";
import { env } from "./backend/env";
import { syncHeartbeatJobsForAgents } from "./backend/heartbeat/jobSync";
import { dispatchRoute } from "./backend/http/router";
import { createApiRoutes } from "./backend/http/routes";
import { initializeMemory } from "./backend/memory/service";
import { resolveAppDistDir } from "./backend/paths";
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

interface OpenCodeApp {
  fetch(request: Request, env?: unknown, executionCtx?: unknown): Response | Promise<Response>;
}

let openCodeAppPromise: Promise<OpenCodeApp> | undefined;

async function getOpenCodeApp(): Promise<OpenCodeApp> {
  if (!openCodeAppPromise) {
    openCodeAppPromise = import(
      new URL("../../../vendor/opencode/packages/opencode/src/server/server.ts", import.meta.url).href
    ).then(module => {
      const server = module as {
        Server: {
          createApp: (opts: { cors?: string[]; localApp?: boolean }) => OpenCodeApp;
        };
      };
      return server.Server.createApp({ localApp: true });
    });
  }
  return openCodeAppPromise;
}

ensureSeedData();
ensureConfigFile();
const configSnapshot = getConfigSnapshot();
const runtime = createRuntime();
const cronService = new CronService(runtime);
const signalService = new SignalChannelService(runtime);
const runtimeInfo = getRuntimeStartupInfo();
const appDistDir = resolveAppDistDir();
const apiRoutes = createApiRoutes({
  runtime,
  cronService,
  signalService,
});

let heartbeatAgentHash = "";

async function syncHeartbeatJobs(reason: string) {
  try {
    const payload = await listOpencodeAgentTypes();
    if (payload.hash === heartbeatAgentHash) return;
    heartbeatAgentHash = payload.hash;
    await syncHeartbeatJobsForAgents(cronService, payload.agentTypes);
  } catch (error) {
    console.error(`[heartbeat] Failed to sync heartbeat jobs during ${reason}:`, error);
  }
}

async function serveOpenCodeApp(req: Request, server?: Bun.Server<any>) {
  if (!appDistDir) {
    return new Response("Missing built OpenCode app assets (dist/app).", { status: 500 });
  }

  const url = new URL(req.url);
  const pathname = decodeURIComponent(url.pathname);
  if (isOpenCodeServerPath(pathname)) {
    const opencodeApp = await getOpenCodeApp();
    return opencodeApp.fetch(req, server as object);
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

cronService.start();
signalService.start();
void syncHeartbeatJobs("startup");
const heartbeatJobSyncTimer = setInterval(() => {
  void syncHeartbeatJobs("poll");
}, 5_000);

const server = serve({
  idleTimeout: 120,
  fetch: async (req, server) => {
    const apiResponse = await dispatchRoute(apiRoutes, req);
    if (apiResponse) {
      return apiResponse;
    }
    return serveOpenCodeApp(req, server);
  },
  development: env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
  websocket,
});

const shutdown = () => {
  clearInterval(heartbeatJobSyncTimer);
  cronService.stop();
  signalService.stop();
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdown();
    process.exit(0);
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
