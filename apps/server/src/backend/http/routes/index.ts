import { z } from "zod";

import { migrateOpenclawWorkspace } from "../../agents/openclawImport";
import type { SignalChannelService } from "../../channels/signal/service";
import type { RuntimeEngine } from "../../contracts/runtime";
import type { CronService } from "../../cron/service";
import { syncMemoryIndex } from "../../memory/service";
import type { RunService } from "../../run/service";
import type { RouteTable } from "../router";
import type { RuntimeEventStream } from "../sse";
import { createAgentRoutes } from "./agentRoutes";
import { createBackgroundRoutes } from "./backgroundRoutes";
import { createChatRoutes } from "./chatRoutes";
import { createConfigRoutes } from "./configRoutes";
import { createCronRoutes } from "./cronRoutes";
import { createDashboardRoutes } from "./dashboardRoutes";
import { createEventRoutes } from "./eventRoutes";
import { createMcpRoutes } from "./mcpRoutes";
import { createMemoryRoutes } from "./memoryRoutes";
import { createRunRoutes } from "./runRoutes";
import { createRuntimeRoutes } from "./runtimeRoutes";
import { createSignalRoutes } from "./signalRoutes";
import { createSkillRoutes } from "./skillRoutes";
import { createUiRoutes } from "./uiRoutes";
import { createUsageRoutes } from "./usageRoutes";

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
  eventStream: RuntimeEventStream;
  runService: RunService;
}): RouteTable {
  return {
    "/api/waffle/runtime/import-openclaw": {
      POST: (req: Request) => importOpenclaw(req),
    },
    ...createRuntimeRoutes({ cronService: input.cronService }),
    ...createChatRoutes(input.runtime),
    ...createRunRoutes(input.runService),
    ...createBackgroundRoutes(input.runtime),
    ...createDashboardRoutes(input.runtime),
    ...createConfigRoutes(input.eventStream),
    ...createUiRoutes(input.runtime, input.eventStream),
    ...createUsageRoutes(),
    ...createEventRoutes(input.eventStream),
    ...createAgentRoutes(),
    ...createMcpRoutes(),
    ...createSkillRoutes(),
    ...createCronRoutes(input.cronService),
    ...createMemoryRoutes(),
    ...createSignalRoutes(input.signalService),
  };
}
