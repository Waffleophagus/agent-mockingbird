import { z } from "zod";

import { migrateOpenclawWorkspace } from "../../agents/openclawImport";
import type { SignalChannelService } from "../../channels/signal/service";
import type { RuntimeEngine } from "../../contracts/runtime";
import type { CronService } from "../../cron/service";
import { syncMemoryIndex } from "../../memory/service";
import type { RouteTable } from "../router";
import { createAgentRoutes } from "./agentRoutes";
import { createCronRoutes } from "./cronRoutes";
import { createMcpRoutes } from "./mcpRoutes";
import { createMemoryRoutes } from "./memoryRoutes";
import { createRuntimeRoutes } from "./runtimeRoutes";
import { createSignalRoutes } from "./signalRoutes";
import { createSkillRoutes } from "./skillRoutes";

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

export function createApiRoutes(input: {
  runtime: RuntimeEngine;
  cronService: CronService;
  signalService: SignalChannelService;
}): RouteTable {
  return {
    "/api/health": {
      GET: () => Response.json({ ok: true, service: "agent-mockingbird" }),
    },
    "/api/waffle/runtime/import-openclaw": {
      POST: (req: Request) => importOpenclaw(req),
    },
    ...createRuntimeRoutes(),
    ...createAgentRoutes(),
    ...createMcpRoutes(),
    ...createSkillRoutes(),
    ...createCronRoutes(input.cronService),
    ...createMemoryRoutes(),
    ...createSignalRoutes(input.signalService),
  };
}
