import { z } from "zod";

import { migrateOpenclawWorkspace } from "../../agents/openclawImport";
import {
  getOpencodeAgentStorageInfo,
  listOpencodeAgentTypes,
  patchOpencodeAgentTypes,
  validateOpencodeAgentPatch,
} from "../../agents/opencodeConfig";
import {
  getConfigSnapshot,
  applyConfigPatch,
  ConfigApplyError,
  replaceConfig,
} from "../../config/service";
import {
  getEnabledSkillsFromCatalog,
  importManagedSkillWithConfigUpdate,
  loadRuntimeSkillCatalog,
  setEnabledSkillsFromCatalog,
} from "../../config/orchestration";
import { configuredMcpServerSchema } from "../../config/schema";
import type { RuntimeEngine } from "../../contracts/runtime";
import type { CronService } from "../../cron/service";
import { getRuntimeStartupInfo } from "../../runtime";
import type { SignalChannelService } from "../../channels/signal/service";
import { syncMemoryIndex } from "../../memory/service";
import {
  connectRuntimeMcp,
  disconnectRuntimeMcp,
  getWorkspaceMcpConfig,
  listRuntimeMcps,
  removeRuntimeMcpAuth,
  startRuntimeMcpAuth,
  updateWorkspaceMcpConfig,
} from "../../mcp/service";
import { createCronRoutes } from "./cronRoutes";
import { createMemoryRoutes } from "./memoryRoutes";
import { parseStringListBody } from "../parsers";
import type { RouteTable } from "../router";
import { createSignalRoutes } from "./signalRoutes";

function prefixRoutes(prefix: string, routes: RouteTable): RouteTable {
  return Object.fromEntries(
    Object.entries(routes).map(([pathname, handlers]) => {
      const suffix = pathname.startsWith("/api/") ? pathname.slice("/api".length) : pathname;
      return [`${prefix}${suffix}`, handlers];
    }),
  );
}

function configError(error: unknown) {
  if (error instanceof ConfigApplyError) {
    const status = error.stage === "conflict" ? 409 : error.stage === "schema" || error.stage === "request" ? 400 : 422;
    return Response.json({ error: error.message, stage: error.stage, details: error.details }, { status });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : "Request failed" },
    { status: 500 },
  );
}

function baseRuntimePayload(runtime: RuntimeEngine) {
  const snapshot = getConfigSnapshot();
  return {
    configPath: snapshot.path,
    configHash: snapshot.hash,
    workspace: {
      pinnedDirectory: snapshot.config.workspace.pinnedDirectory,
    },
    opencode: getRuntimeStartupInfo().opencode,
    runtimeHealthy: typeof runtime.checkHealth === "function",
  };
}

