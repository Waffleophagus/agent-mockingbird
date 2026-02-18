import { createChatRoutes } from "./chatRoutes";
import { createConfigRoutes } from "./configRoutes";
import { createCronRoutes } from "./cronRoutes";
import { createDashboardRoutes } from "./dashboardRoutes";
import { createEventRoutes } from "./eventRoutes";
import { createMemoryRoutes } from "./memoryRoutes";
import { createRunRoutes } from "./runRoutes";
import type { RuntimeEngine } from "../../contracts/runtime";
import type { CronService } from "../../cron/service";
import type { RunService } from "../../run/service";
import type { RuntimeEventStream } from "../sse";

export function createApiRoutes(input: {
  runtime: RuntimeEngine;
  cronService: CronService;
  eventStream: RuntimeEventStream;
  runService: RunService;
}) {
  return {
    ...createDashboardRoutes(),
    ...createChatRoutes(input.runtime),
    ...createRunRoutes(input.runService),
    ...createConfigRoutes(),
    ...createCronRoutes(input.cronService),
    ...createMemoryRoutes(),
    ...createEventRoutes(input.eventStream),
  };
}
