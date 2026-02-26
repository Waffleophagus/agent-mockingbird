import type { HeartbeatConfig } from "./types";
import { parseInterval } from "./service";
import type { CronService } from "../cron/service";

const MAIN_SESSION_ID = "main";

export function getHeartbeatJobId(agentId: string): string {
  return `heartbeat-${agentId}`;
}

export async function syncHeartbeatJob(
  cronService: CronService,
  agentId: string,
  config: HeartbeatConfig | undefined,
): Promise<void> {
  const jobId = getHeartbeatJobId(agentId);
  const existingJob = await cronService.getJob(jobId);

  if (!config || !config.enabled) {
    if (existingJob) {
      await cronService.deleteJob(jobId);
    }
    return;
  }

  const everyMs = parseInterval(config.interval);
  if (everyMs <= 0) {
    if (existingJob) {
      await cronService.deleteJob(jobId);
    }
    return;
  }

  if (existingJob) {
    await cronService.updateJob(jobId, {
      everyMs,
      payload: {
        agentId,
        sessionId: MAIN_SESSION_ID,
      },
    });
    return;
  }

  await cronService.createJob({
    name: `Heartbeat: ${agentId}`,
    scheduleKind: "every",
    everyMs,
    runMode: "system",
    invokePolicy: "never",
    handlerKey: "heartbeat.check",
    payload: {
      agentId,
      sessionId: MAIN_SESSION_ID,
    },
  });
}

export async function syncHeartbeatJobsForAgents(
  cronService: CronService,
  agentTypes: Array<{ id: string; heartbeat?: HeartbeatConfig }>,
): Promise<void> {
  for (const agent of agentTypes) {
    await syncHeartbeatJob(cronService, agent.id, agent.heartbeat);
  }
}
