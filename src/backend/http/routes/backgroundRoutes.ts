import type { RuntimeEngine } from "../../contracts/runtime";
import type { RuntimeInputPart } from "../../contracts/runtime";
import { getSessionById } from "../../db/repository";

function parseBoolean(value: string | null) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeRuntimeInputParts(value: unknown): RuntimeInputPart[] {
  if (!Array.isArray(value)) return [];
  const parts: RuntimeInputPart[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    if (record.type === "text") {
      const text = typeof record.text === "string" ? record.text : "";
      if (!text.trim()) continue;
      parts.push({ type: "text", text });
      continue;
    }
    if (record.type === "file") {
      const mime = typeof record.mime === "string" ? record.mime.trim() : "";
      const url = typeof record.url === "string" ? record.url.trim() : "";
      const filename = typeof record.filename === "string" ? record.filename.trim() || undefined : undefined;
      if (!mime || !url) continue;
      parts.push({ type: "file", mime, url, filename });
    }
  }
  return parts;
}

export function createBackgroundRoutes(runtime: RuntimeEngine) {
  return {
    "/api/background": {
      GET: async (req: Request) => {
        if (!runtime.listBackgroundRuns) {
          return Response.json({ error: "Runtime does not support background listing" }, { status: 501 });
        }
        try {
          const url = new URL(req.url);
          const parentSessionId = url.searchParams.get("sessionId")?.trim() || undefined;
          const limitRaw = Number(url.searchParams.get("limit") ?? "100");
          const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100;
          const inFlightOnly = parseBoolean(url.searchParams.get("inFlightOnly"));
          const runs = await runtime.listBackgroundRuns({
            parentSessionId,
            limit,
            inFlightOnly,
          });
          return Response.json({ runs });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to list background runs";
          return Response.json({ error: message }, { status: 502 });
        }
      },
      POST: async (req: Request) => {
        if (!runtime.spawnBackgroundSession) {
          return Response.json({ error: "Runtime does not support background sessions" }, { status: 501 });
        }

        const body = (await req.json()) as {
          sessionId?: string;
          title?: string;
          requestedBy?: string;
          prompt?: string;
          parts?: RuntimeInputPart[];
          model?: string;
          system?: string;
          agent?: string;
          noReply?: boolean;
        };
        const sessionId = body.sessionId?.trim();
        if (!sessionId) {
          return Response.json({ error: "sessionId is required" }, { status: 400 });
        }
        if (!getSessionById(sessionId)) {
          return Response.json({ error: "Unknown session" }, { status: 404 });
        }

        const parts = normalizeRuntimeInputParts(body.parts);
        try {
          const run = await runtime.spawnBackgroundSession({
            parentSessionId: sessionId,
            title: body.title,
            requestedBy: body.requestedBy,
            prompt: body.prompt,
          });
          if (body.prompt?.trim() || parts.length > 0) {
            if (!runtime.promptBackgroundAsync) {
              return Response.json({ error: "Runtime does not support background prompting" }, { status: 501 });
            }
            const updated = await runtime.promptBackgroundAsync({
              runId: run.runId,
              content: body.prompt?.trim() ?? "",
              parts,
              model: body.model,
              system: body.system,
              agent: body.agent,
              noReply: body.noReply,
            });
            return Response.json({ run: updated }, { status: 202 });
          }
          return Response.json({ run }, { status: 202 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to spawn background run";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    "/api/background/:id": {
      GET: async (req: Request & { params: { id: string } }) => {
        if (!runtime.getBackgroundStatus) {
          return Response.json({ error: "Runtime does not support background status" }, { status: 501 });
        }
        try {
          const run = await runtime.getBackgroundStatus(req.params.id);
          if (!run) {
            return Response.json({ error: "Unknown background run" }, { status: 404 });
          }
          return Response.json({ run });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to fetch background run";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    "/api/background/:id/abort": {
      POST: async (req: Request & { params: { id: string } }) => {
        if (!runtime.abortBackground) {
          return Response.json({ error: "Runtime does not support background abort" }, { status: 501 });
        }
        try {
          const aborted = await runtime.abortBackground(req.params.id);
          return Response.json({ aborted });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to abort background run";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    "/api/background/:id/steer": {
      POST: async (req: Request & { params: { id: string } }) => {
        if (!runtime.promptBackgroundAsync) {
          return Response.json({ error: "Runtime does not support background steering" }, { status: 501 });
        }
        const body = (await req.json()) as {
          content?: string;
          parts?: RuntimeInputPart[];
          model?: string;
          system?: string;
          agent?: string;
          noReply?: boolean;
        };
        const content = body.content?.trim();
        const parts = normalizeRuntimeInputParts(body.parts);
        if (!content && parts.length === 0) {
          return Response.json({ error: "content or parts is required" }, { status: 400 });
        }
        try {
          const run = await runtime.promptBackgroundAsync({
            runId: req.params.id,
            content: content ?? "",
            parts,
            model: body.model,
            system: body.system,
            agent: body.agent,
            noReply: body.noReply,
          });
          return Response.json({ run }, { status: 202 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to steer background run";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    "/api/sessions/:id/background": {
      GET: async (req: Request & { params: { id: string } }) => {
        if (!runtime.listBackgroundRuns) {
          return Response.json({ error: "Runtime does not support background listing" }, { status: 501 });
        }
        const session = getSessionById(req.params.id);
        if (!session) {
          return Response.json({ error: "Unknown session" }, { status: 404 });
        }
        try {
          const runs = await runtime.listBackgroundRuns({
            parentSessionId: req.params.id,
            limit: 200,
          });
          return Response.json({ runs });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to list session background runs";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  };
}
