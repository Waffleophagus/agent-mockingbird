import type { RuntimeEngine } from "../../contracts/runtime";
import {
  createSession,
  getDashboardBootstrap,
  getSessionById,
  listMessagesForSession,
  listSessions,
  setSessionModel,
} from "../../db/repository";
import { listOpencodeModelOptions } from "../../opencode/models";

export function createDashboardRoutes(runtime: RuntimeEngine) {
  return {
    "/api/health": () =>
      Response.json({
        status: "ok",
        now: new Date().toISOString(),
      }),

    "/api/dashboard/bootstrap": () => Response.json(getDashboardBootstrap()),

    "/api/runtime/health": {
      GET: async (req: Request) => {
        if (!runtime.checkHealth) {
          return Response.json({ error: "Runtime health checks are not supported by this runtime" }, { status: 501 });
        }

        const force = (() => {
          const value = new URL(req.url).searchParams.get("force");
          if (!value) return false;
          const normalized = value.trim().toLowerCase();
          return normalized === "1" || normalized === "true" || normalized === "yes";
        })();

        try {
          const health = await runtime.checkHealth({ force });
          return Response.json({ health }, { status: health.ok ? 200 : 503 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Runtime health check failed";
          return Response.json({ error: message }, { status: 503 });
        }
      },
    },

    "/api/sessions": {
      GET: () => Response.json({ sessions: listSessions() }),
      POST: async (req: Request) => {
        const body = (await req.json()) as { title?: string; model?: string } | null;
        const session = createSession({
          title: body?.title,
          model: body?.model,
        });
        return Response.json({ session }, { status: 201 });
      },
    },

    "/api/sessions/:id/messages": (req: Request & { params: { id: string } }) => {
      const sessionId = req.params.id;
      const session = getSessionById(sessionId);
      if (!session) {
        return Response.json({ error: "Unknown session" }, { status: 404 });
      }
      return Response.json({
        sessionId,
        messages: listMessagesForSession(sessionId),
      });
    },

    "/api/sessions/:id/model": {
      PUT: async (req: Request & { params: { id: string } }) => {
        const sessionId = req.params.id;
        const body = (await req.json()) as { model?: string };
        const model = body.model?.trim();
        if (!model) {
          return Response.json({ error: "model is required" }, { status: 400 });
        }
        const session = setSessionModel(sessionId, model);
        if (!session) {
          return Response.json({ error: "Unknown session" }, { status: 404 });
        }
        return Response.json({ session });
      },
    },

    "/api/opencode/models": {
      GET: async () => {
        try {
          const models = await listOpencodeModelOptions();
          return Response.json({ models });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load models";
          return Response.json({ models: [], error: message }, { status: 502 });
        }
      },
    },
  };
}
