import type { RuntimeEngine } from "../../contracts/runtime";
import { getSessionById } from "../../db/repository";
import { RuntimeSessionBusyError, RuntimeSessionNotFoundError, RuntimeTurnTimeoutError } from "../../runtime";

export function createChatRoutes(runtime: RuntimeEngine) {
  return {
    "/api/chat": {
      POST: async (req: Request) => {
        const body = (await req.json()) as { sessionId?: string; content?: string };
        const content = body.content?.trim();
        if (!body.sessionId || !content) {
          return Response.json({ error: "sessionId and content are required" }, { status: 400 });
        }

        let ack;
        try {
          ack = await runtime.sendUserMessage({
            sessionId: body.sessionId,
            content,
          });
        } catch (error) {
          if (error instanceof RuntimeSessionNotFoundError) {
            return Response.json({ error: "Unknown session" }, { status: 404 });
          }
          if (error instanceof RuntimeSessionBusyError) {
            return Response.json({ error: "Session is already processing a request" }, { status: 409 });
          }
          if (error instanceof RuntimeTurnTimeoutError) {
            return Response.json({ error: "Runtime timed out waiting for OpenCode to finish" }, { status: 504 });
          }
          const message = error instanceof Error ? error.message : "Runtime request failed";
          return Response.json({ error: message }, { status: 502 });
        }

        const session = getSessionById(ack.sessionId);
        if (!session) {
          return Response.json({ error: "Unknown session" }, { status: 404 });
        }

        return Response.json({
          messages: ack.messages,
          session,
        });
      },
    },
    "/api/chat/:id/abort": {
      POST: async (req: Request & { params: { id: string } }) => {
        if (!runtime.abortSession) {
          return Response.json({ error: "Runtime does not support abort" }, { status: 501 });
        }
        const session = getSessionById(req.params.id);
        if (!session) {
          return Response.json({ error: "Unknown session" }, { status: 404 });
        }
        const aborted = await runtime.abortSession(session.id);
        return Response.json({ aborted });
      },
    },
    "/api/chat/:id/compact": {
      POST: async (req: Request & { params: { id: string } }) => {
        if (!runtime.compactSession) {
          return Response.json({ error: "Runtime does not support compaction" }, { status: 501 });
        }
        const session = getSessionById(req.params.id);
        if (!session) {
          return Response.json({ error: "Unknown session" }, { status: 404 });
        }
        const compacted = await runtime.compactSession(session.id);
        return Response.json({ compacted });
      },
    },
  };
}
