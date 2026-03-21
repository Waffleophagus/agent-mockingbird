import { z } from "zod";

const cronScheduleKindSchema = z.enum(["at", "every", "cron"]);
const cronRunModeSchema = z.enum(["background", "conditional_agent", "agent"]);
const cronPayloadSchema = z.record(z.string(), z.unknown());

const cronJobCreateSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  enabled: z.boolean().optional(),
  scheduleKind: cronScheduleKindSchema,
  scheduleExpr: z.string().min(1).nullable().optional(),
  everyMs: z.coerce.number().int().positive().nullable().optional(),
  atIso: z.string().min(1).nullable().optional(),
  timezone: z.string().min(1).nullable().optional(),
  runMode: cronRunModeSchema,
  conditionModulePath: z.string().min(1).nullable().optional(),
  conditionDescription: z.string().min(1).nullable().optional(),
  agentPromptTemplate: z.string().min(1).nullable().optional(),
  agentModelOverride: z.string().min(1).nullable().optional(),
  maxAttempts: z.coerce.number().int().positive().optional(),
  retryBackoffMs: z.coerce.number().int().positive().optional(),
  payload: cronPayloadSchema.optional(),
});

const cronJobPatchSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  scheduleKind: cronScheduleKindSchema.optional(),
  scheduleExpr: z.string().min(1).nullable().optional(),
  everyMs: z.coerce.number().int().positive().nullable().optional(),
  atIso: z.string().min(1).nullable().optional(),
  timezone: z.string().min(1).nullable().optional(),
  runMode: cronRunModeSchema.optional(),
  conditionModulePath: z.string().min(1).nullable().optional(),
  conditionDescription: z.string().min(1).nullable().optional(),
  agentPromptTemplate: z.string().min(1).nullable().optional(),
  agentModelOverride: z.string().min(1).nullable().optional(),
  maxAttempts: z.coerce.number().int().positive().optional(),
  retryBackoffMs: z.coerce.number().int().positive().optional(),
  payload: cronPayloadSchema.optional(),
});

const cronManageSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_jobs") }),
  z.object({ action: z.literal("health") }),
  z.object({ action: z.literal("get_job"), jobId: z.string().min(1) }),
  z.object({ action: z.literal("create_job"), job: cronJobCreateSchema }),
  z.object({ action: z.literal("upsert_job"), job: cronJobCreateSchema }),
  z.object({ action: z.literal("update_job"), jobId: z.string().min(1), patch: cronJobPatchSchema }),
  z.object({ action: z.literal("enable_job"), jobId: z.string().min(1) }),
  z.object({ action: z.literal("disable_job"), jobId: z.string().min(1) }),
  z.object({ action: z.literal("describe_contract") }),
  z.object({ action: z.literal("delete_job"), jobId: z.string().min(1) }),
  z.object({ action: z.literal("run_job_now"), jobId: z.string().min(1) }),
  z.object({
    action: z.literal("list_instances"),
    jobId: z.string().min(1).optional(),
    limit: z.coerce.number().int().positive().optional(),
  }),
  z.object({ action: z.literal("list_steps"), instanceId: z.string().min(1) }),
]);

export { cronJobCreateSchema, cronJobPatchSchema, cronManageSchema };
