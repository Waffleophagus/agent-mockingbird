import type { CronService } from "../../cron/service";
import { parseJsonWithSchema } from "../parsers";
import { cronJobCreateSchema, cronJobPatchSchema, cronManageSchema } from "../schemas";

export function createCronRoutes(cronService: CronService) {
  return {
    "/api/mockingbird/cron/health": {
      GET: async () => {
        try {
          return Response.json({ health: await cronService.getHealth() });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load cron health";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/mockingbird/cron/jobs": {
      GET: async () => {
        try {
          return Response.json({ jobs: await cronService.listJobs() });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load cron jobs";
          return Response.json({ error: message }, { status: 500 });
        }
      },
      POST: async (req: Request) => {
        const body = await parseJsonWithSchema(req, cronJobCreateSchema);
        if (!body.ok) {
          return body.response;
        }
        try {
          const job = await cronService.createJob(body.body);
          return Response.json({ job }, { status: 201 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to create cron job";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },

    "/api/mockingbird/cron/jobs/:id": {
      GET: async (req: Request & { params: { id: string } }) => {
        const job = await cronService.getJob(req.params.id);
        if (!job) {
          return Response.json({ error: "Unknown cron job" }, { status: 404 });
        }
        return Response.json({ job });
      },
      PATCH: async (req: Request & { params: { id: string } }) => {
        const body = await parseJsonWithSchema(req, cronJobPatchSchema);
        if (!body.ok) {
          return body.response;
        }
        try {
          const job = await cronService.updateJob(req.params.id, body.body);
          return Response.json({ job });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to update cron job";
          const status = message.startsWith("Unknown cron job:") ? 404 : 400;
          return Response.json({ error: message }, { status });
        }
      },
      DELETE: async (req: Request & { params: { id: string } }) => {
        const result = await cronService.deleteJob(req.params.id);
        if (!result.removed) {
          return Response.json({ error: "Unknown cron job" }, { status: 404 });
        }
        return Response.json(result);
      },
    },

    "/api/mockingbird/cron/jobs/:id/run": {
      POST: async (req: Request & { params: { id: string } }) => {
        try {
          const run = await cronService.runJobNow(req.params.id);
          return Response.json(run, { status: run.queued ? 202 : 409 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to queue cron run";
          const status = message.startsWith("Unknown cron job:") ? 404 : 400;
          return Response.json({ error: message }, { status });
        }
      },
    },

    "/api/mockingbird/cron/instances": {
      GET: async (req: Request) => {
        try {
          const url = new URL(req.url);
          const jobId = url.searchParams.get("jobId")?.trim() || undefined;
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw ? Number(limitRaw) : undefined;
          const instances = await cronService.listInstances({
            jobId,
            limit: typeof limit === "number" && Number.isFinite(limit) ? limit : undefined,
          });
          return Response.json({ instances });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load cron instances";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },

    "/api/mockingbird/cron/instances/:id/steps": {
      GET: async (req: Request & { params: { id: string } }) => {
        try {
          const steps = await cronService.listSteps(req.params.id);
          return Response.json({ steps });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load cron steps";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },

    "/api/mockingbird/cron/manage": {
      POST: async (req: Request) => {
        const body = await parseJsonWithSchema(req, cronManageSchema);
        if (!body.ok) {
          return body.response;
        }
        try {
          const command = body.body;
          switch (command.action) {
            case "list_jobs":
              return Response.json({ ok: true, action: command.action, jobs: await cronService.listJobs() });
            case "health":
              return Response.json({ ok: true, action: command.action, health: await cronService.getHealth() });
            case "get_job": {
              const job = await cronService.getJob(command.jobId);
              if (!job) {
                return Response.json({ error: "Unknown cron job" }, { status: 404 });
              }
              return Response.json({ ok: true, action: command.action, job });
            }
            case "create_job":
              return Response.json(
                { ok: true, action: command.action, job: await cronService.createJob(command.job) },
                { status: 201 },
              );
            case "upsert_job": {
              const upserted = await cronService.upsertJob(command.job);
              return Response.json({
                ok: true,
                action: command.action,
                created: upserted.created,
                job: upserted.job,
              });
            }
            case "update_job":
              return Response.json({
                ok: true,
                action: command.action,
                job: await cronService.updateJob(command.jobId, command.patch),
              });
            case "enable_job":
              return Response.json({
                ok: true,
                action: command.action,
                job: await cronService.updateJob(command.jobId, { enabled: true }),
              });
            case "disable_job":
              return Response.json({
                ok: true,
                action: command.action,
                job: await cronService.updateJob(command.jobId, { enabled: false }),
              });
            case "describe_contract":
              return Response.json({
                ok: true,
                action: command.action,
                contract: cronService.describeContract(),
              });
            case "delete_job":
              return Response.json({
                ok: true,
                action: command.action,
                ...(await cronService.deleteJob(command.jobId)),
              });
            case "run_job_now":
              return Response.json({
                ok: true,
                action: command.action,
                ...(await cronService.runJobNow(command.jobId)),
              });
            case "list_instances":
              return Response.json({
                ok: true,
                action: command.action,
                instances: await cronService.listInstances({
                  jobId: command.jobId,
                  limit: command.limit,
                }),
              });
            case "list_steps":
              return Response.json({
                ok: true,
                action: command.action,
                steps: await cronService.listSteps(command.instanceId),
              });
            default:
              return Response.json({ error: "Unsupported cron action" }, { status: 400 });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Cron manage request failed";
          const status = message.startsWith("Unknown cron job:") ? 404 : 400;
          return Response.json({ error: message }, { status });
        }
      },
    },
  };
}
