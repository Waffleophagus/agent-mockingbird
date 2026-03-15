import { z } from "zod";

import { applyConfigPatch, getConfigSnapshot, replaceConfig } from "../../config/service";
import {
  buildAgentMockingbirdCompactionContext,
  buildAgentMockingbirdSystemPrompt,
} from "../../opencode/systemPrompt";

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
        cron: z.record(z.string(), z.unknown()).optional(),
        channels: z.record(z.string(), z.unknown()).optional(),
      })
      .partial()
      .optional(),
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
        cron: snapshot.config.runtime.cron,
        channels: snapshot.config.runtime.channels,
      },
    },
  };
}

export function createRuntimeRoutes() {
  return {
    "/api/waffle/runtime/pinned-workspace": {
      GET: () => {
        const snapshot = getConfigSnapshot();
        return Response.json({
          directory: snapshot.config.workspace.pinnedDirectory,
          hash: snapshot.hash,
        });
      },
    },

    "/api/waffle/runtime/config": {
      GET: () => Response.json(buildRuntimePayload()),
      PATCH: async (req: Request) => {
        const body = (await req.json()) as Record<string, unknown>;
        const parsed = runtimePatchSchema.safeParse(body.patch ?? body);
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.issues[0]?.message ?? "Invalid runtime config patch" },
            { status: 400 },
          );
        }

        try {
          const result = await applyConfigPatch({
            patch: parsed.data,
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

    "/api/waffle/runtime/config/replace": {
      POST: async (req: Request) => {
        const body = (await req.json()) as { config?: unknown; expectedHash?: unknown };
        try {
          const result = await replaceConfig({
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

    "/api/waffle/runtime/info": {
      GET: () => {
        const snapshot = getConfigSnapshot();
        return Response.json({
          hash: snapshot.hash,
          path: snapshot.path,
          pinnedWorkspace: snapshot.config.workspace.pinnedDirectory,
          opencode: {
            baseUrl: snapshot.config.runtime.opencode.baseUrl,
            directory: snapshot.config.runtime.opencode.directory,
            timeoutMs: snapshot.config.runtime.opencode.timeoutMs,
          },
        });
      },
    },

    "/api/waffle/runtime/system-prompt": {
      GET: () =>
        Response.json({
          system: buildAgentMockingbirdSystemPrompt() ?? "",
        }),
    },

    "/api/waffle/runtime/compaction-context": {
      GET: () =>
        Response.json({
          context: buildAgentMockingbirdCompactionContext(),
        }),
    },
  };
}
