import { getConfigSnapshot } from "../../config/service";
import { getSessionById } from "../../db/repository";
import type { RunService } from "../../run/service";
import type { AgentRunEvent } from "../../run/types";

function runStreamConfig() {
  return getConfigSnapshot().config.runtime.runStream;
}

function parseAfterSeq(req: Request) {
  const url = new URL(req.url);
  const queryRaw = url.searchParams.get("afterSeq") ?? url.searchParams.get("after");
  const headerRaw = req.headers.get("last-event-id");
  const queryAfter = Number(queryRaw);
  const headerAfter = Number(headerRaw);
  const normalizedQuery = Number.isFinite(queryAfter) ? Math.max(0, Math.floor(queryAfter)) : 0;
  const normalizedHeader = Number.isFinite(headerAfter) ? Math.max(0, Math.floor(headerAfter)) : 0;
  return Math.max(normalizedQuery, normalizedHeader);
}

function toRunEventFrame(event: AgentRunEvent) {
  return `id: ${event.seq}\nevent: run-event\ndata: ${JSON.stringify(event)}\n\n`;
}

function toRunHeartbeatFrame(runId: string) {
  return `event: run-heartbeat\ndata: ${JSON.stringify({ runId, at: new Date().toISOString() })}\n\n`;
}

export function createRunRoutes(runService: RunService) {
  return {
    "/api/runs": {
      POST: async (req: Request) => {
        const body = (await req.json()) as {
          sessionId?: string;
          content?: string;
          agent?: string;
          metadata?: Record<string, unknown>;
          idempotencyKey?: string;
        };

        const sessionId = body.sessionId?.trim();
        const content = body.content?.trim();
        if (!sessionId || !content) {
          return Response.json({ error: "sessionId and content are required" }, { status: 400 });
        }
        if (!getSessionById(sessionId)) {
          return Response.json({ error: "Unknown session" }, { status: 404 });
        }

        const metadata =
          body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
            ? body.metadata
            : undefined;
        const agent = typeof body.agent === "string" ? body.agent.trim() || undefined : undefined;
        const idempotencyKey = body.idempotencyKey?.trim() || undefined;

        try {
          const result = runService.createRun({
            sessionId,
            content,
            agent,
            metadata,
            idempotencyKey,
          });
          return Response.json(
            {
              accepted: true,
              deduplicated: result.deduplicated,
              runId: result.run.id,
              run: result.run,
            },
            { status: result.deduplicated ? 200 : 202 },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to queue run";
          if (message.startsWith("Unknown session:")) {
            return Response.json({ error: "Unknown session" }, { status: 404 });
          }
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },

    "/api/runs/:id": {
      GET: async (req: Request & { params: { id: string } }) => {
        const run = runService.getRunById(req.params.id);
        if (!run) {
          return Response.json({ error: "Unknown run" }, { status: 404 });
        }
        return Response.json({ run });
      },
    },

    "/api/runs/:id/events": {
      GET: async (req: Request & { params: { id: string } }) => {
        const run = runService.getRunById(req.params.id);
        if (!run) {
          return Response.json({ error: "Unknown run" }, { status: 404 });
        }

        const url = new URL(req.url);
        const afterRaw = url.searchParams.get("afterSeq") ?? url.searchParams.get("after") ?? "0";
        const limitRaw = url.searchParams.get("limit") ?? "100";
        const afterSeq = Number(afterRaw);
        const limit = Number(limitRaw);

        const replay = runService.listRunEvents({
          runId: run.id,
          afterSeq: Number.isFinite(afterSeq) ? afterSeq : 0,
          limit: Number.isFinite(limit) ? limit : 100,
        });

        return Response.json({
          runId: run.id,
          afterSeq: Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0,
          events: replay.events,
          nextAfterSeq: replay.nextAfterSeq,
          hasMore: replay.hasMore,
        });
      },
    },

    "/api/runs/:id/events/stream": {
      GET: (req: Request & { params: { id: string } }) => {
        const run = runService.getRunById(req.params.id);
        if (!run) {
          return Response.json({ error: "Unknown run" }, { status: 404 });
        }

        const runId = run.id;
        const initialAfterSeq = parseAfterSeq(req);

        let streamController: ReadableStreamDefaultController<string> | null = null;
        let unsubscribe: (() => void) | null = null;
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
        let closed = false;
        let cursor = initialAfterSeq;

        const close = () => {
          if (closed) return;
          closed = true;
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
          if (streamController) {
            try {
              streamController.close();
            } catch {
              // stream already closed
            }
            streamController = null;
          }
        };

        const emit = (event: AgentRunEvent) => {
          if (closed || !streamController) return;
          if (event.seq <= cursor) return;
          cursor = event.seq;
          try {
            streamController.enqueue(toRunEventFrame(event));
          } catch {
            close();
            return;
          }
          if (event.type === "run.completed" || event.type === "run.failed") {
            close();
          }
        };

        const stream = new ReadableStream<string>({
          start(controller) {
            streamController = controller;
            unsubscribe = runService.subscribe(event => {
              if (event.runId !== runId) return;
              emit(event);
            });

            while (!closed) {
              const replay = runService.listRunEvents({
                runId,
                afterSeq: cursor,
                limit: runStreamConfig().replayPageSize,
              });
              if (!replay.events.length) break;
              for (const event of replay.events) {
                emit(event);
                if (closed) return;
              }
              if (!replay.hasMore) break;
            }

            if (closed) return;
            const latestRun = runService.getRunById(runId);
            if (latestRun?.state === "completed" || latestRun?.state === "failed") {
              close();
              return;
            }

            heartbeatTimer = setInterval(() => {
              if (closed || !streamController) return;
              try {
                streamController.enqueue(toRunHeartbeatFrame(runId));
              } catch {
                close();
              }
            }, runStreamConfig().heartbeatMs);
          },
          cancel() {
            close();
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  };
}
