import { z } from "zod";

import { getOpencodeAgentStorageInfo } from "../../agents/opencodeConfig";
import { applyConfigPatchSafe, getConfigSnapshot, replaceConfigSafe } from "../../config/service";
import type { CronService } from "../../cron/service";
import {
  buildAgentMockingbirdCompactionPrompt,
  buildAgentMockingbirdCompactionContext,
  buildAgentMockingbirdSystemPrompt,
} from "../../opencode/systemPrompt";
import { resolveRuntimeSessionScope } from "../../runtime/sessionScope";
import { parseJsonWithSchema } from "../parsers";

const runtimePatchSchema = z
  .object({
    workspace: z
      .object({
        pinnedDirectory: z.string().min(1).optional(),
      })
      .partial()
      .optional(),
    runtime: z
      .object({
        memory: z.record(z.string(), z.unknown()).optional(),
        heartbeat: z.record(z.string(), z.unknown()).optional(),
        agentHeartbeats: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
        cron: z.record(z.string(), z.unknown()).optional(),
      })
      .partial()
      .optional(),
  })
  .strict();

const runtimeConfigPatchRequestSchema = z
  .object({
    patch: runtimePatchSchema.optional(),
    expectedHash: z.unknown().optional(),
  })
  .passthrough();

const runtimeReplaceBodySchema = z
  .object({
    config: z.unknown().optional(),
    expectedHash: z.unknown().optional(),
  })
  .strict();

const notifyMainThreadBodySchema = z
  .object({
    sessionId: z.unknown().optional(),
    prompt: z.unknown().optional(),
    severity: z.unknown().optional(),
  })
  .strict();

function buildRuntimePayload() {
  const snapshot = getConfigSnapshot();
  return {
    hash: snapshot.hash,
    path: snapshot.path,
    config: {
      workspace: snapshot.config.workspace,
      runtime: {
        memory: snapshot.config.runtime.memory,
        heartbeat: snapshot.config.runtime.heartbeat,
        agentHeartbeats: snapshot.config.runtime.agentHeartbeats,
        cron: snapshot.config.runtime.cron,
      },
    },
  };
}

export function createRuntimeRoutes(input: { cronService: CronService }) {
  return {
    "/api/mockingbird/runtime/pinned-workspace": {
      GET: () => {
        const snapshot = getConfigSnapshot();
        return Response.json({
          directory: snapshot.config.workspace.pinnedDirectory,
          hash: snapshot.hash,
        });
      },
    },

    "/api/mockingbird/runtime/config": {
      GET: () => Response.json(buildRuntimePayload()),
      PATCH: async (req: Request) => {
        const parsedBody = await parseJsonWithSchema(req, runtimeConfigPatchRequestSchema);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }
        const body = parsedBody.body;
        const patchCandidate = body.patch ?? body;
        const parsedPatch = runtimePatchSchema.safeParse(patchCandidate);
        if (!parsedPatch.success) {
          return Response.json(
            { error: parsedPatch.error.issues[0]?.message ?? "Invalid runtime config patch" },
            { status: 400 },
          );
        }

        try {
          const result = await applyConfigPatchSafe({
            patch: parsedPatch.data,
            expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
            runSmokeTest: false,
          });
          return Response.json({
            ...buildRuntimePayload(),
            hash: result.snapshot.hash,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to update runtime config";
          const status = message.includes("refresh and retry") ? 409 : 400;
          return Response.json({ error: message }, { status });
        }
      },
    },

    "/api/mockingbird/runtime/config/replace": {
      POST: async (req: Request) => {
        const parsedBody = await parseJsonWithSchema(req, runtimeReplaceBodySchema);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }
        const body = parsedBody.body;
        try {
          const result = await replaceConfigSafe({
            config: body.config,
            expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
            runSmokeTest: false,
          });
          return Response.json({
            ...buildRuntimePayload(),
            hash: result.snapshot.hash,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to replace runtime config";
          const status = message.includes("refresh and retry") ? 409 : 400;
          return Response.json({ error: message }, { status });
        }
      },
    },

    "/api/mockingbird/runtime/info": {
      GET: () => {
        const snapshot = getConfigSnapshot();
        const storage = getOpencodeAgentStorageInfo(snapshot.config);
        return Response.json({
          hash: snapshot.hash,
          path: snapshot.path,
          pinnedWorkspace: snapshot.config.workspace.pinnedDirectory,
          opencode: {
            baseUrl: snapshot.config.runtime.opencode.baseUrl,
            workspaceDirectory: snapshot.config.runtime.opencode.directory,
            configDirectory: storage.configDirectory,
            effectiveConfigPath: storage.configFilePath,
            timeoutMs: snapshot.config.runtime.opencode.timeoutMs,
          },
        });
      },
    },

    "/api/mockingbird/runtime/system-prompt": {
      GET: () =>
        Response.json({
          system: buildAgentMockingbirdSystemPrompt() ?? "",
        }),
    },

    "/api/mockingbird/runtime/compaction-context": {
      GET: (req: Request) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId")?.trim() || undefined;
        return Response.json({
          prompt: buildAgentMockingbirdCompactionPrompt(sessionId),
          context: buildAgentMockingbirdCompactionContext(sessionId),
        });
      },
    },

    "/api/mockingbird/runtime/session-scope": {
      GET: (req: Request) => {
        const sessionId = new URL(req.url).searchParams.get("sessionId")?.trim() ?? "";
        if (!sessionId) {
          return Response.json({ error: "sessionId is required" }, { status: 400 });
        }

        return Response.json(resolveRuntimeSessionScope(sessionId, input.cronService));
      },
    },

    "/api/mockingbird/runtime/notify-main-thread": {
      POST: async (req: Request) => {
        const parsedBody = await parseJsonWithSchema(req, notifyMainThreadBodySchema);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }
        const body = parsedBody.body;
        const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
        const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
        const severity =
          body.severity === "info" || body.severity === "warn" || body.severity === "critical"
            ? body.severity
            : undefined;
        if (!sessionId) {
          return Response.json({ error: "sessionId is required" }, { status: 400 });
        }
        if (!prompt) {
          return Response.json({ error: "prompt is required" }, { status: 400 });
        }

        try {
          const result = await input.cronService.notifyMainThread({
            runtimeSessionId: sessionId,
            prompt,
            severity,
          });
          return Response.json({ ok: true, ...result });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to notify main thread";
          const status =
            message === "Unknown runtime session" ||
            message === "notify_main_thread is only available from cron or heartbeat threads"
              ? 403
              : 400;
          return Response.json({ error: message }, { status });
        }
      },
    },
  };
}
