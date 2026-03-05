import { createBackgroundRoutes } from "./backgroundRoutes";
import { createChatRoutes } from "./chatRoutes";
import { createConfigRoutes } from "./configRoutes";
import { createCronRoutes } from "./cronRoutes";
import { createDashboardRoutes } from "./dashboardRoutes";
import { createEventRoutes } from "./eventRoutes";
import { createMemoryRoutes } from "./memoryRoutes";
import { createQueueRoutes } from "./queueRoutes";
import { createRunRoutes } from "./runRoutes";
import { createSignalRoutes } from "./signalRoutes";
import { createUiRoutes } from "./uiRoutes";
import type { SignalChannelService } from "../../channels/signal/service";
import type { RuntimeEngine } from "../../contracts/runtime";
import type { CronService } from "../../cron/service";
import type { RunService } from "../../run/service";
import type { RuntimeEventStream } from "../sse";

export function createApiRoutes(input: {
  runtime: RuntimeEngine;
  cronService: CronService;
  eventStream: RuntimeEventStream;
  runService: RunService;
  signalService: SignalChannelService;
}) {
  return {
    ...createDashboardRoutes(input.runtime),
    ...createBackgroundRoutes(input.runtime),
    ...createChatRoutes(input.runtime),
    ...createRunRoutes(input.runService),
    ...createConfigRoutes(input.eventStream),
    ...createCronRoutes(input.cronService),
    ...createMemoryRoutes(),
    ...createQueueRoutes(),
    ...createEventRoutes(input.eventStream),
    ...createSignalRoutes(input.signalService),
    ...createUiRoutes(input.runtime),
  };
}
