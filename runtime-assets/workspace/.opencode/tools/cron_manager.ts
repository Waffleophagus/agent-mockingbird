import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

function resolveApiBaseUrl() {
  const explicit = process.env.WAFFLEBOT_CRON_API_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const memoryAlias = process.env.WAFFLEBOT_MEMORY_API_BASE_URL?.trim();
  if (memoryAlias) return memoryAlias.replace(/\/+$/, "");
  const port = process.env.WAFFLEBOT_PORT?.trim() || process.env.PORT?.trim() || "3001";
  return `http://127.0.0.1:${port}`;
}

async function postJson(pathname: string, body: unknown) {
  const response = await fetch(`${resolveApiBaseUrl()}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
    throw new Error(error);
  }
  return payload;
}

const scheduleKindSchema = z.enum(["at", "every", "cron"]);
const runModeSchema = z.enum(["background", "conditional_agent", "agent"]);
const payloadSchema = z.record(z.string(), z.unknown());

const jobCreateSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().optional(),
  scheduleKind: scheduleKindSchema,
  scheduleExpr: z.string().min(1).nullable().optional(),
  everyMs: z.number().int().positive().nullable().optional(),
  atIso: z.string().min(1).nullable().optional(),
  timezone: z.string().min(1).nullable().optional(),
  runMode: runModeSchema,
  handlerKey: z.string().min(1).nullable().optional(),
  agentPromptTemplate: z.string().min(1).nullable().optional(),
  agentModelOverride: z.string().min(1).nullable().optional(),
  maxAttempts: z.number().int().positive().optional(),
  retryBackoffMs: z.number().int().positive().optional(),
  payload: payloadSchema.optional(),
});

const jobPatchSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  scheduleKind: scheduleKindSchema.optional(),
  scheduleExpr: z.string().min(1).nullable().optional(),
  everyMs: z.number().int().positive().nullable().optional(),
  atIso: z.string().min(1).nullable().optional(),
  timezone: z.string().min(1).nullable().optional(),
  runMode: runModeSchema.optional(),
  handlerKey: z.string().min(1).nullable().optional(),
  agentPromptTemplate: z.string().min(1).nullable().optional(),
  agentModelOverride: z.string().min(1).nullable().optional(),
  maxAttempts: z.number().int().positive().optional(),
  retryBackoffMs: z.number().int().positive().optional(),
  payload: payloadSchema.optional(),
});

const argsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_jobs") }),
  z.object({ action: z.literal("list_handlers") }),
  z.object({ action: z.literal("health") }),
  z.object({ action: z.literal("get_job"), jobId: z.string().min(1) }),
  z.object({ action: z.literal("create_job"), job: jobCreateSchema }),
  z.object({ action: z.literal("update_job"), jobId: z.string().min(1), patch: jobPatchSchema }),
  z.object({ action: z.literal("delete_job"), jobId: z.string().min(1) }),
  z.object({ action: z.literal("run_job_now"), jobId: z.string().min(1) }),
  z.object({
    action: z.literal("list_instances"),
    jobId: z.string().min(1).optional(),
    limit: z.number().int().positive().optional(),
  }),
  z.object({ action: z.literal("list_steps"), instanceId: z.string().min(1) }),
]);

export default tool({
  description: "Manage Wafflebot cron jobs (list/create/update/run/delete/inspect).",
  args: {
    action: tool.schema.enum([
      "list_jobs",
      "list_handlers",
      "health",
      "get_job",
      "create_job",
      "update_job",
      "delete_job",
      "run_job_now",
      "list_instances",
      "list_steps",
    ]),
    jobId: tool.schema.string().optional(),
    instanceId: tool.schema.string().optional(),
    limit: tool.schema.number().int().positive().optional(),
    job: tool.schema.unknown().optional(),
    patch: tool.schema.unknown().optional(),
  },
  async execute(rawArgs: {
    action:
      | "list_jobs"
      | "list_handlers"
      | "health"
      | "get_job"
      | "create_job"
      | "update_job"
      | "delete_job"
      | "run_job_now"
      | "list_instances"
      | "list_steps";
    jobId?: string;
    instanceId?: string;
    limit?: number;
    job?: unknown;
    patch?: unknown;
  }) {
    const args = argsSchema.parse(rawArgs);
    const payload = await postJson("/api/cron/manage", args);
    return JSON.stringify({
      ok: true,
      ...payload,
    });
  },
});