async function importManagedSkill(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const rawId = typeof body.id === "string" ? body.id : "";
  const content = typeof body.content === "string" ? body.content : "";
  const enable = typeof body.enable === "boolean" ? body.enable : true;

  try {
    const imported = await importManagedSkillWithConfigUpdate({
      rawId,
      content,
      enable,
      expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
    });
    return Response.json({
      imported: imported.imported,
      skills: imported.skills,
      hash: imported.hash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to import skill";
    const status = message.includes("catalog has changed") || message.includes("already exists") ? 409 : 400;
    return Response.json({ error: message }, { status });
  }
}

async function importOpenclaw(req: Request) {
  const schema = z.object({
    source: z.discriminatedUnion("mode", [
      z.object({
        mode: z.literal("local"),
        path: z.string().min(1),
      }),
      z.object({
        mode: z.literal("git"),
        url: z.string().min(1),
        ref: z.string().optional(),
      }),
    ]),
    targetDirectory: z.string().optional(),
  });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid import request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const migration = await migrateOpenclawWorkspace(parsed.data);
    let memorySync: { attempted: boolean; completed: boolean; error?: string | null } = {
      attempted: false,
      completed: false,
      error: null,
    };
    try {
      await syncMemoryIndex();
      memorySync = { attempted: true, completed: true, error: null };
    } catch (error) {
      memorySync = {
        attempted: true,
        completed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return Response.json({ migration, memorySync });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to import OpenClaw workspace files" },
      { status: 422 },
    );
  }
}

async function getMcpCatalog() {
  const snapshot = getConfigSnapshot();
  try {
    const current = await getWorkspaceMcpConfig(snapshot.config);
    const mcps = await listRuntimeMcps(snapshot.config);
    return Response.json(
      {
        mcps,
        servers: current.servers,
        enabled: current.servers.filter(server => server.enabled).map(server => server.id),
        hash: current.hash,
      },
      { status: 200 },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load MCP catalog" },
      { status: 502 },
    );
  }
}

async function updateMcpConfig(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const parsed = z.array(configuredMcpServerSchema).safeParse(body.servers);
  if (!parsed.success) {
    return Response.json({ error: "servers must be a valid MCP config array" }, { status: 400 });
  }

  try {
    const snapshot = getConfigSnapshot();
    const updated = await updateWorkspaceMcpConfig({
      config: snapshot.config,
      servers: parsed.data,
      expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
    });
    return Response.json({
      servers: updated.servers,
      enabled: updated.servers.filter(server => server.enabled).map(server => server.id),
      hash: updated.hash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update MCP config";
    return Response.json({ error: message }, { status: message.includes("refresh and retry") ? 409 : 422 });
  }
}

async function runMcpAction(req: Request & { params: { id: string } }, action: "connect" | "disconnect" | "authStart" | "authRemove") {
  const id = req.params.id.trim();
  if (!id) {
    return Response.json({ error: "MCP id is required" }, { status: 400 });
  }

  try {
    const snapshot = getConfigSnapshot();
    if (action === "connect") {
      const connected = await connectRuntimeMcp(snapshot.config, id);
      return Response.json({ id, connected, mcps: await listRuntimeMcps(snapshot.config) });
    }
    if (action === "disconnect") {
      const disconnected = await disconnectRuntimeMcp(snapshot.config, id);
      return Response.json({ id, disconnected, mcps: await listRuntimeMcps(snapshot.config) });
    }
    if (action === "authStart") {
      const authorizationUrl = await startRuntimeMcpAuth(snapshot.config, id);
      return Response.json({ id, authorizationUrl, mcps: await listRuntimeMcps(snapshot.config) });
    }
    const authRemoved = await removeRuntimeMcpAuth(snapshot.config, id);
    return Response.json({ id, authRemoved, mcps: await listRuntimeMcps(snapshot.config) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : `Failed to ${action} MCP server ${id}` },
      { status: 502 },
    );
  }
}

async function getAgents() {
  try {
    const payload = await listOpencodeAgentTypes();
    return Response.json({
      agentTypes: payload.agentTypes,
      hash: payload.hash,
      storage: payload.storage,
      source: "opencode",
    });
  } catch (error) {
    const storage = getOpencodeAgentStorageInfo();
    return Response.json(
      {
        agentTypes: [],
        hash: "",
        storage,
        source: "opencode",
        error: error instanceof Error ? error.message : "Failed to load OpenCode agents",
      },
      { status: 502 },
    );
  }
}

async function patchAgents(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const expectedHash = typeof body.expectedHash === "string" ? body.expectedHash.trim() : "";
  if (!expectedHash) {
    return Response.json({ error: "expectedHash is required" }, { status: 400 });
  }
  const validation = await validateOpencodeAgentPatch({
    upserts: body.upserts,
    deletes: body.deletes,
  });
  if (!validation.ok) {
    return Response.json(
      {
        error: "Agent patch validation failed",
        issues: validation.issues,
        warnings: validation.warnings,
      },
      { status: 400 },
    );
  }

  try {
    const result = await patchOpencodeAgentTypes({
      upserts: validation.normalized.upserts,
      deletes: validation.normalized.deletes,
      expectedHash,
    });
    if (!result.ok) {
      return Response.json({ error: result.error, hash: result.currentHash }, { status: result.status });
    }
    return Response.json({
      agentTypes: result.agentTypes,
      hash: result.hash,
      storage: result.storage,
      applied: result.applied,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to update OpenCode agent definitions",
      },
      { status: 502 },
    );
  }
}

export function createApiRoutes(input: {
  runtime: RuntimeEngine;
  cronService: CronService;
  signalService: SignalChannelService;
}) {
  const runtimeRoutes: RouteTable = {
    "/api/health": {
      GET: () => Response.json({ ok: true, service: "agent-mockingbird" }),
    },
    "/api/waffle/runtime/pinned-workspace": {
      GET: () => {
        const snapshot = getConfigSnapshot();
        return Response.json({
          directory: snapshot.config.workspace.pinnedDirectory,
        });
      },
    },
    "/api/waffle/runtime/info": {
      GET: async () => {
        const payload = baseRuntimePayload(input.runtime);
        if (typeof input.runtime.checkHealth === "function") {
          const health = await input.runtime.checkHealth().catch(() => null);
          return Response.json({ ...payload, health });
        }
        return Response.json(payload);
      },
    },
    "/api/waffle/runtime/config": {
      GET: () => Response.json(getConfigSnapshot()),
      PATCH: async (req: Request) => {
        try {
          const body = (await req.json()) as { patch?: unknown; expectedHash?: string };
          const result = await applyConfigPatch({
            patch: body.patch,
            expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
          });
          return Response.json(result);
        } catch (error) {
          return configError(error);
        }
      },
    },
    "/api/waffle/runtime/config/replace": {
      POST: async (req: Request) => {
        try {
          const body = (await req.json()) as { config?: unknown; expectedHash?: string };
          const result = await replaceConfig({
            config: body.config,
            expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
          });
          return Response.json(result);
        } catch (error) {
          return configError(error);
        }
      },
    },
    "/api/waffle/runtime/import-openclaw": {
      POST: (req: Request) => importOpenclaw(req),
    },
    "/api/waffle/skills": {
      GET: async () => {
        const result = await loadRuntimeSkillCatalog();
        return Response.json(result.payload, { status: result.status });
      },
      PUT: async (req: Request) => {
        const body = (await req.json()) as Record<string, unknown>;
        const skills = parseStringListBody(body, "skills");
        if (!skills) {
          return Response.json({ error: "skills must be a string array" }, { status: 400 });
        }
        try {
          return Response.json(
            await setEnabledSkillsFromCatalog({
              skills,
              expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
            }),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to update skills";
          return Response.json({ error: message }, { status: message.includes("refresh and retry") ? 409 : 500 });
        }
      },
      POST: (req: Request) => importManagedSkill(req),
    },
    "/api/waffle/skills/enabled": {
      GET: () => Response.json(getEnabledSkillsFromCatalog()),
    },
    "/api/waffle/mcp": {
      GET: () => getMcpCatalog(),
      PUT: (req: Request) => updateMcpConfig(req),
    },
    "/api/waffle/mcp/:id/connect": {
      POST: (req: Request & { params: { id: string } }) => runMcpAction(req, "connect"),
    },
    "/api/waffle/mcp/:id/disconnect": {
      POST: (req: Request & { params: { id: string } }) => runMcpAction(req, "disconnect"),
    },
    "/api/waffle/mcp/:id/auth/start": {
      POST: (req: Request & { params: { id: string } }) => runMcpAction(req, "authStart"),
    },
    "/api/waffle/mcp/:id/auth/remove": {
      POST: (req: Request & { params: { id: string } }) => runMcpAction(req, "authRemove"),
    },
    "/api/waffle/agents": {
      GET: () => getAgents(),
      PATCH: (req: Request) => patchAgents(req),
    },
    "/api/waffle/agents/validate": {
      POST: async (req: Request) => {
        const body = (await req.json()) as Record<string, unknown>;
        return Response.json(
          await validateOpencodeAgentPatch({
            upserts: body.upserts,
            deletes: body.deletes,
          }),
        );
      },
    },
  };

  return {
    ...runtimeRoutes,
    ...prefixRoutes("/api/waffle", createCronRoutes(input.cronService) as RouteTable),
    ...prefixRoutes("/api/waffle", createMemoryRoutes() as RouteTable),
    ...prefixRoutes("/api/waffle", createSignalRoutes(input.signalService) as RouteTable),
  };
}
