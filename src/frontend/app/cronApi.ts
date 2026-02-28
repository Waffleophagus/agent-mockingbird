import type {
  CronJobDefinition,
  CronJobInstance,
  CronJobStep,
  CronHealthSnapshot,
} from "@/backend/cron/types";

interface CronJobsResponse {
  jobs: CronJobDefinition[];
  error?: string;
}

interface CronJobResponse {
  job: CronJobDefinition;
  error?: string;
}

interface CronInstancesResponse {
  instances: CronJobInstance[];
  error?: string;
}

interface CronStepsResponse {
  steps: CronJobStep[];
  error?: string;
}

interface CronHealthResponse {
  health: CronHealthSnapshot;
  error?: string;
}

interface CronHandlersResponse {
  handlers: string[];
  error?: string;
}

interface DeleteJobResponse {
  removed: boolean;
  error?: string;
}

export async function fetchCronJobs(): Promise<CronJobDefinition[]> {
  const response = await fetch("/api/cron/jobs");
  const payload = (await response.json()) as CronJobsResponse;
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to fetch cron jobs");
  }
  return payload.jobs;
}

export async function fetchCronJob(jobId: string): Promise<CronJobDefinition> {
  const response = await fetch(`/api/cron/jobs/${encodeURIComponent(jobId)}`);
  const payload = (await response.json()) as CronJobResponse;
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to fetch cron job");
  }
  return payload.job;
}

export async function deleteCronJob(jobId: string): Promise<boolean> {
  const response = await fetch(`/api/cron/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
  const payload = (await response.json()) as DeleteJobResponse;
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to delete cron job");
  }
  return payload.removed;
}

export async function fetchCronInstances(
  jobId?: string,
  limit?: number,
): Promise<CronJobInstance[]> {
  const params = new URLSearchParams();
  if (jobId) params.set("jobId", jobId);
  if (limit) params.set("limit", String(limit));
  const query = params.toString();
  const response = await fetch(`/api/cron/instances${query ? `?${query}` : ""}`);
  const payload = (await response.json()) as CronInstancesResponse;
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to fetch cron instances");
  }
  return payload.instances;
}

export async function fetchCronSteps(instanceId: string): Promise<CronJobStep[]> {
  const response = await fetch(
    `/api/cron/instances/${encodeURIComponent(instanceId)}/steps`,
  );
  const payload = (await response.json()) as CronStepsResponse;
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to fetch cron steps");
  }
  return payload.steps;
}

export async function fetchCronHealth(): Promise<CronHealthSnapshot> {
  const response = await fetch("/api/cron/health");
  const payload = (await response.json()) as CronHealthResponse;
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to fetch cron health");
  }
  return payload.health;
}

export async function fetchCronHandlers(): Promise<string[]> {
  const response = await fetch("/api/cron/handlers");
  const payload = (await response.json()) as CronHandlersResponse;
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to fetch cron handlers");
  }
  return payload.handlers;
}
