import {
  createSession,
  getDashboardBootstrap,
  getSessionById,
  listMessagesForSession,
  listSessions,
  setSessionModel,
} from "../../db/repository";
import { listOpencodeModelOptions } from "../../opencode/models";

export function createDashboardRoutes() {
  return {
    "/api/health": () =>
      Response.json({
        status: "ok",
        now: new Date().toISOString(),
      }),

    "/api/dashboard/bootstrap": () => Response.json(getDashboardBootstrap()),

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
